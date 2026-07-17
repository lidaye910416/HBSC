import { AnimatePresence, motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'

/**
 * Public route transition wrapper.
 *
 * Mounts the current page inside an AnimatePresence + motion.div keyed by
 * `location.pathname`. Public pages get a fast (180ms) fade; /labs and
 * /admin are explicitly excluded here because they have their own shells
 * (lab iframe + admin chrome) and out-of-route fade would either be
 * visually noisy or break focus restoration.
 */
export function PublicRouteTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const path = location.pathname
  const skipTransition =
    path.startsWith('/labs') ||
    path.startsWith('/admin') ||
    path === '*'

  if (skipTransition) {
    return <>{children}</>
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={path}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        style={{ willChange: 'opacity' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
