import { useCallback, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useApi } from '../../app/useApi'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { HostEventsLink } from '../../app/HostEventsLink'
import { LoadFailure } from '../../design-system/components/Async'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Spinner } from '../../design-system/components/Spinner'
import { useToast } from '../../design-system/components/useToast'
import { messageForError, type UiText } from '../../lib/i18n/translations'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { useEventStream, type StreamSignal } from '../../lib/realtime/useEventStream'
import { useLoader } from '../../lib/useLoader'
import { allowsModeration } from '../admin/eventLifecycle'
import { ConsoleTabs } from './components/ConsoleTabs'
import { panelId, tabId, type ConsoleTab } from './components/consoleTabIds'
import { GuestbookMessages } from './components/GuestbookMessages'
import { ModerationGrid } from './components/ModerationGrid'
import { ModerationToolbar } from './components/ModerationToolbar'
import { PhotoLightbox } from './components/PhotoLightbox'
import { useArrivals } from './hooks/useArrivals'
import { useGuestbookModeration } from './hooks/useGuestbookModeration'
import { useModerationQueue } from './hooks/useModerationQueue'
import { useModerationShortcuts } from './hooks/useModerationShortcuts'
import { needsRejectConfirmation } from './hooks/rejectConfirmation'
import { useQueueSelection } from './hooks/useQueueSelection'
import type { ModerationDecision, ModerationPhotoDto } from '../../lib/api/dto'
import styles from './ModerationPage.module.css'

/**
 * The moderation console: `/admin/events/:slug/moderation`.
 *
 * The host's laptop, during a party, while photos keep arriving. Composition only —
 * the queue, the selection and the keyboard live in hooks, so what this file shows is
 * the shape of the screen and nothing else.
 *
 * Two tabs when the event has a guestbook (spec 15): the photos, and the messages guests
 * wrote. One stream serves both.
 */
/** What a key says when the photo it was pressed on cannot take that decision. */
const NOT_ALLOWED_MESSAGE: Readonly<Record<ModerationDecision, (text: UiText) => string>> = {
  publish: (text) => text.moderation.alreadyOnScreen,
  reject: (text) => text.moderation.alreadyRefused,
  hide: (text) => text.moderation.notOnScreen,
}

