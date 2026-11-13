import { useId, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { GuidedTour } from '../../design-system/components/GuidedTour'
import { Notice } from '../../design-system/components/Notice'
import { useToast } from '../../design-system/components/useToast'
import { cx } from '../../design-system/classNames'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { HostEventsLink } from '../../app/HostEventsLink'
import { useAbout } from '../../lib/useAbout'
import { formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from '../../design-system/components/Async'
import { EventDestinationTile, type PanelDestination } from './components/EventDestinationTile'
import { EventNowCard } from './components/EventNowCard'
import { EventQrCard } from './components/EventQrCard'
import { EventStatusBadge } from './components/EventStatusBadge'
import { TileGroup } from './components/EventTiles'
import { LifecycleConfirmDialog } from './components/LifecycleConfirmDialog'
import { StorageMeter } from './components/StorageMeter'
import { SupportCard } from './components/SupportCard'
import { GuestListPanel } from './GuestListPanel'
import { GuestbookPanel } from './GuestbookPanel'
import { ChallengePanel } from './ChallengePanel'
import { MissionsPanel } from './MissionsPanel'
import { ModeratorsPanel } from './ModeratorsPanel'
import { PurgeEventDialog } from './PurgeEventDialog'
import { AlbumBookPanel } from './AlbumBookPanel'
import { BestOfPanel } from './BestOfPanel'
import { ShareLinkPanel } from './ShareLinkPanel'
import {
  allowsModeration,
  canManageEvent,
  isMutable,
  lifecycleActions,
  offersSupport,
} from '../../lib/eventLifecycle'
import { scheduleMoment, upcomingMoves } from './eventSchedule'
import { overviewTiles } from './eventOverview'
import { bringIntoView } from './bringIntoView'
import { useAlbumUrl, useEvent } from './hooks/useEventData'
import { useEventTour } from './hooks/useEventTour'
import { eventTourSteps } from './eventTour'
import { usePurgeEvent, useRotateJoinCode } from './hooks/useEventActions'
import { useLifecycleTransition } from './hooks/useLifecycleTransition'
import styles from './EventPage.module.css'

/**
 * Surface: the host's laptop, and the phone they hold by the end of the evening. The screen they
 * come back to during the event.
 *
 * Three layers, most urgent first (maquette D, 11/11): the **"Maintenant" card**, which changes
 * with the status and holds what the moment asks for, beside the **access card** (code, link,
 * a small QR that prints large); then **"Tout l'évènement"**, one tile per destination, so what
 * is not in the first card is one press away; then the panels themselves. `eventOverview.ts`
 * decides what goes in which layer.
 */
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

  // The first visit's guided tour of this page, once the event is there to show.
  const tour = useEventTour(
    event === null ? null : { status: event.status, pendingCount: event.pendingCount },
  )

  // The card a toast elsewhere on the page sends the host to (the new code makes the printed
  // ones out of date), and the panels the tiles lead to.
  const qrHeading = useRef<HTMLHeadingElement>(null)
  // Where focus lands when the guided tour closes: the button that brings it back.
  const tourButton = useRef<HTMLButtonElement>(null)
  const overviewTitleId = useId()
  // The panels the tiles lead to are found by id: a prefix of this page's own, one per panel.
  const panelIds = useId()
  const panelId = (panel: PanelDestination) => panelIds + '-' + panel

  /**
   * Takes the host to a panel further down: to its heading, so a screen reader reads on from
   * there. The heading is the panel's own; it is made focusable here rather than in every panel.
   */
  const openPanel = (panel: PanelDestination) => {
    const heading =
      document.getElementById(panelId(panel))?.querySelector<HTMLElement>('h2, h3') ?? null
    if (heading !== null && !heading.hasAttribute('tabindex')) heading.tabIndex = -1
    bringIntoView(heading)
  }

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
  const actions = lifecycleActions(event.status, t)

  // What is armed to happen by itself, so the host on the day does not open the doors "to be
  // safe" (revue UX 30/10, HOT-10). Editing it is the settings page's, which is the owner's.
  const scheduleTexts = moves.flatMap((move) => {
    const moment = scheduleMoment(move.at, new Date(), locale)
    if (moment === null) return []
    const text =
      move.kind === 'open'
        ? moment.today
          ? t.admin.autoOpenAt(moment.text)
          : t.admin.autoOpenOn(moment.text)
        : moment.today
          ? t.admin.autoCloseAt(moment.text)
          : t.admin.autoCloseOn(moment.text)
    return [<span key={move.kind}>{text}</span>]
  })
  const schedule: ReactNode | undefined =
    scheduleTexts.length === 0 ? undefined : (
      <p className={styles['schedule']}>
        {scheduleTexts}
        {isOwner ? <Link to={settingsPath}>{t.admin.autoEdit}</Link> : null}
      </p>
    )

  const lifecycle: ReactNode | undefined = !isOwner ? undefined : actions.length === 0 ? (
    <p className={styles['archived']}>{t.admin.settingsReadOnly}</p>
  ) : (
    <>
      {actions.map((action) => (
        <Button
          key={action.to}
          variant={action.primary ? 'primary' : 'secondary'}
          loading={transition.isPending(`${event.slug}:${action.to}`)}
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
    </>
  )

  const overview = overviewTiles({
    status: event.status,
    role: event.role,
    allowGuestbook: event.settings.allowGuestbook,
  })

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
      <header className={cx(styles['header'], styles['screenOnly'])}>
        <h1 className={styles['title']}>{event.name}</h1>
        <div className={styles['facts']}>
          <EventStatusBadge status={event.status} />
          <span>{t.admin.photos(event.photoCount)}</span>
          <span>{t.admin.guests(event.guestCount)}</span>
          {event.pendingCount > 0 ? (
            <Badge tone="warning">{t.moderation.pending(event.pendingCount)}</Badge>
          ) : null}
          <Button
            ref={tourButton}
            size="sm"
            variant="ghost"
            onClick={tour.replay}
            aria-haspopup="dialog"
            data-tour="tourButton"
          >
            {t.admin.tourButton}
          </Button>
        </div>
        {discardedAt === null ? null : (
          <Notice tone="warning" role="status" variant="boxed">
            {t.admin.scheduleDiscarded(discardedAt)}{' '}
            {isOwner ? <Link to={settingsPath}>{t.admin.scheduleDiscardedAction}</Link> : null}
          </Notice>
        )}
      </header>

      <div className={styles['lead']}>
        <div className={styles['screenOnly']}>
          <EventNowCard
            event={event}
            albumUrl={albumUrl}
            onOpenPanel={openPanel}
            schedule={schedule}
            lifecycle={lifecycle}
          />
        </div>
        {/* Wrapped for the guided tour only: the card is the grid's second track either way. */}
        <div data-tour="access">
          <EventQrCard
            eventName={event.name}
            joinCode={event.joinCode}
            joinUrl={event.joinUrl}
            titleRef={qrHeading}
            // Both are for an event still in use: an archived one gets no empty row under the card.
            extraActions={
              event.status === 'archived' ? undefined : (
                <>
                  <Link to={`/admin/events/${event.slug}/print`}>{t.admin.printKitTitle}</Link>
                  {isOwner && isMutable(event.status) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={rotate.busy}
                      onClick={() => setRotating(true)}
                      aria-haspopup="dialog"
                    >
                      {t.admin.rotateJoinCode}
                    </Button>
                  ) : null}
                </>
              )
            }
          />
        </div>
      </div>

      <div className={cx(styles['column'], styles['screenOnly'])}>
        {/* Once the event is closed, and only where the operator set `DONATION_URL` (roadmap
            G4-02): a card that can be closed and stays closed for this event. It is in the host's
            console and nowhere a guest or the room can see. */}
        {offersSupport(event.status) && links.donate !== undefined ? (
          <SupportCard eventId={event.id} donateUrl={links.donate} budgetUrl={links.budget} />
        ) : null}

        <section
          className={styles['overview']}
          aria-labelledby={overviewTitleId}
          data-tour="overview"
        >
          <h2 id={overviewTitleId} className={styles['overviewTitle']}>
            {t.admin.overviewTitle}
          </h2>
          <TileGroup size="small">
            {overview.map((destination) => (
              <EventDestinationTile
                key={destination}
                destination={destination}
                size="small"
                event={event}
                albumUrl={albumUrl}
                onOpenPanel={openPanel}
              />
            ))}
          </TileGroup>
          <StorageMeter usedBytes={event.usedBytes} quotaBytes={event.quotaBytes} />
          {event.liveWindowEnd === undefined ? null : (
            <p className={styles['liveWindow']}>
              {t.clientSpace.liveWindowEnd(
                formatDateTime(event.liveWindowEnd, locale) ?? event.liveWindowEnd,
              )}
            </p>
          )}
        </section>

        {/* The panels, in the overview's order. Each is wrapped so a tile can take the host to
            its heading. */}
        {event.settings.allowGuestbook ? (
          // Any moderator: deciding on a message is moderation, like deciding on a photo (spec 01).
          <div id={panelId('guestbook')}>
            <GuestbookPanel slug={event.slug} canDecide={allowsModeration(event.status)} />
          </div>
        ) : null}
        {/* Any moderator launches or stops a timed challenge (spec 10): the person with the laptop
            at the evening is usually the moderator, and it writes no new sentence. */}
        <div id={panelId('challenge')}>
          <ChallengePanel slug={event.slug} live={event.status === 'live'} />
        </div>
        {/* Owner-only, and a moderator may read the list — `GET` allows it — but a panel whose
            every affordance is refused is worse than no panel (roadmap §2.1). */}
        {isOwner ? (
          <div id={panelId('missions')}>
            <MissionsPanel slug={event.slug} />
          </div>
        ) : null}
        <div id={panelId('guests')}>
          <GuestListPanel slug={event.slug} canRevoke={allowsModeration(event.status)} />
        </div>
        {/* Owner-only: every moderator endpoint requires it, so a moderator is not shown a panel
            whose requests would all come back 403. */}
        {isOwner ? (
          <div id={panelId('moderators')}>
            <ModeratorsPanel slug={event.slug} />
          </div>
        ) : null}
        {/* Any moderator: starring and the ZIP are moderation, and the routes allow it (spec 08). */}
        <div id={panelId('bestOf')}>
          <BestOfPanel slug={event.slug} canStar={allowsModeration(event.status)} />
        </div>
        {/* The photo book (spec 04): any moderator, like the ZIP; the server answers for the rest. */}
        <div id={panelId('book')}>
          <AlbumBookPanel slug={event.slug} defaultTitle={event.name} />
        </div>
        {/* Owner-only, like every endpoint behind it: sending the album beyond the room is a
            decision about the whole event (roadmap §4.1). */}
        {isOwner ? (
          <div id={panelId('share')}>
            <ShareLinkPanel slug={event.slug} />
          </div>
        ) : null}
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

      <GuidedTour
        open={tour.open}
        steps={eventTourSteps(
          {
            name: event.name,
            status: event.status,
            role: event.role,
            moderation: event.settings.moderation,
          },
          t,
        )}
        onFinish={tour.close}
        onDismiss={tour.close}
        returnFocusRef={tourButton}
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
