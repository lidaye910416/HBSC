// frontend-vite/src/components/hero/particleCloud.ts
//
// particleCloud — T3 ambient dust layer rendered as a single THREE.Points
// cloud with a custom ShaderMaterial. Adds 300/180/80 particles per GPU tier
// (high/mid/low) drifting slowly inside a box volume around the cluster.
//
// Design notes:
//   - One BufferGeometry + one ShaderMaterial → one Points object per tier.
//     (no PointsMaterial — we need per-vertex alpha, size, color mixing.)
//   - Deterministic seed (mulberry32) so the same tier reproduces the same
//     layout across reloads — no flicker, no jump-cut on StrictMode remount.
//   - Soft-disc fragment via radial distance from gl_PointCoord center.
//   - AdditiveBlending + depthWrite:false → glows over dark, doesn't occlude
//     the InstancedMesh cluster behind it.
//   - T9: per-particle twinkle. Each particle has its own period
//     (aTwinklePeriod, 1.5–6 s) and phase so the field desyncs naturally;
//     ~10 % are flagged "flashy" (shorter period, sharper brightness peaks).

import * as THREE from 'three'

const TIER_PARTICLE_COUNT: Record<'high' | 'mid' | 'low', number> = {
  high: 300,
  mid: 180,
  low: 80,
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
  const rng = mulberry32(42) // deterministic seed

  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const alphas = new Float32Array(count)
  const phases = new Float32Array(count)
  const depths = new Float32Array(count)
  // T9: per-particle twinkle period and "flashy" flag. Flashy particles get
  // shorter periods (0.6–1.4 s) and a sharper, brighter peak than the rest,
  // giving the cloud occasional bright blinks scattered across the field.
  const twinklePeriods = new Float32Array(count)
  const flashy = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    // Box bounds x∈[-6,6] y∈[-3,3] z∈[-2,2]
    positions[i * 3 + 0] = (rng() - 0.5) * 12
    positions[i * 3 + 1] = (rng() - 0.5) * 6
    positions[i * 3 + 2] = (rng() - 0.5) * 4

    // 80% main dust, 20% distant
    const isDistant = rng() < 0.2
    sizes[i] = isDistant ? 0.04 + rng() * 0.04 : 0.12 + rng() * 0.18
    alphas[i] = isDistant ? 0.15 + rng() * 0.15 : 0.55 + rng() * 0.35
    phases[i] = rng() * Math.PI * 2
    depths[i] = rng()

    // T9: ~10% flashy, the rest slow-twinkle. Period range differs so the
    // two populations don't lockstep visually.
    const isFlashy = rng() < 0.1
    flashy[i] = isFlashy ? 1 : 0
    twinklePeriods[i] = isFlashy ? 0.6 + rng() * 0.8 : 1.5 + rng() * 4.5
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1))
  geometry.setAttribute('aTwinklePeriod', new THREE.BufferAttribute(twinklePeriods, 1))
  geometry.setAttribute('aFlashy', new THREE.BufferAttribute(flashy, 1))

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: window.devicePixelRatio || 1 },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      attribute float aDepth;
      attribute float aTwinklePeriod;
      attribute float aFlashy;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying float vDepth;
      varying float vTwinkle;
      void main() {
        vec3 p = position;
        // Slow drift
        p.x += sin(uTime * 0.1 + aPhase) * 0.15;
        p.y += cos(uTime * 0.08 + aPhase * 1.3) * 0.1;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;

        // T9: per-particle twinkle. The phase scales 0→2π and modulates the
        // shared uTime sinusoid so neighbouring particles desync. power(2.2)
        // makes the envelope spend more time dark, more time bright peaks —
        // i.e. sharper "blink" rather than even sine fade. Flashy particles
        // get a soft sqrt curve (more time near peak) and a 1.4× boost so
        // their blinks read clearly even on a tier with bloom disabled.
        float phaseRadians = aPhase * 6.28;
        float omega = 6.28 / max(aTwinklePeriod, 0.01);
        float t = 0.5 + 0.5 * sin(uTime * omega + phaseRadians);
        t = pow(t, 2.2);
        t = mix(t, pow(t, 0.5) * 1.4, aFlashy);
        vTwinkle = t;

        // Slight size bump during a twinkle peak (cheap depth mask by reusing vDepth).
        float sizeMul = 1.0 + 0.25 * t * (1.0 - aDepth);
        gl_PointSize = aSize * sizeMul * (300.0 / max(dist, 0.1)) * uPixelRatio;

        vAlpha = aAlpha;
        vDepth = aDepth;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vDepth;
      varying float vTwinkle;
      void main() {
        // soft disc via radial distance from center
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float alpha = vAlpha * smoothstep(0.5, 0.0, d);
        // gold for near, blue-tint for distant
        vec3 nearColor = vec3(0.79, 0.66, 0.30); // gold #C9A84C
        vec3 farColor = vec3(0.42, 0.55, 0.85);
        vec3 col = mix(nearColor, farColor, vDepth);
        // T9: brightness and alpha both modulated by the twinkle envelope.
        // 35% baseline alpha keeps the field always present; the 65%
        // modulated share carries the blink. Colour brightness is biased
        // upward at peaks (0.6→1.0) so peak moments punch through bloom.
        float alphaMul = 0.35 + 0.65 * vTwinkle;
        col *= (0.6 + 0.4 * vTwinkle);
        gl_FragColor = vec4(col, alpha * alphaMul);
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
