// frontend-vite/src/components/hero/ThreeScene.tsx
//
// ThreeScene — pure three renderer. No React state.
//
// Responsibilities:
//   - WebGLRenderer + Scene + PerspectiveCamera + Lights
//   - InstancedMesh of N icosahedrons (A/B alternating)
//   - GLSL vertex displacement (uTime + uMouse bump) + emissive fragment modulation
//   - RAF tick: stepCluster + write instanceMatrix + update uniforms
//   - DPR cap + visibility gate + cleanup (StrictMode-safe)
//   - ScrollTrigger: drive camera dolly + cluster rotation as hero scrolls out
//   - Mouse world position: derived from ndcRef + own camera in RAF (pointer.worldRef
//     may be null when hook is created with camera=null — see B2 fix below)

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import {
  commonInjection as vertexCommonInjection,
} from './shaders/vertex.glsl'
import {
  commonInjection as fragmentCommonInjection,
} from './shaders/fragment.glsl'
import {
  buildCluster,
  stepCluster,
  applyClusterStep,
  assignGeometryTypes,
  type ClusterNode,
  type GeometryKind,
  type Vec3Like,
} from './geometryCluster'
import type { PointerGravityRefs } from './usePointerGravity'
import type { GpuTier } from './useHeroCapability'
import { buildParticleCloud } from './particleCloud'

// Deterministic per-tiny-seed so pulse phases line up across StrictMode
// remounts the same way mulberry32(42) does for the particle cloud. Kept
// here (not in geometryCluster) because it's exclusive to the per-instance
// pulse logic added in T9.
function pulseRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ThreeSceneProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  tier: GpuTier
  pointer: PointerGravityRefs
}

const TIER_INSTANCE_COUNT: Record<GpuTier, number> = {
  high: 3,
  mid: 3,
  low: 2,
  none: 0,
}

const TIER_DPR_CAP: Record<GpuTier, number> = {
  high: 2,
  mid: 1.5,
  low: 1,
  none: 1,
}

// Bloom post-processing config.
// Subtle bloom: only the brightest 3% of HDR hero stars reach threshold 0.4.
// Strength 0.5 keeps the dark navy sky intact instead of washing it out.
const BLOOM_STRENGTH = 0.5
const BLOOM_RADIUS = 0.40
const BLOOM_THRESHOLD = 0.40
const BLOOM_RES_SCALE = 0.5 // composer renders at half-resolution

// T5: center attraction — only the hero node (index 0) is pulled toward the
// cursor's world position, within 3.2 units and capped per frame. Mutates
// node.basePos in place; stepCluster's return-to-base force provides the
// counter-spring so it drifts rather than sticks.
function applyCenterAttraction(node: ClusterNode, mouseWorld: Vec3Like, dt: number) {
  if (node.index !== 0) return
  const dx = mouseWorld.x - node.basePos.x
  const dy = mouseWorld.y - node.basePos.y
  const dz = mouseWorld.z - node.basePos.z
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (dist < 3.2 && dist > 0.001) {
    const force = Math.pow(1 - dist / 3.2, 2)
    const dtScale = Math.min(dt * 60, 4)
    const invDist = 1 / dist
    node.basePos.x += dx * invDist * 0.08 * force * dtScale
    node.basePos.y += dy * invDist * 0.08 * force * dtScale
    node.basePos.z += dz * invDist * 0.08 * force * dtScale
  }
}

