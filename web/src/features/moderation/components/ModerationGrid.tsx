import { ModerationCard } from './ModerationCard'
import { fr } from '../../../lib/i18n/fr'
import type { ModerationDecision, ModerationPhotoDto } from '../../../lib/api/dto'
import styles from './ModerationGrid.module.css'

/**
 * The queue, as tiles.
 *
 * A real list of real list items: a screen reader announces "liste, 24 éléments", which
 * is how a host using one knows how much is left. 1.0 rendered a bare grid of divs.
 */

export interface ModerationGridProps {
  readonly photos: readonly ModerationPhotoDto[]
  readonly selectedIds: readonly string[]
  /**
   * Which photos were not on this screen a moment ago — roadmap 11.2.
   *
   * Computed by `useArrivals` above the grid rather than here, because the grid is
   * unmounted whenever the queue is empty and the first photo of the evening is exactly the
   * arrival worth showing. A set rather than a flag per photo: the answer belongs to the
   * list, and a tile cannot know whether it is new.
   */
  readonly arrivedIds: ReadonlySet<string>
  readonly focusedId: string | null
  readonly onSelectToggle: (photoId: string) => void
  readonly onFocusCard: (photoId: string) => void
  readonly onDecide: (photoId: string, decision: ModerationDecision) => void
  readonly onOpen: (photoId: string) => void
  readonly registerCard: (photoId: string, element: HTMLElement | null) => void
}

export function ModerationGrid({
  photos,
  selectedIds,
  arrivedIds,
  focusedId,
  onSelectToggle,
  onFocusCard,
  onDecide,
  onOpen,
  registerCard,
}: ModerationGridProps) {
  const selected = new Set(selectedIds)

  return (
    <ul
      className={styles['grid']}
      // Explicit, because `list-style: none` drops list semantics in Safari and
      // VoiceOver would then announce the tiles as loose text.
      role="list"
      aria-label={fr.moderation.queueLabel}
    >
      {photos.map((photo) => (
        <li
          key={photo.id}
          className={styles['cell']}
          // Absent rather than `false` on a tile that was already here: the stylesheet
          // matches on the attribute, so a value of "no" would be a rule that runs.
          {...(arrivedIds.has(photo.id) ? { 'data-arrival': 'new' } : {})}
        >
          <ModerationCard
            photo={photo}
            selected={selected.has(photo.id)}
            active={photo.id === focusedId}
            onSelectToggle={onSelectToggle}
            onFocusCard={onFocusCard}
            onDecide={onDecide}
            onOpen={onOpen}
            cardRef={(element) => registerCard(photo.id, element)}
          />
        </li>
      ))}
    </ul>
  )
}
