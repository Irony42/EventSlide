import { Badge, type BadgeTone } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { fr } from '../../../lib/i18n/fr'
import type { ModerationDecision, ModerationPhotoDto, PhotoStatus } from '../../../lib/api/dto'
import styles from './ModerationCard.module.css'

/**
 * One photo awaiting a host's judgement.
 *
 * **This is not a clickable div.** 1.0's tile was a `<div role="button" tabIndex={0}>`
 * with hand-rolled Enter/Space handling and a nested delete `<button>` held together
 * by `stopPropagation`: the whole moderation screen was unusable by keyboard and
 * announced nothing. Here the selection is a real checkbox, each decision is a real
 * button, and the tile itself is an `<article>` — focusable only programmatically, so
 * J/K can land on it without adding a Tab stop per photo to a queue of a hundred.
 */

const TONE: Readonly<Record<PhotoStatus, BadgeTone>> = {
  pending: 'warning',
  published: 'success',
  rejected: 'danger',
  hidden: 'neutral',
}

const STATE_LABEL: Readonly<Record<PhotoStatus, string>> = {
  pending: fr.moderation.statePending,
  published: fr.moderation.statePublished,
  rejected: fr.moderation.stateRejected,
  hidden: fr.moderation.stateHidden,
}

export interface ModerationCardProps {
  readonly photo: ModerationPhotoDto
  readonly selected: boolean
  /** The photo the keyboard is on. Shown, because a host has to see where they are. */
  readonly active: boolean
  readonly onSelectToggle: (photoId: string) => void
  /** The tile took the browser's focus — by a Tab, or by a click on a control in it. */
  readonly onFocusCard: (photoId: string) => void
  readonly onDecide: (photoId: string, decision: ModerationDecision) => void
  readonly onOpen: (photoId: string) => void
  readonly cardRef: (element: HTMLElement | null) => void
}

export function ModerationCard({
  photo,
  selected,
  active,
  onSelectToggle,
  onFocusCard,
  onDecide,
  onOpen,
  cardRef,
}: ModerationCardProps) {
  /**
   * The author, as it reads inside "la photo de …". `byAnonymous` is the standalone
   * caption line; using it here would produce "la photo de Invité anonyme".
   */
  const authorInName = photo.authorName ?? fr.moderation.anonymousInName
  const authorLine =
    photo.authorName === null ? fr.moderation.byAnonymous : fr.moderation.by(photo.authorName)

  return (
    <article
      // Part of the e2e contract: tests/e2e drives the console through this.
      data-testid="moderation-card"
      // The border colour. Never the only signal — the Badge below carries the same
      // status as a shape and a word, so a red-green colourblind host under stage
      // lighting reads the same thing.
      data-status={photo.status}
      data-active={active ? 'true' : 'false'}
      className={styles['card']}
      // Programmatic focus target for J/K. Not in the tab order: a hundred photos
      // would otherwise mean a hundred Tab stops before the toolbar.
      tabIndex={-1}
      ref={cardRef}
      aria-label={fr.moderation.photoOf(authorInName)}
      onFocus={() => onFocusCard(photo.id)}
    >
      <div className={styles['top']}>
        <input
          type="checkbox"
          className={styles['checkbox']}
          checked={selected}
          onChange={() => onSelectToggle(photo.id)}
          // Named rather than `<label>`-wrapped: the author already appears once as
          // text under the photo, and a visible or clipped second copy per tile makes
          // a screenful of cards read as a wall of names.
          aria-label={fr.moderation.selectPhoto(authorInName)}
        />
        <Badge tone={TONE[photo.status]}>{STATE_LABEL[photo.status]}</Badge>
      </div>

      <button
        type="button"
        className={styles['thumbnail']}
        // The photo has to be judged full size before it goes on a wall in front of
        // two hundred people; a 240 px tile is not enough to spot who is in it.
        aria-label={fr.moderation.enlargePhoto(authorInName)}
        onClick={() => onOpen(photo.id)}
      >
        <img
          className={styles['image']}
          src={photo.thumbUrl}
          // Decorative inside a button that already says what it opens, and the
          // caption and author are text right below.
          alt=""
          loading="lazy"
          decoding="async"
          // Intrinsic size, so the grid does not reflow as thumbnails arrive over a
          // venue's Wi-Fi. 1.0's grid jumped under the cursor for the first minute.
          width={photo.width}
          height={photo.height}
        />
      </button>

      <div className={styles['meta']}>
        {photo.caption === null ? null : <p className={styles['caption']}>{photo.caption}</p>}
        <p className={styles['author']}>{authorLine}</p>
        <p className={styles['dimensions']}>
          {fr.moderation.dimensions(photo.width, photo.height)}
        </p>
      </div>

      {/*
        All three decisions are always offered. Which of them a photo may legally take
        is the server's rule, not this component's: it answers `photo.illegalTransition`
        and the console reports it. Re-deriving the state machine here is how a client
        ends up disagreeing with the server about what is possible.
      */}
      <div className={styles['actions']}>
        <Button
          variant="primary"
          size="sm"
          aria-label={fr.moderation.publishPhoto(authorInName)}
          onClick={() => onDecide(photo.id, 'publish')}
        >
          {fr.moderation.publish}
        </Button>
        <Button
          variant="danger"
          size="sm"
          aria-label={fr.moderation.rejectPhoto(authorInName)}
          onClick={() => onDecide(photo.id, 'reject')}
        >
          {fr.moderation.reject}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={fr.moderation.hidePhoto(authorInName)}
          onClick={() => onDecide(photo.id, 'hide')}
        >
          {fr.moderation.hide}
        </Button>
      </div>
    </article>
  )
}
