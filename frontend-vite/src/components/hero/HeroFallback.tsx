// frontend-vite/src/components/hero/HeroFallback.tsx
//
// HeroFallback — used when:
//   1. prefers-reduced-motion: reduce
//   2. WebGL is unavailable
//   3. GPU tier is 'none'
//
// Renders the existing decoration layers verbatim. No new animation.

import { HeroParticles } from '../HeroParticles'
import { HeroShader } from '../HeroShader'
import './HeroFallback.css'

export function HeroFallback() {
  return (
    <div className="hero-fallback" aria-hidden="true" data-testid="hero-fallback">
      <HeroShader />
      <HeroParticles />
    </div>
  )
}