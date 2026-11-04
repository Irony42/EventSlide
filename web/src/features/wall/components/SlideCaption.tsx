import { useContext } from 'react'
import { cx } from '../../../design-system/classNames'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { formatSendTime } from '../formatSendTime'
import { SendTimeContext } from './sendTimeContext'
import styles from './SlideCaption.module.css'

export type SlideCaptionVariant = 'spotlight' | 'tile' | 'pane' | 'print'

export interface SlideCaptionProps {
  readonly caption: string | null
  /** When the photo was sent (ISO). Printed only when the event turned the setting on. */
  readonly sentAt?: string | undefined
  readonly authorName: string | null
  /**
   * This is the first photo the named sender has on the wall: a line says so, above the
   * caption. Nothing for an anonymous sender, whom there is no one to name.
   */
  readonly firstFromGuest?: boolean
  /**
   * `spotlight` sits in the projector safe area; `tile` sits inside its own tile;
   * `pane` is a split half, where one ellipsised line under the photo is what the
   * design system asks for; `print` is the polaroid's bottom mat — the one place a
   * caption is ink on paper rather than light text on a scrim, because it sits on the
   * print and not on the photograph.
   */
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
export function SlideCaption({
  caption,
  authorName,
  sentAt,
  firstFromGuest = false,
  variant = 'spotlight',
}: SlideCaptionProps) {
  const text = useTranslations()
  const { locale } = useLocale()
  const showsTime = useContext(SendTimeContext)
  const time = showsTime && sentAt !== undefined ? formatSendTime(sentAt, locale, new Date()) : null
  const hasCaption = caption !== null && caption !== ''
  const hasAuthor = authorName !== null && authorName !== ''

  // An anonymous guest's photo with no caption gets no panel at all: the photo is the
  // hero, and an empty scrim across the bottom of it is chrome for nothing.
  if (!hasCaption && !hasAuthor && time === null) return null

  return (
    <figcaption className={cx(styles['caption'], styles[variant])}>
      {firstFromGuest && hasAuthor ? (
        <p className={styles['first']}>{text.wall.firstPhotoOf(authorName)}</p>
      ) : null}
      {hasCaption ? <p className={styles['text']}>{caption}</p> : null}
      {hasAuthor ? <p className={styles['author']}>{authorName}</p> : null}
      {time === null ? null : (
        <p className={styles['time']}>
          <time dateTime={sentAt}>{time}</time>
        </p>
      )}
    </figcaption>
  )
}
