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
    nodes[i]!.basePos.x = p.x
    nodes[i]!.basePos.y = p.y
    nodes[i]!.basePos.z = p.z
  }
}