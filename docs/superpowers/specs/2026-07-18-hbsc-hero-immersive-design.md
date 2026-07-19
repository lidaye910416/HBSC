# HBSC Hero Immersive Upgrade — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-07-18
**Status:** Approved
**Branch:** `feat/hero-immersive` (worktree)
**Author:** Claude (after user selected Approach B + new `--color-accent-gold` token)

---

## Goal

Replace the existing hero decoration (HeroShader + HeroParticles) with a **Three.js-driven immersive layer** featuring a low-poly gold icosahedron cluster that responds to mouse position via a soft gravity field, plus a GLSL vertex displacement for surface liquid motion. The existing decoration layers are retained as a fallback when WebGL is unavailable, reduced motion is requested, or the GPU is detected as low-tier.

---

## Architecture

```
Home.tsx (hero section, lines 76–97)
└── <section className="hero" id="hero">
    ├── <HeroImmersive />         ← new: WebGL-driven 3D cluster (this PR)
    │     ├── <canvas.hero-immersive>
    │     ├── <ThreeScene>        ← renderer + lights + instanced mesh + RAF
    │     └── <usePointerGravity> ← mouse → ndc / world ref
    ├── <div className="hero__pattern" /> ← preserved
    └── <div className="hero__content" /> ← preserved
         ├── label / title / subtitle / actions (CTA buttons unchanged)

Fallback path (motionAllowed()=false OR WebGL unavailable OR tier='none'):
  HeroImmersive returns <HeroFallback /> which renders the existing
  HeroShader + HeroParticles verbatim — no behavioral change for those users.
```

**Files added** under `frontend-vite/src/components/hero/`:

| File | Purpose |
|---|---|
| `HeroImmersive.tsx` | React entry, motion gate, DOM ref bridge |
| `HeroImmersive.css` | canvas positioning, z-index, opacity, reduced-motion media query |
| `HeroFallback.tsx` | Wraps existing HeroShader + HeroParticles verbatim |
| `ThreeScene.tsx` | Pure three renderer (WebGLRenderer, InstancedMesh, Lights, RAF, cleanup) |
| `usePointerGravity.ts` | pointermove → ndc (NDC) + world (THREE.Vector3) with lerp smoothing |
| `geometryCluster.ts` | spherical Fibonacci hemisphere distribution + per-frame step (forces + return) |
| `useHeroCapability.ts` | WebGL detection + GPU tier (UNMASKED_RENDERER_WEBGL) + mobile matchMedia |
| `shaders/vertex.glsl` | vertex displacement: surface liquid wave + mouse proximity bump |
| `shaders/fragment.glsl` | emissive intensity multiplier via varying |
| `__tests__/geometryCluster.test.ts` | vitest unit tests |
| `__tests__/usePointerGravity.test.ts` | vitest unit tests (jsdom) |
| `__tests__/HeroImmersive.spec.tsx` | Playwright component-style test (rendering + cleanup) |

**Files modified**:
- `frontend-vite/src/pages/Home.tsx` — insert `<HeroImmersive />` after `<HeroParticles />` (lines ~77)
- `frontend-vite/src/styles/global.css` — add `--color-accent-gold: #C9A84C` token
- `frontend-vite/package.json` — add `three@^0.170`
- `frontend-vite/tests/e2e/home-hero.spec.ts` — upgrade assertion to verify canvas exists + non-zero pixels
- `frontend-vite/tests/e2e/hero-immersive.spec.ts` — NEW: motion-gate test + StrictMode double-mount test + mouse-move integration test

**Files NOT modified** (per audit risk list):
- `frontend-vite/src/animations/runtime.ts` — `ScrollTrigger.normalizeScroll` ban preserved
- `frontend-vite/src/components/HeroParticles.tsx` and `HeroShader.tsx` — kept for fallback
- `frontend-vite/src/pages/Home.css` lines 58–166 — only append `.hero-immersive` rules, do not change existing styles
- Any other hero file (Navigation, About, etc.)

---

## Tech Stack

