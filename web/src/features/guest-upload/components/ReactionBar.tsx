import { Button } from '../../../design-system/components/Button'
import { StatusIcon } from '../../../design-system/components/StatusIcon'
import { cx } from '../../../design-system/classNames'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { usePhotoReactions } from '../hooks/usePhotoReactions'
import type { ReactionKind } from '../../../lib/api/dto'
import styles from './ReactionBar.module.css'

/**
 * The five reactions a guest may give to one photo.
 *
 * The set is closed on purpose (`src/domain/reactions/reactionKind.ts`): five fixed buttons
 * mean the guest flow never opens a keyboard, and whatever is sent is projected a metre tall
 * in front of a family. The server parses it again; this list only says what to draw, and in
 * which order. A kind added to the wire type is a compile error in `GLYPHS` below, which is
 * the cue to add it here too — and the ring-5 test that lists all five by name is what
 * fails if only one of the two is done.
 */
const KINDS: readonly ReactionKind[] = ['love', 'laugh', 'wow', 'cheers', 'clap']

/**
 * The face of each button, built from code points rather than typed in.
 *
 * A reaction's face is the one place in the guest flow where a pictograph is the content
 * rather than decoration of system copy (DESIGN-SYSTEM.md section 1, principle 4), and a
 * pictograph is what a thumb recognises across a dark room. It is `aria-hidden`: the word
 * from the copy table is the accessible name, and the colour of the pressed state is never
 * the only signal — a pressed button is filled and an unpressed one is an outline.
 *
 * Written as `fromCodePoint` because an emoji in source is an invisible variation selector
 * away from rendering as text on one platform and as a picture on another.
 */
const GLYPHS: Readonly<Record<ReactionKind, string>> = {
  love: String.fromCodePoint(0x2764, 0xfe0f),
  laugh: String.fromCodePoint(0x1f602),
  wow: String.fromCodePoint(0x1f62e),
  cheers: String.fromCodePoint(0x1f942),
  clap: String.fromCodePoint(0x1f44f),
}

export interface ReactionBarProps {
  readonly slug: string
  readonly photoId: string
  /** The photo's place in the list, one-based, so two rows are never the same label. */
  readonly position: number
}

/**
 * Under a published photo of the guest's own: what the room felt, and the buttons to feel.
 *
 * Only ever mounted when the host has reactions on and the photo is on the wall — the
 * caller decides both, from the event the join returned and the status the server reported,
 * so a bar that is not wanted never asks the server anything.
 */
export function ReactionBar({ slug, photoId, position }: ReactionBarProps) {
  const t = useTranslations()
  const reactions = usePhotoReactions(slug, photoId)

  if (reactions.phase === 'failed') {
    return (
      <div className={styles['failed']}>
        <p className={styles['error']} role="alert">
          <StatusIcon tone="danger" />
          {reactions.error}
        </p>
        <Button variant="secondary" size="sm" onClick={reactions.retry}>
          {t.app.retry}
        </Button>
      </div>
    )
  }

  const loading = reactions.phase === 'loading'

  return (
    <div className={styles['bar']}>
      <div
        role="group"
        aria-label={t.upload.reactionsGroup(position)}
        aria-busy={loading || undefined}
        className={styles['row']}
      >
        {KINDS.map((kind) => {
          const pressed = reactions.mine.has(kind)
          const count = reactions.counts[kind]

          return (
            <button
              key={kind}
              type="button"
              className={cx(styles['reaction'], pressed && styles['pressed'])}
              aria-pressed={pressed}
              aria-label={t.upload.reactionButton(t.upload.reactionKinds[kind], count)}
              disabled={loading}
              onClick={() => reactions.toggle(kind)}
            >
              <span className={styles['glyph']} aria-hidden="true">
                {GLYPHS[kind]}
              </span>
              {/* Said only above zero: a row of five zeros is noise on a photo nobody has
                  reacted to yet, and the glyph is already the control. */}
              {count > 0 ? (
                <span className={styles['count']} aria-hidden="true">
                  {count}
                </span>
              ) : null}
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
    </div>
  )
}
