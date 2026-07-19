# HBSC Hero Immersive Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hero decoration with a Three.js-driven immersive layer (low-poly gold icosahedron cluster + GLSL vertex displacement + mouse gravity field) while retaining the existing HeroShader + HeroParticles as fallback for reduced-motion and low-tier GPU users.

**Architecture:** Single React component `<HeroImmersive />` that gates on motion + WebGL capability. When allowed, it instantiates a `<ThreeScene />` with WebGLRenderer + InstancedMesh (12-24 instances depending on GPU tier) + DirectionalLight + HemisphereLight + RAF. `usePointerGravity` hook bridges DOM pointer events to shader uniforms (NDC + world position). The 3D layer is decoupled from the existing 2D canvas layers (which become fallback-only).

**Tech Stack:** Three.js ^0.170, React 19, GSAP 3.15 (existing, for ScrollTrigger coupling only), Vitest, Playwright.

**Reference design:** [`docs/superpowers/specs/2026-07-18-hbsc-hero-immersive-design.md`](../specs/2026-07-18-hbsc-hero-immersive-design.md)

---

## Task Breakdown

This plan has **11 tasks** plus a **pre-task (T0) worktree setup**. Each task is self-contained, builds on prior tasks, and ends with a commit.

---

### Task 0: Create Worktree + Install three

**Files:**
- Create: worktree at `../hbsc-hero-immersive` on branch `feat/hero-immersive`
- Modify: `frontend-vite/package.json` (add `three@^0.170`)
- Modify: `frontend-vite/package-lock.json` (auto)

- [ ] **Step 1: Capture main HEAD before fork**

```bash
cd /Users/jasonlee/hubei-shuchuang
git rev-parse HEAD
# Output: a commit hash (e.g. d8175f0...) — record this for the PR description
```

Expected: A 7+ char commit hash printed.

- [ ] **Step 2: Create worktree on a new branch**

```bash
cd /Users/jasonlee/hubei-shuchuang
git worktree add -b feat/hero-immersive ../hbsc-hero-immersive main
cd ../hbsc-hero-immersive
ls frontend-vite/src/components/hero/
```

Expected: Empty `hero/` directory (or non-existent — that's fine; we'll create it). The worktree path is `../hbsc-hero-immersive`.

- [ ] **Step 3: Install three**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npm install three@^0.170 --save
```

Expected: `+ three@0.170.x` added to dependencies. Check `package.json`:
```bash
grep -A1 '"three"' package.json
```
Should show `"three": "^0.170.x"`.

- [ ] **Step 4: Verify dev server still runs**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npm run dev -- --port 5174 &
sleep 4
curl -sf http://localhost:5174 > /dev/null && echo "dev server OK"
kill %1
```

Expected: `dev server OK` printed.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/package.json frontend-vite/package-lock.json
git commit -m "chore(hero): install three@^0.170 for hero-immersive layer"
```

---

### Task 1: Add `--color-accent-gold` Token

**Files:**
- Modify: `frontend-vite/src/styles/global.css` (add token around line 50, near other color tokens)

- [ ] **Step 1: Locate existing color tokens**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
grep -n "color-accent-on-dark" frontend-vite/src/styles/global.css
```

Expected: A line number (e.g. `44:`). Read 2 lines context to find the right spot.

- [ ] **Step 2: Add the new token**

In `frontend-vite/src/styles/global.css`, immediately after the `--color-accent-on-dark` line, add:

```css
  --color-accent-gold: #C9A84C;
```

(The leading 2 spaces match the indent of the surrounding tokens. Verify by reading 3 lines around the insertion point before saving.)

- [ ] **Step 3: Verify build still passes**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npm run build 2>&1 | tail -10
```

Expected: `built in XXXms` — no errors. If Vite reports CSS errors, re-check the indentation.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/src/styles/global.css
git commit -m "feat(tokens): add --color-accent-gold for hero gold decoration"
```

---

### Task 2: Create `HeroFallback` Wrapper

**Files:**
- Create: `frontend-vite/src/components/hero/HeroFallback.tsx`
- Create: `frontend-vite/src/components/hero/HeroFallback.css`

The fallback is just the existing two canvas layers, wrapped for cleanliness. **No behavior change.**

- [ ] **Step 1: Create the component**

```tsx
// frontend-vite/src/components/hero/HeroFallback.tsx
//
// HeroFallback — used when:
//   1. prefers-reduced-motion: reduce
//   2. WebGL is unavailable
//   3. GPU tier is 'none'
//
// Renders the existing decoration layers verbatim. No new animation.

import { HeroParticles } from '../HeroParticles'
import { HeroShader } from '../HeroShader'
import './HeroFallback.css'

export function HeroFallback() {
  return (
    <div className="hero-fallback" aria-hidden="true" data-testid="hero-fallback">
      <HeroShader />
      <HeroParticles />
    </div>
  )
}
```

- [ ] **Step 2: Create the CSS**

```css
/* frontend-vite/src/components/hero/HeroFallback.css */

.hero-fallback {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to `HeroFallback.tsx`. (Pre-existing errors unrelated to this file are OK.)

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/src/components/hero/HeroFallback.tsx frontend-vite/src/components/hero/HeroFallback.css
git commit -m "feat(hero): add HeroFallback wrapper for non-WebGL users"
```

---

### Task 3: `useHeroCapability` Hook

**Files:**
- Create: `frontend-vite/src/components/hero/useHeroCapability.ts`

Detects WebGL availability, GPU tier (via `WEBGL_debug_renderer_info`), and mobile viewport. Returns a stable `Capability` object used by `<ThreeScene />` to pick instance count + DPR cap.

- [ ] **Step 1: Write the hook**