export function ThreeScene({ canvasRef, tier, pointer }: ThreeSceneProps) {
  const sceneStateRef = useRef<{
    renderer?: THREE.WebGLRenderer
    scene?: THREE.Scene
    camera?: THREE.PerspectiveCamera
    meshes?: THREE.InstancedMesh[]
    materials?: THREE.Material[]
    geometries?: THREE.BufferGeometry[]
    nodes?: ClusterNode[]
    raf?: number
    running?: boolean
    startTime?: number
    lastTime?: number
    scrollExitT?: number
    composer?: EffectComposer
    bloomPass?: UnrealBloomPass
    useComposer?: boolean
  }>({})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (tier === 'none') return

    const count = TIER_INSTANCE_COUNT[tier]
    const dprCap = TIER_DPR_CAP[tier]
    // Bloom gate: high & mid tiers get UnrealBloomPass via EffectComposer;
    // low tier skips composer (renders direct) and relies on material emissive
    // + CSS halo overlay. 'none' tier is handled by early-return above.
    const useComposer = tier === 'high' || tier === 'mid'
    console.info('[ThreeScene] bloom:', tier)

    // 1. Renderer — wrap in try/catch: if context creation fails (e.g. context-lost
    // cascade from a prior failed mount in StrictMode), bail out cleanly so the
    // ErrorBoundary doesn't trip. HeroFallback will be tried by the parent gate.
    let renderer: THREE.WebGLRenderer
    try {
      // Diagnose: log what's wrong if init fails.
      // Important: do NOT call canvas.getContext() here without preserveDrawingBuffer
      // because a successful call "locks" the context attributes — subsequent
      // WebGLRenderer init (which passes preserveDrawingBuffer: true) would silently
      // receive the existing context with the wrong attrs, breaking readPixels.
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: tier !== 'low',
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      })
    } catch (err) {
      console.warn('[ThreeScene] WebGLRenderer init failed, skipping:', err)
      return
    }
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap))

    // T7: Pause RAF when the hero is scrolled out of the viewport. The
    // existing visibilitychange handler stops on tab-hide; this stops on
    // scroll-past, which is the common case. We don't tear down the scene
    // — just skip the per-frame uniform writes + render until we're back.
    // Bounded to the .hero-immersive wrapper (canvas.parentElement).
    const heroEl = canvas.parentElement
    let isInView = true
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          isInView = entry.isIntersecting
        }
      },
      { threshold: 0 },
    )
    if (heroEl) observer.observe(heroEl)

    // 2. Scene + camera
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 6)

    // 3. Lights — warm gold key + cool blue hemi. Key intensity bumped so
    //    the day/night terminator reads clearly on the planet bodies.
    const key = new THREE.DirectionalLight(0xffd89b, 1.8)
    key.position.set(3, 4, 4)
    const hemi = new THREE.HemisphereLight(0x1a2e5a, 0x0f172a, 0.45)
    scene.add(key, hemi)

    // 4. Geometries + materials — two InstancedMesh instances by type.
    //    Restyled as "celestial planets in a starfield" — dark body with gold
    //    rim light + soft emissive inner glow, NOT metallic gold clusters.
    //    icosa: warm dark planet (deep umber body + amber emissive core
    //    + Fresnel gold rim). dodec: cold gas giant (deep navy body + cool blue
    //    emissive + silver rim). Shader injection adds the Fresnel rim and a
    //    subtle horizontal "atmosphere band" via emissive modulation.
    // Planet geometry: SphereGeometry with high segment counts gives a
    // perfectly round silhouette at hero scale.
    //   - icosaSphere: 96×64 segments = 12,288 quads → silky-smooth hero body
    //   - dodecSphere: 64×48 segments = 6,144 quads → smooth gas giant
    // Earlier (320-face IcosahedronGeometry(1,2) + 80-face DodecahedronGeometry(1,1))
    // showed visible facets on the blue dodec at upper-left, which read as a
    // faceted gem instead of a celestial body. SphereGeometry guarantees a
    // round silhouette regardless of viewport size.
    const icosaGeometry = new THREE.SphereGeometry(1, 96, 64)
    const dodecGeometry = new THREE.SphereGeometry(1, 64, 48)
    // Saturn ring (annulus) geometry — flat ring in the XZ plane. One geometry
    // is shared by ALL planet ring instances; the per-planet tilt is baked
    // into the InstancedMesh's per-instance matrix so every planet ends up
    // with the same 25-degree ring tilt (Saturn-style).
    //   innerRadius 1.30 → just outside the planet's 1.0 surface
    //   outerRadius 1.85 → ~85% of the body, never overlaps neighbors
    //   thetaSegments 96 → smooth circular silhouette (3.75deg / segment)
    //   phiSegments  1   → open ring (no radial subdivision — just
    //                       one quad between inner and outer radius)
    // NOTE: RingGeometry's parameter order is (inner, outer, theta, phi).
    // Earlier (1, 96) was misordered; theta=1 is bumped to 3 by
    // Math.max(3, theta), producing a 4-vertex polygon instead of a
    // smooth ring.
    // Two ring geometries with deliberately different tilts so the two
    // Saturns in the scene don't look like clones of each other.  The
    // icosa ring tilts +25° around X (back of ring goes up, front goes
    // down — the classic Saturn silhouette). The dodec ring is viewed almost
    // edge-on at +78° around X so its projected ellipse stays near horizontal,
    // with a subtle +3° rotation around Z to avoid a mechanically flat line.
    const icosaRingGeometry = new THREE.RingGeometry(1.30, 1.85, 96, 1)
    icosaRingGeometry.rotateX(Math.PI * 25 / 180)
    const dodecRingGeometry = new THREE.RingGeometry(1.30, 1.85, 96, 1)
    dodecRingGeometry.rotateX(Math.PI * 78 / 180)
    dodecRingGeometry.rotateZ(Math.PI * 3 / 180)
    // After the tilt, RingGeometry's UVs are no longer (radius, angle) — they
    // are (x, y) in object space, which is what we need for radial alpha
    // falloff and angular banded shading. We compute radius from the local
    // position attribute so the shader can ignore the baked rotation.

    // Saturn ring material factory — one material per planet family so warm
    // icosa planets get tan/gold rings and cool dodec planets get pale silver
    // rings. Custom ShaderMaterial (not MeshStandardMaterial) because the
    // ring's appearance is dominated by its own radial alpha + banded
    // shading, and we want a single, predictable result without lighting
    // calculations getting in the way.
    //   - transparent + depthWrite false + DoubleSide: front half of the
    //     ring draws on top of the planet (renderOrder puts it after the
    //     InstancedMesh planets), back half is occluded by the planet's
    //     depth because depthTest stays enabled. Result: ring appears to
    //     pass behind the planet on the far side, in front on the near
    //     side — exactly the Saturn silhouette.
    //   - The alpha curve is shaped by uv (post-tilt x is the radial axis,
    //     y is angular). Smoothstep on |uv.x| gives a soft inner/outer edge
    //     so the ring doesn't read as a hard plastic annulus.
    const makeRingMaterial = (tint: THREE.Color, tiltX: number, tiltZ: number) => new THREE.ShaderMaterial({
      uniforms: {
        uTint: { value: tint.clone() },
        uTiltX: { value: tiltX },
        uTiltZ: { value: tiltZ },
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocalPos;
        void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vLocalPos;
        uniform vec3 uTint;
        uniform float uTiltX;
        uniform float uTiltZ;
        void main() {
        // RingGeometry is built in the XY plane (z=0), so a rotation
        // around X preserves every point's distance from the origin —
        // that distance is the radial coordinate we want. Using
        // length(vLocalPos) keeps the bands/cassini-gap math correct
        // regardless of where on the ring the fragment is.
        float r = length(vLocalPos);
        // Recover the original XY-plane coordinates by undoing the baked
        // Z rotation first, then the X rotation.
        float cosX = cos(uTiltX);
        float sinX = sin(uTiltX);
        float cosZ = cos(uTiltZ);
        float sinZ = sin(uTiltZ);
        float xAfterZ = vLocalPos.x * cosZ + vLocalPos.y * sinZ;
        float yAfterZ = -vLocalPos.x * sinZ + vLocalPos.y * cosZ;
        float yOrig = yAfterZ * cosX + vLocalPos.z * sinX;
        float xOrig = xAfterZ;
        float angle = atan(yOrig, xOrig);
        // Map r to [0..1] across the ring width.
        float rNorm = clamp((r - 1.30) / (1.85 - 1.30), 0.0, 1.0);
        // Soft alpha falloff at inner and outer edges.
        float edgeFade = smoothstep(0.0, 0.15, rNorm) * smoothstep(1.0, 0.85, rNorm);
        // Cassini-style dark gap at ~55% radius (the famous Saturn division).
        float gap = smoothstep(0.06, 0.0, abs(rNorm - 0.55));
        // Concentric micro-bands: subtle sin in radius gives a "dusty
        // ring" texture without requiring an image asset.
        float microBand = 0.5 + 0.5 * sin(rNorm * 70.0);
        float micro = mix(0.82, 1.05, microBand);
        // Slight angular variation so the ring isn't a perfect cylinder.
        float angular = 0.5 + 0.5 * sin(angle * 16.0);
        float bandStrength = mix(0.88, 1.06, angular) * micro;
        vec3 col = uTint * bandStrength;
        // Slight blue cast in the gap for a cooler dark band.
        col = mix(col, uTint * 0.45, gap * 0.6);
         float alpha = edgeFade * (1.0 - gap * 0.85) * 0.85;
          // Slight emissive boost so the brightest ring zones cross the
          // bloom threshold (0.4) and pick up a soft glow.
          col *= 1.15;
        gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    })
    // Warm ring: tan/gold, matches icosa rim (#C9A84C, slightly desaturated).
    const icosaRingMaterial = makeRingMaterial(new THREE.Color(0xd4b06a), Math.PI * 25 / 180, 0)
    // Cool ring: pale silver/icy, matches dodec rim (#93C5FD, desaturated).
    const dodecRingMaterial = makeRingMaterial(
      new THREE.Color(0xb8c8e0),
      Math.PI * 78 / 180,
      Math.PI * 3 / 180,
    )

    // Warm planet: dark umber body, modest emissive — let the directional
    // light do the day/night terminator. Bumped emissive so the planet body
    // is clearly visible against the dark navy background.
    const goldMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a2820,             // dark warm umber body (was 0x2a1f15, slightly lifted)
      emissive: 0x6a4220,          // amber inner glow (was 0x4a2f12)
      emissiveIntensity: 0.35,     // was 0.18 — too dim against navy bg
      metalness: 0.02,
      roughness: 0.92,
      transparent: true,
      opacity: 0.95,
    })
    // Cold gas-giant planet: deep navy body, cool blue emissive.
    const dodecMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x182840,             // lifted slightly from 0x0e1828 for visibility
      emissive: 0x254280,          // stronger blue inner glow (was 0x15264a)
      emissiveIntensity: 0.32,     // was 0.16
      metalness: 0.02,
      roughness: 0.92,
      transmission: 0.0,
      clearcoat: 0.0,
      transparent: true,
      opacity: 0.95,
    })

    // Shader uniforms (shared across materials so all update from one RAF write).
    // THREE.ShaderMaterial accepts a `uniforms` prop on regular materials too
    // via onBeforeCompile, but the safer path for MeshStandardMaterial is to
    // attach them as material.userData.uniforms AND mirror them in shader.uniforms.
    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uMouseVel: { value: new THREE.Vector2(0, 0) },
    }

    // Apply the GLSL vertex-displacement + emissive-modulation injection to a
    // material, wiring the shared uniforms. Attaching to `material.uniforms`
    // makes the WebGLProgram cache a uniform location for these names.
    //
    // The planet "rim light" effect: in the fragment shader we add Fresnel-
    // based emissive on top of Three.js's standard physical material output.
    // Fresnel ≈ 1 at silhouette edges, ≈ 0 facing camera, which is exactly
    // what gives a planet its characteristic glowing rim against a dark sky.
    // Saturn banding option: when opts.banded is true, add a horizontal-stripe
    // modulation to diffuseColor (via a second fragment replacement at
    // #include <map_fragment>). Default false so unbanded shaders stay lean.
    const injectShader = (mat: THREE.Material, rimColor: THREE.Vector3, opts: { banded?: boolean } = {}) => {
      ;(mat as unknown as { uniforms: typeof uniforms }).uniforms = uniforms
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime
        shader.uniforms.uMouse = uniforms.uMouse
        shader.uniforms.uMouseVel = uniforms.uMouseVel

        // Vertex: declare varying + uniforms at the top, displace `transformed`
        // by hooking into <begin_vertex> (Three.js declares `vec3 transformed`
        // inside <begin_vertex> — we override the chunk to assign our own).
        // Also write viewDir + worldNormal varyings so the fragment shader
        // can compute Fresnel. Use the input `normal` attribute directly to
        // avoid depending on Three's intermediate `objectNormal` variable
        // (which only exists inside the original begin_vertex chunk).
        const planetVertexInjection = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vViewDir;
${vertexCommonInjection}
`
        const planetBeginVertex = /* glsl */ `
vec3 transformed = vec3(position);
// Subtle surface wobble (was 0.04 — produced visible bumps that distorted the
// planet silhouette into a non-spherical shape). At 0.012 the wobble is just
// a hint of breathing motion; the sphere geometry reads as a planet.
float wave = sin(transformed.x * 3.0 + uTime * 0.6)
           + cos(transformed.y * 2.5 - uTime * 0.5);
transformed += normal * wave * 0.012;
vec2 toMouse = uMouse - transformed.xy;
float dist = length(toMouse);
// Mouse-attraction bump reduced from 0.08 to 0.035 — still responsive to the
// cursor but the silhouette no longer distorts when the cursor is near.
float bump = smoothstep(0.6, 0.0, dist) * 0.035;
transformed += normal * bump;
vDisplace = wave + bump;
vWorldNormal = normalize(mat3(modelMatrix) * normal);
vec4 worldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
vViewDir = normalize(cameraPosition - worldPos.xyz);
`
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>\n${planetVertexInjection}`,
          )
          .replace(
            '#include <begin_vertex>',
            planetBeginVertex,
          )

        // Fragment: declare varyings + apply Fresnel rim light + emissive modulation.
        // Order matters: emissivemap_fragment sets totalEmissiveRadiance; we
        // ADD the rim contribution after that point so it benefits from
        // bloom (the rim is what makes the planet "glow").
        const planetFragmentInjection = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vViewDir;
