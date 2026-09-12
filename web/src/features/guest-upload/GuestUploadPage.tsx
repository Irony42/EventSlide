import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { readGuestSession } from '../../lib/guestSession'
import { fr } from '../../lib/i18n/fr'
import { CaptionField } from './components/CaptionField'
import { MyPhotos } from './components/MyPhotos'
import { PhotoPicker } from './components/PhotoPicker'
import { UploadQueue } from './components/UploadQueue'
import { useMyPhotos } from './hooks/useMyPhotos'
import { useUploadQueue } from './hooks/useUploadQueue'
import type { PublicEventDto } from '../../lib/api/dto'
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
  const queue = useUploadQueue({ slug, onSettled: mine.refresh })
  const [caption, setCaption] = useState('')

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

      {/* Everything to press, kept together at the bottom of the screen: a control in
          the top half of a phone needs a second hand, and the guest is holding a
          drink with the other one. */}
      <div className={styles['composer']}>
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
