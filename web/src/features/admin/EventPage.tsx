import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { useToast } from '../../design-system/components/useToast'
import { fr } from '../../lib/i18n/fr'
import { LoadFailure, Pending } from './components/AsyncState'
import { EventQrCard } from './components/EventQrCard'
import { EventStatusBadge } from './components/EventStatusBadge'
import { StorageMeter } from './components/StorageMeter'
import { GuestListPanel } from './GuestListPanel'
import { ModeratorsPanel } from './ModeratorsPanel'
import { PurgeEventDialog } from './PurgeEventDialog'
import { allowsModeration, isMutable, lifecycleActions, servesWall } from './eventLifecycle'
import { useAlbumUrl, useEvent } from './hooks/useEventData'
import { usePurgeEvent, useRotateJoinCode, useStatusChange } from './hooks/useEventActions'
import styles from './EventPage.module.css'
import type { EventStatus } from '../../lib/api/dto'

/** Surface: the host's laptop. The screen they come back to during the event. */
export function EventPage() {
  const { slug = '' } = useParams()
  const { data: event, loading, error, reload, replace } = useEvent(slug)
  const statusChange = useStatusChange()
  const rotate = useRotateJoinCode()
  const purge = usePurgeEvent()
  const toast = useToast()
  const navigate = useNavigate()
  const albumUrl = useAlbumUrl(slug)

  const [rotating, setRotating] = useState(false)
  const [purging, setPurging] = useState(false)

  const changeStatus = (to: EventStatus) => {
    void statusChange.run(to, slug, to).then((result) => {
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      // The answer is the whole event, so the screen updates from what the server
      // decided rather than from what the client hoped.
      replace(result.value)
      toast.show(fr.admin.statusSaved, { tone: 'success' })
    })
  }

  const confirmRotate = () => {
    void rotate.run('rotate', slug).then((result) => {
      setRotating(false)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      replace(result.value)
      toast.show(fr.admin.codeRotated, { tone: 'success' })
    })
  }

  const confirmPurge = () => {
    if (event === null) return
    const name = event.name
    void purge.run('purge', slug).then((result) => {
      if (!result.ok) {
        setPurging(false)
        toast.show(result.message, { tone: 'danger' })
        return
      }
      toast.show(fr.admin.purged(name), { tone: 'success' })
      navigate('/admin', { replace: true })
    })
  }

  if (loading) return <Pending label={fr.admin.eventLoading} />
  if (error !== null) return <LoadFailure message={error} onRetry={reload} as="h1" />
  if (event === null) return <LoadFailure message={fr.errors.unknown} onRetry={reload} as="h1" />

  const isOwner = event.role === 'owner'

  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        <h1 className={styles['title']}>{event.name}</h1>
        <div className={styles['facts']}>
          <EventStatusBadge status={event.status} />
          <span>{fr.admin.photos(event.photoCount)}</span>
          <span>{fr.admin.guests(event.guestCount)}</span>
          {event.pendingCount > 0 ? (
            <Badge tone="warning">{fr.moderation.pending(event.pendingCount)}</Badge>
          ) : null}
        </div>
      </header>

      <div className={styles['columns']}>
        <div className={`${styles['column']} ${styles['screenOnly']}`}>
          <Card as="h2" title={fr.admin.joinCode} subtitle={fr.admin.joinCodeHint}>
            <p className={styles['joinCode']}>{event.joinCode}</p>
            <p className={styles['joinUrl']}>
              <span>{fr.admin.joinLink}</span>{' '}
              {/* The server built this URL. The client never assembles a join link. */}
              <a href={event.joinUrl}>{event.joinUrl}</a>
            </p>
            {isOwner && isMutable(event.status) ? (
              <div className={styles['actions']}>
                <Button
                  loading={rotate.busy}
                  onClick={() => setRotating(true)}
                  aria-haspopup="dialog"
                >
                  {fr.admin.rotateJoinCode}
                </Button>
              </div>
            ) : null}
          </Card>

          <Card as="h2" title={fr.admin.eventControls}>
            <div className={styles['links']}>
              {servesWall(event.status) ? (
                <Link className={styles['link']} to={`/e/${event.slug}/display`}>
                  {fr.admin.openWall}
                </Link>
              ) : null}
              {allowsModeration(event.status) ? (
                <Link className={styles['link']} to={`/admin/events/${event.slug}/moderation`}>
                  {fr.admin.openModeration}
                </Link>
              ) : null}
              <Link className={styles['link']} to={`/admin/events/${event.slug}/settings`}>
                {fr.admin.settings}
              </Link>
              {/*
                A plain link, not a fetch: the ZIP is streamed and can be hundreds of
                megabytes, so the browser's own download manager is the right tool —
                buffering it through JavaScript is how a laptop runs out of memory
                halfway through an album.
              */}
              <a className={styles['link']} href={albumUrl} download>
                {fr.admin.download}
              </a>
            </div>
            <StorageMeter usedBytes={event.usedBytes} quotaBytes={event.quotaBytes} />
            {isOwner ? (
              <div className={styles['actions']}>
                {lifecycleActions(event.status).map((action) => (
                  <Button
                    key={action.to}
                    variant={action.primary ? 'primary' : 'secondary'}
                    loading={statusChange.pending === action.to}
                    disabled={statusChange.busy}
                    onClick={() => changeStatus(action.to)}
                  >
                    {action.label}
                  </Button>
                ))}
                {lifecycleActions(event.status).length === 0 ? (
                  <p className={styles['archived']}>{fr.admin.settingsReadOnly}</p>
                ) : null}
              </div>
            ) : null}
          </Card>
        </div>

        <div className={styles['column']}>
          <EventQrCard eventName={event.name} joinCode={event.joinCode} joinUrl={event.joinUrl} />
        </div>
      </div>

      <div className={`${styles['column']} ${styles['screenOnly']}`}>
        <GuestListPanel slug={event.slug} canRevoke={allowsModeration(event.status)} />
        {/* Owner-only: every moderator endpoint requires it, so a moderator is not
            shown a panel whose requests would all come back 403. */}
        {isOwner ? <ModeratorsPanel slug={event.slug} /> : null}
        {isOwner ? (
          <div className={styles['actions']}>
            <Button variant="danger" onClick={() => setPurging(true)} aria-haspopup="dialog">
              {fr.admin.purge}
            </Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={rotating}
        title={fr.admin.rotateJoinCodeTitle}
        // Says the thing a host is actually afraid of: that changing the code throws
        // out the guests who already joined. It does not.
        description={fr.admin.rotateJoinCodeHint}
        confirmLabel={fr.admin.rotateJoinCode}
        busy={rotate.busy}
        onConfirm={confirmRotate}
        onCancel={() => setRotating(false)}
      />

      <PurgeEventDialog
        open={purging}
        slug={event.slug}
        eventName={event.name}
        busy={purge.busy}
        onConfirm={confirmPurge}
        onCancel={() => setPurging(false)}
      />
    </div>
  )
}
