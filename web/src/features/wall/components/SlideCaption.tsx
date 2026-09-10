import styles from './SlideCaption.module.css'

export type SlideCaptionVariant = 'spotlight' | 'tile'

export interface SlideCaptionProps {
  readonly caption: string | null
  readonly authorName: string | null
  /** `spotlight` sits in the projector safe area; `tile` sits inside its own tile. */
  readonly variant?: SlideCaptionVariant
}

/**
 * The caption and the author, over a scrim.
 *
 * Never directly on the photo: a light patch in a wedding dress swallows white text
 * whatever size it is, so the scrim is part of the contract rather than a style choice
 * (DESIGN-SYSTEM.md section 8). Both lines sit at `--text-xl` because nothing below
 * that is readable at five metres — a credit too small to read is worse than no credit,
 * since the guest it names cannot see it either.
 */
export function SlideCaption({ caption, authorName, variant = 'spotlight' }: SlideCaptionProps) {
  const hasCaption = caption !== null && caption !== ''
  const hasAuthor = authorName !== null && authorName !== ''

  // An anonymous guest's photo with no caption gets no panel at all: the photo is the
  // hero, and an empty scrim across the bottom of it is chrome for nothing.
  if (!hasCaption && !hasAuthor) return null

  return (
    <figcaption className={`${styles['caption']} ${styles[variant]}`}>
      {hasCaption ? <p className={styles['text']}>{caption}</p> : null}
      {hasAuthor ? <p className={styles['author']}>{authorName}</p> : null}
    </figcaption>
  )
}
