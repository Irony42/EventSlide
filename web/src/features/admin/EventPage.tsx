import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { useToast } from '../../design-system/components/useToast'
import { cx } from '../../design-system/classNames'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { HostEventsLink } from '../../app/HostEventsLink'
import { useAbout } from '../../app/useAbout'
import { formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from '../../design-system/components/Async'
import { EventActionLinks } from './components/EventActionLinks'
import { EventQrCard } from './components/EventQrCard'
import { EventStatusBadge } from './components/EventStatusBadge'
import { StorageMeter } from './components/StorageMeter'
import { SupportCard } from './components/SupportCard'
import { GuestListPanel } from './GuestListPanel'
import { MissionsPanel } from './MissionsPanel'
import { ModeratorsPanel } from './ModeratorsPanel'
import { PurgeEventDialog } from './PurgeEventDialog'
import { ShareLinkPanel } from './ShareLinkPanel'
import {
  allowsModeration,
  canManageEvent,
  isMutable,
  lifecycleActions,
  offersSupport,
} from './eventLifecycle'
import { useAlbumUrl, useEvent } from './hooks/useEventData'
import { usePurgeEvent, useRotateJoinCode, useStatusChange } from './hooks/useEventActions'
import styles from './EventPage.module.css'
import type { EventStatus } from '../../lib/api/dto'

/** Surface: the host's laptop. The screen they come back to during the event. */
export function EventPage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { slug = '' } = useParams()
  const { data: event, loading, error, reload, replace } = useEvent(slug)
  const statusChange = useStatusChange()
  const rotate = useRotateJoinCode()
  const purge = usePurgeEvent()
  const toast = useToast()
  const navigate = useNavigate()
  const albumUrl = useAlbumUrl(slug)
  // Where the operator says to support the project, if they do. Empty on a self-hosted box.
  const { links } = useAbout()

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
      toast.show(t.admin.statusSaved, { tone: 'success' })
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
      toast.show(t.admin.codeRotated, { tone: 'success' })
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
      toast.show(t.admin.purged(name), { tone: 'success' })
      navigate('/admin', { replace: true })
    })
  }

  if (loading) return <Pending label={t.admin.eventLoading} />
  // A page that failed to load is still a dead end without the way out: a mistyped or revoked
  // address is exactly when the host needs the list.
  if (error !== null || event === null) {
    return (
      <div className={styles['page']}>
        <HostBreadcrumb slug={slug} page="event" eventName={null} />
        <LoadFailure
          message={error ?? t.errors.unknown}
          onRetry={reload}
          as="h1"
          secondaryAction={<HostEventsLink />}
        />
      </div>
    )
  }

  const isOwner = canManageEvent(event.role)

  return (
    <div className={styles['page']}>
      <HostBreadcrumb
        slug={event.slug}
        page="event"
        eventName={event.name}
        ambiance={event.settings.theme.ambiance}
      />
      <header className={styles['header']}>
        <h1 className={styles['title']}>{event.name}</h1>
        <div className={styles['facts']}>
          <EventStatusBadge status={event.status} />
          <span>{t.admin.photos(event.photoCount)}</span>
          <span>{t.admin.guests(event.guestCount)}</span>
          {event.pendingCount > 0 ? (
            <Badge tone="warning">{t.moderation.pending(event.pendingCount)}</Badge>
          ) : null}
        </div>
      </header>

      <div className={styles['columns']}>
        <div className={cx(styles['column'], styles['screenOnly'])}>
          <Card as="h2" title={t.admin.joinCode} subtitle={t.admin.joinCodeHint}>
            <p className={styles['joinCode']}>{event.joinCode}</p>
            <p className={styles['joinUrl']}>
              <span>{t.admin.joinLink}</span>{' '}
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
                  {t.admin.rotateJoinCode}
                </Button>
              </div>
            ) : null}
          </Card>

          <Card as="h2" title={t.admin.eventControls}>
            <EventActionLinks
              slug={event.slug}
              status={event.status}
              role={event.role}
              albumUrl={albumUrl}
            />
            <StorageMeter usedBytes={event.usedBytes} quotaBytes={event.quotaBytes} />
            {event.liveWindowEnd === undefined ? null : (
              <p className={styles['liveWindow']}>
                {t.clientSpace.liveWindowEnd(
                  formatDateTime(event.liveWindowEnd, locale) ?? event.liveWindowEnd,
                )}
              </p>
            )}
            {isOwner ? (
              <div className={styles['actions']}>
                {lifecycleActions(event.status, t).map((action) => (
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
                {lifecycleActions(event.status, t).length === 0 ? (
                  <p className={styles['archived']}>{t.admin.settingsReadOnly}</p>
                ) : null}
              </div>
            ) : null}
          </Card>

          {/* Once the event is closed, and only where the operator set `DONATION_URL`
              (roadmap G4-02): a card that can be closed and stays closed for this event. It
              is in the host's console and nowhere a guest or the room can see. */}
          {offersSupport(event.status) && links.donate !== undefined ? (
            <SupportCard eventId={event.id} donateUrl={links.donate} budgetUrl={links.budget} />
          ) : null}
        </div>

        <div className={styles['column']}>
          <EventQrCard eventName={event.name} joinCode={event.joinCode} joinUrl={event.joinUrl} />
        </div>
      </div>

      <div className={cx(styles['column'], styles['screenOnly'])}>
        <GuestListPanel slug={event.slug} canRevoke={allowsModeration(event.status)} />
        {/* Owner-only for the reason below, and mounted above the moderators because a
            host sets the prompts up before the evening rather than during it (roadmap
            §2.1). A moderator may read the list — `GET` allows it — but a panel whose
            every affordance is refused is worse than no panel. */}
        {isOwner ? <MissionsPanel slug={event.slug} /> : null}
        {/* Owner-only, like every endpoint behind it: sending the album beyond the room
            is a decision about the whole event (roadmap §4.1). */}
        {isOwner ? <ShareLinkPanel slug={event.slug} /> : null}
        {/* Owner-only: every moderator endpoint requires it, so a moderator is not
            shown a panel whose requests would all come back 403. */}
        {isOwner ? <ModeratorsPanel slug={event.slug} /> : null}
        {isOwner ? (
          <div className={styles['actions']}>
            <Button variant="danger" onClick={() => setPurging(true)} aria-haspopup="dialog">
              {t.admin.purge}
            </Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={rotating}
        title={t.admin.rotateJoinCodeTitle}
        // Says the thing a host is actually afraid of: that changing the code throws
        // out the guests who already joined. It does not.
        description={t.admin.rotateJoinCodeHint}
        confirmLabel={t.admin.rotateJoinCode}
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
