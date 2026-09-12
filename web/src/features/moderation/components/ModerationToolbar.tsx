import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { fr } from '../../../lib/i18n/fr'
import type { ModerationDecision } from '../../../lib/api/dto'
import type { StatusFilter } from '../hooks/useModerationQueue'
import styles from './ModerationToolbar.module.css'

/**
 * The console's header: how much is waiting, what is shown, and what to do with a
 * selection.
 *
 * It stays visible while the grid scrolls under it, because the pending count is the
 * number a host glances at between courses, and because the bulk actions have to be
 * reachable without scrolling back to the top of a hundred-photo queue.
 */

interface FilterOption {
  readonly value: StatusFilter
  readonly label: string
}

/** Pending first: it is the tab a host actually works in. */
const FILTERS: readonly FilterOption[] = [
  { value: 'pending', label: fr.moderation.filterPending },
  { value: 'all', label: fr.moderation.filterAll },
  { value: 'published', label: fr.moderation.filterPublished },
  { value: 'rejected', label: fr.moderation.filterRejected },
  { value: 'hidden', label: fr.moderation.filterHidden },
]

export interface ModerationToolbarProps {
  readonly pendingCount: number
  /** Whether the stream is delivering. A host must know when it has gone quiet. */
  readonly connected: boolean
  readonly filter: StatusFilter
  readonly selectedCount: number
  readonly busy: boolean
  readonly onFilterChange: (filter: StatusFilter) => void
  readonly onSelectAll: () => void
  readonly onClearSelection: () => void
  readonly onBulk: (decision: ModerationDecision) => void
}

export function ModerationToolbar({
  pendingCount,
  connected,
  filter,
  selectedCount,
  busy,
  onFilterChange,
  onSelectAll,
  onClearSelection,
  onBulk,
}: ModerationToolbarProps) {
  const hasSelection = selectedCount > 0

  return (
    <div className={styles['toolbar']}>
      <div className={styles['row']}>
        {/*
          One live region per concern. The count changes on its own as guests upload,
          and a host who is not looking at the screen still needs to be told.
        */}
        <div aria-live="polite" className={styles['status']}>
          <Badge tone={pendingCount > 0 ? 'warning' : 'neutral'}>
            {fr.moderation.pending(pendingCount)}
          </Badge>
        </div>

        <div aria-live="polite" className={styles['status']}>
          <Badge tone={connected ? 'success' : 'warning'}>
            {connected ? fr.moderation.live : fr.moderation.liveLost}
          </Badge>
        </div>
      </div>

      {/*
        Buttons with `aria-pressed` rather than a tab list: these filter a list that
        stays in place, and announcing them as tabs would promise a panel switch that
        does not happen.
      */}
      <div className={styles['filters']} role="group" aria-label={fr.moderation.filterLabel}>
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={option.value === filter ? 'primary' : 'ghost'}
            aria-pressed={option.value === filter}
            onClick={() => onFilterChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className={styles['row']}>
        <div aria-live="polite" className={styles['status']}>
          {hasSelection ? (
            <span className={styles['selection']}>{fr.moderation.selected(selectedCount)}</span>
          ) : null}
        </div>

        <div className={styles['bulk']}>
          <Button size="sm" variant="ghost" onClick={onSelectAll}>
            {fr.moderation.selectAll}
          </Button>
          <Button size="sm" variant="ghost" disabled={!hasSelection} onClick={onClearSelection}>
            {fr.moderation.clearSelection}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!hasSelection}
            onClick={() => onBulk('publish')}
          >
            {fr.moderation.bulkPublish(selectedCount)}
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            disabled={!hasSelection}
            onClick={() => onBulk('reject')}
          >
            {fr.moderation.bulkReject(selectedCount)}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            disabled={!hasSelection}
            onClick={() => onBulk('hide')}
          >
            {fr.moderation.bulkHide(selectedCount)}
          </Button>
        </div>
      </div>

      <p className={styles['shortcuts']}>
        <span className={styles['shortcutsLabel']}>{fr.moderation.shortcuts}</span>{' '}
        {fr.moderation.shortcutsHint} {fr.moderation.shortcutsMore}
      </p>
    </div>
  )
}
