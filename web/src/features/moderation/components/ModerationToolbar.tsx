import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { useTranslations } from '../../../lib/i18n/useTranslations'
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
  const t = useTranslations()
  const hasSelection = selectedCount > 0

  /**
   * Pending first: it is the tab a host actually works in.
   *
   * Built here rather than at module load, because the labels are read in whichever
   * language the moderator chose and a module-level table would freeze the first one.
   */
  const FILTERS: readonly FilterOption[] = [
    { value: 'pending', label: t.moderation.filterPending },
    { value: 'all', label: t.moderation.filterAll },
    { value: 'published', label: t.moderation.filterPublished },
    { value: 'rejected', label: t.moderation.filterRejected },
    { value: 'hidden', label: t.moderation.filterHidden },
  ]

  return (
    <div className={styles['toolbar']}>
      <div className={styles['row']}>
        {/*
          One live region per concern. The count changes on its own as guests upload,
          and a host who is not looking at the screen still needs to be told.
        */}
        <div aria-live="polite" className={styles['status']}>
          <Badge tone={pendingCount > 0 ? 'warning' : 'neutral'}>
            {t.moderation.pending(pendingCount)}
          </Badge>
        </div>

        <div aria-live="polite" className={styles['status']}>
          <Badge tone={connected ? 'success' : 'warning'}>
            {connected ? t.moderation.live : t.moderation.liveLost}
          </Badge>
        </div>
      </div>

      {/*
        Buttons with `aria-pressed` rather than a tab list: these filter a list that
        stays in place, and announcing them as tabs would promise a panel switch that
        does not happen.
      */}
      <div className={styles['filters']} role="group" aria-label={t.moderation.filterLabel}>
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
            <span className={styles['selection']}>{t.moderation.selected(selectedCount)}</span>
          ) : null}
        </div>

        <div className={styles['bulk']}>
          <Button size="sm" variant="ghost" onClick={onSelectAll}>
            {t.moderation.selectAll}
          </Button>
          <Button size="sm" variant="ghost" disabled={!hasSelection} onClick={onClearSelection}>
            {t.moderation.clearSelection}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!hasSelection}
            onClick={() => onBulk('publish')}
          >
            {t.moderation.bulkPublish(selectedCount)}
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            disabled={!hasSelection}
            onClick={() => onBulk('reject')}
          >
            {t.moderation.bulkReject(selectedCount)}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            disabled={!hasSelection}
            onClick={() => onBulk('hide')}
          >
            {t.moderation.bulkHide(selectedCount)}
          </Button>
        </div>
      </div>

      <p className={styles['shortcuts']}>
        <span className={styles['shortcutsLabel']}>{t.moderation.shortcuts}</span>{' '}
        {t.moderation.shortcutsHint} {t.moderation.shortcutsMore}
      </p>
    </div>
  )
}
