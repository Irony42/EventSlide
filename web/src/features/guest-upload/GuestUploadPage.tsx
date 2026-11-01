import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { themeSurfaceProps } from '../../design-system/eventTheme'
import { RootGroundHue } from '../../design-system/useRootGroundHue'
import { forgetGuestSession, readGuestSession } from '../../lib/guestSession'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { prefersReducedMotion } from '../../lib/prefersReducedMotion'
import { cx } from '../../design-system/classNames'
import { ComposerOptions } from './components/ComposerOptions'
import { InstallCard } from './components/InstallCard'
import { MissionChecklist } from './components/MissionChecklist'
import { EraseEverything } from './components/EraseEverything'
import { GuestbookCard } from './components/GuestbookCard'
import { MyMessages } from './components/MyMessages'
import { MyPhotos } from './components/MyPhotos'
import { Notice } from '../../design-system/components/Notice'
import { OfflineNotice } from './components/OfflineNotice'
import { PhotoPicker } from './components/PhotoPicker'
import { PrivacyNoticeCard, PrivacyNoticeDialog } from './components/PrivacyNotice'
import { UploadQueue } from './components/UploadQueue'
import { useBackgroundSync } from './hooks/useBackgroundSync'
import { useClipUpload } from './hooks/useClipUpload'
import { useEraseEverything } from './hooks/useEraseEverything'
import { useGuestbook } from './hooks/useGuestbook'
import { useMyMessages } from './hooks/useMyMessages'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { useMissions } from './hooks/useMissions'
import { useMyPhotos } from './hooks/useMyPhotos'
import { useOutbox } from './hooks/useOutbox'
import { useOversizedPane } from './hooks/useOversizedPane'
import { usePrivacyNotice } from './hooks/usePrivacyNotice'
import { useUploadQueue, type SettledOutcome } from './hooks/useUploadQueue'
import type { PrivacyNoticeState, PublicEventDto } from '../../lib/api/dto'
import type { DrainReport } from '../../lib/offline/drainOutbox'
import styles from './GuestUploadPage.module.css'

/**
 * `/e/:slug/upload`. The screen the whole product depends on.
 *
 * Forty seconds, one thumb, a dark room and a saturated Wi-Fi. Everything the guest
 * has to press lives in the bottom half; everything else is there to tell them their
 * photos arrived, because a guest who cannot tell sends them again.
 */
export function GuestUploadPage() {
  const { slug } = useParams()

  /**
   * The event, as the join step left it.
   *
   * `POST /api/join` is the only endpoint that answers with a `PublicEventDto` — there
   * is deliberately no readable "event by slug" — so this screen cannot fetch the
   * event name or the host's caption setting for itself.
   */
  const session = useMemo(() => (slug === undefined ? null : readGuestSession(slug)), [slug])

  if (slug === undefined || session === null) return <NotJoined />

  return (
    <UploadScreen
      slug={slug}
      event={session.event}
      displayName={session.displayName}
      privacyNotice={session.privacyNotice}
    />
  )
}

/**
 * The host removed this guest. Nothing is offered to send, and the one thing that stays is the
 * right to take back what they sent (roadmap §5.2): the same button, the same confirmation.
 */
function Revoked({
  eventName,
  erasure,
}: {
  readonly eventName: string
  readonly erasure: ReturnType<typeof useEraseEverything>
}) {
  const t = useTranslations()

  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        <h1 className={styles['title']}>{eventName}</h1>
        <Notice tone="warning" variant="boxed" role="status">
          <strong>{t.upload.revokedTitle}</strong> {t.upload.revokedBody}
        </Notice>
      </header>
      <EraseEverything state={erasure} />
    </div>
  )
}

/** After "delete everything I sent": said once, with the way back in if the guest wants it. */
function Erased() {
  const t = useTranslations()

  return (
    <EmptyState
      as="h1"
      title={t.upload.eraseDoneTitle}
      description={t.upload.eraseDone}
      action={
        <Link className={styles['rejoin']} to="/join">
          {t.upload.notJoinedAction}
        </Link>
      }
    />
  )
}

