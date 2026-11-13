import { useCallback, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useApi } from '../../lib/useApi'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { HostEventsLink } from '../../app/HostEventsLink'
import { LoadFailure } from '../../design-system/components/Async'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Spinner } from '../../design-system/components/Spinner'
import { VisuallyHidden } from '../../design-system/components/VisuallyHidden'
import { messageForError } from '../../lib/i18n/translations'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { useEventStream, type StreamSignal } from '../../lib/realtime/useEventStream'
import { useLoader } from '../../lib/useLoader'
import { photoLabels } from './photoLabels'
import { allowsModeration } from '../../lib/eventLifecycle'
import { ConsoleTabs } from './components/ConsoleTabs'
import type { ConsoleTab } from './components/consoleTabIds'
import { MessageSwipeCard } from './components/MessageSwipeCard'
import { OnScreenMessages } from './components/OnScreenMessages'
import { OnScreenStrip } from './components/OnScreenStrip'
import { SwipeCard } from './components/SwipeCard'
import { useGuestbookModeration } from './hooks/useGuestbookModeration'
import { useModerationQueue } from './hooks/useModerationQueue'
import type { ModerationDecision } from '../../lib/api/dto'
import styles from './MobileModerationPage.module.css'

/**
 * The moderation console for a host who is not at the laptop:
 * `/admin/events/:slug/moderation/mobile`.
 *
 * They are at a table, standing, holding a phone in one hand. The desktop console is
 * built around a dense grid, a keyboard and a selection, and no amount of responsive CSS
 * makes any of those workable with one thumb — so this is a second *view* over the same
 * queue rather than the same view made narrower.
 *
 * What it does not do is as important as what it does:
 *
 * - **No server code.** Same `useModerationQueue`, same endpoints, same SSE channel,
 *   same decisions. A photo judged here and a photo judged on the laptop travel exactly
 *   the same path.
 * - **No filters, no selection, no bulk.** One photo at a time is the entire idea; a
 *   host who wants to work through forty at once has a laptop for that.
 * - **No gesture-only control.** Every decision the swipe can take is also a real
 *   button, because a swipe is invisible to a screen reader and unusable one-handed by
 *   somebody with limited mobility. The gesture is the shortcut, not the interface.
 */
/**
 * How many photos the "Dernières photos à l'écran" strip shows: the six latest published,
 * by upload time. Not "what the room is looking at" — the wall cycles through older photos
 * too, and the server has no publication time to order by yet (MOD-5).
 */
const ON_SCREEN_COUNT = 6

export interface MobileModerationPageProps {
  /** Opens the laptop's console of the same queue, on this same address (`ModerationRoute`). */
  readonly onSwitchView: () => void
}

