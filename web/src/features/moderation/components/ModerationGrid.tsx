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
        <li key={photo.id} className={styles['cell']}>
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