/** Reached by a bookmark, or after the tab was closed and reopened. */
function NotJoined() {
  const t = useTranslations()
  const { pathname } = useLocation()

  return (
    <EmptyState
      as="h1"
      title={t.upload.notJoinedTitle}
      description={`${t.upload.notJoinedHint} ${t.upload.eraseLostAccess}`}
      action={
        // Where the guest was heading, so the code entry returns here.
        <Link className={styles['rejoin']} to="/join" state={{ from: pathname }}>
          {t.upload.notJoinedAction}
        </Link>
      }
    />
  )
}

interface UploadScreenProps {
  readonly slug: string
  readonly event: PublicEventDto
  readonly displayName: string | null
  /** What the join (or the last read) said about the privacy notice. See the session. */
  readonly privacyNotice: PrivacyNoticeState | null
}

function UploadScreen({ slug, event, displayName, privacyNotice }: UploadScreenProps) {
  const t = useTranslations()
  const navigate = useNavigate()
  const mine = useMyPhotos(slug)
  /**
   * The guestbook (spec 01): the guest's own messages and whether a new one would be taken. Read
   * only when the join said the host switched it on, and hidden on any refusal to answer.
   */
  const messages = useMyMessages(slug, event.allowGuestbook === true)
  const writer = useGuestbook(slug, messages.refresh)
  /** "Delete everything I sent" (roadmap §5.2): its request, and what the device forgets after. */
  const erasure = useEraseEverything(slug)
  /**
   * The privacy notice (roadmap §5.1): what happens to a photo, read once per device
   * before the first one is sent, and again if the host changes what it says.
   *
   * It gates the controls that pick and send a **new** photo, and nothing else. The
   * header, "Vos envois" and the install offer render whatever it says, so a guest who
   * opened the page to look is never stopped by it; and photos already chosen — the
   * queue with its retry, the outbox with its "send now" — keep their way to the server,
   * because they were chosen under the notice the guest had read, and holding them is
   * how a queued photo expires on the phone for a change the host made.
   */
  const notice = usePrivacyNotice(slug, privacyNotice)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const publication = notice.state?.notice.publication ?? null
  /**
   * The host's prompts, and the one the next send is filed under (roadmap §2.1).
   *
   * Empty for most events, in which case nothing below renders and this screen is the
   * screen it was.
   */
  const missions = useMissions(slug)
  const [caption, setCaption] = useState('')

  /**
   * The two halves of one promise.
   *
   * `useUploadQueue` owns what is being sent right now; `useOutbox` owns what the
   * device is holding until it can be. They meet in exactly two places — the queue
   * hands a photo over when the network refuses it, and `settle` marks the rows a
   * drain has since delivered — which is what stops one photo appearing twice on this
   * screen under two different names.
   *
   * The indirection through a ref is not decoration: each hook needs something the
   * other produces, and React has no ordering that satisfies both directly. The ref is
   * written in an effect rather than during render, so a render that is thrown away
   * cannot leave the outbox pointing at a queue that was never committed.
   */
  const settleRef = useRef<((report: DrainReport) => void) | null>(null)
  // Lifted out of the object so the dependency below names the stable function rather
  // than the state container it hangs off, which changes on every fetch.
  const refreshMine = mine.refresh
  const refreshMissions = missions.refresh

  /**
   * What a settled batch changes: the guest's own list, and their checklist.
   *
   * The checklist has to be re-read from the server rather than ticked here. Whether a
   * prompt is done is `isDoneForGuest`'s answer over **published** photographs, and an
   * upload lands `pending` on a moderated event — so a client that ticked the row on
   * send would tell a guest their mission was answered before anybody had approved it,
   * which is the one thing this feature must not do.
   */
  const onBatchSettled = useCallback(() => {
    refreshMine()
    refreshMissions()
  }, [refreshMine, refreshMissions])

  const onDrained = useCallback(
    (report: DrainReport) => {
      settleRef.current?.(report)
      // Only a real arrival is worth a refetch. A drain that only dropped an expired
      // photo has changed nothing the server would report.
      if (report.sent.length > 0) onBatchSettled()
    },
    [onBatchSettled],
  )

  /**
   * A batch that left the phone for good has used its caption up (INV-5): kept, it would be
   * printed under the ten photos the guest takes next, and nobody rereads it at the second one.
   * The prompt stays (several photos for one challenge is a use, and the line under "Envoyer"
   * says which one it is). A batch with a failure keeps everything, because the retry sends the
   * same caption again and the guest has to be able to see it. "Left for good" includes a photo
   * the outbox now holds: its caption went into the entry, so the field has nothing left to do.
   *
   * Only if the field still says what the batch was sent with: it stays editable during the send,
   * and a guest who has started the next caption must not see it wiped under their thumb.
   */
  const onQueueSettled = useCallback(
    (outcome: SettledOutcome) => {
      onBatchSettled()
      if (outcome.allSent)
        setCaption((current) => ((current.trim() || null) === outcome.caption ? '' : current))
    },
    [onBatchSettled],
  )

  const outbox = useOutbox({ slug, onDrained })
  const queue = useUploadQueue({ slug, outbox, onSettled: onQueueSettled })
  /** Whether "you can close this page" is true on this phone: it is not on an iPhone (INV-8). */
  const canCloseSafely = useBackgroundSync()

  /**
   * The video path, and it is deliberately not part of the queue above.
   *
   * A clip is one file, refused for reasons a photograph is not, and it goes on being
   * worked on for a minute after the bytes have landed — so it has its own hook, its own
   * states and, crucially, **no outbox**: the bytes are never stored on the device. See
   * `useClipUpload` and `web/src/lib/offline/outboxPolicy.ts`.
   *
   * `onArrived` is what closes the loop: a finished transcode is a new row in "Vos
   * envois", and until it is refetched the guest has a success message and an empty list
   * above it.
   */
  const clip = useClipUpload({
    slug,
    limits: { maxBytes: event.maxClipBytes, maxSeconds: event.maxClipSeconds },
    onArrived: refreshMine,
    ...(publication === null ? {} : { publication }),
  })

  useEffect(() => {
    settleRef.current = queue.settle
  }, [queue.settle])

  /**
   * Offered only once a photo has actually arrived.
   *
   * `mine.photos` is the server's answer rather than this session's queue, so a guest
   * returning to a gallery they uploaded to yesterday is offered it too — and a guest
   * who has sent nothing is never interrupted before they do.
   */
  const install = useInstallPrompt({ eligible: mine.photos.length > 0 })

  /**
   * Where focus goes when the notice and the picker trade places.
   *
   * After "J'ai compris" the button the guest pressed unmounts under their finger, and
   * focus would fall to <body> — the top of the page, in the middle of a first upload.
   * It is handed to "Ajouter des photos" instead, the control the guest acknowledged the
   * notice in order to reach. The other direction — a changed notice taking the picker's
   * place while the page is open — takes focus only if it was lost, so a guest reading
   * their own photos is not pulled away from them.
   *
   * A layout effect, so focus moves in the same commit that swaps the two. A passive one
   * runs later, and until it does focus sits on <body>: ring 5 caught that window as a
   * test that failed on one CI run and passed on the next, and the negative case beside
   * it could pass for the wrong reason inside the same window.
   */
  const libraryInput = useRef<HTMLInputElement | null>(null)
  const noticeCard = useRef<HTMLElement | null>(null)
  const gated = notice.mustAcknowledge
  const wasGated = useRef(gated)
  useLayoutEffect(() => {
    if (wasGated.current === gated) return
    wasGated.current = gated
    const lost = document.activeElement === null || document.activeElement === document.body
    if (!gated) libraryInput.current?.focus()
    else if (lost) noticeCard.current?.focus({ preventScroll: true })
  }, [gated])

  /**
   * Whether the pane below is too tall to stay pinned to the bottom of the screen. It grows
   * with every photo the guest picks, so this is measured rather than assumed: see the hook,
   * and `.composer[data-oversized]` in the stylesheet for what it changes.
   */
  const composer = useRef<HTMLDivElement | null>(null)
  const oversized = useOversizedPane(composer)

  /**
   * "Voir mes envois", on the summary line of the queue: the guest's photos have moved to the
   * list above, and this is the way there. The page owns it because it is the page that holds
   * both ends (the pane and the list).
   *
   * Scrolls to the heading (smooth, unless the guest asked for less motion), moves focus to it —
   * the only place focus is moved for this feature, and only because the guest pressed the button
   * — and flashes the photos of the batch that is on screen, by the ids the server answered with.
   */
  const mineHeading = useRef<HTMLHeadingElement | null>(null)
  const [highlighted, setHighlighted] = useState<readonly string[]>([])
  const batchPhotoIds = queue.batch.photoIds
  const viewMine = useCallback(() => {
    const heading = mineHeading.current
    if (heading === null) return
    const calm = prefersReducedMotion()
    heading.focus({ preventScroll: true })
    heading.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
    // No flash for a guest who asked for no motion: the list is where they were taken.
    setHighlighted(calm ? [] : batchPhotoIds)
  }, [batchPhotoIds])
  const endHighlight = useCallback(() => setHighlighted([]), [])

  const installSlot = useRef<HTMLDivElement | null>(null)
  const dismissInstall = () => {
    install.dismiss()
    installSlot.current?.focus()
  }

  /**
   * The server does not know this guest any more (no cookie, or one past its 36 hours).
   *
   * What the device remembered of the event is dropped with it, or the installed app would
   * reopen this very screen on every launch: the code entry is the only way forward.
   */
  const signedOut = mine.signedOut
  useEffect(() => {
    if (signedOut) forgetGuestSession(slug)
  }, [signedOut, slug])
  // Before the signed-out branch: the erased guest is signed out too, and the sentence for that
  // is not "scan again" but "it is done".
  if (erasure.done) return <Erased />
  if (signedOut) return <NotJoined />
  if (mine.revoked) return <Revoked eventName={event.name} erasure={erasure} />

  const sending = queue.sending || outbox.draining || clip.stage === 'uploading'
  const trimmedCaption = caption.trim()
  /**
   * Whether the guest has anything on the server to list or take back (INV-12).
   *
   * A first visit used to read a card of an empty list and, under it, "Supprimer tout ce que j'ai
   * envoyé" with nothing to delete: a permanent-deletion button before the first photo, and two
   * empty states pushing the picker down. Neither is rendered until there is something in them. A
   * failed read still shows the card, because its retry is the only way back to the list.
   */
  const hasPhotos = mine.photos.length > 0
  /** What the closed evening thanks the guest for: not the photos the host refused. */
  const thanked = mine.photos.filter((photo) => photo.status !== 'rejected').length
  const showMine = !mine.unavailable && (hasPhotos || mine.error !== null)
  const hasMessages = !messages.unavailable && messages.items.length > 0
  /** Where a guest who may write is offered the card (spec 01): never behind the notice. */
  const bookOpen = !messages.unavailable && messages.accepting && !mine.unavailable

  /** The words of the chosen prompt, for the line under the send button. */
  const selectedPrompt =
    missions.missions.find((mission) => mission.id === missions.selected)?.prompt ?? null

  return (
    /**
     * The host's event rather than the product (roadmap 2.2).
     *
     * The accent only: a phone has no photo frames to style, and a font pairing is a
     * choice about `--text-display` on a projector, while this screen's largest type is
     * `--text-lg`. The pairings cost nothing because they are built from system faces
     * (DESIGN-SYSTEM.md §12); had they been bundled instead, this is the surface — a
     * phone on venue Wi-Fi — that would have paid for a face too small here to show off.
     *
     * Applied on the element rather than on `:root`, and read out of the session the join
     * already wrote, so the first frame is painted without waiting on a request: a
     * `sessionStorage` read is synchronous.
     *
     * **Then the server's answer, because the join's copy is a snapshot.** A host who changes
     * the colour after a guest joined has not changed what that guest's session holds, and this
     * screen cannot refetch the event. The guest's own-photos read — which the screen makes
     * anyway — carries the current theme, so it takes over the moment it answers: one repaint,
     * only for a guest whose theme actually changed, and never a request added to the first
     * screen. While that read is in the air, or if it fails, the stored theme stands. The same
     * answer is written back to the session (see `useMyPhotos`), so the next visit's first frame
     * is already the new one.
     */
    <div {...themeSurfaceProps(mine.theme ?? event.theme, 'guest')} className={styles['page']}>
      <RootGroundHue theme={mine.theme ?? event.theme} />
      <header className={styles['header']}>
        {/* The event name, on the screen the guest actually uploads from. 1.0 read the
            event from a query parameter the QR page never set, so every photo went to
            the default event and nothing on the page would have shown it. */}
        <h1 className={styles['title']}>{event.name}</h1>
        {/* From the notice rather than written once: "after approval" is false on an
            event that publishes on arrival, and the notice below would say so. */}
        <p className={styles['intro']}>
          {publication === 'immediate' ? t.upload.introImmediate : t.upload.intro}
        </p>
        <p className={styles['signature']}>
          {displayName === null ? t.upload.signedAnonymous : t.upload.signedAs(displayName)}
        </p>
        {/* What the room is looking at, on a page of its own: a list that grows all evening
            would push the controls below off the bottom of the phone. */}
        {/* Not once the server has stopped serving the gallery: the link would lead to a
            page that can only say so. A closed or archived evening keeps it, because a
            closed one still has its wall and an archived one's feed explains itself. */}
        {mine.unavailable ? null : (
          <div>
            {/* Still a link while photos are on their way (INV-1), and still focusable, so a keyboard or
                screen-reader guest who was on it is not dropped to the top of the page when the send
                starts. It opens a page of its own in this tab, and leaving unmounts this screen, which
                cancels the sends in flight: so pressing it does nothing until they are over (the same
                rule as the button below), and `aria-disabled` says so to the technologies that read
                it. The reason is said in the status line under it, not by swapping the link for text. */}
            <Link
              className={cx(styles['feedLink'], sending && styles['feedLinkWaiting'])}
              to={`/e/${slug}/photos`}
              aria-disabled={sending ? 'true' : undefined}
              onClick={(event) => {
                if (sending) event.preventDefault()
              }}
            >
              {t.feed.link}
            </Link>
            {/* Rendered even when empty: a live region has to exist before its content changes, or the
                first announcement is swallowed. The count moves as each photo arrives. */}
            <span role="status" className={styles['leaveStatus']}>
              {!sending
                ? null
                : queue.sending && queue.items.length > 0
                  ? t.upload.leaveWaitCount(queue.batch.arrived, queue.items.length)
                  : t.upload.leaveWait}
            </span>
          </div>
        )}
        {/* The way out of an event that is not the guest's (navigation pass, A1/A10). */}
        <Button
          variant="ghost"
          size="sm"
          className={styles['noticeLink']}
          // Not while photos are on their way: leaving unmounts this screen, which cancels every
          // send in flight (the reason `NewTabLink` exists), and a thumb brushes a header link.
          disabled={sending}
          onClick={() => {
            forgetGuestSession(slug)
            navigate('/join')
          }}
        >
          {t.join.notYourEvening}
        </Button>
        {/* The way back to the notice once it has been read. Not rendered while the card
            is on screen, where it would open the same text a second time. */}
        {notice.state === null || gated ? null : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className={styles['noticeLink']}
              onClick={() => setNoticeOpen(true)}
            >
              {t.upload.noticeLink}
            </Button>
            <PrivacyNoticeDialog
              notice={notice.state.notice}
              open={noticeOpen}
              onClose={() => setNoticeOpen(false)}
              // The way to take everything back for a guest whose list is not on the page yet
              // (INV-12): the notice promises it, so it is offered where the notice is read.
              extra={
                mine.unavailable || hasPhotos || hasMessages ? undefined : (
                  <EraseEverything state={erasure} guestbook={event.allowGuestbook === true} />
                )
              }
            />
          </>
        )}
      </header>

      {showMine ? (
        <MyPhotos
          photos={mine.photos}
          loading={mine.loading}
          error={mine.error}
          onRetry={mine.refresh}
          onDelete={mine.remove}
          arrival={mine.arrival}
          headingRef={mineHeading}
          highlighted={highlighted}
          onHighlightEnd={endHighlight}
        />
      ) : null}
      {hasMessages ? (
        <MyMessages
          items={messages.items}
          onWall={messages.onWall}
          error={messages.error}
          onDelete={messages.remove}
        />
      ) : null}
      {(showMine && hasPhotos) || hasMessages ? (
        <EraseEverything state={erasure} guestbook={event.allowGuestbook === true} />
      ) : null}

      {/* Below the proof that it worked, above the controls: a reward for having sent
          something, never a gate in front of sending it.

          The wrapper outlives the card and takes focus when the card is dismissed.
          Without it the dismiss button unmounts under the guest's own finger and focus
          falls to <body>, which drops a keyboard or screen-reader guest back to the top
          of the page in the middle of sending photos. The page owns this rather than the
          card, because the page is what knows where the reading position should land. */}
      <div ref={installSlot} tabIndex={-1} className={styles['installSlot']}>
        <InstallCard
          offer={install.offer}
          onInstall={() => void install.install()}
          onDismiss={dismissInstall}
        />
      </div>

      {/* Everything to press, kept together at the bottom of the screen: a control in
          the top half of a phone needs a second hand, and the guest is holding a
          drink with the other one. */}
      <div
        ref={composer}
        data-testid="upload-composer"
        className={styles['composer']}
        data-gated={gated ? '' : undefined}
        data-oversized={oversized ? '' : undefined}
      >
        {/* Above the queue: it is the answer to "did my photos go?", and a guest who
            reads it stops pressing "Envoyer" again. */}
        {/* Not once the evening is over: "will be sent" would be a promise the box refuses. */}
        {mine.acceptingUploads && !mine.unavailable ? (
          <OfflineNotice
            waiting={outbox.waiting}
            draining={outbox.draining}
            onSendNow={outbox.drain}
            canCloseSafely={canCloseSafely}
          />
        ) : null}
        <UploadQueue
          items={queue.items}
          batch={queue.batch}
          onRetry={queue.retry}
          onRemove={queue.remove}
          onDismiss={queue.clearSettled}
          // Not once the server has stopped serving the gallery: there is no list to go to.
          onViewMine={showMine ? viewMine : undefined}
        />
        {/*
          The notice, in the place the picker will be, until this device has read the one
          in force. Everything below it picks or sends a new photo, so all of it waits;
          the queue above does not, because what it holds was already chosen.
        */}
        {mine.unavailable ? (
          // A suspended account, or an event the server no longer knows: it answers `404` before it
          // would even say the evening is over, and every send would fail. No form, no queue of
          // false hope.
          <>
            <Notice tone="warning" variant="boxed" role="status">
              {t.upload.galleryUnavailable}
            </Notice>
            {/* The same `404` is what the server says to a phone whose cookie names another
                event (this one was joined before a later one), and it cannot tell the two
                apart on purpose: so the way back to the code is offered here as well. */}
            <Link className={styles['rejoin']} to="/join" state={{ from: `/e/${slug}/upload` }}>
              {t.upload.galleryUnavailableAction}
            </Link>
          </>
        ) : !mine.acceptingUploads ? (
          // The host closed the evening (or archived it, or its account is suspended): there is
          // nothing left to send, so none of the controls is offered. A quiet thank-you and not a
          // warning (INV-4): nothing went wrong, the evening ended, and the guest's next question is
          // where the photos will be. The count is the list already on screen, so no request is added.
          // What the guest sent stays listed above.
          <>
            <section className={styles['ended']} role="status" data-testid="evening-ended">
              <h2 className={styles['endedTitle']}>{t.upload.endedTitle}</h2>
              <p className={styles['endedBody']}>
                {thanked > 0 ? t.upload.endedThanks(thanked) : t.upload.endedThanksNone}
              </p>
              <p className={styles['endedBody']}>{t.upload.endedAlbum}</p>
            </section>
            {/* A closed evening still takes a written word for a while (spec 01, Q4): the server's
              `accepting` says so, and the notice still comes first. */}
            {bookOpen ? (
              gated && notice.state !== null ? (
                <PrivacyNoticeCard
                  ref={noticeCard}
                  state={notice.state}
                  onAcknowledge={() => {
                    setNoticeOpen(false)
                    notice.acknowledge()
                  }}
                />
              ) : (
                <GuestbookCard
                  writer={writer}
                  maxLength={event.guestbookMaxLength}
                  publication={publication ?? 'afterReview'}
                />
              )
            ) : null}
          </>
        ) : notice.state !== null && gated ? (
          <PrivacyNoticeCard
            ref={noticeCard}
            state={notice.state}
            onAcknowledge={() => {
              // The dialog may have been open when a changed notice took the picker's
              // place, and it was only unmounted, not closed: without this it would pop
              // back up over the picker the moment the card went, and take the focus
              // meant for "Ajouter des photos" with it.
              setNoticeOpen(false)
              notice.acknowledge()
            }}
          />
        ) : (
          <>
            {/*
              Above the picker, because the order is the point: the checklist is what tells a
              guest there is something to photograph, and a list of prompts *after* the button
              that opens the camera arrives one decision too late. Inside the composer, because
              everything a thumb presses lives in the bottom half of the screen.

              Nothing at all for the majority of events, which set no prompts.
            */}
            <MissionChecklist
              missions={missions.missions}
              selected={missions.selected}
              onToggle={missions.toggle}
            />
            {bookOpen ? (
              <GuestbookCard
                writer={writer}
                maxLength={event.guestbookMaxLength}
                publication={publication ?? 'afterReview'}
              />
            ) : null}
            <PhotoPicker onPick={queue.add} libraryRef={libraryInput} />
            {/* The caption and the video, as labelled buttons that unfold in place: shown in full
                they took half of a phone before a photo was chosen. The host's settings, from the
                event the join step returned, decide which exist at all. */}
            <ComposerOptions
              captions={event.allowCaptions}
              caption={caption}
              onCaptionChange={setCaption}
              clips={event.allowClips}
              clip={clip}
              limits={{ maxBytes: event.maxClipBytes, maxSeconds: event.maxClipSeconds }}
            />
            <Button
              variant="primary"
              size="lg"
              block
              loading={queue.sending}
              disabled={queue.sendableCount === 0}
              onClick={() =>
                queue.send(trimmedCaption.length === 0 ? null : trimmedCaption, missions.selected)
              }
            >
              {queue.sendableCount === 0 ? t.upload.send : t.upload.sendCount(queue.sendableCount)}
            </Button>
            {/*
              Said once, under the button, rather than on every row of the checklist: the
              guest has just chosen a prompt and is about to send, and this is the moment a
              confirmation is worth its line. `aria-live` because the selection is made by a
              tap somewhere above it.
            */}
            {selectedPrompt === null ? null : (
              <p className={styles['missionNotice']} aria-live="polite">
                {t.upload.missionFor(selectedPrompt)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