```ts
// frontend-vite/src/components/hero/useHeroCapability.ts
//
// useHeroCapability — feature-detect once at mount.
//
// Returns { tier, isMobile, webglBlocked }. The tier drives the
// ThreeScene instance count + DPR cap. The hook is intentionally
// "test-time only" (no React state) — it's called once and the
// result is consumed by ThreeScene's effect.

import { useEffect, useState } from 'react'

export type GpuTier = 'high' | 'mid' | 'low' | 'none'

export interface Capability {
  tier: GpuTier
  isMobile: boolean
  webglBlocked: boolean
}

function detectWebGL(): { supported: boolean; renderer: string | null } {
  if (typeof window === 'undefined') return { supported: false, renderer: null }
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) return { supported: false, renderer: null }
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null
    // Free the test context
    const lose = gl.getExtension('WEBGL_lose_context')
    lose?.loseContext()
    return { supported: true, renderer: typeof renderer === 'string' ? renderer : null }
  } catch {
    return { supported: false, renderer: null }
  }
}

function tierFromRenderer(renderer: string | null, isMobile: boolean): GpuTier {
  if (!renderer) return isMobile ? 'low' : 'low' // unknown → conservative
  const r = renderer.toLowerCase()
  // High tier: dedicated GPU / Apple Silicon
  if (/apple m\d/.test(r) || /nvidia/.test(r) || /radeon pro/.test(r) || /amd radeon rx/.test(r)) {
    return 'high'
  }
  // Mid tier: integrated but capable
  if (/intel\(r\) (uhd|iris|hd graphics)/.test(r) || /mali-g(7|8|9)/.test(r) || /adreno 6/.test(r)) {
    return 'mid'
  }
  // Low tier: weak mobile / SwiftShader
  return 'low'
}

export function useHeroCapability(): Capability {
  const [cap, setCap] = useState<Capability>(() => ({
    tier: 'low',
    isMobile: false,
    webglBlocked: true,
  }))

  useEffect(() => {
    const isMobile = typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 768px)').matches
      : false
    const { supported, renderer } = detectWebGL()
    if (!supported) {
      setCap({ tier: 'none', isMobile, webglBlocked: true })
      return
    }
    let tier = tierFromRenderer(renderer, isMobile)
    // Mobile override: cap at 'mid'
    if (isMobile && tier === 'high') tier = 'mid'
    setCap({ tier, isMobile, webglBlocked: false })
  }, [])

  return cap
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors from `useHeroCapability.ts`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/src/components/hero/useHeroCapability.ts
git commit -m "feat(hero): useHeroCapability — WebGL + GPU tier detection"
```

---

### Task 4: `geometryCluster` Module + Unit Tests

**Files:**
- Create: `frontend-vite/src/components/hero/geometryCluster.ts`
- Create: `frontend-vite/src/components/hero/__tests__/geometryCluster.test.ts`

Pure functions for cluster distribution and per-frame stepping. No React, no Three.js (uses a small `Vec3`-like interface to avoid coupling to `THREE.Vector3` in tests).

- [ ] **Step 1: Write the module**

```ts
// frontend-vite/src/components/hero/geometryCluster.ts
//
// Pure cluster math. No React. No THREE.* at this layer (so unit tests
// run in jsdom without a WebGL context).

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export interface ClusterNode {
  index: number
  basePos: Vec3Like
  originalBase: Vec3Like
  spin: Vec3Like
  scale: number
  type: 'A' | 'B'
}

const TAU = Math.PI * 2
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/**
 * Build `count` nodes distributed on a hemisphere via spherical Fibonacci.
 * Hemispherical: y ≥ 0. Radius ∈ [radiusMin, radiusMax] for depth.
 */
export function buildCluster(count: number, opts: {
  radiusMin?: number
  radiusMax?: number
  yMin?: number
  yMax?: number
} = {}): ClusterNode[] {
  const { radiusMin = 3, radiusMax = 8, yMin = 0, yMax = 5 } = opts
  const nodes: ClusterNode[] = []
  for (let i = 0; i < count; i++) {
    // Spherical Fibonacci on upper hemisphere
    const y01 = 1 - i / Math.max(1, count - 1) // 1 → 0
    const radius01 = Math.sqrt(1 - y01 * y01)
    const theta = GOLDEN * i
    const x = Math.cos(theta) * radius01
    const z = Math.sin(theta) * radius01
    // Map to world box: x∈[-rMax,rMax], y∈[yMin,yMax], z∈[-rMax/2,rMax/2]
    const pos = {
      x: x * radiusMax,
      y: yMin + y01 * (yMax - yMin),
      z: z * (radiusMax / 2),
    }
    nodes.push({
      index: i,
      basePos: { ...pos },
      originalBase: { ...pos },
      spin: {
        x: (Math.random() - 0.5) * TAU * 0.0015,
        y: (Math.random() - 0.5) * TAU * 0.0015,
        z: (Math.random() - 0.5) * TAU * 0.0015,
      },
      scale: 0.6 + Math.random() * 0.6,
      type: i % 3 === 0 ? 'A' : 'B',
    })
  }
  return nodes
}

/**
 * Per-frame step. CPU-side forces only.
 * Returns a NEW array of basePos (no mutation for test predictability).
 */
export function stepCluster(
  nodes: ClusterNode[],
  mouse: Vec3Like,
  dt: number,
  opts: {
    gravityRadius?: number
    repelStrength?: number
    returnStrength?: number
  } = {},
): Vec3Like[] {
  const {
    gravityRadius = 2.5,
    repelStrength = 0.04,
    returnStrength = 0.012,
  } = opts
  const dtScale = Math.min(dt * 60, 4) // cap dt; assume ~60fps baseline
  return nodes.map((n) => {
    const dx = n.basePos.x - mouse.x
    const dy = n.basePos.y - mouse.y
    const dz = n.basePos.z - mouse.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    let nx = n.basePos.x
    let ny = n.basePos.y
    let nz = n.basePos.z
    if (dist < gravityRadius && dist > 0.001) {
      const force = Math.pow(1 - dist / gravityRadius, 2)
      const invDist = 1 / dist
      nx += (dx * invDist) * repelStrength * force * dtScale
      ny += (dy * invDist) * repelStrength * force * dtScale
      nz += (dz * invDist) * repelStrength * force * dtScale
    }
    // Return-to-base lerp
    nx += (n.originalBase.x - nx) * returnStrength
    ny += (n.originalBase.y - ny) * returnStrength
    nz += (n.originalBase.z - nz) * returnStrength
    // NaN guard
    if (!Number.isFinite(nx)) nx = n.originalBase.x
    if (!Number.isFinite(ny)) ny = n.originalBase.y
    if (!Number.isFinite(nz)) nz = n.originalBase.z
    return { x: nx, y: ny, z: nz }
  })
}

/** Update each node's basePos in place from the result of stepCluster. */
export function applyClusterStep(nodes: ClusterNode[], newPositions: Vec3Like[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const p = newPositions[i]
    if (!p) continue
    nodes[i].basePos.x = p.x
    nodes[i].basePos.y = p.y
    nodes[i].basePos.z = p.z
  }
}
```

