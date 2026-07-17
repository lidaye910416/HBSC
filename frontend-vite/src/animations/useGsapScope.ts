'use client'
import { useGSAP } from '@gsap/react'
import type React from 'react'
import { installAnimationRuntime } from './runtime'

// Register plugins the first time this module is evaluated.
// React 19 StrictMode + HMR may invoke module evaluation twice in dev,
// but `installAnimationRuntime` is idempotent so this stays safe.
installAnimationRuntime()

interface ReactRefLike {
  current: unknown | null
}

/**
 * Thin wrapper around `@gsap/react`'s `useGSAP` that:
 *   - guarantees the animation runtime is installed
 *   - defaults to `revertOnUpdate: true` (StrictMode-safe)
 *   - lets the caller attach a scope ref so selectors stay bounded
 *
 * The returned `context` and `contextSafe` are the same handles `useGSAP`
 * exposes — keep them when you need to schedule work from event handlers
 * or async callbacks.
 */
export function useGsapScope(
  fn: Parameters<typeof useGSAP>[0],
  deps: readonly unknown[] = [],
  options: { scope?: ReactRefLike | Element | string } = {},
): ReturnType<typeof useGSAP> {
  return useGSAP(fn, {
    dependencies: deps as unknown[],
    revertOnUpdate: true,
    ...(options.scope !== undefined ? { scope: options.scope as React.RefObject<Element> | Element | string } : {}),
  })
}