- **Three.js** `^0.170` (only — no `@react-three/fiber`, no `@react-three/drei`)
- GSAP ecosystem (already installed): not used in this hero — `ThreeScene` runs its own RAF
- React 19 (already installed)
- Vitest (already installed) — unit tests for cluster + pointer hook
- Playwright (already installed) — e2e + StrictMode double-mount

**Bundle impact**: `three` core tree-shaken ≈ 35–40 KB gzipped (only `WebGLRenderer`, `InstancedMesh`, `IcosahedronGeometry`, `MeshStandardMaterial`, `DirectionalLight`, `HemisphereLight`, `PerspectiveCamera`, `Color`, `Vector2`, `Vector3`).

---

## Key Technical Decisions

### 1. Single source of truth for "should WebGL run"

```ts
function shouldRunWebGL(): boolean {
  if (!motionAllowed()) return false
  const cap = detectCapability()
  return cap.tier !== 'none' && !cap.webglBlocked
}
```

Both `HeroImmersive.tsx` (component-level) and `ThreeScene.tsx` (runtime safety) check it. The component-level check decides whether to render fallback. The runtime check is a defense-in-depth.

### 2. GPU tier → instance count mapping

| tier | DPR cap | instance count | antialias |
|---|---|---|---|
| `high` (dedicated GPU / Apple Silicon) | min(devicePixelRatio, 2) | 24 | true |
| `mid` (integrated GPU) | min(devicePixelRatio, 1.5) | 18 | true |
| `low` (mobile / weak iGPU) | min(devicePixelRatio, 1) | 12 | false |
| `none` (no WebGL / blocked) | — | 0 (fallback only) | — |

Tier detection via `WEBGL_debug_renderer_info` string match:
- `Apple M*`, `NVIDIA`, `AMD`, `Radeon Pro` → `high`
- `Intel(R) UHD`, `Intel(R) Iris`, `Mali-G*` (high-end), `Adreno 6*` → `mid`
- `Mali-G3*`/`Mali-G5*` (low-end), `Adreno 3*`/`4*`/`5*`, `SwiftShader` → `low`
- `null`/empty/unknown → `low` (assume worst)

Mobile overrides: `(max-width: 768px)` → cap to `mid`.

### 3. Mouse gravity field

- `usePointerGravity` tracks `(clientX, clientY)` over the hero element, normalized to NDC `[-1, 1]²`.
- Each frame: `ndcRef.lerp(target, 0.12)` for smoothing.
- `worldRef` is the same NDC unprojected onto the `z=0` plane.
- On `pointerleave`: target NDC converges to `(0, 0)` (center).
- `pointer: coarse` (touch) → hook is a no-op (no listener attached).

### 4. Cluster forces (CPU-side, not vertex shader)

- Initial distribution: spherical Fibonacci hemisphere, radius ∈ `[3, 8]`, biased to right-back of camera.
- Each frame: for each node, compute distance to mouse world position; if `dist < gravityRadius (2.5)`, apply **soft repulsion** `(-repelStrength * (1 - dist/r)²) * normalize(toMouse)`.
- After force: `node.basePos.lerp(originalBasePos, returnStrength)` so cluster springs back.
- Self-spin: each node has `spin = random axis * 0.0015 rad/frame`.
- Result written to `InstancedMesh.instanceMatrix`.

**Why CPU not vertex shader**: forces need spatial reasoning across nodes (per-node interaction); vertex shader displacement is a *visual* effect on each node's surface (see #5).

### 5. Vertex displacement (GLSL)

- Uniforms: `uTime (float)`, `uMouse (vec2 NDC)`, `uMouseVel (vec2)`.
- Per-vertex:
  1. Surface wave: `displace = sin(p.x*3 + uTime*0.6) + cos(p.y*2.5 - uTime*0.5)` → push along `normal` by `displace * 0.08`.
  2. Mouse proximity: `toMouse = uMouse - p.xy; bump = smoothstep(0.6, 0.0, length(toMouse)) * 0.15` → push along `normal`.
  3. `vDisplace = displace + bump` → fragment varying.

**Why two separate effects**: the wave is global (always running); the mouse bump is local and immediate. They compose multiplicatively.

### 6. Fragment shading