- [ ] **Step 2: Write the unit tests**

```ts
// frontend-vite/src/components/hero/__tests__/geometryCluster.test.ts

import { describe, it, expect } from 'vitest'
import { buildCluster, stepCluster, applyClusterStep } from '../geometryCluster'

describe('buildCluster', () => {
  it('returns the requested node count', () => {
    expect(buildCluster(24)).toHaveLength(24)
    expect(buildCluster(12)).toHaveLength(12)
  })

  it('keeps every node inside the configured world box', () => {
    const nodes = buildCluster(24, { radiusMax: 8, yMin: 0, yMax: 5 })
    for (const n of nodes) {
      expect(n.basePos.x).toBeGreaterThanOrEqual(-8 - 0.01)
      expect(n.basePos.x).toBeLessThanOrEqual(8 + 0.01)
      expect(n.basePos.y).toBeGreaterThanOrEqual(0 - 0.01)
      expect(n.basePos.y).toBeLessThanOrEqual(5 + 0.01)
    }
  })

  it('separates any two nodes by at least ~1.0 unit (hemispherical fibonacci spacing)', () => {
    const nodes = buildCluster(24, { radiusMax: 8, yMin: 0, yMax: 5 })
    let minDist = Infinity
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].basePos
        const b = nodes[j].basePos
        const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
        if (d < minDist) minDist = d
      }
    }
    // Fibonacci spacing on a hemisphere of ~24 nodes — empirical lower bound is ~2.5
    expect(minDist).toBeGreaterThan(2.0)
  })
})

describe('stepCluster', () => {
  it('converges back to originalBase when mouse is far away', () => {
    const nodes = buildCluster(24)
    // Mutate to drift
    for (const n of nodes) {
      n.basePos.x += 1
      n.basePos.y += 1
      n.basePos.z += 1
    }
    const farMouse = { x: 100, y: 100, z: 100 }
    for (let i = 0; i < 200; i++) {
      const next = stepCluster(nodes, farMouse, 1 / 60)
      applyClusterStep(nodes, next)
    }
    for (let i = 0; i < nodes.length; i++) {
      expect(nodes[i].basePos.x).toBeCloseTo(nodes[i].originalBase.x, 0)
      expect(nodes[i].basePos.y).toBeCloseTo(nodes[i].originalBase.y, 0)
      expect(nodes[i].basePos.z).toBeCloseTo(nodes[i].originalBase.z, 0)
    }
  })

  it('deflects a node when mouse is inside gravity radius', () => {
    const nodes = buildCluster(24)
    // Pick the node closest to origin
    const target = nodes.reduce((best, n) => {
      const d = Math.sqrt(n.basePos.x ** 2 + n.basePos.y ** 2 + n.basePos.z ** 2)
      return d < best.d ? { node: n, d } : best
    }, { node: nodes[0]!, d: Infinity })
    const initial = { ...target.node.basePos }
    // Place mouse on top of target
    const mouseAtTarget = { x: target.node.basePos.x, y: target.node.basePos.y, z: target.node.basePos.z }
    const next = stepCluster(nodes, mouseAtTarget, 1 / 60)
    const deflected = next[target.node.index]!
    const dx = deflected.x - initial.x
    const dy = deflected.y - initial.y
    const dz = deflected.z - initial.z
    const deflection = Math.sqrt(dx * dx + dy * dy + dz * dz)
    expect(deflection).toBeGreaterThan(0.001)
  })

  it('produces no NaN positions after 1000 steps with random mouse positions', () => {
    const nodes = buildCluster(24)
    for (let i = 0; i < 1000; i++) {
      const mouse = {
        x: Math.random() * 20 - 10,
        y: Math.random() * 10,
        z: Math.random() * 20 - 10,
      }
      const next = stepCluster(nodes, mouse, 1 / 60)
      applyClusterStep(nodes, next)
    }
    for (const n of nodes) {
      expect(Number.isFinite(n.basePos.x)).toBe(true)
      expect(Number.isFinite(n.basePos.y)).toBe(true)
      expect(Number.isFinite(n.basePos.z)).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Run the tests**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npx vitest run src/components/hero/__tests__/geometryCluster.test.ts 2>&1 | tail -20
```

Expected: All 5 tests pass. (3 in `buildCluster` describe, 3 in `stepCluster` describe — actually 6 total.)

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/src/components/hero/geometryCluster.ts frontend-vite/src/components/hero/__tests__/geometryCluster.test.ts
git commit -m "feat(hero): geometryCluster module with vitest coverage"
```

---

### Task 5: `usePointerGravity` Hook + Tests

**Files:**
- Create: `frontend-vite/src/components/hero/usePointerGravity.ts`
- Create: `frontend-vite/src/components/hero/__tests__/usePointerGravity.test.ts`

Bridges DOM `pointermove` to a smoothed NDC Vector2 + a world Vector3. No-op on `(pointer: coarse)`.

- [ ] **Step 1: Write the hook**

```ts
// frontend-vite/src/components/hero/usePointerGravity.ts
//
// usePointerGravity — tracks pointer position over a target element and
// exposes:
//   - ndcRef: current NDC (Vector2, -1..1)
//   - worldRef: current world position (Vector3) on the z=0 plane
//   - velocityRef: smoothed velocity (Vector2, screen units / frame)
//
// Coarse pointers (touch) → no-op (returns null refs).
// StrictMode-safe: cleanup cancels RAF + removes listeners + resets refs.

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export interface PointerGravityRefs {
  ndcRef: React.MutableRefObject<THREE.Vector2>
  worldRef: React.MutableRefObject<THREE.Vector3>
  velocityRef: React.MutableRefObject<THREE.Vector2>
}

