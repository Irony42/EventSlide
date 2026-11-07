import type { PrivacyNoticeState, PublicEventDto } from '../../../lib/api/dto'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { forgetGuestSession } from '../../../lib/guestSession'
import { prefersReducedMotion } from '../../../lib/prefersReducedMotion'
import { useBackgroundSync } from './useBackgroundSync'
import { useClipUpload } from './useClipUpload'
import { useEraseEverything } from './useEraseEverything'
import { useGuestbook } from './useGuestbook'
import { useMyMessages } from './useMyMessages'
import { useInstallPrompt } from './useInstallPrompt'
import { useMissions } from './useMissions'
import { useMyPhotos } from './useMyPhotos'
import { useOutbox } from './useOutbox'
import { useOversizedPane } from './useOversizedPane'
import { usePrivacyNotice } from './usePrivacyNotice'
import { useUploadQueue, type SettledOutcome } from './useUploadQueue'
import type { DrainReport } from '../../../lib/offline/drainOutbox'

export interface UploadScreenInput {
  readonly slug: string
  readonly event: PublicEventDto
  /** What the join (or the last read) said about the privacy notice. See the session. */
  readonly privacyNotice: PrivacyNoticeState | null
}

/**
 * Everything the upload screen wires: its eight hooks, the focus choreography of the pane and
 * the notice, the folded bar and the participate state. `UploadScreen` only decides which
 * screen to show and draws it. Every hook runs on every render, so the early returns of the
 * screen stay below this call.
 */
export function useUploadScreen({ slug, event, privacyNotice }: UploadScreenInput) {
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
  // "Je participe au défi" (spec 18): checked for every batch, so playing costs no tap.
  const [participate, setParticipate] = useState(true)
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
   * The pane folded into a bar (spec 19, mockup B), and where the focus goes either way.
   *
   * Only page state, and only the view: the selection lives in `queue` above and a folded pane is
   * the same pane with its content `hidden`, so nothing is unmounted and nothing is lost. The
   * guest folds it with "Réduire" and only that: scrolling never folds it (Pierre's call, the pane
   * is the guest's to put away), and only a tap on the bar opens it again. The button moves the
   * focus to the bar, and opening moves it to the first useful action, in the layout effect
   * below, once the content is displayed.
   */
  const paneContent = useId()
  const [folded, setFolded] = useState(false)
  const openButton = useRef<HTMLButtonElement | null>(null)
  const sendButton = useRef<HTMLButtonElement | null>(null)
  const focusAfterToggle = useRef(false)
  const canFold = mine.acceptingUploads && !mine.unavailable && !gated
  const isFolded = folded && canFold
  const foldPane = useCallback(() => {
    focusAfterToggle.current = true
    setFolded(true)
  }, [])
  const openPane = useCallback(() => {
    focusAfterToggle.current = true
    setFolded(false)
  }, [])
  useLayoutEffect(() => {
    if (!focusAfterToggle.current) return
    focusAfterToggle.current = false
    if (isFolded) openButton.current?.focus({ preventScroll: true })
    else (sendButton.current?.disabled === false ? sendButton : libraryInput).current?.focus()
  }, [isFolded, libraryInput])

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

  return {
    mine,
    messages,
    writer,
    erasure,
    notice,
    publication,
    missions,
    outbox,
    queue,
    canCloseSafely,
    clip,
    install,
    libraryInput,
    noticeCard,
    gated,
    composer,
    oversized,
    paneContent,
    openButton,
    sendButton,
    canFold,
    isFolded,
    foldPane,
    openPane,
    mineHeading,
    viewMine,
    endHighlight,
    installSlot,
    dismissInstall,
    signedOut,
    noticeOpen,
    setNoticeOpen,
    participate,
    setParticipate,
    caption,
    setCaption,
    highlighted,
  }
}
