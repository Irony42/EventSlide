import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { themeSurfaceProps } from '../../design-system/eventTheme'
import { readGuestSession } from '../../lib/guestSession'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { CaptionField } from './components/CaptionField'
import { ClipComposer } from './components/ClipComposer'
import { InstallCard } from './components/InstallCard'
import { MissionChecklist } from './components/MissionChecklist'
import { MyPhotos } from './components/MyPhotos'
import { OfflineNotice } from './components/OfflineNotice'
import { PhotoPicker } from './components/PhotoPicker'
import { PrivacyNoticeCard, PrivacyNoticeDialog } from './components/PrivacyNotice'
import { UploadQueue } from './components/UploadQueue'
import { useClipUpload } from './hooks/useClipUpload'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { useMissions } from './hooks/useMissions'
import { useMyPhotos } from './hooks/useMyPhotos'
import { useOutbox } from './hooks/useOutbox'
import { usePrivacyNotice } from './hooks/usePrivacyNotice'
import { useUploadQueue } from './hooks/useUploadQueue'
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

/** Reached by a bookmark, or after the tab was closed and reopened. */
function NotJoined() {
  const t = useTranslations()

  return (
    <EmptyState
      as="h1"
      title={t.upload.notJoinedTitle}
      description={t.upload.notJoinedHint}
      action={
        <Link className={styles['rejoin']} to="/join">
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
  const mine = useMyPhotos(slug)
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

  const outbox = useOutbox({ slug, onDrained })
  const queue = useUploadQueue({ slug, outbox, onSettled: onBatchSettled })

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
   */
  const libraryInput = useRef<HTMLInputElement | null>(null)
  const noticeCard = useRef<HTMLElement | null>(null)
  const gated = notice.mustAcknowledge
  const wasGated = useRef(gated)
  useEffect(() => {
    if (wasGated.current === gated) return
    wasGated.current = gated
    const lost = document.activeElement === null || document.activeElement === document.body
    if (!gated) libraryInput.current?.focus()
    else if (lost) noticeCard.current?.focus({ preventScroll: true })
  }, [gated])

  const installSlot = useRef<HTMLDivElement | null>(null)
  const dismissInstall = () => {
    install.dismiss()
    installSlot.current?.focus()
  }

  const trimmedCaption = caption.trim()

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
     * already wrote, so the first frame is the right colour: a `sessionStorage` read is
     * synchronous, and nothing here waits on a request.
     */
    <div {...themeSurfaceProps(event.theme, 'guest')} className={styles['page']}>
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
            />
          </>
        )}
      </header>

      <MyPhotos
        photos={mine.photos}
        loading={mine.loading}
        error={mine.error}
        onRetry={mine.refresh}
        onDelete={mine.remove}
      />

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
        data-testid="upload-composer"
        className={styles['composer']}
        data-gated={gated ? '' : undefined}
      >
        {/* Above the queue: it is the answer to "did my photos go?", and a guest who
            reads it stops pressing "Envoyer" again. */}
        <OfflineNotice
          waiting={outbox.waiting}
          draining={outbox.draining}
          onSendNow={outbox.drain}
        />
        <UploadQueue items={queue.items} onRetry={queue.retry} onRemove={queue.remove} />
        {/*
          The notice, in the place the picker will be, until this device has read the one
          in force. Everything below it picks or sends a new photo, so all of it waits;
          the queue above does not, because what it holds was already chosen.
        */}
        {notice.state !== null && gated ? (
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
            <PhotoPicker onPick={queue.add} libraryRef={libraryInput} />
            {/* The host's setting, from the event the join step returned. */}
            {event.allowCaptions ? <CaptionField value={caption} onChange={setCaption} /> : null}
            {/*
              Below the caption, because the caption travels with the clip as well — a guest
              who wrote one and then sent a video must not lose it — and above the send
              button, because the video has a send button of its own and two of them side by
              side would be a guess about which one does what.

              Rendered only when the host allowed video. On a gallery created before clips
              shipped this setting reads `false`, and offering the control there would mean a
              `403` after eighty megabytes.
            */}
            {event.allowClips ? (
              <ClipComposer
                clip={clip}
                limits={{ maxBytes: event.maxClipBytes, maxSeconds: event.maxClipSeconds }}
                caption={trimmedCaption.length === 0 ? null : trimmedCaption}
              />
            ) : null}
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
