// frontend-vite/tests/animations/geometryCluster.test.ts

import { describe, it, expect } from 'vitest'
import { buildCluster, stepCluster, applyClusterStep } from '../../src/components/hero/geometryCluster'

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

  it('separates any two nodes by at least ~1.5 units (hemispherical fibonacci spacing)', () => {
    const nodes = buildCluster(24, { radiusMax: 8, yMin: 0, yMax: 5 })
    let minDist = Infinity
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!.basePos
        const b = nodes[j]!.basePos
        const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
        if (d < minDist) minDist = d
      }
    }
    // Fibonacci spacing on a hemisphere of ~24 nodes — empirical lower bound ~1.7
    expect(minDist).toBeGreaterThan(1.5)
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
      expect(nodes[i]!.basePos.x).toBeCloseTo(nodes[i]!.originalBase.x, 0)
      expect(nodes[i]!.basePos.y).toBeCloseTo(nodes[i]!.originalBase.y, 0)
      expect(nodes[i]!.basePos.z).toBeCloseTo(nodes[i]!.originalBase.z, 0)
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
    // Place mouse 0.5 units offset from target — within gravityRadius (2.5)
    // but not exactly on top (which the step would skip due to dist > 0.001 guard)
    const mouseAtTarget = {
      x: target.node.basePos.x + 0.5,
      y: target.node.basePos.y,
      z: target.node.basePos.z,
    }
    const next = stepCluster(nodes, mouseAtTarget, 1 / 60)
    const deflected = next[target.node.index]!
    const dx = deflected.x - initial.x
    const dy = deflected.y - initial.y
    const dz = deflected.z - initial.z
    const deflection = Math.sqrt(dx * dx + dy * dy + dz * dz)
    expect(deflection).toBeGreaterThan(0.0005)
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