export function ModerationPage() {
  const t = useTranslations()
  const { slug } = useParams()
  const toast = useToast()
  const api = useApi()
  // `linkToRejected`: this console has the filter bar the notice's "Voir dans Refusées" needs.
  // `ownStream: false`: this page opens the console's one stream and hands every signal to
  // both queues, so photos and messages share a connection.
  const queue = useModerationQueue(slug, { linkToRejected: true, ownStream: false })
  const selection = useQueueSelection(queue.items)

  // The guestbook is only offered when the event has one; a failed read of the event means
  // no tab rather than a console that cannot open.
  const loadEvent = useCallback(
    (signal: AbortSignal) =>
      slug === undefined ? Promise.resolve(null) : api.getEvent(slug, signal),
    [api, slug],
  )
  const { data: event } = useLoader(loadEvent)
  const guestbookEnabled = event?.settings.allowGuestbook === true
  const autoModeration = event?.settings.moderation === 'auto'
  const canDecideMessages = event !== null && allowsModeration(event.status)

  const [searchParams, setSearchParams] = useSearchParams()
  const [requestedTab, setRequestedTab] = useState<ConsoleTab>(
    searchParams.get('vue') === 'messages' ? 'messages' : 'photos',
  )
  const tab: ConsoleTab = requestedTab === 'messages' && guestbookEnabled ? 'messages' : 'photos'
  const onMessages = tab === 'messages'
  /** Where "new since your last visit" starts counting, in automatic moderation. */
  const [seenAt, setSeenAt] = useState(() => new Date().toISOString())
  const guestbook = useGuestbookModeration(slug, {
    active: onMessages,
    enabled: guestbookEnabled,
    watchPublishedSince: autoModeration && !onMessages ? seenAt : null,
  })
  const messageSelection = useQueueSelection(guestbook.items)
  /** What the last decision on a message said, for the live region. */
  const [decisionNote, setDecisionNote] = useState('')

  const { onSignal: onQueueSignal } = queue
  const { onSignal: onGuestbookSignal } = guestbook
  const onSignal = useCallback(
    (signal: StreamSignal) => {
      onQueueSignal(signal)
      onGuestbookSignal(signal)
    },
    [onQueueSignal, onGuestbookSignal],
  )
  const streamUrl = useMemo(
    () => (slug === undefined ? null : api.moderationStreamUrl(slug)),
    [api, slug],
  )
  const { connected } = useEventStream({ url: streamUrl, onSignal })

  /**
   * Above the grid, not inside it — roadmap 11.2.
   *
   * The grid is replaced by an `EmptyState` while the queue is empty, so a hook inside it
   * would be mounted fresh by the first photo of the evening and treat it as a screen it
   * had always been showing. That photo is the arrival most worth marking.
   */
  const arrivedIds = useArrivals(
    queue.items.map((item) => item.id),
    !queue.loading,
  )
  const [lightboxOpen, setLightboxOpen] = useState(false)
  /** The photos a bulk refusal is waiting on the host's answer about. */
  const [confirmingReject, setConfirmingReject] = useState<
    readonly Pick<ModerationPhotoDto, 'id' | 'status'>[] | null
  >(null)

  const focused = queue.items.find((item) => item.id === selection.focusedId) ?? null

  const openLightbox = (photoId: string) => {
    selection.focus(photoId, { moveDomFocus: false })
    setLightboxOpen(true)
  }

  const decideOne = (photoId: string, decision: ModerationDecision) => {
    setLightboxOpen(false)
    void queue.decide(photoId, decision)
  }

  const runBulk = (photoIds: readonly string[], decision: ModerationDecision) => {
    void queue.decideBulk(photoIds, decision)
    // Dropped straight away: leaving forty tiles ticked after acting on them is how the
    // next keystroke hits the same forty a second time.
    selection.clear()
  }

  const bulk = (decision: ModerationDecision) => {
    const chosen = queue.items.filter((item) => selection.selectedIds.includes(item.id))
    // MOD-9: a refusal of waiting photos is final and their guests see it, so a screenful
    // of them is asked about first — a stray R or the red button beside "Publier (30)".
    if (decision === 'reject' && needsRejectConfirmation(chosen)) {
      setConfirmingReject(chosen.map(({ id, status }) => ({ id, status })))
      return
    }
    runBulk(selection.selectedIds, decision)
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
    // The server's answer about this photo, so a key never ends in a red toast. Empty
    // while the photo's own decision is still travelling: nothing to say yet.
    if (focused.allowedDecisions.length === 0) return
    if (!focused.allowedDecisions.includes(decision)) {
      toast.show(NOT_ALLOWED_MESSAGE[decision](t), { tone: 'neutral', durationMs: 2_500 })
      return
    }
    void queue.decide(focused.id, decision)
    // The queue moves on with the host, so the next decision needs no navigation.
    selection.moveFocus(1)
  }

  const toggleHighlight = (photoId: string) => {
    void queue.toggleHighlight(photoId)
  }

  const switchTab = (next: ConsoleTab) => {
    if (next === tab) return
    // Both ways: a selection of photos must not outlive the tab it was made on, or a P
    // tapped over there would reach forty photos nobody can see.
    selection.clear()
    messageSelection.clear()
    setDecisionNote('')
    if (next === 'messages') {
      // In automatic moderation nothing waits: open on what is already on the wall.
      if (autoModeration) guestbook.setFilter('published')
    } else {
      setSeenAt(new Date().toISOString())
    }
    setRequestedTab(next)
    setSearchParams(next === 'messages' ? { vue: 'messages' } : {}, { replace: true })
  }

  /** `viaKey`: a key the server would refuse says so in words, a button never offers it. */
  const decideMessage = (entryId: string, decision: ModerationDecision, viaKey: boolean) => {
    const item = guestbook.items.find((row) => row.id === entryId)
    if (item === undefined || !canDecideMessages) return
    if (viaKey) {
      if (item.allowedDecisions.length === 0) return
      if (!item.allowedDecisions.includes(decision)) {
        toast.show(NOT_ALLOWED_MESSAGE[decision](t), { tone: 'neutral', durationMs: 2_500 })
        return
      }
    }
    const author = item.authorName ?? t.guestbookHost.anonymous
    setDecisionNote(
      {
        publish: t.moderation.messagePublished,
        reject: t.moderation.messageRejected,
        hide: t.moderation.messageHidden,
      }[decision](author),
    )
    void guestbook.decide(entryId, decision)
    if (viaKey) messageSelection.moveFocus(1)
  }

  const focusedMessage = messageSelection.focusedId
  useModerationShortcuts(
    onMessages
      ? {
          onNext: () => messageSelection.moveFocus(1),
          onPrevious: () => messageSelection.moveFocus(-1),
          // Never the photo selection: on this tab P, R and H decide the message under the keyboard.
          onPublish: () => {
            if (focusedMessage !== null) decideMessage(focusedMessage, 'publish', true)
          },
          onReject: () => {
            if (focusedMessage !== null) decideMessage(focusedMessage, 'reject', true)
          },
          onHide: () => {
            if (focusedMessage !== null) decideMessage(focusedMessage, 'hide', true)
          },
          onUndo: () => {
            if (canDecideMessages) void guestbook.undo()
          },
          // No favourite, no selection and no lightbox for a message.
          onHighlight: () => undefined,
          onToggleSelect: () => undefined,
          onClear: () => undefined,
        }
      : {
          onNext: () => selection.moveFocus(1),
          onPrevious: () => selection.moveFocus(-1),
          onPublish: () => decideByKey('publish'),
          onReject: () => decideByKey('reject'),
          onHide: () => decideByKey('hide'),
          onUndo: () => {
            void queue.undo()
          },
          onHighlight: () => {
            if (focused !== null) toggleHighlight(focused.id)
          },
          onToggleSelect: () => {
            if (selection.focusedId !== null) selection.toggle(selection.focusedId)
          },
          onClear: () => selection.clear(),
        },
    // The lightbox owns the keyboard while it is open: it has the same decisions plus
    // the arrows, and J/K would otherwise pull the browser's focus out of the modal.
    // Space is the browser's on the messages tab: it scrolls, and presses a focused button.
    { enabled: !lightboxOpen && confirmingReject === null, captureSpace: !onMessages },
  )

  const emptyTitle =
    queue.filter === 'pending' || queue.filter === 'all'
      ? t.moderation.empty
      : t.moderation.emptyFiltered
  const emptyHint =
    queue.filter === 'pending' || queue.filter === 'all'
      ? t.moderation.emptyHint
      : t.moderation.emptyFilteredHint

  if (slug === undefined) {
    return <EmptyState as="h1" title={t.shell.notFoundTitle} description={t.shell.notFoundHint} />
  }

  const messagesBadge = autoModeration ? guestbook.freshPublishedCount : guestbook.pendingCount

  return (
    <div className={styles['page']}>
      <HostBreadcrumb slug={slug} page="moderation" />
      <header className={styles['intro']}>
        <h1 className={styles['title']}>{t.moderation.title}</h1>
        <p className={styles['lead']}>{t.moderation.intro}</p>
        {/* The same queue, one photograph at a time: the two consoles used to share no link. */}
        <Link className={styles['otherConsole']} to={`/admin/events/${slug}/moderation/mobile`}>
          {t.moderation.openMobile}
        </Link>
      </header>

      {guestbookEnabled ? (
        <ConsoleTabs
          tab={tab}
          onChange={switchTab}
          photosPending={queue.pendingCount}
          messagesPending={messagesBadge}
          messagesAreFresh={autoModeration}
        />
      ) : null}
      {/* The count of the tab nobody is looking at, said once per change. */}
      <div aria-live="polite" className="visually-hidden">
        {!onMessages && guestbookEnabled && messagesBadge > 0
          ? t.moderation.messagesPendingAnnounce(messagesBadge)
          : ''}
      </div>
      <div aria-live="polite" className="visually-hidden">
        {decisionNote}
      </div>

      <div
        hidden={onMessages}
        {...(guestbookEnabled
          ? { role: 'tabpanel', id: panelId('photos'), 'aria-labelledby': tabId('photos') }
          : {})}
      >
        <ModerationToolbar
          pendingCount={queue.pendingCount}
          connected={connected}
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
            {messageForError(queue.error, t)}
          </p>
        ) : null}

        {queue.loading && queue.items.length === 0 ? (
          <div className={styles['pending']} aria-busy="true">
            <Spinner size="lg" label={t.app.loading} />
          </div>
        ) : queue.error !== null && queue.items.length === 0 ? (
          <LoadFailure
            as="h2"
            title={t.moderation.loadFailed}
            message={messageForError(queue.error, t)}
            onRetry={queue.refresh}
            secondaryAction={<HostEventsLink />}
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
            arrivedIds={arrivedIds}
            focusedId={selection.focusedId}
            onSelectToggle={selection.toggle}
            onFocusCard={(photoId) => selection.focus(photoId, { moveDomFocus: false })}
            onDecide={decideOne}
            onToggleHighlight={toggleHighlight}
            onOpen={openLightbox}
            registerCard={selection.registerCard}
          />
        )}
      </div>

      {onMessages ? (
        <div role="tabpanel" id={panelId('messages')} aria-labelledby={tabId('messages')}>
          <GuestbookMessages
            guestbook={guestbook}
            selection={messageSelection}
            canDecide={canDecideMessages}
            onDecide={(entryId, decision) => decideMessage(entryId, decision, false)}
          />
        </div>
      ) : null}

      <PhotoLightbox
        photo={focused}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        onPrevious={() => selection.moveFocus(-1, { moveDomFocus: false })}
        onNext={() => selection.moveFocus(1, { moveDomFocus: false })}
        onDecide={decideOne}
        onToggleHighlight={toggleHighlight}
      />

      <ConfirmDialog
        open={confirmingReject !== null}
        title={t.moderation.confirmRejectTitle(confirmingReject?.length ?? 0)}
        description={t.moderation.confirmRejectBody}
        confirmLabel={t.moderation.confirmRejectLabel(confirmingReject?.length ?? 0)}
        onCancel={() => setConfirmingReject(null)}
        onConfirm={() => {
          if (confirmingReject !== null) {
            // The dialog was open while the queue kept moving: another moderator may have
            // published or refused some of these in the meantime, and the host agreed to
            // refuse photos as they were, not as they have become.
            const unchanged = confirmingReject
              .filter(({ id, status }) =>
                queue.items.some((item) => item.id === id && item.status === status),
              )
              .map(({ id }) => id)
            if (unchanged.length > 0) runBulk(unchanged, 'reject')
            else selection.clear()
          }
          setConfirmingReject(null)
        }}
      />
    </div>
  )
}
