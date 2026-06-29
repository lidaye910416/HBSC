import { useState } from 'react'
import './CoverImage.css'

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
 */
export function CoverImage({
  src,
  alt = '',
  category,
  aspectRatio = '16 / 9',
  className,
}: Props) {
  const [failed, setFailed] = useState(false)

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
        src={src!}
        alt={alt}
        loading="lazy"
        className={natural ? 'cover-image__img--natural' : undefined}
        onError={() => setFailed(true)}
      />
    </div>
  )
}