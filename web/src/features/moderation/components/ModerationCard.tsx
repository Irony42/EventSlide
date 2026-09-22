import { Badge, type BadgeTone } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { useTranslations } from '../../../lib/i18n/useTranslations'
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
  const t = useTranslations()

  /**
   * The word beside the border colour, built here rather than at module load: it is
   * read in whichever language the moderator chose, and a module-level table would
   * freeze the first one.
   */
  const STATE_LABEL: Readonly<Record<PhotoStatus, string>> = {
    pending: t.moderation.statePending,
    published: t.moderation.statePublished,
    rejected: t.moderation.stateRejected,
    hidden: t.moderation.stateHidden,
  }

  /**
   * The author, as it reads inside "la photo de …". `byAnonymous` is the standalone
   * caption line; using it here would produce "la photo de Invité anonyme".
   */
  const authorInName = photo.authorName ?? t.moderation.anonymousInName
  const authorLine =
    photo.authorName === null ? t.moderation.byAnonymous : t.moderation.by(photo.authorName)
  const isClip = photo.kind === 'clip'

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
      aria-label={t.moderation.photoOf(authorInName)}
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
          aria-label={t.moderation.selectPhoto(authorInName)}
        />
        <Badge tone={TONE[photo.status]}>{STATE_LABEL[photo.status]}</Badge>
      </div>

      <button
        type="button"
        className={styles['thumbnail']}
        // The photo has to be judged full size before it goes on a wall in front of
        // two hundred people; a 240 px tile is not enough to spot who is in it. For a
        // clip the button says something stronger, because what it opens is not a
        // larger still — it is the only place on this surface the video can be watched,
        // and the thing that gets somebody into trouble is rarely in the first frame.
        aria-label={
          isClip ? t.moderation.watchVideo(authorInName) : t.moderation.enlargePhoto(authorInName)
        }
        onClick={() => onOpen(photo.id)}
      >
        {/* A clip's `thumbUrl` is its poster frame, so this is the same `<img>` either
            way — the server resolved the difference. What changes is the badge over it
            and what the button promises. */}
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
        {/*
          On the poster, because the host's decision starts before they open anything:
          "this one is eight seconds of video" changes how long they are about to spend
          on it, and a still frame does not say so. Text rather than a play glyph alone
          — the badge has to survive stage lighting and a projector-lit room, which is
          the same argument the status badge above it settles.
        */}
        {isClip ? (
          <span className={styles['clipBadge']}>
            {photo.durationMs === null
              ? t.moderation.videoBadge
              : t.moderation.videoLength(Math.round(photo.durationMs / 1_000))}
          </span>
        ) : null}
      </button>

      <div className={styles['meta']}>
        {/*
          Always a line, even with no caption. A tile that simply omits it reads the
          same as one whose caption failed to arrive — and the host is deciding whether
          this text goes on a wall in front of the room.
        */}
        {photo.caption === null ? (
          <p className={styles['captionEmpty']}>{t.moderation.noCaption}</p>
        ) : (
          <p className={styles['caption']}>{photo.caption}</p>
        )}
        <p className={styles['author']}>{authorLine}</p>
        <p className={styles['dimensions']}>{t.moderation.dimensions(photo.width, photo.height)}</p>
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
          aria-label={t.moderation.publishPhoto(authorInName)}
          onClick={() => onDecide(photo.id, 'publish')}
        >
          {t.moderation.publish}
        </Button>
        <Button
          variant="danger"
          size="sm"
          aria-label={t.moderation.rejectPhoto(authorInName)}
          onClick={() => onDecide(photo.id, 'reject')}
        >
          {t.moderation.reject}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t.moderation.hidePhoto(authorInName)}
          onClick={() => onDecide(photo.id, 'hide')}
        >
          {t.moderation.hide}
        </Button>
      </div>
    </article>
  )
}
