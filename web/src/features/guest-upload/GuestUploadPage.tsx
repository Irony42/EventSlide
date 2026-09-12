import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { readGuestSession } from '../../lib/guestSession'
import { fr } from '../../lib/i18n/fr'
import { CaptionField } from './components/CaptionField'
import { InstallCard } from './components/InstallCard'
import { MyPhotos } from './components/MyPhotos'
import { OfflineNotice } from './components/OfflineNotice'
import { PhotoPicker } from './components/PhotoPicker'
import { UploadQueue } from './components/UploadQueue'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { useMyPhotos } from './hooks/useMyPhotos'
import { useOutbox } from './hooks/useOutbox'
import { useUploadQueue } from './hooks/useUploadQueue'
import type { PublicEventDto } from '../../lib/api/dto'
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

  return <UploadScreen slug={slug} event={session.event} displayName={session.displayName} />
}

/** Reached by a bookmark, or after the tab was closed and reopened. */
function NotJoined() {
  return (
    <EmptyState
      as="h1"
      title={fr.upload.notJoinedTitle}
      description={fr.upload.notJoinedHint}
      action={
        <Link className={styles['rejoin']} to="/join">
          {fr.upload.notJoinedAction}
        </Link>
      }
    />
  )
}

interface UploadScreenProps {
  readonly slug: string
  readonly event: PublicEventDto
  readonly displayName: string | null
}

function UploadScreen({ slug, event, displayName }: UploadScreenProps) {
  const mine = useMyPhotos(slug)
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

  const onDrained = useCallback(
    (report: DrainReport) => {
      settleRef.current?.(report)
      // Only a real arrival is worth a refetch. A drain that only dropped an expired
      // photo has changed nothing the server would report.
      if (report.sent.length > 0) refreshMine()
    },
    [refreshMine],
  )

  const outbox = useOutbox({ slug, onDrained })
  const queue = useUploadQueue({ slug, outbox, onSettled: mine.refresh })

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

  const installSlot = useRef<HTMLDivElement | null>(null)
  const dismissInstall = () => {
    install.dismiss()
    installSlot.current?.focus()
  }

  const trimmedCaption = caption.trim()

  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        {/* The event name, on the screen the guest actually uploads from. 1.0 read the
            event from a query parameter the QR page never set, so every photo went to
            the default event and nothing on the page would have shown it. */}
        <h1 className={styles['title']}>{event.name}</h1>
        <p className={styles['intro']}>{fr.upload.intro}</p>
        <p className={styles['signature']}>
          {displayName === null ? fr.upload.signedAnonymous : fr.upload.signedAs(displayName)}
        </p>
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
      <div className={styles['composer']}>
        {/* Above the queue: it is the answer to "did my photos go?", and a guest who
            reads it stops pressing "Envoyer" again. */}
        <OfflineNotice
          waiting={outbox.waiting}
          draining={outbox.draining}
          onSendNow={outbox.drain}
        />
        <UploadQueue items={queue.items} onRetry={queue.retry} onRemove={queue.remove} />
        <PhotoPicker onPick={queue.add} />
        {/* The host's setting, from the event the join step returned. */}
        {event.allowCaptions ? <CaptionField value={caption} onChange={setCaption} /> : null}
        <Button
          variant="primary"
          size="lg"
          block
          loading={queue.sending}
          disabled={queue.sendableCount === 0}
          onClick={() => queue.send(trimmedCaption.length === 0 ? null : trimmedCaption)}
        >
          {queue.sendableCount === 0 ? fr.upload.send : fr.upload.sendCount(queue.sendableCount)}
        </Button>
      </div>
    </div>
  )
}
