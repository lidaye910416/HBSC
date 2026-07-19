# Planet vs Crystal Recipe — Three.js Sphere Aesthetics

> **Context.** HBSC (Hubei Digital Innovation) currently uses a 2D GSAP/CSS hero (no Three.js dependency yet). This recipe is a forward-looking design spec for when a 3D hero is introduced — covering how to make a sphere read as **"planet"** instead of **"crystal/gem"**.
>
> Sources: Three.js official docs (IcosahedronGeometry, SphereGeometry, MeshStandardMaterial, MeshPhysicalMaterial), PBR / microfacet theory references, Awwwards space-themed portfolio roundups (2025), Codrops 3D planet hero articles, react-three-fiber + drei community examples.

---

## 1. TL;DR — The One-Line Rule

> **"Gem = few faces + flat shading + high specular. Planet = many faces + smooth shading + matte/diffuse + Fresnel atmosphere rim."**

Everything below is operationalizing that sentence.

---

## 2. Geometry — Subdivision Detail Level

### 2.1 Triangle count math

`IcosahedronGeometry(radius, detail)` produces **20 × 4^detail** triangles. Icosahedra are preferred over UV spheres for planet work because their triangles are evenly distributed — no UV-pole pinch and no longitude/latitude seams for textures.

| `detail` | Triangles | Vertices (approx, indexed) | Silhouette reads as |
|---------:|----------:|--------------------------:|---------------------|
| 0        |        20 |                       12  | **Faceted gem / cut crystal** — each face obvious |
| 1        |        80 |                       42  | Still gem-like, but rounder; "low-poly art" aesthetic |
| 2        |       320 |                      162  | **Boundary** — silhouette looks like a sphere, but facets still readable as a *stylized planet* |
| 3        |     1,280 |                      642  | Reads as smooth planet; facets only visible at close zoom or with flat shading |
| 4        |     5,120 |                    2,562  | Effectively indistinguishable from a perfect sphere — overkill unless you need fine displacement |

For reference: `SphereGeometry(r, 32, 16)` ≈ 1,024 triangles (32 width × 16 height segments → ~512 quads → ~1,024 tris). `SphereGeometry(r, 64, 32)` ≈ 4,096.

### 2.2 Recommended choice for "planet" hero

**`IcosahedronGeometry(radius, detail=3)`** — 1,280 triangles. Rationale:

1. **Silhouette is mathematically a sphere** at this density — facets disappear at hero scale.
2. **Mobile-safe** — 1,280 tris per planet × 1–5 planets ≈ 6,400 tris total; trivially within budget for any WebGL1 device.
3. **Displacement-friendly** — if you ever add noise displacement to fake terrain, 1,280 tris gives you enough vertex resolution without going to a NormalMap.
4. **Pairs with normal maps** — at detail=3, baked normal maps hide any residual faceting.

If the planet is intentionally **stylized / illustrative** (low-poly art, Diorama, Brutalist design), drop to **detail=1 or 2** and lean into the faceting with `flatShading: true`.

If you only need a small background planet (≤ 120px on screen), **`IcosahedronGeometry(r, 1)` = 80 tris** is plenty — the silhouette is already convincingly round.

### 2.3 When flat shading vs smooth shading matters

The geometry is the same — the difference is **how normals are computed**:

- **Smooth shading (default for indexed `IcosahedronGeometry`)**: each vertex has one normal, averaged across all faces touching it. Looks like a sphere with diffuse light.
- **Flat shading (`material.flatShading = true`)**: each face gets its own normal; vertices are duplicated internally. Looks faceted.

| Combination                       | Reads as                          |
|----------------------------------|-----------------------------------|
| `detail=0` + flatShading         | Cut gemstone / d20 die            |
| `detail=0` + smooth              | Smooth gem / marble ball          |
| `detail=2` + flatShading         | Low-poly art planet / Diorama     |
| `detail=3` + smooth              | **Realistic planet** ✓ (default target) |
| `detail=2` + smooth + normal map | Stylized planet (e.g. NASA-illustrated) |

**Rule of thumb**: anything at `detail ≤ 1` should almost always have `flatShading: true` — at that density, *not* flat shading looks plasticky and wrong. Anything at `detail ≥ 3` should always have smooth shading — flat shading there looks like a faceted ball, not a planet.

---

## 3. Material — PBR Parameters

All values below are for `MeshStandardMaterial` (sufficient for planet) or `MeshPhysicalMaterial` (only needed if you want transmission/clearcoat for crystal work).

### 3.1 Planet (target recipe)