${fragmentCommonInjection}
`
        const planetEmissiveInjection = /* glsl */ `
  // Standard emissive modulation (subtle displacement-driven wobble).
  totalEmissiveRadiance *= ( 1.0 + vDisplace * 0.25 );

  // Atmosphere ring: thin Fresnel rim that only fires at silhouette edges,
  // not on the body face. Power 5 keeps it crisp; multiplier 0.85 makes
  // the glow clearly visible against the dark hero background.
  float ndotv = max(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0);
  float fresnel = pow(1.0 - ndotv, 5.0);
  vec3 rimRGB = vec3(${rimColor.x.toFixed(4)}, ${rimColor.y.toFixed(4)}, ${rimColor.z.toFixed(4)});
  totalEmissiveRadiance += rimRGB * fresnel * 0.85;
`
        // Saturn-style horizontal banding. ~3 stripes via sin of the world-
        // space normal y; mix(0.78, 1.05) keeps the dark band clearly darker
        // without blowing out the bright zone. x term breaks perfect symmetry.
        const planetBandInjection = /* glsl */ `
  float lat = vWorldNormal.y;
  float absLat = abs(lat);
  float band1 = 0.5 + 0.5 * sin(lat * 14.0);
  float band2 = 0.5 + 0.5 * sin(lat * 4.0 + 1.3);
  float band3 = 0.5 + 0.5 * sin(lat * 28.0 + vWorldNormal.x * 0.6);
  float bands = band1 * 0.55 + band2 * 0.30 + band3 * 0.15;
  float bandStrength = mix(0.74, 1.10, bands);
  // Cassini-belt-style dark streak near the equator.
  float equator = smoothstep(0.06, 0.0, absLat);
  bandStrength *= mix(1.0, 0.62, equator);
  // Polar zones.
  bandStrength *= mix(1.0, 0.72, smoothstep(0.55, 0.92, absLat));
  diffuseColor.rgb *= bandStrength;