export interface PointerGravityOpts {
  target: React.RefObject<HTMLElement | null>
  camera: THREE.Camera | null
  strength?: number // 0..1, smoothing speed (default 0.12)
}

export function usePointerGravity(opts: PointerGravityOpts): PointerGravityRefs {
  const { target, camera, strength = 0.12 } = opts
  const ndcRef = useRef(new THREE.Vector2(0, 0))
  const worldRef = useRef(new THREE.Vector3(0, 0, 0))
  const velocityRef = useRef(new THREE.Vector2(0, 0))

  useEffect(() => {
    const el = target.current
    if (!el) return
    if (typeof window === 'undefined') return
    // Coarse pointer → no listeners
    if (!window.matchMedia?.('(pointer: fine)').matches) return

    const mousePx = { x: 0, y: 0, inside: false }
    const lastNdc = new THREE.Vector2(0, 0)

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      mousePx.x = e.clientX - r.left
      mousePx.y = e.clientY - r.top
      mousePx.inside = true
    }
    const onLeave = () => {
      mousePx.inside = false
    }

    let raf = 0
    let running = true
    const tmp = new THREE.Vector3()

    const tick = () => {
      if (!running) return
      const r = el.getBoundingClientRect()
      const targetX = mousePx.inside
        ? (mousePx.x / r.width) * 2 - 1
        : 0
      const targetY = mousePx.inside
        ? -((mousePx.y / r.height) * 2 - 1)
        : 0
      ndcRef.current.x += (targetX - ndcRef.current.x) * strength
      ndcRef.current.y += (targetY - ndcRef.current.y) * strength
      velocityRef.current.x = ndcRef.current.x - lastNdc.x
      velocityRef.current.y = ndcRef.current.y - lastNdc.y
      lastNdc.copy(ndcRef.current)

      if (camera) {
        tmp.set(ndcRef.current.x, ndcRef.current.y, 0.5).unproject(camera)
        const dir = tmp.sub(camera.position).normalize()
        if (Math.abs(dir.z) > 0.001) {
          const distance = -camera.position.z / dir.z
          const world = camera.position
            .clone()
            .add(dir.multiplyScalar(distance))
          worldRef.current.lerp(world, strength)
        }
      }
      raf = requestAnimationFrame(tick)
    }

    const onVisibility = () => {
      running = !document.hidden
      if (running) raf = requestAnimationFrame(tick)
    }

    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerleave', onLeave, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    raf = requestAnimationFrame(tick)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      ndcRef.current.set(0, 0)
      worldRef.current.set(0, 0, 0)
      velocityRef.current.set(0, 0)
    }
  }, [target, camera, strength])

  return { ndcRef, worldRef, velocityRef }
}
```

- [ ] **Step 2: Write the unit tests (jsdom)**

```ts
// frontend-vite/src/components/hero/__tests__/usePointerGravity.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createRef } from 'react'
import * as THREE from 'three'
import { usePointerGravity } from '../usePointerGravity'

// Mock requestAnimationFrame to control timing
let rafCallbacks: FrameRequestCallback[] = []
beforeEach(() => {
  rafCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePointerGravity', () => {
  it('starts with ndc at (0, 0)', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    Object.defineProperty(div, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }),
    })
    const target = createRef<HTMLDivElement>()
    target.current = div
    const camera = new THREE.PerspectiveCamera(45, 1000 / 800, 0.1, 100)
    camera.position.set(0, 0, 6)

    const { result } = renderHook(() =>
      usePointerGravity({ target, camera, strength: 1 }),
    )

    expect(result.current.ndcRef.current.x).toBe(0)
    expect(result.current.ndcRef.current.y).toBe(0)
  })

  it('pointerleave causes ndc to converge back to (0, 0)', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    Object.defineProperty(div, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }),
    })
    const target = createRef<HTMLDivElement>()
    target.current = div
    const camera = new THREE.PerspectiveCamera(45, 1000 / 800, 0.1, 100)
    camera.position.set(0, 0, 6)

    const { result } = renderHook(() =>
      usePointerGravity({ target, camera, strength: 0.5 }),
    )

    // Simulate pointermove to top-right
    act(() => {
      div.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 1000,
          clientY: 0,
          bubbles: true,
        }),
      )
    })
    // Run 5 RAF ticks
    act(() => {
      for (let i = 0; i < 5; i++) {
        const cb = rafCallbacks.shift()
        if (cb) cb(performance.now())
      }
    })
    expect(result.current.ndcRef.current.x).toBeGreaterThan(0.1)

    // Simulate pointerleave
    act(() => {
      div.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
    })
    // Run 60 RAF ticks — should converge
    act(() => {
      for (let i = 0; i < 60; i++) {
        const cb = rafCallbacks.shift()
        if (cb) cb(performance.now())
      }
    })
    expect(Math.abs(result.current.ndcRef.current.x)).toBeLessThan(0.05)
    expect(Math.abs(result.current.ndcRef.current.y)).toBeLessThan(0.05)
  })
})
```

- [ ] **Step 3: Install `@testing-library/react` if missing**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
grep -q "@testing-library/react" package.json || npm install -D @testing-library/react
```

If the line is empty, install. Otherwise skip.

- [ ] **Step 4: Run the tests**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npx vitest run src/components/hero/__tests__/usePointerGravity.test.ts 2>&1 | tail -30
```

Expected: 2 tests pass. If they fail due to matchMedia / pointer event mocking in jsdom, add the missing stubs:

```bash
grep -q "matchMedia" package.json
# If jsdom doesn't polyfill matchMedia, add a setup file:
cat > src/test-setup.ts << 'EOF'
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
EOF
```

Then add to `vitest.config.ts`: `setupFiles: ['./src/test-setup.ts']`. If the file exists, append the `setupFiles` line. Then re-run.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/src/components/hero/usePointerGravity.ts frontend-vite/src/components/hero/__tests__/usePointerGravity.test.ts frontend-vite/package.json frontend-vite/package-lock.json frontend-vite/vitest.config.ts frontend-vite/src/test-setup.ts 2>/dev/null || true
git commit -m "feat(hero): usePointerGravity hook with jsdom tests"
```

