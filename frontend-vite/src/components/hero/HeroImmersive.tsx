// frontend-vite/src/components/hero/HeroImmersive.tsx
//
// HeroImmersive — top-level component for the WebGL hero layer.
//
// Decision tree:
//   motionAllowed() === false         → render <HeroFallback />
//   useHeroCapability().tier === 'none' → render <HeroFallback />
//   otherwise                          → render <canvas> + <ThreeScene>

import { useRef } from 'react'
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
    camera: null, // Camera is owned by ThreeScene; world position is set there.
    strength: 0.12,
  })

  // Fallback path: motion off OR no WebGL
  if (!motionAllowed() || cap.tier === 'none') {
    return <HeroFallback />
  }

  return (
    <div
      className="hero-immersive"
      aria-hidden="true"
      data-testid="hero-immersive"
    >
      <canvas
        ref={canvasRef}
        className="hero-immersive__canvas"
        data-testid="hero-immersive-canvas"
      />
      <ThreeScene canvasRef={canvasRef} tier={cap.tier} pointer={pointer} />
    </div>
  )
}