`
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>\n${planetFragmentInjection}`,
          )
        // Band injection is conditional so unbanded materials don't pay for
        // the sin call at every fragment.
        if (opts.banded) {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>\n${planetBandInjection}`,
          )
        }
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>\n${planetEmissiveInjection}`,
          )
      }
      mat.needsUpdate = true
    }
    // Warm planet: amber body, gold rim (#C9A84C).
    injectShader(goldMaterial, new THREE.Vector3(0xc9 / 255, 0xa8 / 255, 0x4c / 255))
    // Cold gas giant: navy body, cool blue-silver rim (#93C5FD).
    // Banded so the dodec reads as a Saturn-style gas giant with horizontal
    // atmospheric bands rather than a smooth blue marble. Same shader path
    // as the warm icosa; the band colors are driven by the material's
    // diffuse color, so the cool tint naturally produces cool bands.
    injectShader(dodecMaterial, new THREE.Vector3(0x93 / 255, 0xc5 / 255, 0xfd / 255), { banded: true })

    // Saturn-band clone for warm icosa planets. Re-injecting onBeforeCompile
    // on the clone overrides whatever the clone inherited from goldMaterial.
    const icosaMaterial = goldMaterial.clone()
    injectShader(
      icosaMaterial,
      new THREE.Vector3(0xc9 / 255, 0xa8 / 255, 0x4c / 255),
      { banded: true },
    )

    // 5. Cluster data — assign geometry kinds per tier, then group by kind.
    const types = assignGeometryTypes(count)
    const nodes = buildCluster(count)
    nodes.forEach((n, i) => {
      n.type = types[i] ?? 'icosa'
    })

    // Hero redesign (2026-07): explicitly place planets in 4 corners of the
    // hero frame so they read as separate celestial bodies. Positions chosen
    // to AVOID the title block (center vertical band) so text stays fully
    // legible. Each planet sits in a different viewport corner.
    //   - Hero gold icosa (upper-right corner) — focal body
    //   - Cool blue dodec (upper-left corner) — cold gas giant
    //   - Mid gold icosa (lower-right corner) — atmospheric support
    //   - Torus accent (lower-left corner) — Saturn-style ring
    const HERO_POSITIONS: Array<[number, number, number]> = [
      [ 3.4,  2.0, -2.5],   // [0] hero gold icosa (upper-right)
      [-3.4,  1.8, -3.4],   // [1] cool blue dodec (upper-left)
      [ 2.6, -1.6, -3.0],   // [2] mid gold icosa (lower-right)
      [-2.6, -1.7, -2.5],   // [3] secondary gold planet (lower-left)
    ]
    nodes.forEach((n, i) => {
      if (i < HERO_POSITIONS.length) {
        const [x, y, z] = HERO_POSITIONS[i]!
        n.basePos.x = x
        n.basePos.y = y
        n.basePos.z = z
        n.originalBase.x = x
        n.originalBase.y = y
        n.originalBase.z = z
      }
    })

    const geoByKind: Record<GeometryKind, THREE.BufferGeometry> = {
      icosa: icosaGeometry,
      dodec: dodecGeometry,
    }
    const matByKind: Record<GeometryKind, THREE.Material> = {
      icosa: icosaMaterial,
      dodec: dodecMaterial,
    }

    // Per-kind instance counts + one InstancedMesh each.
    const kindCounts: Record<GeometryKind, number> = { icosa: 0, dodec: 0 }
    for (const n of nodes) kindCounts[n.type]++
    const meshByKind = {} as Record<GeometryKind, THREE.InstancedMesh>
    ;(['icosa', 'dodec'] as const).forEach((k) => {
      const m = new THREE.InstancedMesh(geoByKind[k], matByKind[k], kindCounts[k])
      meshByKind[k] = m
      scene.add(m)
    })
    const meshes = [meshByKind.icosa, meshByKind.dodec]

    // Saturn ring InstancedMeshes — one per planet family (icosa, dodec).
    // Each ring instance tracks its corresponding spherical planet's local
    // index so the RAF tick can update both matrices in
    // lockstep (same position, same scale, no rotation since the tilt is
    // baked into the geometry).
    // renderOrder = 1 ensures the rings draw AFTER the planet InstancedMesh
    // so the front half of the ring appears on top of the planet's face.
    // depthWrite is false on the material so the back half of the ring is
    // still occluded by the planet's depth (the planet was written first).
    const icosaRingMesh = new THREE.InstancedMesh(icosaRingGeometry, icosaRingMaterial, 1)
    icosaRingMesh.renderOrder = 1
    icosaRingMesh.frustumCulled = false
    scene.add(icosaRingMesh)
    const dodecRingMesh = new THREE.InstancedMesh(dodecRingGeometry, dodecRingMaterial, 1)
    dodecRingMesh.renderOrder = 1
    dodecRingMesh.frustumCulled = false
    scene.add(dodecRingMesh)

    // T9: per-instance pulse phase + speed for the geometry twinkle. Each
    // mesh gets its own arrays of length kindCounts[k]; pulse math in the
    // RAF tick uses localInstanceIndex to look these up. Slow speeds
    // (0.3–0.8 rad/s) mean a typical pulse cycle is ~10–20 s — the
    // cluster as a whole always has a handful of nodes mid-flash, but no
    // single node blinks more than once every several seconds.
    const phasesPerMesh: Record<GeometryKind, Float32Array> = {
      icosa: new Float32Array(kindCounts.icosa),
      dodec: new Float32Array(kindCounts.dodec),
    }
    const speedsPerMesh: Record<GeometryKind, Float32Array> = {
      icosa: new Float32Array(kindCounts.icosa),
      dodec: new Float32Array(kindCounts.dodec),
    }
    {
      const rng = pulseRng(123)
      for (const k of ['icosa', 'dodec'] as const) {
        const phases = phasesPerMesh[k]
        const speeds = speedsPerMesh[k]
        const n = kindCounts[k]
        for (let i = 0; i < n; i++) {
          phases[i] = rng() * Math.PI * 2
          speeds[i] = 0.3 + rng() * 0.5
        }
      }
    }

    // Map each node → its local instance index within the per-kind mesh.
    const localIndex = new Array<number>(nodes.length)
    const cursor: Record<GeometryKind, number> = { icosa: 0, dodec: 0 }
    for (let i = 0; i < nodes.length; i++) {
      localIndex[i] = cursor[nodes[i]!.type]++
    }

    const dummy = new THREE.Object3D()
    const _white = new THREE.Color(0xffffff)
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      dummy.position.set(n.basePos.x, n.basePos.y, n.basePos.z)
      // Center node (index 0) gets a fixed 1.0x hero scale (was 1.15x — too
      // dominant). Other nodes get n.sizeFactor (1.0 for nodes i%3===0, 0.7
      // otherwise) so the supporting planets read smaller than the hero.
      const s = i === 0 ? n.scale : n.scale * n.sizeFactor
      dummy.scale.set(s, s, s)
      dummy.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      )
      dummy.updateMatrix()
      meshByKind[n.type].setMatrixAt(localIndex[i]!, dummy.matrix)
      // T5: seed instance colors to white so instanceColor is fully allocated
      // (setColorAt lazily creates a zero-filled = black buffer otherwise).
      meshByKind[n.type].setColorAt(localIndex[i]!, _white)
    }
    // Seed each planet's ring with the same matrix as its body. The RAF
    // tick will rewrite this every frame to track the planet's animated
    // position and hover scale. Tilt is baked into the geometry; the ring
    // matrix only carries position + uniform scale.
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      if (localIndex[i] !== 0) continue
      const ringMesh = n.type === 'icosa' ? icosaRingMesh : dodecRingMesh
      const s = i === 0 ? n.scale : n.scale * n.sizeFactor
      dummy.position.set(n.basePos.x, n.basePos.y, n.basePos.z)
      dummy.scale.set(s, s, s)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      ringMesh.setMatrixAt(0, dummy.matrix)
    }
    icosaRingMesh.instanceMatrix.needsUpdate = true
    dodecRingMesh.instanceMatrix.needsUpdate = true
    for (const m of meshes) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }

    // T3: ambient dust particle cloud — single THREE.Points per tier.
    // One BufferGeometry + one ShaderMaterial; per-vertex size/alpha/color
    // mixing handled in the GLSL below. Deterministic seed (mulberry32(42))
    // so StrictMode remounts don't flicker the layout.
    const particles = buildParticleCloud(tier as 'high' | 'mid' | 'low')
    const points = new THREE.Points(particles.geometry, particles.material)
    scene.add(points)

    // 6. Sizing — composer declared above so resize() can safely reference it.
    let composer: EffectComposer | null = null
    let bloomPass: UnrealBloomPass | null = null
    const resize = () => {
      const w = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth
      const h = canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
      if (composer) {
        // Composer renders at half-resolution for the bloom MRTs; the OutputPass
        // upscales back to canvas size for the final blit.
        composer.setSize(w * BLOOM_RES_SCALE, h * BLOOM_RES_SCALE)
      }
    }
    resize()
    window.addEventListener('resize', resize)

    // 6b. EffectComposer + UnrealBloomPass (T1). Skipped on 'low' tier — the
    // material emissive + CSS halo on the canvas wrapper carry the bloom look.
    // RenderPass → UnrealBloomPass → OutputPass (gamma + color-space).
    if (useComposer) {
      const w0 = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth
      const h0 = canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight
      composer = new EffectComposer(renderer)
      composer.setSize(w0 * BLOOM_RES_SCALE, h0 * BLOOM_RES_SCALE)
      const renderPass = new RenderPass(scene, camera)
      composer.addPass(renderPass)
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(w0 * BLOOM_RES_SCALE, h0 * BLOOM_RES_SCALE),
        BLOOM_STRENGTH,
        BLOOM_RADIUS,
        BLOOM_THRESHOLD,
      )
      composer.addPass(bloomPass)
      const outputPass = new OutputPass()
      composer.addPass(outputPass)
    }

    // 7. Visibility / context-lost
    let running = true
    const onVis = () => {
      running = !document.hidden
    }
    const onLost = (e: Event) => {
      e.preventDefault()
      running = false
    }
    document.addEventListener('visibilitychange', onVis)
    canvas.addEventListener('webglcontextlost', onLost as EventListener)

    // 8. RAF tick
    const startTime = performance.now()
    let lastTime = startTime
    // B1 fix: drive scrollExitT via ScrollTrigger so the camera/cluster actually
    // respond to hero scrolling out of view (was dead code before — declared,
    // never written, always 0).
    let scrollExitT = 0
    const scrollTrigger = ScrollTrigger.create({
      trigger: canvas.parentElement || document.body,
      start: 'top top',
      end: 'bottom top',
      scrub: 0.6,
      onUpdate: (self) => {
        scrollExitT = self.progress
      },
    })

    // B2 fix: derive worldRef in RAF from ndcRef + this camera.
    // (usePointerGravity was created with camera:null so worldRef stayed (0,0,0).)
    const _tmpVec = new THREE.Vector3()
    const _mouseWorldEuler: Vec3Like = { x: 0, y: 0, z: 0 }

    // T5: geometry hover — raycast against the instanced meshes and track the
    // hovered instance as `${mesh.uuid}:${localInstanceIndex}`. On mid/low tiers
    // we raycast every other frame to halve the CPU cost.
    const raycaster = new THREE.Raycaster()
    const mouseNDC = new THREE.Vector2()
    let hoveredKey: string | null = null
    let frameCount = 0

    // Instance color base/hover. Base is white (neutral multiplier — preserves
    // each material's own color); hover is a warm/bright tint per kind so the
    // hovered node reads brighter and blooms more. (Writing the materials' own
    // colors as the base would double-multiply and mud the dodec's dark blue,
    // so white is the correct neutral base here.)
    const WHITE = new THREE.Color(0xffffff)
    const HOVER_COLOR: Record<GeometryKind, THREE.Color> = {
      icosa: new THREE.Color(0xffd89b),
      dodec: new THREE.Color(0x7aa0e8),
    }
    // T9: per-instance twinkle. Lerp the base color (WHITE / HOVER_COLOR)
    // toward a brighter warm tint at a node's pulse peak. Lerp factor is
    // pulse^4 * 0.6 — the ^4 makes most of the cycle invisible and only the
    // top of the sine peak reads as a flash, so the cluster "breathes" with
    // occasional bright pops rather than oscillating uniformly.
    const PULSE_COLOR: Record<GeometryKind, THREE.Color> = {
      icosa: new THREE.Color(0xfff4cc),
      dodec: new THREE.Color(0xa8c8ff),
    }
    const _pulseMix = new THREE.Color()

    const tick = () => {
      if (!running || !isInView) {
        sceneStateRef.current.raf = requestAnimationFrame(tick)
        return
      }
      const now = performance.now()
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now
      frameCount++
      // T9: pulse-time used by the per-instance twinkle below. Same wall
      // clock seconds as the uTime uniform a few lines down — duplicate the
      // calc here so the per-node color write doesn't have to plumb it in.
      const tSec = (now - startTime) / 1000

      // Derive world position from NDC + camera (fix B2)
      _tmpVec.set(pointer.ndcRef.current.x, pointer.ndcRef.current.y, 0.5)
        .unproject(camera)
      const dir = _tmpVec.sub(camera.position).normalize()
      if (Math.abs(dir.z) > 0.001) {
        const distance = -camera.position.z / dir.z
        _tmpVec.copy(camera.position).add(dir.multiplyScalar(distance))
        _mouseWorldEuler.x = _tmpVec.x
        _mouseWorldEuler.y = _tmpVec.y
        _mouseWorldEuler.z = _tmpVec.z
      }

      // T5: center attraction — pull the hero node toward the cursor before the
      // general cluster step runs its return-to-base spring.
      applyCenterAttraction(nodes[0]!, _mouseWorldEuler, dt)

      // Step cluster forces
      const next = stepCluster(nodes, _mouseWorldEuler, dt)
      applyClusterStep(nodes, next)

      // T5: geometry hover raycast (every other frame on mid/low tiers).
      if (tier === 'high' || frameCount % 2 === 0) {
        mouseNDC.copy(pointer.ndcRef.current)
        raycaster.setFromCamera(mouseNDC, camera)
        let newHoveredKey: string | null = null
        for (const m of meshes) {
          const intersects = raycaster.intersectObject(m)
          if (intersects.length > 0) {
            const hit = intersects[0]!
            if (hit.instanceId !== undefined) {
              newHoveredKey = `${m.uuid}:${hit.instanceId}`
              break
            }
          }
        }
        hoveredKey = newHoveredKey
      }

      // Write instance matrix
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!
        const mesh = meshByKind[n.type]
        const li = localIndex[i]!
        const isHovered =
          hoveredKey !== null &&
          hoveredKey === `${mesh.uuid}:${li}`
        dummy.position.set(n.basePos.x, n.basePos.y, n.basePos.z)
        const s = i === 0 ? n.scale : n.scale * n.sizeFactor
        const fs = isHovered ? s * 1.06 : s
        dummy.scale.set(fs, fs, fs)
        dummy.rotation.x += n.spin.x
        dummy.rotation.y += n.spin.y
        dummy.rotation.z += n.spin.z
        dummy.updateMatrix()
        mesh.setMatrixAt(li, dummy.matrix)
        // T5: brighten the hovered instance via instanceColor (white = neutral).
        // T9: layer a per-instance twinkle pulse on top. baseColor is the
        // hover/non-hover color; pulseColor is the warmer peak tint. The
        // pulse envelope is sin → [0..1] → ^4 to keep flashes rare and
        // punchy, scaled by 0.6 so we never fully replace the base color
        // (the original hover signal must stay readable on top of a flash).
        const baseColor = isHovered ? HOVER_COLOR[n.type] : WHITE
        const phases = phasesPerMesh[n.type]
        const speeds = speedsPerMesh[n.type]
        const pulse01 =
          0.5 + 0.5 * Math.sin(tSec * speeds[li]! + phases[li]!)
        const flash = Math.pow(pulse01, 4) * 0.6
        _pulseMix.copy(baseColor).lerp(PULSE_COLOR[n.type], flash)
        mesh.setColorAt(li, _pulseMix)
      }
      // Saturn ring matrix write — each planet (icosa/dodec) has a ring
      // instance sharing its local index. We mirror the planet's position
      // and hover-scaled size so the ring tracks the body exactly. No
      // rotation in the matrix because the 25deg tilt is baked into the
      // ring geometry. Rings DON'T pulse (only the body does) — keeping
      // them steady reads as a stable accretion ring around an active
      // planet.
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!
        if (localIndex[i] !== 0) continue
        const ringMesh = n.type === 'icosa' ? icosaRingMesh : dodecRingMesh
        const s = i === 0 ? n.scale : n.scale * n.sizeFactor
        const isRingHovered =
          hoveredKey !== null &&
          hoveredKey === `${meshByKind[n.type].uuid}:${localIndex[i]!}`
        const rs = isRingHovered ? s * 1.06 : s
        dummy.position.set(n.basePos.x, n.basePos.y, n.basePos.z)
        dummy.scale.set(rs, rs, rs)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        ringMesh.setMatrixAt(0, dummy.matrix)
      }
      icosaRingMesh.instanceMatrix.needsUpdate = true
      dodecRingMesh.instanceMatrix.needsUpdate = true
      for (const m of meshes) {
        m.instanceMatrix.needsUpdate = true
        if (m.instanceColor) m.instanceColor.needsUpdate = true
      }

      // Camera parallax: wider travel makes the near planets and distant
      // particle field separate more clearly while the existing damping
      // keeps pointer movement smooth rather than twitchy.
      const targetX = pointer.ndcRef.current.x * 0.84
      const targetY = -pointer.ndcRef.current.y * 0.50
      camera.position.x += (targetX - camera.position.x) * 0.18
      camera.position.y += (targetY - camera.position.y) * 0.18
      // Apply scroll-coupled exit transform
      camera.position.z = 6 - 1.5 * scrollExitT
      camera.lookAt(0, 0, 0)
      for (const m of meshes) m.rotation.z = 0.4 * scrollExitT

      // Update shader uniforms
      uniforms.uTime!.value = (now - startTime) / 1000
      uniforms.uMouse!.value.copy(pointer.ndcRef.current)
      uniforms.uMouseVel!.value.copy(pointer.velocityRef.current)

      // T3: drive particle-cloud uTime so the slow drift animates
      particles.update(uniforms.uTime!.value)

      if (composer) {
        composer.render()
      } else {
        renderer.render(scene, camera)
      }
      sceneStateRef.current.raf = requestAnimationFrame(tick)
    }
    sceneStateRef.current.startTime = startTime
    tick()

    // 9. Expose for cleanup
    sceneStateRef.current.renderer = renderer
    sceneStateRef.current.scene = scene
    sceneStateRef.current.camera = camera
    sceneStateRef.current.meshes = meshes
    sceneStateRef.current.materials = [goldMaterial, dodecMaterial, icosaMaterial]
    sceneStateRef.current.geometries = [icosaGeometry, dodecGeometry]
    sceneStateRef.current.nodes = nodes
    sceneStateRef.current.running = true
    sceneStateRef.current.scrollExitT = scrollExitT
    sceneStateRef.current.lastTime = lastTime
    sceneStateRef.current.composer = composer ?? undefined
    sceneStateRef.current.bloomPass = bloomPass ?? undefined
    sceneStateRef.current.useComposer = useComposer
    ;(sceneStateRef.current as unknown as { uniforms?: typeof uniforms }).uniforms = uniforms

    // 10. Cleanup
    return () => {
      running = false
      observer.disconnect()
      if (sceneStateRef.current.raf) {
        cancelAnimationFrame(sceneStateRef.current.raf)
      }
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('webglcontextlost', onLost as EventListener)
      scrollTrigger.kill()
      // B4 fix: InstancedMesh has no dispose() — remove the no-op call.
      // Note: WebGLRenderer.dispose() does not release the GL context;
      // we rely on canvas DOM node removal + GC for context cleanup.
      // (Explicit forceContextLoss() was removed — it can pollute browser
      // GL state in some Chromium versions, breaking subsequent mounts.)
      icosaGeometry.dispose()
      dodecGeometry.dispose()
      icosaRingGeometry.dispose()
      dodecRingGeometry.dispose()
      goldMaterial.dispose()
      dodecMaterial.dispose()
      icosaMaterial.dispose()
      icosaRingMaterial.dispose()
      dodecRingMaterial.dispose()
      // T3: particle-cloud GPU resources
      particles.geometry.dispose()
      particles.material.dispose()
      // Bloom post-processing cleanup. The composer's renderTarget1/2 are the
      // ping-pong MRTs for the bloom blur; dispose both explicitly before
      // dropping the composer reference so the GPU memory is reclaimed.
      if (composer) {
        if (bloomPass) {
          // UnrealBloomPass owns its own mip RT chain; dispose each.
          bloomPass.dispose()
        }
        composer.renderTarget1.dispose()
        composer.renderTarget2.dispose()
        composer.dispose()
        composer = null
        bloomPass = null
      }
      renderer.dispose()
      // Drop references
      sceneStateRef.current = {}
    }
  }, [canvasRef, tier, pointer])

  return null
}
