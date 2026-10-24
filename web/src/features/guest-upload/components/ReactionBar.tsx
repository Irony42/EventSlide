import { useRef } from 'react'
import { Button } from '../../../design-system/components/Button'
import { StatusIcon } from '../../../design-system/components/StatusIcon'
import { cx } from '../../../design-system/classNames'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { usePhotoReactions } from '../hooks/usePhotoReactions'
import type { ReactionKind } from '../../../lib/api/dto'
import styles from './ReactionBar.module.css'

/**
 * The face of each of the five reactions a guest may give.
 *
 * The set is closed on purpose (`src/domain/reactions/reactionKind.ts`): five fixed buttons
 * mean the guest flow never opens a keyboard, and whatever is sent is projected a metre tall
 * in front of a family. The server parses it again; this table only says what to draw.
 *
 * A reaction's face is the one place in the guest flow where a pictograph is the content
 * rather than decoration of system copy (DESIGN-SYSTEM.md section 1, principle 4), and a
 * pictograph is what a thumb recognises across a dark room. It is `aria-hidden`: the word
 * from the copy table is the accessible name, and the colour of the pressed state is never
 * the only signal — a pressed button is filled and an unpressed one is an outline.
 *
 * Built from code points because an emoji typed into source is one invisible variation
 * selector away from rendering as text on one platform and as a picture on another.
 *
 * Typed as a `Record` so that a kind added to the wire type is a compile error here, and
 * the buttons are drawn from its keys, in the order written: one table, so a kind cannot be
 * given a face and no button.
 */
const GLYPHS: Readonly<Record<ReactionKind, string>> = {
  love: String.fromCodePoint(0x2764, 0xfe0f),
  laugh: String.fromCodePoint(0x1f602),
  wow: String.fromCodePoint(0x1f62e),
  cheers: String.fromCodePoint(0x1f942),
  clap: String.fromCodePoint(0x1f44f),
}

/**
 * The keys of {@link GLYPHS}. The one assertion in this file, and a safe one: the table is a
 * `Record<ReactionKind, …>`, so its keys are exactly the members of `ReactionKind`.
 */
const KINDS = Object.keys(GLYPHS) as readonly ReactionKind[]

export interface ReactionBarProps {
  readonly slug: string
  readonly photoId: string
  /** The photo's place in the list, one-based, so two rows are never the same label. */
  readonly position: number
}

/**
 * Under a published photo of the guest's own: the buttons to react to it.
 *
 * Only ever mounted when the host has reactions on and the photo is on the wall — the
 * caller decides both, from the event the join returned and the status the server reported,
 * so a bar that is not wanted never asks the server anything.
 *
 * **A refusal is spoken, a failed read is not.** What a guest caused by tapping — a spent
 * budget, a switch the host turned off, a dropped connection — is a `role="alert"`, because
 * they are waiting on it. A row that could not be read is not something they asked for, and
 * on a list of twenty photographs on a bad connection it would be twenty alerts: it says so
 * in a plain line, with a way to try again, and leaves the announcing to the taps.
 */
export function ReactionBar({ slug, photoId, position }: ReactionBarProps) {
  const t = useTranslations()
  const reactions = usePhotoReactions(slug, photoId)

  /**
   * Where focus rests while the row is being read again.
   *
   * "Réessayer" unmounts under the finger that pressed it, and focus would fall to
   * `<body>` — the top of the page, mid-list. The container outlives both of its states, so
   * it takes focus at the press, the way `GuestUploadPage` keeps the install card's slot.
   */
  const root = useRef<HTMLDivElement | null>(null)

  const loading = reactions.phase === 'loading'

  return (
    <div ref={root} tabIndex={-1} className={styles['bar']}>
      {reactions.phase === 'failed' ? (
        <div className={styles['failed']}>
          <p className={styles['error']}>
            <StatusIcon tone="danger" />
            {reactions.error}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              root.current?.focus({ preventScroll: true })
              reactions.retry()
            }}
          >
            {t.app.retry}
          </Button>
        </div>
      ) : (
        <>
          <div
            role="group"
            aria-label={t.upload.reactionsGroup(position)}
            aria-busy={loading || undefined}
            className={styles['row']}
          >
            {KINDS.map((kind) => {
              const pressed = reactions.mine.has(kind)

              return (
                <button
                  key={kind}
                  type="button"
                  className={cx(styles['reaction'], pressed && styles['pressed'])}
                  aria-pressed={pressed}
                  aria-label={t.upload.reactionKinds[kind]}
                  disabled={loading}
                  onClick={() => reactions.toggle(kind)}
                >
                  <span className={styles['glyph']} aria-hidden="true">
                    {GLYPHS[kind]}
                  </span>
                </button>
              )
            })}
          </div>

          {reactions.error === null ? null : (
            <p className={styles['error']} role="alert">
              <StatusIcon tone="danger" />
              {reactions.error}
            </p>
          )}
        </>
      )}
    </div>
  )
}
