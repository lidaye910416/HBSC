/**
 * Reduced motion gate.
 *
 * Single source of truth for "should this device run our motion design?".
 * Respects:
 *   - `prefers-reduced-motion: reduce` (user accessibility preference)
 *   - `navigator.connection.saveData` (user data-saver preference)
 *
 * Anything that draws, tweens, or scrubs MUST consult `motionAllowed()`
 * before scheduling work — content visibility MUST NOT depend on a
 * JS animation reaching its end state.
 */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
  const saveData = (navigator as any)?.connection?.saveData === true
  return !reduced && !saveData
}