```js
new THREE.MeshStandardMaterial({
  color:        0x1A1A2E,   // deep navy / dark body; substitute 0x2a1f15 umber for warm
  roughness:    0.92,        // 0.85–0.95; matte, diffuse-dominant
  metalness:    0.02,        // 0.0–0.05; planets are dielectric rock, not metal
  emissive:     0x0a0e1f,   // subtle inner glow tint matching color
  emissiveIntensity: 0.15,   // 0.05–0.3; just enough to lift the dark side from pure black
  flatShading:  false,       // smooth shading — REQUIRED for planet look at detail ≥ 2
})
```

Why each value:

- **`color` dark navy / umber / oxide**: real planets in shadow read as dark blue-grey, brown, or rust. Pure black is wrong — it looks like a hole.
- **`roughness 0.92`**: rock, soil, dust, water — all diffuse. A rough planet has no specular highlights, which is what reads as "natural body."
- **`metalness 0.02`**: planets are not metallic. Setting metalness > 0.3 makes them look like polished hematite sculpture.
- **`emissive` + low intensity**: fakes the bounce-light from atmosphere so the night side isn't pure black. Without it, the dark hemisphere disappears against a dark background.
- **`smooth shading`**: at `detail=3` this gives clean spherical diffuse falloff.

**Optional map layer** for richer planet: a procedural noise-based normal map + diffuse texture. Even a 512×512 baked noise normal map makes the planet feel "geological."

### 3.2 Crystal / gem (the alternative, for reference)

```js
new THREE.MeshPhysicalMaterial({
  color:         0xC9A84C,   // ancient-bronze gold (HBSC accent) or pure 0xffffff
  roughness:     0.05,        // 0.0–0.2; mirror-sharp
  metalness:     1.0,         // 0.8–1.0; full metal — pure mirror
  envMapIntensity: 1.4,       // crucial: requires an env map or it looks black
  // or for glass crystal:
  transmission:  0.95,
  thickness:     0.5,
  ior:           2.4,         // diamond-level
  roughness:     0.0,
  clearcoat:     1.0,
})
```

A crystal needs an **environment map** (`scene.environment = pmremGenerator.fromScene(...).texture`). Without one, it has nothing to reflect and just looks like a black sphere.

### 3.3 The Fresnel rim — the single biggest visual difference

This is the effect that makes a sphere read as **"atmosphere"** (planet) versus **"no atmosphere"** (gem).

**Recipe — separate back-faced atmosphere sphere with additive shader:**

```js
// Slightly larger sphere, rendered as additive glow shell
const atmoGeo = new THREE.IcosahedronGeometry(radius * 1.04, 3);
const atmoMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(0x4a78c8) } }, // pale blue
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vPos;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vPos = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying vec3 vNormal;
    varying vec3 vPos;
    uniform vec3 uColor;
    void main() {
      vec3 view = normalize(-vPos);
      // Backside Fresnel: peaks at the silhouette
      float rim = pow(1.0 - max(dot(view, vNormal), 0.0), 2.5);
      gl_FragColor = vec4(uColor * rim, rim);
    }
  `,
  blending: THREE.AdditiveBlending,
  side: THREE.BackSide,        // crucial: render the inside of the larger sphere
  transparent: true,
  depthWrite: false,
});
```

**Key choices:**
- **Scale 1.02–1.05× planet radius**: too small and the rim is invisible; too large and it floats disconnected.
- **`BackSide`**: render the inside of the shell so the silhouette is what the camera sees.
- **`AdditiveBlending`**: rim adds light to whatever's behind, never darkens.
- **`pow(..., 2.5)` exponent**: controls rim sharpness. 2.0 = soft, 5.0 = knife-edge. Earth-style atmosphere wants 2.0–3.0.

**For crystal: omit the atmosphere sphere entirely.** A crystal's defining feature is sharp internal reflections, not a glowing rim. If you put a Fresnel rim on a crystal, it stops reading as a crystal.

### 3.4 Quick reference table

| Property        | Planet recipe              | Crystal recipe            |
|-----------------|---------------------------|---------------------------|
| `color`         | Dark navy / umber `#1A1A2E` | Gold `#C9A84C` or white   |
| `roughness`     | 0.85 – 0.95               | 0.0 – 0.2                 |
| `metalness`     | 0.0 – 0.05                | 0.8 – 1.0 (or `transmission` for glass) |
| `emissive`      | Subtle (intensity 0.1–0.3) | None                      |
| Fresnel rim     | YES — additive atmosphere shell | NO                   |
| `flatShading`   | Only at detail ≤ 1        | YES at detail ≤ 1, NO at detail ≥ 3 |
| Env map         | Optional (helps)          | **Required**              |
| Geometry detail | 2–3                       | 0–2                       |

---

## 4. Scale and Depth

### 4.1 Apparent size rules

Apparent size on screen is determined by `radius`, `camera.position.z` (distance), and `camera.fov`:

```
screen_height_fraction ≈ (radius / distance) × (1 / tan(fov/2))
```