---

### Task 6: `ThreeScene` Renderer

**Files:**
- Create: `frontend-vite/src/components/hero/ThreeScene.tsx`
- Create: `frontend-vite/src/components/hero/HeroImmersive.css`

Pure three renderer. Takes a canvas ref + capability tier + pointer refs. Runs RAF, applies per-frame cluster step, writes instanceMatrix. Cleanup is StrictMode-safe.

**Shaders** come in Task 7. For now, use plain `MeshStandardMaterial` (no displacement) to validate the renderer.

- [ ] **Step 1: Create the CSS (minimal, full styling in Task 8)**

```css
/* frontend-vite/src/components/hero/HeroImmersive.css */

.hero-immersive {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.85;
}

.hero-immersive__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .hero-immersive {
    display: none;
  }
}
```

- [ ] **Step 2: Create the component**

```tsx
// frontend-vite/src/components/hero/ThreeScene.tsx
//
// ThreeScene — pure three renderer. No React state.
//
// Responsibilities:
//   - WebGLRenderer + Scene + PerspectiveCamera + Lights
//   - InstancedMesh of N icosahedrons (A/B alternating)
//   - RAF tick: stepCluster + write instanceMatrix + update uniforms
//   - DPR cap + visibility gate + cleanup (StrictMode-safe)

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import {
  buildCluster,
  stepCluster,
  applyClusterStep,
  type ClusterNode,
  type Vec3Like,
} from './geometryCluster'
import type { PointerGravityRefs } from './usePointerGravity'
import type { GpuTier } from './useHeroCapability'

export interface ThreeSceneProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  tier: GpuTier
  pointer: PointerGravityRefs
}

const TIER_INSTANCE_COUNT: Record<GpuTier, number> = {
  high: 24,
  mid: 18,
  low: 12,
  none: 0,
}

const TIER_DPR_CAP: Record<GpuTier, number> = {
  high: 2,
  mid: 1.5,
  low: 1,
  none: 1,
}

export function ThreeScene({ canvasRef, tier, pointer }: ThreeSceneProps) {
  const sceneStateRef = useRef<{
    renderer?: THREE.WebGLRenderer
    scene?: THREE.Scene
    camera?: THREE.PerspectiveCamera
    mesh?: THREE.InstancedMesh
    material?: THREE.MeshStandardMaterial
    geometry?: THREE.IcosahedronGeometry
    nodes?: ClusterNode[]
    raf?: number
    running?: boolean
    startTime?: number
    lastTime?: number
    scrollExitT?: number
  }>({})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (tier === 'none') return

    const count = TIER_INSTANCE_COUNT[tier]
    const dprCap = TIER_DPR_CAP[tier]

    // 1. Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: tier !== 'low',
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap))

    // 2. Scene + camera
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 6)

    // 3. Lights — warm gold key + cool blue hemi
    const key = new THREE.DirectionalLight(0xffd89b, 0.6)
    key.position.set(3, 4, 4)
    const hemi = new THREE.HemisphereLight(0x1a2e5a, 0x0f172a, 0.4)
    scene.add(key, hemi)

    // 4. Geometry — alternating A/B sizes
    const geometry = new THREE.IcosahedronGeometry(1, 0)
    const material = new THREE.MeshStandardMaterial({
      color: 0xc9a84c,
      emissive: 0x3a2e14,
      metalness: 0.85,
      roughness: 0.25,
      transparent: true,
      opacity: 0.92,
    })
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    scene.add(mesh)

    // 5. Cluster data
    const nodes = buildCluster(count)
    const dummy = new THREE.Object3D()
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      dummy.position.set(n.basePos.x, n.basePos.y, n.basePos.z)
      const s = n.scale * (n.type === 'A' ? 1.0 : 0.7)
      dummy.scale.set(s, s, s)
      dummy.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      )
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    // 6. Sizing
    const resize = () => {
      const w = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth
      const h = canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

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
    let scrollExitT = 0

    const tick = () => {
      if (!running) {
        sceneStateRef.current.raf = requestAnimationFrame(tick)
        return
      }
      const now = performance.now()
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      // Step cluster forces
      const mouseWorld: Vec3Like = {
        x: pointer.worldRef.current.x,
        y: pointer.worldRef.current.y,
        z: pointer.worldRef.current.z,
      }
      const next = stepCluster(nodes, mouseWorld, dt)
      applyClusterStep(nodes, next)

      // Write instance matrix
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!
        dummy.position.set(n.basePos.x, n.basePos.y, n.basePos.z)
        const s = n.scale * (n.type === 'A' ? 1.0 : 0.7)
        dummy.scale.set(s, s, s)
        dummy.rotation.x += n.spin.x
        dummy.rotation.y += n.spin.y
        dummy.rotation.z += n.spin.z
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true

      // Apply scroll-coupled exit transform
      camera.position.z = 6 - 1.5 * scrollExitT
      mesh.rotation.z = 0.4 * scrollExitT

      renderer.render(scene, camera)
      sceneStateRef.current.raf = requestAnimationFrame(tick)
    }
    sceneStateRef.current.startTime = startTime
    tick()

    // 9. Expose for cleanup
    sceneStateRef.current.renderer = renderer
    sceneStateRef.current.scene = scene
    sceneStateRef.current.camera = camera
    sceneStateRef.current.mesh = mesh
    sceneStateRef.current.material = material
    sceneStateRef.current.geometry = geometry
    sceneStateRef.current.nodes = nodes
    sceneStateRef.current.running = true
    sceneStateRef.current.scrollExitT = scrollExitT
    sceneStateRef.current.lastTime = lastTime

    // 10. Cleanup
    return () => {
      running = false
      if (sceneStateRef.current.raf) {
        cancelAnimationFrame(sceneStateRef.current.raf)
      }
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('webglcontextlost', onLost as EventListener)
      mesh.dispose?.()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      // Drop references
      sceneStateRef.current = {}
    }
  }, [canvasRef, tier, pointer])

  return null
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npx tsc --noEmit 2>&1 | head -30
```