- Base: `MeshStandardMaterial(color: #C9A84C, emissive: #3A2E14, metalness: 0.85, roughness: 0.25)`.
- Custom injection via `mat.onBeforeCompile`: in `<emissivemap_fragment>`, multiply emissive by `(1 + vDisplace * 0.4)`.

### 7. Scroll-coupled exit

- `ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 })`.
- Progress drives a proxy `params.exitT (0..1)` that `ThreeScene` reads each frame.
- Effect: cluster rotates `+0.4 * exitT` rad on Z, camera dollies in `z = 6 - 1.5 * exitT`, mouse gravity is multiplied by `(1 - exitT)` (cluster freezes).
- This couples with the existing `HeroParticles.accent` scrub (`0..1`) so the layers feel coherent.

### 8. Cleanup (StrictMode + HMR safe)

Every `useEffect` in this PR follows the existing `HeroParticles` pattern:
1. `cancelAnimationFrame(raf)`
2. `removeEventListener` all listeners
3. `tween.scrollTrigger?.kill()` then `tween.kill()` for any GSAP tweens
4. `geometry.dispose()` + `material.dispose()` + `renderer.dispose()`
5. Reset shared ref to empty object

`usePointerGravity` adds: `ndcRef.current.set(0, 0); worldRef.current.set(0, 0, 0)` on cleanup so re-mount starts clean.

### 9. Accessibility

- `<canvas>` element: `aria-hidden="true"` + `data-testid="hero-immersive"` (already covered by `.hero-immersive` parent).
- New `<section id="hero">` gets `aria-labelledby="hero-title"` (h1 needs an id — added in this PR; currently missing per audit).
- Hero text content unchanged — semantic structure intact.
- `prefers-reduced-motion: reduce` → `<HeroFallback />` (CSS in `HeroImmersive.css` also adds `@media (prefers-reduced-motion: reduce) { .hero-immersive { display: none } }` as defense-in-depth).

### 10. Performance budget