For a hero planet with the camera at z=5, fov=50° (≈ `Math.PI * 50/180`):

| Camera distance | Planet radius | Approx screen height |
|----------------:|--------------:|---------------------:|
| z=5             | r=1.5         | ~60% of viewport (extreme close-up, fills hero) |
| z=8             | r=1.5         | ~37% of viewport (default hero planet) |
| z=12            | r=1.5         | ~25% of viewport (distant planet, supporting) |
| z=20            | r=1.5         | ~15% of viewport (background moon) |

### 4.2 Recommended scale ranges

- **Hero planet**: 35–55% of viewport height. Big enough to feel "approachable" (a focal mass you could orbit), small enough to leave room for headline text on the opposite side.
- **Supporting planets**: 8–20% of viewport height. These are punctuation, not focal.
- **Distant / background**: 3–8% of viewport height. Should be small enough that you don't consciously count them.

### 4.3 Camera placement

- **`fov`**: stay in **45°–55°** range. Wide FOV (75°+) distorts spheres at frame edges (they look like flying-saucer discs).
- **Camera position**: do NOT place the camera at `(0, 0, z)` looking straight at the planet — the planet becomes a circle (worst case for "this is a sphere"). Use `(x, y, z)` with `x ≠ 0` and `y > 0` slightly — e.g. `(2, 1.5, 8)` looking at `(0, 0, 0)`. This reveals the planet's curvature.
- **Rule of thirds**: place the hero planet off-center — e.g. 1/3 from right edge — and put the headline on the other 2/3. Pure-center planet + centered headline is the default amateur look.
- **Tilt the planet slightly**: a 5–15° tilt on the planet's rotation axis gives it character (Earth's 23.5°, Saturn's 27°). Dead-vertical rotation looks like a billiard ball.

### 4.4 Depth cues — how to fake "this planet is far away"

Supporting planets should sit at different camera distances, not just different sizes. Stack distances:

```
Hero planet:        z = 8
Supporting planet A: z = 14   (smaller AND farther)
Supporting planet B: z = 5    (larger AND closer — for foreground depth)
Distant moon:        z = 25
```

The foreground-supporting planet (z=5) blurs the hero planet visually and creates parallax on mouse-move. The far one (z=14) sits behind the hero.

---

## 5. Composition — "Space Scene" Hero Recipe

The reference category (Awwwards, Codrops 2025 roundups, noomoagency-style agencies) consistently uses:

### 5.1 Element counts

```
1  hero planet            (35–55% viewport height, off-center)
2–4 supporting planets     (8–20% viewport height, varied depths)
1  starfield               (200–800 small points, dense)
0–2 nebula/galaxy clouds   (additive blended, very low opacity)
1  atmosphere rim          (only on hero planet, optional on supporting)
0  rings                   (Saturn-style — optional, single hero planet only)
```

Avoid more than **5 planets total** in a hero — beyond that it stops feeling "cinematic" and starts feeling "screensaver demo."

### 5.2 Starfield — the most underrated element

A dense starfield does more than decorate; it sells the "space" context.