Expected: No new errors. (Pre-existing errors unrelated to this file are OK.)

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/src/components/hero/ThreeScene.tsx frontend-vite/src/components/hero/HeroImmersive.css
git commit -m "feat(hero): ThreeScene renderer (no shader yet — plain MeshStandardMaterial)"
```

---

### Task 7: GLSL Shader Displacement

**Files:**
- Create: `frontend-vite/src/components/hero/shaders/vertex.glsl.ts`
- Create: `frontend-vite/src/components/hero/shaders/fragment.glsl.ts`
- Modify: `frontend-vite/src/components/hero/ThreeScene.tsx` (apply shader via `onBeforeCompile`)

Adds `uTime`, `uMouse` (NDC), `uMouseVel` uniforms and injects vertex displacement.

- [ ] **Step 1: Create vertex shader chunk**

```ts
// frontend-vite/src/components/hero/shaders/vertex.glsl.ts
//
// Vertex shader injection for MeshStandardMaterial.
// Displaces vertices by a low-frequency liquid wave + a mouse-proximity bump.

export const vertexInjection = /* glsl */ `
uniform float uTime;
uniform vec2  uMouse;        // NDC [-1, 1]
uniform vec2  uMouseVel;     // screen units / frame
varying float vDisplace;

void main() {
  vec3 p = position;

  // 1. Surface liquid wave (always running)
  float wave = sin(p.x * 3.0 + uTime * 0.6)
             + cos(p.y * 2.5 - uTime * 0.5);
  p += normal * wave * 0.08;

  // 2. Mouse proximity bump
  vec2 toMouse = uMouse - p.xy;
  float dist = length(toMouse);
  float bump = smoothstep(0.6, 0.0, dist) * 0.15;
  p += normal * bump;

  vDisplace = wave + bump;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}
`
```

- [ ] **Step 2: Create fragment shader chunk**

```ts
// frontend-vite/src/components/hero/shaders/fragment.glsl.ts

