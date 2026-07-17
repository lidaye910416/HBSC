/**
 * Public route transition wrapper.
 *
 * T1 establishes this as a pass-through fragment so that the route shell
 * already has a single seam future motion work (T13 — AnimatePresence
 * fade) can attach to without rewriting every route entry.
 *
 * Today: children render unchanged, no motion is applied.
 */
export function PublicRouteTransition({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}