import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import './CoverImage.css'
import { motionAllowed } from '@/animations/reducedMotion'

interface Props {
  src?: string | null
  alt?: string
  category?: string
  aspectRatio?: string
  className?: string
}

/**
 * CoverImage renders an image with a graceful fallback to a category-tinted
 * blue gradient placeholder if the source is missing or fails to load.
 *
 * The placeholder uses a subtle hue rotation per category and a 5% dot-pattern
 * overlay so that empty states still feel branded rather than broken.
 *
 * When motion is allowed, the image also runs a soft decode-reveal: it
 * fades in while slightly scaling back from 1.03 → 1, so the cover
 * doesn't pop in stark on first paint.
 */
export function CoverImage({
  src,
  alt = '',
  category,
  aspectRatio = '16 / 9',
  className,
}: Props) {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const useFallback = !src || failed
  // `auto` means "preserve the image's natural aspect ratio" — used by the
  // media library so uploaded images aren't cropped to a forced shape.
  const natural = aspectRatio === 'auto'

  const slug = (category ?? 'default')
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-|-$/g, '') || 'default'

  const classes = ['cover-image', `cover-image--${slug}`, className]
    .filter(Boolean)
    .join(' ')

  const playDecodeReveal = (img: HTMLImageElement) => {
    if (!motionAllowed()) return
    img.style.opacity = '0'
    img.style.transform = 'scale(1.03)'
    gsap.to(img, { opacity: 1, scale: 1, duration: 0.9, ease: 'power3.out' })
  }

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    playDecodeReveal(e.currentTarget)
  }

  // If the image is already cached / complete on mount, fire the reveal too.
  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    if (img.complete && img.naturalWidth > 0) playDecodeReveal(img)
  }, [src])

  if (useFallback) {
    return (
      <div
        className={classes}
        style={natural ? undefined : { aspectRatio }}
        role="img"
        aria-label={category ? `${category} 封面` : '封面占位'}
      >
        <div className="cover-image__pattern" aria-hidden="true" />
        <span className="cover-image__label">{category ?? '封面'}</span>
      </div>
    )
  }

  return (
    <div
      className={classes}
      style={natural ? undefined : { aspectRatio }}
    >
      <img
        ref={imgRef}
        src={src!}
        alt={alt}
        loading="lazy"
        className={natural ? 'cover-image__img--natural' : undefined}
        onLoad={handleLoad}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