- Target: 60 fps on MacBook Air M1, 50 fps on iPad Air, 30 fps on mid-tier Android.
- DPR cap (see #2).
- `requestAnimationFrame` is gated by `document.visibilityState` (skip when hidden).
- `webglcontextlost` listener prevents default (don't auto-rebuild — HMR will remount).

---

## Data Flow

```
mouse event → usePointerGravity
  ├─ ndcRef (THREE.Vector2)
  ├─ worldRef (THREE.Vector3)
  └─ velocityRef (THREE.Vector2)

ThreeScene RAF tick:
  1. Read ndcRef, worldRef, velocityRef
  2. Update uMouse/uMouseVel uniforms
  3. stepCluster(nodes, mouseWorld, dt) → writes instanceMatrix
  4. Update uTime uniform
  5. Apply scroll-exit transform (rotation + camera z)
  6. renderer.render(scene, camera)

ScrollTrigger onUpdate:
  └─ params.exitT (0..1) proxy
        └─ read by ThreeScene RAF tick
```

---

## Testing Strategy

### Unit (Vitest, jsdom)
- `geometryCluster.test.ts`:
  - `buildCluster(24)` returns 24 nodes
  - All node positions within `(x∈[-8,8], y∈[0,5], z∈[-6,6])`
  - No two nodes within distance 1.0 of each other (min separation)
  - `stepCluster` with mouse at origin after 100 frames: all nodes converge back to base positions (no drift)
  - `stepCluster` with mouse inside gravity radius: at least one node deflects by ≥ 0.5 units
- `usePointerGravity.test.ts`:
  - Initial ndcRef is (0,0)
  - pointermove sets target ndc; after 30 frames, actual ndc converges to within 0.01
  - pointerleave sets target back to (0,0); after 30 frames, actual returns to (0,0)

### Integration (Playwright e2e)
- `tests/e2e/hero-immersive.spec.ts`:
  - **renders canvas**: `<canvas data-testid="hero-immersive">` exists, has non-zero `width`/`height`, opacity > 0.5
  - **falls back on reduced-motion**: with `reducedMotion: 'reduce'`, the canvas is not present; HeroFallback content (`<canvas data-testid="hero-particles">`) IS present
  - **mouse move updates instance matrix**: dispatch `pointermove` at known coords, sample a pixel from canvas, expect color shift after a few frames
  - **StrictMode double-mount clean**: visit `/`, navigate away, navigate back; assert no `webglcontextlost` events fired; assert `document.querySelectorAll('canvas').length === expected`
- `tests/e2e/home-hero.spec.ts` upgrade:
  - Add: `<canvas data-testid="hero-immersive">` is attached when `reducedMotion: 'no-preference'`
  - Add: `[data-count-up]` still works (regression)

### Manual / visual
- Playwright `toHaveScreenshot` baseline for the hero region (saved at `tests/e2e/__screenshots__/hero-default.spec.ts-snap.png`).
- Lighthouse run: Performance ≥ 90 (target), Accessibility 100.
- Chrome DevTools Performance recording: ≥ 50 fps for 5 seconds of mouse movement.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `three` tree-shake doesn't work as expected | Low | Bundle bloat | Use specific imports `import { WebGLRenderer } from 'three'`; run `vite build` and check chunk size; fallback: import from `three/build/three.module.js` |
| StrictMode double mount leaks WebGL context | Low | Dev-only memory leak | All cleanup paths verified; manual test by toggling StrictMode 5x in devtools Memory |
| `prefers-reduced-motion` users see no decoration at all | Medium | UX: feels barren | `<HeroFallback />` already renders HeroParticles for these users |
| Mouse gravity too aggressive / too subtle | Medium | Visual regression | Calibration task (T5 step 4) lets user tune strength constants |
| Scroll-coupled exit fights with existing HeroParticles accent scrub | Low | Visual jank | Both proxies share the same ScrollTrigger; only one per page is needed — we re-use the existing `HeroParticles.accent` proxy to avoid duplication |
| WebGL not available in test browser | Low | Test failure | Playwright config uses Chromium with `--enable-webgl` and `--use-gl=swiftshader` fallback; if still fails, the fallback test handles it |
| h1 id collision with another page | Very Low | A11y | Use unique id `hero-title` scoped to home page; not a global |

---

## Success Criteria

1. ✅ `npm run build` succeeds; bundle increase ≤ 50 KB gzipped
2. ✅ `npm run test` (vitest) passes — new tests for cluster + pointer hook
3. ✅ `npx playwright test` passes — new e2e for hero-immersive + existing tests unchanged
4. ✅ Lighthouse Performance ≥ 90 on `/`
5. ✅ Devtools: 60 fps on M1 MacBook Air during 5-second mouse drag
6. ✅ `prefers-reduced-motion: reduce` → fallback renders, no Three.js code paths execute
7. ✅ Playwright StrictMode double-mount: 0 leaked canvases / RAF / event listeners

---

## Out of Scope (explicit)

- ❌ Changing CTA button colors or text
- ❌ Changing hero copy
- ❌ Replacing title font
- ❌ Modifying `HeroShader` or `HeroParticles` internals (used as fallback)
- ❌ Modifying `Navigation` or other pages
- ❌ Changing global `runtime.ts` (ScrollTrigger.normalizeScroll ban preserved)
- ❌ Adding `@react-three/fiber` or `@react-three/drei`
- ❌ Bloom / post-processing (out of scope; can be future PR)
- ❌ Mobile-first redesign (mobile gets tier-down but no separate design)

---

## References

- **Audit baseline**: see audit report (constraint + risk section above)
- **Three.js docs**: `WebGLRenderer.dispose()`, `InstancedMesh.setMatrixAt()`
- **GSAP demo hub research**: 7 demos pulled (cursor-driven-perspective-tilt, magnetic-button-overwrite-modes, velocity-skew, responsive-line-splits-on-scroll)
- **HeroImmersive sketch**: see existing skeleton at `frontend-vite/src/components/hero/` (created during research phase)

---

## Approval

- User selected Approach B (沉浸 3D) — Three.js + low-poly cluster + GLSL displacement
- User selected new `--color-accent-gold: #C9A84C` token (separate from existing `--color-accent-on-dark: #93C5FD`)
- Scope: hero region only (Home.tsx 76-97 + Home.css 58-166 + new components/hero/)
- Quality bar: 4 bottom lines (prefers-reduced-motion, FPS cap, RAF cleanup, StrictMode safety)