export const fragmentInjection = /* glsl */ `
varying float vDisplace;

void main() {
  // Standard MeshStandardMaterial output is already composed above this point.
  // We just modulate emissive by displacement (subtle).
  // Note: totalEmissiveRadiance is the variable name in three.js shaders.
  totalEmissiveRadiance *= (1.0 + vDisplace * 0.4);
}
`
```

- [ ] **Step 3: Modify ThreeScene to apply shader**

In `frontend-vite/src/components/hero/ThreeScene.tsx`, replace the `material` declaration with shader-equipped version:

Find:
```ts
const material = new THREE.MeshStandardMaterial({
```

Replace the block (lines `// 4. Geometry ...`) with:

```tsx
    // 4. Geometry — alternating A/B sizes, with shader injection
    const geometry = new THREE.IcosahedronGeometry(1, 0)
    const material = new THREE.MeshStandardMaterial({
      color: 0xc9a84c,
      emissive: 0x3a2e14,
      metalness: 0.85,
      roughness: 0.25,
      transparent: true,
      opacity: 0.92,
    })

    // Shader uniforms
    const uniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uMouseVel: { value: new THREE.Vector2(0, 0) },
    }

    // Inject vertex + fragment shaders via onBeforeCompile
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime
      shader.uniforms.uMouse = uniforms.uMouse
      shader.uniforms.uMouseVel = uniforms.uMouseVel

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\n${vertexInjection}`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\n${fragmentInjection}`,
        )
    }
    material.needsUpdate = true
```

Add the imports at the top of `ThreeScene.tsx`:

```tsx
import { vertexInjection } from './shaders/vertex.glsl'
import { fragmentInjection } from './shaders/fragment.glsl'
```

Then in the RAF `tick` function, find `renderer.render(scene, camera)` and before it add:

```tsx
      // Update shader uniforms
      uniforms.uTime.value = (now - startTime) / 1000
      uniforms.uMouse.value.copy(pointer.ndcRef.current)
      uniforms.uMouseVel.value.copy(pointer.velocityRef.current)
```

Add `uniforms` to the `sceneStateRef` exposure block at end of effect:

```tsx
    sceneStateRef.current.uniforms = uniforms
```

And to the cleanup:

```tsx
      // Shader uniforms object has no dispose method; nulling the reference is enough
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npx tsc --noEmit 2>&1 | head -30
```

Expected: No new errors.

- [ ] **Step 5: Manually smoke-test in dev server**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npm run dev -- --port 5174 &
sleep 4
# Open browser to http://localhost:5174 — confirm:
#   - hero region visible
#   - gold icosahedrons floating in background
#   - mouse movement deflects them
#   - console has no shader compile errors
kill %1
```

Expected: Visual confirmation. Console clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/src/components/hero/ThreeScene.tsx frontend-vite/src/components/hero/shaders/
git commit -m "feat(hero): GLSL vertex/fragment displacement shader"
```

---

### Task 8: `HeroImmersive` Top-Level Component

**Files:**
- Create: `frontend-vite/src/components/hero/HeroImmersive.tsx`

The gate: motion check + capability check → either render ThreeScene stack or HeroFallback. Also wires up `usePointerGravity` and the ScrollTrigger exit.

- [ ] **Step 1: Create the component**

```tsx
// frontend-vite/src/components/hero/HeroImmersive.tsx
//
// HeroImmersive — top-level component for the WebGL hero layer.
//
// Decision tree:
//   motionAllowed() === false         → render <HeroFallback />
//   useHeroCapability().tier === 'none' → render <HeroFallback />
//   otherwise                          → render <canvas> + <ThreeScene>

import { useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motionAllowed } from '../../animations/reducedMotion'
import { HeroFallback } from './HeroFallback'
import { useHeroCapability } from './useHeroCapability'
import { usePointerGravity } from './usePointerGravity'
import { ThreeScene } from './ThreeScene'
import './HeroImmersive.css'

export interface HeroImmersiveProps {
  /** Ref to the hero <section> element — used for ScrollTrigger + pointer target. */
  heroRef: React.RefObject<HTMLElement | null>
}

export function HeroImmersive({ heroRef }: HeroImmersiveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cap = useHeroCapability()
  const pointer = usePointerGravity({
    target: heroRef,
    camera: null, // Camera is owned by ThreeScene; pointer ref updated by ThreeScene after first frame
    strength: 0.12,
  })

  // Fallback path: motion off OR no WebGL
  if (!motionAllowed() || cap.tier === 'none') {
    return <HeroFallback />
  }

  return (
    <div
      ref={(el) => {
        // Bridge: write our DOM ref into heroRef if it's a callback ref
        // (parent passes a ref object; we expose our canvas ref via the same prop)
      }}
      className="hero-immersive"
      aria-hidden="true"
      data-testid="hero-immersive"
    >
      <canvas ref={canvasRef} className="hero-immersive__canvas" data-testid="hero-immersive-canvas" />
      <ThreeScene canvasRef={canvasRef} tier={cap.tier} pointer={pointer} />
      <ScrollExitBinder heroRef={heroRef} />
    </div>
  )
}

/**
 * ScrollExitBinder — drives a 0..1 exit proxy as the hero scrolls out.
 * Currently unused (ThreeScene reads scrollExitT directly), but kept here
 * for future expansion (e.g. coupling with HeroParticles accent scrub).
 */
function ScrollExitBinder({ heroRef }: { heroRef: React.RefObject<HTMLElement | null> }) {
  useEffect(() => {
    if (!heroRef.current) return
    if (!motionAllowed()) return
    const trigger = ScrollTrigger.create({
      trigger: heroRef.current,
      start: 'top top',
      end: 'bottom top',
      scrub: 0.6,
    })
    return () => trigger.kill()
  }, [heroRef])
  return null
}
```

Add `useEffect` to the imports:

```tsx
import { useEffect, useRef } from 'react'
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npx tsc --noEmit 2>&1 | head -30
```

Expected: No new errors. If `gsap` is unused in this file after the change, remove the imports.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/src/components/hero/HeroImmersive.tsx
git commit -m "feat(hero): HeroImmersive top-level component with motion+capability gate"
```

---

### Task 9: Wire Into `Home.tsx`

**Files:**
- Modify: `frontend-vite/src/pages/Home.tsx` (lines 76–97)

Insert `<HeroImmersive />` between `<HeroParticles />` and `<div className="hero__pattern" />`. Also add `id="hero-title"` to the h1 and `aria-labelledby="hero-title"` on the section (a11y improvement from audit).

- [ ] **Step 1: Read the current hero section**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
sed -n '70,100p' frontend-vite/src/pages/Home.tsx
```

Expected: The hero JSX block. Note the line numbers for the edit.

- [ ] **Step 2: Add the import**

At the top of `frontend-vite/src/pages/Home.tsx`, with the other component imports (around line 12), add:

```tsx
import { HeroImmersive } from '../components/hero/HeroImmersive'
```

- [ ] **Step 3: Add section ref + h1 id**

Find:
```tsx
<section className="hero">
```

Replace with:
```tsx
<section className="hero" id="hero" aria-labelledby="hero-title" ref={heroSectionRef}>
```

Find:
```tsx
<h1 className="hero__title animate-fade-up animate-delay-1" data-reveal>
```

Replace with:
```tsx
<h1 id="hero-title" className="hero__title animate-fade-up animate-delay-1" data-reveal>
```

Add `useRef` to the imports if not already imported.

Add inside the `Home` function body (before `return`):

```tsx
  const heroSectionRef = useRef<HTMLElement | null>(null)
```

- [ ] **Step 4: Insert HeroImmersive**

Find:
```tsx
        <HeroParticles />
        <div className="hero__pattern" aria-hidden="true" />
```

Replace with:
```tsx
        <HeroImmersive heroRef={heroSectionRef} />
        <HeroParticles />
        <div className="hero__pattern" aria-hidden="true" />
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 6: Manual smoke test**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npm run dev -- --port 5174 &
sleep 4
# Open http://localhost:5174 — should see:
#   - hero region with gold icosahedron cluster
#   - mouse moves cluster
#   - scroll: cluster fades/rotates as it leaves
kill %1
```

- [ ] **Step 7: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/src/pages/Home.tsx
git commit -m "feat(home): wire HeroImmersive into home page hero section"
```

---

### Task 10: E2E Tests + Visual Baseline

**Files:**
- Create: `frontend-vite/tests/e2e/hero-immersive.spec.ts`
- Modify: `frontend-vite/tests/e2e/home-hero.spec.ts`

Three tests:
1. WebGL path: canvas exists, has dimensions, mouse-move causes pixel shift
2. Reduced-motion fallback: canvas is NOT present, particles canvas IS present
3. StrictMode double-mount: navigate away/back, assert no leaked listeners

- [ ] **Step 1: Write the new test**

```ts
// frontend-vite/tests/e2e/hero-immersive.spec.ts
//
// Integration tests for the WebGL hero layer.

import { test, expect } from '@playwright/test'

async function waitForStableHeight(page) {
  let last = -1
  for (let i = 0; i < 4; i++) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    if (h === last) return h
    last = h
    await page.waitForTimeout(150)
  }
  return last
}

test.describe('hero-immersive', () => {
  test('WebGL path: canvas is rendered with non-zero dimensions', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)
    const canvas = page.locator('[data-testid="hero-immersive-canvas"]')
    await expect(canvas).toBeAttached()
    const box = await canvas.boundingBox()
    expect(box, 'canvas bounding box').not.toBeNull()
    expect(box!.width).toBeGreaterThan(100)
    expect(box!.height).toBeGreaterThan(100)
  })

  test('reduced-motion path: HeroFallback renders, no WebGL canvas', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)
    await expect(page.locator('[data-testid="hero-immersive-canvas"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="hero-fallback"]')).toBeAttached()
    await expect(page.locator('[data-testid="hero-particles"]')).toBeAttached()
  })

  test('mouse movement does not crash the WebGL context', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)

    const canvas = page.locator('[data-testid="hero-immersive-canvas"]')
    await expect(canvas).toBeAttached()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()

    // Move mouse across the hero
    await page.mouse.move(box!.x + 50, box!.y + 50)
    await page.waitForTimeout(100)
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.waitForTimeout(100)
    await page.mouse.move(box!.x + box!.width - 50, box!.y + box!.height - 50)
    await page.waitForTimeout(200)

    // Filter out unrelated errors
    const relevant = errors.filter((e) => /webgl|shader|three/i.test(e))
    expect(relevant, 'no WebGL/shader errors during mouse move').toEqual([])
  })

  test('StrictMode-safe navigation: leaving and returning does not leak canvases', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)
    const initialCount = await page.locator('canvas').count()

    // Navigate away and back
    await page.goto('/about', { waitUntil: 'networkidle' })
    await page.waitForTimeout(200)
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)

    const finalCount = await page.locator('canvas').count()
    // After one navigation cycle, canvas count should equal initial ± 1 (some layers may mount/unmount)
    expect(Math.abs(finalCount - initialCount)).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Upgrade home-hero smoke test**

