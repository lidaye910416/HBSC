// frontend-vite/src/components/hero/particleCloud.ts
//
// particleCloud — starfield layer rendered as a single THREE.Points cloud.
//
// Recipe (HBSC hero starfield, 2026-07):
//   - 3 depth layers: 15% foreground / 35% midground / 50% background
//   - Power-law size: 85% tiny / 12% small / 3% hero stars
//   - Hero stars use HDR colors (>2.6) so UnrealBloomPass actually fires
//   - Per-star twinkle on ~40% of stars; hero stars get slow gentle twinkle
//   - Color palette honors real stellar types (warm / cool / blue / orange / red)

import * as THREE from 'three'

const TIER_PARTICLE_COUNT: Record<'high' | 'mid' | 'low', number> = {
  high: 1400,
  mid: 800,
  low: 400,
}

function mulberry32(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildParticleCloud(tier: 'high' | 'mid' | 'low'): {
  geometry: THREE.BufferGeometry
  material: THREE.ShaderMaterial
  update: (time: number) => void
} {
  const count = TIER_PARTICLE_COUNT[tier]
  const rng = mulberry32(42)

  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const alphas = new Float32Array(count)
  const phases = new Float32Array(count)
  const depths = new Float32Array(count)
  // Per-star HDR multiplier (>1 for hero stars so bloom catches them).
  const hdrs = new Float32Array(count)
  const hueShifts = new Float32Array(count)
  const twinklePeriods = new Float32Array(count)
  const twinkleFlags = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    // 3-layer depth distribution — sells parallax and atmospheric depth.
    const layer = rng()
    let z: number
    let depth01: number
    if (layer < 0.15) {
      // Foreground (z ∈ [-1.5, -4]): close, dramatic parallax.
      z = -1.5 - rng() * 2.5
      depth01 = 0.15
    } else if (layer < 0.50) {
      // Midground (z ∈ [-4, -10]): sweet-spot readable stars.
      z = -4 - rng() * 6
      depth01 = 0.45
    } else {
      // Background (z ∈ [-10, -22]): sky frame, minimal parallax.
      z = -10 - rng() * 12
      depth01 = 0.85
    }

    // Wide x/y spread for starfield feel.
    positions[i * 3 + 0] = (rng() - 0.5) * 24
    positions[i * 3 + 1] = (rng() - 0.5) * 13
    positions[i * 3 + 2] = z

    // Power-law size distribution.
    //   88% tiny  (sizeRoll < 0.88)  →  0.06–0.14 (subpixel dust)
    //   10% small (0.88 ≤ < 0.98)    →  0.18–0.32 (recognizable stars)
    //    2% hero  (≥ 0.98)           →  0.35–0.65 (rare bright giants, HDR boost)
    const sizeRoll = rng()
    let starSize: number
    let starHdr: number
    if (sizeRoll < 0.88) {
      starSize = 0.06 + rng() * 0.08
      starHdr = 1.0
    } else if (sizeRoll < 0.98) {
      starSize = 0.18 + rng() * 0.14
      starHdr = 1.3
    } else {
      starSize = 0.35 + rng() * 0.30
      // HDR 2.5-3.5: only these rare stars cross bloom threshold 0.4.
      starHdr = 2.5 + rng() * 1.0
    }
    sizes[i] = starSize
    hdrs[i] = starHdr

    // Stellar color distribution (matches real population, biased warm):
    //   50% warm white (G / late-F)
    //   22% cool white (A / early-F)
    //    8% blue giants (B / O, rare, hot — bloom hardest)
    //   12% orange (K)
    //    8% red dwarfs (M)
    const hueRoll = rng()
    if (hueRoll < 0.50) hueShifts[i] = 0.0         // warm white
    else if (hueRoll < 0.72) hueShifts[i] = 0.15   // cool white
    else if (hueRoll < 0.80) hueShifts[i] = 0.55   // blue giant
    else if (hueRoll < 0.92) hueShifts[i] = -0.10  // orange (K)
    else hueShifts[i] = -0.25                      // red (M)

    // Twinkle on ~40% of stars. Hero stars get slow gentle twinkle
    // so they feel anchored rather than flickering.
    twinkleFlags[i] = rng() < 0.40 ? 1 : 0
    twinklePeriods[i] = starSize > 0.30 ? 4 + rng() * 4 : 0.4 + rng() * 2.1
    phases[i] = rng() * Math.PI * 2
    // Higher alpha baseline (was 0.35-0.70) so even faint stars register
    // against the dark navy hero background.
    alphas[i] = 0.65 + rng() * 0.30
    depths[i] = depth01
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1))
  geometry.setAttribute('aHdr', new THREE.BufferAttribute(hdrs, 1))
  geometry.setAttribute('aHue', new THREE.BufferAttribute(hueShifts, 1))
  geometry.setAttribute('aTwinklePeriod', new THREE.BufferAttribute(twinklePeriods, 1))
  geometry.setAttribute('aTwinkleFlag', new THREE.BufferAttribute(twinkleFlags, 1))

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: window.devicePixelRatio || 1 },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,  // stars are additive overlay; never occluded by planets or each other
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      attribute float aDepth;
      attribute float aHdr;
      attribute float aHue;
      attribute float aTwinklePeriod;
      attribute float aTwinkleFlag;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying float vDepth;
      varying float vTwinkle;
      varying float vHue;
      varying float vHdr;
      void main() {
        vec3 p = position;
        // Per-layer parallax: foreground moves most, background barely moves.
        p.x += sin(uTime * 0.08 + aPhase) * 0.10 * (1.0 - aDepth);
        p.y += cos(uTime * 0.06 + aPhase * 1.3) * 0.08 * (1.0 - aDepth);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;

        // Twinkle only for stars with aTwinkleFlag=1.
        float t = 1.0;
        if (aTwinkleFlag > 0.5) {
          float phaseRadians = aPhase * 6.28;
          float omega = 6.28 / max(aTwinklePeriod, 0.01);
          t = 0.5 + 0.5 * sin(uTime * omega + phaseRadians);
          t = pow(t, 1.8);
        }
        vTwinkle = t;

        float sizeMul = 1.0 + 0.18 * t * aTwinkleFlag;
        gl_PointSize = aSize * sizeMul * (240.0 / max(dist, 0.1)) * uPixelRatio;

        vAlpha = aAlpha;
        vDepth = aDepth;
        vHue = aHue;
        vHdr = aHdr;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vDepth;
      varying float vTwinkle;
      varying float vHue;
      varying float vHdr;
      void main() {
        // Centered UV in [-0.5, 0.5] around the point.
        vec2 uv = gl_PointCoord - 0.5;
        float r2 = dot(uv, uv);

        // Real night-sky star: tight bright core + soft Gaussian halo.
        // No diffraction cross.
        float core = exp(-r2 * 220.0);
        float halo = exp(-r2 * 14.0) * 0.22;
        float star = core + halo;
        if (star < 0.005) discard;

        // Stellar color, picked by vHue.
        vec3 warm   = vec3(1.00, 0.95, 0.82);  // G / late-F warm white
        vec3 cool   = vec3(0.92, 0.96, 1.00);  // A / early-F cool white
        vec3 blue   = vec3(0.61, 0.78, 1.00);  // B / O blue giant
        vec3 orange = vec3(1.00, 0.78, 0.55);  // K orange
        vec3 red    = vec3(1.00, 0.62, 0.45);  // M red dwarf
        vec3 col;
        if (vHue > 0.40) col = blue;
        else if (vHue > 0.05) col = cool;
        else if (vHue < -0.20) col = red;
        else if (vHue < -0.05) col = orange;
        else col = warm;

        // HDR multiplier on hero stars (>1.0) so bloom catches them.
        col *= vHdr;

        // Twinkle modulation (gentle).
        float twinkleMod = 0.55 + 0.45 * vTwinkle;
        col *= twinkleMod;

        // Background stars dim slightly to sell depth.
        col *= mix(1.0, 0.55, vDepth);

        float alpha = vAlpha * star;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  })

  return {
    geometry,
    material,
    update: (time: number) => {
      uniforms.uTime.value = time
    },
  }
}