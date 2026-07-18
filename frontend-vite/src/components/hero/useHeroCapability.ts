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

function tierFromRenderer(renderer: string | null, _isMobile: boolean): GpuTier {
  if (!renderer) return 'low' // unknown → conservative
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