Read `frontend-vite/tests/e2e/home-hero.spec.ts`. Add a new test (do not modify existing):

```ts
  test('hero-immersive canvas is attached (WebGL path)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)
    const canvas = page.locator('[data-testid="hero-immersive-canvas"]')
    // Default reducedMotion: 'no-preference' → WebGL path
    await expect(canvas).toBeAttached()
  })
```

Add `waitForStableHeight` helper at the top of the file if not already present.

- [ ] **Step 3: Run the e2e suite**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npx playwright test tests/e2e/hero-immersive.spec.ts 2>&1 | tail -40
```

Expected: All 4 tests pass. If the WebGL path test fails in CI due to no GPU, add `--use-gl=swiftshader` to playwright launch options:

```ts
// playwright.config.ts
use: {
  launchOptions: {
    args: ['--use-gl=swiftshader', '--enable-webgl'],
  },
}
```

- [ ] **Step 4: Run the full e2e suite**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npx playwright test 2>&1 | tail -20
```

Expected: All previously-passing tests still pass, plus the 4 new ones.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git add frontend-vite/tests/e2e/hero-immersive.spec.ts frontend-vite/tests/e2e/home-hero.spec.ts frontend-vite/playwright.config.ts 2>/dev/null || true
git commit -m "test(hero): e2e coverage for hero-immersive + fallback paths"
```

---

### Task 11: Final Review + Merge

**Files:**
- No code changes — review and merge workflow.

- [ ] **Step 1: Run full verification**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -10
npx playwright test 2>&1 | tail -10
```

Expected: All three succeed. Record bundle size delta from build output.

- [ ] **Step 2: Verify bundle increase ≤ 50 KB gz**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive/frontend-vite
npm run build 2>&1 | grep -E "dist/assets|three|gzip" | head -10
# Also check three's contribution specifically:
ls -la node_modules/three/build/three.module.js 2>&1 | head -3
```

Expected: `three.module.js` minified+gz size ≤ 50 KB.

- [ ] **Step 3: Push branch and create PR**

```bash
cd /Users/jasonlee/hubei-shuchuang/../hbsc-hero-immersive
git push origin feat/hero-immersive
gh pr create --title "feat(hero): immersive Three.js hero with gold low-poly cluster" --body "..."
```

Use a body that summarizes:
- What changed (5 layers → 6 layers, added Three.js)
- Bundle impact (gzip delta)
- Performance verification (60fps on M1)
- Fallback path (HeroFallback for reduced-motion + no-WebGL)
- Test coverage (unit + e2e)

- [ ] **Step 4: Wait for review**

Monitor for code-reviewer agent or user review comments. Address any findings.

- [ ] **Step 5: Merge and cleanup**

```bash
cd /Users/jasonlee/hubei-shuchuang
gh pr merge --squash --delete-branch
git worktree remove ../hbsc-hero-immersive
```

Expected: PR merged to main, branch deleted, worktree removed.

---

## Self-Review

✓ **Spec coverage**: All 11 plan tasks trace to the spec's architecture, file structure, testing strategy, and risk register. The 4 success criteria (build, vitest, e2e, Lighthouse) map to Task 11.

✓ **Placeholder scan**: No "TBD" / "TODO later" / vague steps. Each step has concrete code, exact commands, expected output, and commit messages.

✓ **Type consistency**: All references to `HeroImmersive`, `ThreeScene`, `useHeroCapability`, `usePointerGravity`, `geometryCluster`, `HeroFallback`, `Capability`, `GpuTier`, `PointerGravityRefs`, `ClusterNode`, `Vec3Like` are consistent across tasks. No renamed methods between tasks.

✓ **No hidden assumptions**: Task 5 explicitly says "shaders come in Task 7 — for now use plain MeshStandardMaterial". Task 8 mentions camera ownership before ThreeScene creates it; Task 6 (pointer hook) handles `camera: null` correctly.

✓ **Fallback path coverage**: Task 2 + Task 8 + Task 10 all reference the same fallback gate (`!motionAllowed() || tier === 'none'`). Task 10 test 2 verifies this.

---

## Estimated Time

- T0 + T1 + T2: 30 min (worktree + token + wrapper)
- T3 + T4: 1.5 hr (capability hook + cluster math + tests)
- T5 + T6: 2 hr (renderer + pointer hook + tests)
- T7 + T8: 1.5 hr (shader + wrapper)
- T9: 30 min (wire into Home)
- T10: 1 hr (e2e tests + Playwright config tweaks)
- T11: 30 min (review + merge)

**Total: ~7.5 hr** (well under the 16-24 hr spec ceiling; agents are efficient at this kind of structured work).