export function MobileModerationPage({ onSwitchView }: MobileModerationPageProps) {
  const t = useTranslations()
  const { slug } = useParams()

  /**
   * `onScreenLimit` is what this surface asks the queue for that the desktop does not:
   * it has no filter bar, so the last photos on the wall are read beside the queue and
   * shown as a strip (MOD-2). A photo that is already up can then be taken down from the
   * phone, which until then only the host's own last publication could be.
   */
  const queue = useModerationQueue(slug, { onScreenLimit: ON_SCREEN_COUNT, ownStream: false })

  // The messages tab (spec 15): offered when the event has a guestbook. One stream serves the
  // photo queue and both message readings.
  const api = useApi()
  const loadEvent = useCallback(
    (signal: AbortSignal) =>
      slug === undefined ? Promise.resolve(null) : api.getEvent(slug, signal),
    [api, slug],
  )
  const { data: event } = useLoader(loadEvent)
  const guestbookEnabled = event?.settings.allowGuestbook === true
  const canDecideMessages = event !== null && allowsModeration(event.status)
  const [searchParams, setSearchParams] = useSearchParams()
  const [requestedTab, setRequestedTab] = useState<ConsoleTab>(
    searchParams.get('vue') === 'messages' ? 'messages' : 'photos',
  )
  const tab: ConsoleTab = requestedTab === 'messages' && guestbookEnabled ? 'messages' : 'photos'
  const onMessages = tab === 'messages'
  const messages = useGuestbookModeration(slug, { active: onMessages, enabled: guestbookEnabled })
  /** The wall strip's reading: the published ones, newest first. */
  const onWallMessages = useGuestbookModeration(slug, {
    active: onMessages,
    enabled: guestbookEnabled,
    initialFilter: 'published',
  })
  const currentMessage = messages.items.find((item) => item.status === 'pending') ?? null
  const messageAuthor = (message: { readonly authorName: string | null }) =>
    message.authorName ?? t.guestbookHost.anonymous

  const { onSignal: onQueueSignal, onReconnect: onQueueReconnect } = queue
  const { onSignal: onMessagesSignal, onReconnect: onMessagesReconnect } = messages
  const { onSignal: onWallSignal, onReconnect: onWallReconnect } = onWallMessages
  const onSignal = useCallback(
    (signal: StreamSignal) => {
      onQueueSignal(signal)
      onMessagesSignal(signal)
      onWallSignal(signal)
    },
    [onQueueSignal, onMessagesSignal, onWallSignal],
  )
  const onReconnect = useCallback(() => {
    onQueueReconnect()
    onMessagesReconnect()
    onWallReconnect()
  }, [onQueueReconnect, onMessagesReconnect, onWallReconnect])
  const streamUrl = useMemo(
    () => (slug === undefined ? null : api.moderationStreamUrl(slug)),
    [api, slug],
  )
  const { connected } = useEventStream({ url: streamUrl, onSignal, onReconnect })

  /**
   * The photo in hand: the first one still awaiting a decision.
   *
   * Derived rather than held as an index, and that is what makes the screen survive
   * everything that happens around it. A decision changes the photo's status locally
   * before the server confirms, so the card advances immediately; a refetch triggered
   * by the stream can add, remove or reorder photos under the host without the screen
   * pointing at the wrong one; and an undo that puts a photo back becomes visible for
   * the same reason, with no bookkeeping to get wrong.
   */
  const current = queue.items.find((item) => item.status === 'pending') ?? null

  const authorInName =
    current === null ? null : (current.authorName ?? t.moderation.anonymousInName)

  /**
   * The last decision the host took, kept only to explain a greyed-out undo.
   *
   * Nothing is said before the first decision: a line about refusals not being
   * reversible, on a screen where nothing has been refused, explains a situation the
   * host is not in.
   */
  const [lastDecision, setLastDecision] = useState<ModerationDecision | null>(null)

  /**
   * Which clip is running, named by its photo rather than held as a boolean.
   *
   * Derived comparison rather than stored state, for the same reason `current` is
   * derived: the card advances the instant a decision lands, and a boolean would leave
   * the next clip already "playing" — a card that begins with sound the host did not ask
   * for, in a room. Naming the photo means the answer resets itself.
   */
  const [playingId, setPlayingId] = useState<string | null>(null)
  /**
   * What playback did that the host did not ask for, and which photo it happened to.
   *
   * Named by photo for the same reason `playingId` is: the card advances on its own, and
   * a flag would carry one clip's trouble onto the next one's.
   *
   * It is a **notice, never a replacement for the control**. A failed metadata fetch on a
   * venue phone is transient and arrives before the host has pressed anything, so
   * swapping the button out for a sentence would make one network blip cost them the
   * ability to watch that clip for the rest of the session.
   */
  const [notice, setNotice] = useState<{ photoId: string; kind: 'failed' | 'muted' } | null>(null)
  const isClip = current !== null && current.kind === 'clip' && current.videoUrl !== null
  const playing = current !== null && playingId === current.id
  const currentNotice = current !== null && notice?.photoId === current.id ? notice.kind : null

  /**
   * Take a decision on a named photo, and on that photo only.
   *
   * Two guards, both of which exist because the card advances *before* the server
   * answers — that optimism is what keeps the console usable on venue Wi-Fi, and it is
   * also what makes a second press dangerous:
   *
   * - **Nothing while a decision is in flight.** The host taps "Publier", the request
   *   hangs on a saturated network, they tap again — and without this the second tap
   *   lands on the photo that has just slid into place, which nobody has looked at. The
   *   buttons show `loading` for the same reason: a control that ignores a press must
   *   say why.
   * - **Only the photo the gesture began on.** The decision names its photo rather than
   *   taking whatever is in hand when the handler runs. Today the card is keyed by id
   *   so a mid-gesture swap unmounts the gesture with it, and this check cannot fire —
   *   it is here so that a later refactor which drops the key cannot quietly turn a
   *   swipe into a decision on the next photo.
   */
  const decide = (decision: ModerationDecision, photoId: string) => {
    if (queue.busy) return
    if (current === null || current.id !== photoId) return
    setLastDecision(decision)
    // Playback stops with the decision, and this is not tidiness. The status is applied
    // optimistically, so a refusal the server sends back — `photo.illegalTransition`, a
    // dropped connection — rolls the photo back to `pending` and puts *this* clip in hand
    // again. With the id still stored, the remounted card would start playing, with
    // sound, in a room, without anybody asking for it.
    setPlayingId(null)
    void queue.decide(photoId, decision)
  }

  /**
   * Take a photo that is on the wall off it, from the strip. Same guard as `decide`: one
   * decision in flight at a time, so a second tap cannot land on whatever slid into place.
   */
  const removeFromScreen = (photoId: string) => {
    if (queue.busy) return
    void queue.decide(photoId, 'hide')
  }

  /**
   * What the live region says: the photo now in hand, or that there is none left.
   *
   * Silent while the first queue is still loading or has failed — the spinner carries
   * its own `role="status"`, and the failure is a heading the host lands on. A live
   * region that narrated every state of the screen would be a region nobody listens to.
   */
  const announcement = (): string => {
    if (onMessages) {
      if (messages.items.length === 0 && (messages.loading || messages.error !== null)) return ''
      return currentMessage === null
        ? t.moderation.messagesEmpty
        : t.mobileModeration.nowDeciding(t.moderation.messageOf(messageAuthor(currentMessage)))
    }
    if (queue.items.length === 0 && (queue.loading || queue.error !== null)) return ''
    if (current === null || authorInName === null) return t.moderation.empty
    // "Vidéo" rather than "photo" where it is one: a host who cannot see the screen has
    // to know that what is in hand has fifteen seconds in it before they decide, and the
    // play button below is announced only after they have heard what it is for.
    return t.mobileModeration.nowDeciding(photoLabels(current, current.kind === 'clip', t).alt)
  }

  /** Same guard as `decide`: one decision in flight, and only the message the gesture began on. */
  const decideMessage = (decision: ModerationDecision, entryId: string) => {
    if (messages.busy || !canDecideMessages) return
    if (currentMessage === null || currentMessage.id !== entryId) return
    setLastDecision(decision)
    void messages.decide(entryId, decision)
  }

  const removeMessage = (entryId: string) => {
    if (onWallMessages.busy || !canDecideMessages) return
    void onWallMessages.decide(entryId, 'hide')
  }

  const switchTab = (next: ConsoleTab) => {
    setRequestedTab(next)
    setSearchParams(next === 'messages' ? { vue: 'messages' } : {}, { replace: true })
  }

  const busy = onMessages ? messages.busy : queue.busy
  const hasCurrent = onMessages ? currentMessage !== null : current !== null
  const canUndo = onMessages ? messages.canUndo : queue.canUndo
  const handsAuthor = onMessages
    ? currentMessage === null
      ? null
      : messageAuthor(currentMessage)
    : authorInName
  const decideCurrent = (decision: ModerationDecision) => {
    if (onMessages) {
      if (currentMessage !== null) decideMessage(decision, currentMessage.id)
    } else if (current !== null) decide(decision, current.id)
  }

  if (slug === undefined) {
    return <EmptyState as="h1" title={t.shell.notFoundTitle} description={t.shell.notFoundHint} />
  }

  return (
    // `data-ornament-free`: the ambiance's strips and their padding stay off a one-thumb screen.
    <div className={styles['page']} data-ornament-free="">
      {/* Compact: this screen spends every line, and its own heading is right below. */}
      <HostBreadcrumb slug={slug} page="mobileModeration" compact />
      <header className={styles['head']}>
        <h1 className={styles['title']}>{t.mobileModeration.title}</h1>
        <div className={styles['badges']}>
          {/* One live region per concern. The count moves on its own as guests upload,
              and a host holding the phone at their side still needs to be told. */}
          <div aria-live="polite">
            <Badge tone={queue.pendingCount > 0 ? 'warning' : 'neutral'}>
              {t.moderation.pending(queue.pendingCount)}
            </Badge>
          </div>
          <div aria-live="polite">
            <Badge tone={connected ? 'success' : 'warning'}>
              {connected ? t.moderation.live : t.moderation.liveLost}
            </Badge>
          </div>
        </div>
        {/* The tabs take the line the intro had: the card, its caption and its author must fit a phone. */}
        {guestbookEnabled ? (
          <VisuallyHidden as="div">{t.mobileModeration.intro}</VisuallyHidden>
        ) : (
          <p className={styles['intro']}>{t.mobileModeration.intro}</p>
        )}
      </header>

      {guestbookEnabled ? (
        <ConsoleTabs
          tab={tab}
          onChange={switchTab}
          photosPending={queue.pendingCount}
          messagesPending={messages.pendingCount}
          messagesAreFresh={false}
        />
      ) : null}

      {/*
        What is in hand, said out loud.

        The card is replaced silently when a decision lands, so a host who is not
        looking at the screen — which is the whole premise of this surface — hears "1
        photo publiée" and then nothing about what they are now about to decide. The
        region is mounted unconditionally and empty of chrome: a live region has to
        exist before its content changes, or the first announcement is swallowed.
      */}
      <VisuallyHidden as="div">
        <p aria-live="polite">{announcement()}</p>
      </VisuallyHidden>

      {/* A refetch that failed while the host was working says so and keeps the photo
          on screen, rather than replacing a usable queue with an error page. */}
      {queue.error !== null && queue.items.length > 0 ? (
        <p role="alert" className={styles['staleError']}>
          {messageForError(queue.error, t)}
        </p>
      ) : null}

      <div className={styles['stage']}>
        {onMessages ? (
          messages.loading && messages.items.length === 0 ? (
            <div className={styles['pending']} aria-busy="true">
              <Spinner size="lg" label={t.app.loading} />
            </div>
          ) : messages.error !== null && messages.items.length === 0 ? (
            <LoadFailure
              as="h2"
              title={t.moderation.messagesLoadFailed}
              message={messageForError(messages.error, t)}
              onRetry={messages.refresh}
              secondaryAction={<HostEventsLink />}
            />
          ) : currentMessage === null ? (
            <EmptyState
              as="h2"
              title={t.moderation.messagesEmpty}
              description={t.moderation.messagesEmptyHint}
            />
          ) : (
            <MessageSwipeCard
              key={currentMessage.id}
              message={currentMessage}
              disabled={messages.busy || !canDecideMessages}
              onDecide={decideMessage}
            />
          )
        ) : queue.loading && queue.items.length === 0 ? (
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
        ) : current === null ? (
          <EmptyState as="h2" title={t.moderation.empty} description={t.moderation.emptyHint} />
        ) : (
          // Keyed by the photo, so the next one arrives with the gesture reset instead
          // of inheriting the offset the last swipe left behind — and so a photo that
          // changes under a thumb takes the gesture with it rather than inheriting it.
          //
          // `disabled` while a decision is in flight: the card must not move for a
          // gesture the page is about to refuse. Two quick swipes are the same hazard as
          // two quick taps.
          <SwipeCard
            key={current.id}
            photo={current}
            disabled={queue.busy}
            onDecide={decide}
            playing={playing}
            onPlaybackEnded={(reason) => {
              // `muted` is the one that keeps playing: the browser refused sound and the
              // clip is running without it, so the button stays "mettre en pause".
              if (reason === 'muted') {
                setNotice({ photoId: current.id, kind: 'muted' })
                return
              }
              setPlayingId(null)
              if (reason === 'failed') setNotice({ photoId: current.id, kind: 'failed' })
            }}
          />
        )}
      </div>

      {/*
        Not shown until its own read has answered, and not at all if that read failed: an
        empty strip says "nothing is on the wall", and a host who cannot reach the server
        must not be told so. Filtered here as well as in the query, so a photo taken off the
        wall leaves it at once.
      */}
      {onMessages ? (
        // Same rule as the photo strip: not before its own reading has answered.
        onWallMessages.loading && onWallMessages.items.length === 0 ? null : (
          <OnScreenMessages
            messages={onWallMessages.items
              .filter((message) => message.status === 'published')
              .slice(0, ON_SCREEN_COUNT)}
            busy={onWallMessages.busy}
            onRemove={removeMessage}
          />
        )
      ) : queue.onScreen === null ? null : (
        <OnScreenStrip
          photos={queue.onScreen.filter((photo) => photo.status === 'published')}
          busy={queue.busy}
          onRemove={removeFromScreen}
          onToggleHighlight={(photoId) => void queue.toggleHighlight(photoId)}
        />
      )}

      {/*
        Everything pressable, together, in the bottom third of the screen — the same
        rule the guest upload page follows, for the same reason: a control in the top
        half of a phone needs a second hand, and this host is holding something in it.

        The bar is rendered whether or not there is a photo, so the buttons do not move
        between decisions. A target that shifts under a thumb is how a host publishes
        the photo they meant to refuse.
      */}
      <div className={styles['actions']}>
        {/*
          The play control, and it is here rather than on the card for a reason that is
          not cosmetic: the card is a drag surface, and a button inside one fires on a
          gesture meant for the card — an aborted swipe becomes a tap, and a tap near the
          bottom of the card becomes a scrub. So playback is requested from the action
          bar, at the same 44 px target as every decision beside it.

          It is also the accessible path rather than a fallback. A swipe is invisible to
          a screen reader and native video controls inside a drag surface would be worse
          than none; a real button with a real label is the only way this clip can be
          watched without sight or without fine motor control.

          Rendered only for a clip, and above the decisions so the host's thumb does not
          pass over "Refuser" on its way to "Lire".
        */}
        {!onMessages && isClip && current !== null && authorInName !== null ? (
          <>
            <Button
              variant="secondary"
              size="lg"
              block
              aria-label={
                playing
                  ? t.moderation.pauseVideo(authorInName)
                  : t.moderation.playVideo(authorInName)
              }
              onClick={() => {
                // A fresh attempt clears what the last one said. A phone that dropped a
                // metadata fetch a moment ago will very often manage it now, and the host
                // must not be left reading a stale refusal over a clip that plays.
                setNotice(null)
                setPlayingId(playing ? null : current.id)
              }}
            >
              {playing
                ? t.moderation.pauseVideo(authorInName)
                : t.moderation.playVideo(authorInName)}
            </Button>
            {/* Beside the control, never instead of it. */}
            {currentNotice === null ? null : (
              <p className={styles['undoHint']} role="status">
                {currentNotice === 'muted' ? t.moderation.videoMuted : t.moderation.videoUnplayable}
              </p>
            )}
          </>
        ) : null}

        <div className={styles['decisions']}>
          {/*
            `loading` while a decision is in flight, which is what `Button` turns into
            `aria-busy` plus `disabled`. Both halves matter: the disabled half is what
            stops an impatient second tap deciding the photo that has just slid into
            place, and the busy half is what tells the host the first press registered —
            a control that silently ignores a tap on a slow network is a control people
            tap harder.
          */}
          <Button
            variant="danger"
            size="lg"
            block
            loading={busy}
            disabled={!hasCurrent}
            aria-label={
              handsAuthor === null
                ? undefined
                : onMessages
                  ? t.moderation.rejectMessageOf(handsAuthor)
                  : t.moderation.rejectPhoto(handsAuthor)
            }
            onClick={() => {
              decideCurrent('reject')
            }}
          >
            {t.moderation.reject}
          </Button>
          <Button
            variant="primary"
            size="lg"
            block
            loading={busy}
            disabled={!hasCurrent}
            aria-label={
              handsAuthor === null
                ? undefined
                : onMessages
                  ? t.moderation.publishMessageOf(handsAuthor)
                  : t.moderation.publishPhoto(handsAuthor)
            }
            onClick={() => {
              decideCurrent('publish')
            }}
          >
            {t.moderation.publish}
          </Button>
        </div>

        {/*
          Always on the screen, not carried by a toast that expires. A host looks up at
          the projector, sees what they just did, and looks back — on the laptop the
          undo is an action on the decision's own notice, which is reachable because the
          keyboard is right there. Standing at a table, the affordance has to still be
          where it was.
        */}
        <Button
          variant="ghost"
          block
          disabled={!canUndo}
          onClick={() => void (onMessages ? messages.undo() : queue.undo())}
        >
          {t.mobileModeration.undoLast}
        </Button>
        {/*
          Said only to a host who has just met the limit — after a refusal, which is the
          one decision here that nothing takes back. Shown on first paint it would
          explain a situation nobody is in yet.
        */}
        {!canUndo && lastDecision === 'reject' ? (
          <p className={styles['undoHint']}>{t.mobileModeration.undoUnavailable}</p>
        ) : null}
      </div>
      {/* After the thumb zone and outside it, never in it. The bar above is `sticky`, so whatever
          it holds is painted over the bottom of the viewport: a link inside it made the bar a
          line taller, and on a short phone screen the bar then covered the middle of the card,
          where a swipe starts (the pointer landed on the bar and the gesture never began). Here
          the bar and the card are exactly where they were, and the link is below the fold's work:
          a host whose device was taken for a phone (a narrow window, a touch laptop) scrolls to it.
          The choice is remembered on this device. */}
      <Button variant="ghost" className={styles['otherConsole']} onClick={onSwitchView}>
        {t.mobileModeration.openConsole}
      </Button>
    </div>
  )
}
