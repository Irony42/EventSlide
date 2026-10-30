import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { Notice } from '../../design-system/components/Notice'
import { useToast } from '../../design-system/components/useToast'
import { cx } from '../../design-system/classNames'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { HostEventsLink } from '../../app/HostEventsLink'
import { useAbout } from '../../app/useAbout'
import { formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from '../../design-system/components/Async'
import { AfterEventCard } from './components/AfterEventCard'
import { EventActionLinks } from './components/EventActionLinks'
import { EventQrCard } from './components/EventQrCard'
import { EventStatusBadge } from './components/EventStatusBadge'
import { LifecycleConfirmDialog } from './components/LifecycleConfirmDialog'
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
  isAfterEvening,
  isMutable,
  lifecycleActions,
  offersSupport,
} from './eventLifecycle'
import { scheduleMoment, upcomingMoves } from './eventSchedule'
import { bringIntoView } from './bringIntoView'
import { useAlbumUrl, useEvent } from './hooks/useEventData'
import { usePurgeEvent, useRotateJoinCode } from './hooks/useEventActions'
import { useLifecycleTransition } from './hooks/useLifecycleTransition'
import styles from './EventPage.module.css'

/** Surface: the host's laptop. The screen they come back to during the event. */
export function EventPage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { slug = '' } = useParams()
  const { data: event, loading, error, reload, replace } = useEvent(slug)
  const transition = useLifecycleTransition(replace)
  const rotate = useRotateJoinCode()
  const purge = usePurgeEvent()
  const toast = useToast()
  const navigate = useNavigate()
  const albumUrl = useAlbumUrl(slug)
  // Where the operator says to support the project, if they do. Empty on a self-hosted box.
  const { links } = useAbout()

  const [rotating, setRotating] = useState(false)
  const [purging, setPurging] = useState(false)

  // The two cards a toast or a button elsewhere on the page sends the host to.
  const qrHeading = useRef<HTMLHeadingElement>(null)
  const shareHeading = useRef<HTMLHeadingElement>(null)

  const confirmRotate = () => {
    void rotate.run('rotate', slug).then((result) => {
      setRotating(false)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      replace(result.value)
      // The printed QR codes now lead nowhere: the toast is the moment to say so, and its action
      // takes the host to the card they print from (revue UX 30/10, HOT-2).
      toast.show(t.admin.codeRotated, {
        tone: 'success',
        action: {
          label: t.admin.codeRotatedAction,
          onAction: () => bringIntoView(qrHeading.current),
        },
      })
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
  const moves = upcomingMoves(event.status, event)
  const discardedAt =
    event.scheduleDiscardedAt === null
      ? null
      : (formatDateTime(event.scheduleDiscardedAt, locale) ?? event.scheduleDiscardedAt)
  const settingsPath = `/admin/events/${event.slug}/settings`

  return (
    <div className={styles['page']}>
      <HostBreadcrumb
        slug={event.slug}
        page="event"
        eventName={event.name}
        ambiance={event.settings.theme.ambiance}
        custom={event.settings.theme.custom}
        groundUrl={event.settings.theme.groundUrl}
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
        {/* What is armed to happen by itself, so the host on the day does not open the doors
            "to be safe" (revue UX 30/10, HOT-10). Editing it is the settings page's, which is
            the owner's. */}
        {moves.length > 0 ? (
          <p className={styles['schedule']}>
            {moves.map((move) => {
              const moment = scheduleMoment(move.at, new Date(), locale)
              if (moment === null) return null
              const text =
                move.kind === 'open'
                  ? moment.today
                    ? t.admin.autoOpenAt(moment.text)
                    : t.admin.autoOpenOn(moment.text)
                  : moment.today
                    ? t.admin.autoCloseAt(moment.text)
                    : t.admin.autoCloseOn(moment.text)
              return <span key={move.kind}>{text}</span>
            })}
            {isOwner ? <Link to={settingsPath}>{t.admin.autoEdit}</Link> : null}
          </p>
        ) : null}
        {discardedAt === null ? null : (
          <Notice tone="warning" role="status" variant="boxed">
            {t.admin.scheduleDiscarded(discardedAt)}{' '}
            {isOwner ? <Link to={settingsPath}>{t.admin.autoEdit}</Link> : null}
          </Notice>
        )}
      </header>

      <div className={styles['columns']}>
        <div className={cx(styles['column'], styles['screenOnly'])}>
          {/* Once the evening is over the host's job is the album: it leads, and the card of
              the donation comes after it (revue UX 30/10, HOT-5, APR-6). */}
          {isAfterEvening(event.status) ? (
            <AfterEventCard
              albumUrl={albumUrl}
              onShare={isOwner ? () => bringIntoView(shareHeading.current) : undefined}
            />
          ) : null}
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
                    loading={transition.pending === `${event.slug}:${action.to}`}
                    disabled={transition.busy}
                    onClick={() =>
                      transition.request({
                        slug: event.slug,
                        eventName: event.name,
                        from: event.status,
                        to: action.to,
                      })
                    }
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
          <EventQrCard
            eventName={event.name}
            joinCode={event.joinCode}
            joinUrl={event.joinUrl}
            titleRef={qrHeading}
          />
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
        {isOwner ? <ShareLinkPanel slug={event.slug} titleRef={shareHeading} /> : null}
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
        // Says what the change costs (the printed QR codes and the link already sent stop
        // working) and what it does not (the guests already joined).
        description={t.admin.rotateJoinCodeHint}
        confirmLabel={t.admin.rotateJoinCode}
        busy={rotate.busy}
        onConfirm={confirmRotate}
        onCancel={() => setRotating(false)}
      />

      <LifecycleConfirmDialog
        request={transition.asking}
        busy={transition.busy}
        onConfirm={transition.confirm}
        onCancel={transition.cancel}
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
