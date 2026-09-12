import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Spinner } from '../../design-system/components/Spinner'
import { fr } from '../../lib/i18n/fr'
import { ModerationGrid } from './components/ModerationGrid'
import { ModerationToolbar } from './components/ModerationToolbar'
import { PhotoLightbox } from './components/PhotoLightbox'
import { useModerationQueue } from './hooks/useModerationQueue'
import { useModerationShortcuts } from './hooks/useModerationShortcuts'
import { useQueueSelection } from './hooks/useQueueSelection'
import type { ModerationDecision } from '../../lib/api/dto'
import styles from './ModerationPage.module.css'

/**
 * The moderation console: `/admin/events/:slug/moderation`.
 *
 * The host's laptop, during a party, while photos keep arriving. Composition only —
 * the queue, the selection and the keyboard live in hooks, so what this file shows is
 * the shape of the screen and nothing else.
 */
export function ModerationPage() {
  const { slug } = useParams()
  const queue = useModerationQueue(slug)
  const selection = useQueueSelection(queue.items)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const focused = queue.items.find((item) => item.id === selection.focusedId) ?? null

  const openLightbox = (photoId: string) => {
    selection.focus(photoId, { moveDomFocus: false })
    setLightboxOpen(true)
  }

  const decideOne = (photoId: string, decision: ModerationDecision) => {
    setLightboxOpen(false)
    void queue.decide(photoId, decision)
  }

  const bulk = (decision: ModerationDecision) => {
    void queue.decideBulk(selection.selectedIds, decision)
    // Dropped straight away: leaving forty tiles ticked after acting on them is how the
    // next keystroke hits the same forty a second time.
    selection.clear()
  }

  /**
   * What a keystroke acts on: the selection when there is one, the photo under the
   * keyboard otherwise. A host who has just ticked a screenful expects P to mean
   * "those", and a host walking the queue with J expects it to mean "this one".
   */
  const decideByKey = (decision: ModerationDecision) => {
    if (selection.selectedIds.length > 0) {
      bulk(decision)
      return
    }
    if (focused === null) return
    void queue.decide(focused.id, decision)
    // The queue moves on with the host, so the next decision needs no navigation.
    selection.moveFocus(1)
  }

  useModerationShortcuts(
    {
      onNext: () => selection.moveFocus(1),
      onPrevious: () => selection.moveFocus(-1),
      onPublish: () => decideByKey('publish'),
      onReject: () => decideByKey('reject'),
      onHide: () => decideByKey('hide'),
      onUndo: () => {
        void queue.undo()
      },
      onToggleSelect: () => {
        if (selection.focusedId !== null) selection.toggle(selection.focusedId)
      },
      onClear: () => selection.clear(),
    },
    // The lightbox owns the keyboard while it is open: it has the same decisions plus
    // the arrows, and J/K would otherwise pull the browser's focus out of the modal.
    { enabled: !lightboxOpen },
  )

  const emptyTitle =
    queue.filter === 'pending' || queue.filter === 'all'
      ? fr.moderation.empty
      : fr.moderation.emptyFiltered
  const emptyHint =
    queue.filter === 'pending' || queue.filter === 'all'
      ? fr.moderation.emptyHint
      : fr.moderation.emptyFilteredHint

  if (slug === undefined) {
    return <EmptyState as="h1" title={fr.shell.notFoundTitle} description={fr.shell.notFoundHint} />
  }

  return (
    <div className={styles['page']}>
      <header className={styles['intro']}>
        <h1 className={styles['title']}>{fr.moderation.title}</h1>
        <p className={styles['lead']}>{fr.moderation.intro}</p>
      </header>

      <ModerationToolbar
        pendingCount={queue.pendingCount}
        connected={queue.connected}
        filter={queue.filter}
        selectedCount={selection.selectedIds.length}
        busy={queue.busy}
        onFilterChange={queue.setFilter}
        onSelectAll={selection.selectAll}
        onClearSelection={selection.clear}
        onBulk={bulk}
      />

      {/*
        A failed refetch while the host is working keeps the photos on screen and says
        so out loud, rather than replacing a usable queue with an error page.
      */}
      {queue.error !== null && queue.items.length > 0 ? (
        <p role="alert" className={styles['staleError']}>
          {queue.error.message}
        </p>
      ) : null}

      {queue.loading && queue.items.length === 0 ? (
        <div className={styles['pending']} aria-busy="true">
          <Spinner size="lg" label={fr.app.loading} />
        </div>
      ) : queue.error !== null && queue.items.length === 0 ? (
        <EmptyState
          as="h2"
          title={fr.moderation.loadFailed}
          description={queue.error.message}
          action={
            <Button variant="primary" onClick={queue.refresh}>
              {fr.app.retry}
            </Button>
          }
        />
      ) : queue.items.length === 0 ? (
        // Never a bare empty grid: 1.0 showed one before the first photo arrived, which
        // is indistinguishable from a screen that failed to load — and a host with a
        // projector waiting reloads, then reboots.
        <EmptyState as="h2" title={emptyTitle} description={emptyHint} />
      ) : (
        <ModerationGrid
          photos={queue.items}
          selectedIds={selection.selectedIds}
          focusedId={selection.focusedId}
          onSelectToggle={selection.toggle}
          onFocusCard={(photoId) => selection.focus(photoId, { moveDomFocus: false })}
          onDecide={decideOne}
          onOpen={openLightbox}
          registerCard={selection.registerCard}
        />
      )}

      <PhotoLightbox
        photo={focused}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        onPrevious={() => selection.moveFocus(-1, { moveDomFocus: false })}
        onNext={() => selection.moveFocus(1, { moveDomFocus: false })}
        onDecide={decideOne}
      />
    </div>
  )
}