- **Count**: 300–500 points for a full-screen hero. Use `THREE.Points` with a tiny circular sprite texture (don't use sharp squares — they look like pixels).
- **Distribution**: uniform random on a large sphere around the camera. Slight z-bias toward "behind" the planets so foreground planets occlude them.
- **Sizes**: vary star size from 0.5px to 2.5px. Pure-uniform star sizes look fake.
- **Brightness**: most stars at 0.3–0.6 intensity, a few at 0.8–1.0 as "highlight" stars. Avoid pure-white; tint slightly cool `#cfd8ff` or warm `#fff4e0` for variety.
- **Twinkle (optional)**: subtle per-star opacity sin-wave at varied phases. Don't overdo it; subtle is the goal.

### 5.3 Atmospheric haze

Between the camera and the deep starfield, a low-opacity nebula cloud can add color depth:

```js
// A large quad behind everything, additive
const hazeMat = new THREE.ShaderMaterial({
  uniforms: {
    uColorA: { value: new THREE.Color(0x2a1845) }, // deep purple
    uColorB: { value: new THREE.Color(0x1a2a55) }, // deep blue
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `
    varying vec2 vUv;
    uniform vec3 uColorA, uColorB;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
                 mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
    }
    void main(){
      float n = noise(vUv * 4.0);
      vec3 col = mix(uColorA, uColorB, n);
      gl_FragColor = vec4(col, 0.18 * n);  // 0.10–0.25 alpha
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
```

Keep opacity ≤ 0.25 — you want a hint of color, not a fog that swallows stars.

### 5.4 Layout pattern (recommended for HBSC)

```
┌─────────────────────────────────────────────────┐
│                                                  │
│   [Headline left 50%]      [Hero planet right]   │
│   - Label                   - Icosahedron(1, 3)  │
│   - H1 title (2 lines)      - r=1.5, z=8        │
│   - Subtitle                - 40% viewport h    │
│   - 2 buttons               - atmosphere rim     │
│                                                  │
│              [Supporting planet A — small, behind, low-right] │
│                                                  │
│   [Starfield 300-500 points, behind everything]  │
│   [Faint nebula haze layer]                      │
└─────────────────────────────────────────────────┘
```

This is the **agency-portfolio hero** composition: text takes narrative weight left; 3D takes emotional weight right; the rest of the canvas is atmosphere.

---

## 6. Decision Checklist — When to Use What

| If you want…                  | Use this recipe                                    |
|-------------------------------|---------------------------------------------------|
| Cinematic "Earth from space"  | detail=3 + smooth + matte material + Fresnel rim  |
| Stylized NASA-illustration    | detail=2 + smooth + normal-mapped + Fresnel rim   |
| Low-poly art planet (Diorama) | detail=1 + **flatShading=true** + matte material  |
| Cut gem / crystal            | detail=0 + flatShading + MeshPhysicalMaterial (transmission or full metal) |
| Glass marble / pearl          | detail=3 + smooth + `transmission` 0.95 + `roughness` 0.05 |
| Polished metal orb            | detail=3 + smooth + `metalness` 1.0 + env map required |

---

## 7. Performance Budget

For a hero scene with **1 hero planet + 2 supporting planets + 1 atmosphere shell + 400 stars + 1 nebula quad**:

```
Geometry:   1,280 + 1,280 + 640 + 1,280 + 400 + 1 quad ≈ 5,000 draw elements
Drawcalls:  6 (one per mesh)
Material switches: 4 (planet, atmosphere, stars, nebula)
Triangle count: ~5,000 total
```

This is **trivial** for any device shipped in the last decade. Don't waste engineering on LOD at this scale. Only worry about:

- **`renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`** — capping pixel ratio at 2 prevents retina screens from quadrupling fragment cost.
- **Single starfield `THREE.Points`**, not 400 separate `Sprite`s. Critical for drawcall budget.
- **Skip shadow maps** on hero planets — they don't cast/receive useful shadows in a starfield scene, and shadow maps double the rendering cost.

---

## 8. Reference Sites (Design Inspiration)

These are the categories that consistently produce "wow" 3D planet heroes:

- **Agency portfolios** (noomoagency.com, Locomotive, Active Theory) — single hero planet + text overlay
- **WebGL codrops collections** — codrops.com/category/three-js/
- **Awwwards SOTD winners tagged "Three.js"** — searchable collection
- **Bruno Simon's portfolio** (bruno-simon.com) — extreme stylization; useful for "what's possible" reference, not direct copy
- **NASA / ESA visualization pages** — for what real planet materials look like at scale

For the **HBSC brand** specifically: the ancient-bronze-gold accent (`#C9A84C`) and the墨 `#1A1A2E` deep navy from `frontend-vite/src/styles/global.css` map directly onto the planet recipe — dark navy body + gold rim/highlight = "scholarly observatory" aesthetic. If you wanted the **crystal variant** instead, swap the body for gold metal and drop the Fresnel rim.

---

## 9. Concrete Recipe Summary (Copy-Paste Mental Model)

```text
GEOMETRY      IcosahedronGeometry(1.5, 3)   // 1,280 tris, sphere-smooth
              + atmosphere shell (1.5 × 1.04, 3), BackSide, AdditiveBlending
              + supporting planets at (radius 0.4, detail 2)

MATERIAL      MeshStandardMaterial {
                color:    0x1A1A2E   (dark navy — matches HBSC 墨)
                roughness: 0.92
                metalness: 0.02
                emissive:  0x0a0e1f, intensity 0.15
                flatShading: false
              }

ATMOSPHERE    ShaderMaterial, BackSide, AdditiveBlending
              rim = pow(1 - dot(view, normal), 2.5) × uColor (0x4a78c8)

CAMERA        fov 50°, position (2, 1.5, 8), looking at (0, 0, 0)
              hero planet ~40% viewport height
              off-center, slightly tilted rotation axis

SCENE         1 hero + 2 supporting planets at varied z (5, 8, 14)
              + 400-point starfield (THREE.Points)
              + 1 nebula quad at z = -50, alpha 0.18
              no shadow maps
              pixelRatio capped at 2

LIGHTING      HemisphereLight (sky 0x4a78c8, ground 0x1a1a2e, intensity 0.6)
              DirectionalLight (key, from upper-left, intensity 1.2)
              scene.environment = subtle PMREM from a procedural sky
```

---

*Recipe authored for HBSC Hero Three.js migration. Treat the material numbers as starting points — tune per device, brand, and screenshot review. The geometric and composition rules are stable; only the colors and intensities should be brand-tuned.*