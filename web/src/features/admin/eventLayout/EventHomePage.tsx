import { useRef, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { GuidedTour } from '../../../design-system/components/GuidedTour'
import { Notice } from '../../../design-system/components/Notice'
import { cx } from '../../../design-system/classNames'
import { useAbout } from '../../../lib/useAbout'
import { useServerNow } from '../../../lib/useServerNow'
import { formatDateTime } from '../../../lib/format'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { canManageEvent, lifecycleActions, offersSupport } from '../../../lib/eventLifecycle'
import type { PanelDestination } from '../components/EventDestinationTile'
import { EventNowCard } from '../components/EventNowCard'
import { EventStatusBadge } from '../components/EventStatusBadge'
import { LifecycleConfirmDialog } from '../components/LifecycleConfirmDialog'
import { SupportCard } from '../components/SupportCard'
import { RevealBanner } from '../RevealBanner'
import { AlbumDeletionBand } from '../AlbumDeletionBand'
import { deletionMoment } from '../albumDeletion'
import { scheduleMoment, upcomingMoves } from '../eventSchedule'
import { useAlbumExport } from '../hooks/useAlbumExport'
import { useEventTour } from '../hooks/useEventTour'
import { eventTourSteps } from '../eventTour'
import { useLifecycleTransition } from '../hooks/useLifecycleTransition'
import { EventAccessCard } from './EventAccessCard'
import { sectionHref } from './eventSections'
import { useEventPage } from './useEventPage'
import styles from './EventHomePage.module.css'

/** Where each tile of the "Maintenant" card that used to scroll to a panel now leads. */
const PANEL_SECTION = {
  share: 'share',
  guestbook: 'guestbook',
  challenge: 'challenge',
  missions: 'missions',
  guests: 'guests',
  moderators: 'moderators',
  bestOf: 'bestOf',
  book: 'book',
} as const satisfies Record<PanelDestination, string>

/**
 * The event's home page: what the moment asks for, and the way in for the guests (surface: the
 * host and the moderator; the screen they come back to during the evening).
 *
 * It holds the **"Maintenant" card**, which changes with the status (getting ready, the queue and
 * the screen, the album), beside the **access card** (code, link, a small QR that prints large),
 * and what must not be missed above them: the disposable camera's reveal, a schedule that was
 * thrown away, the album's deletion date. Everything else is a page of its own in the menu, so
 * this page stays one screen high instead of the seven the event page used to be.
 */
export function EventHomePage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { event, replace, offsetMs, albumUrl, revealControl } = useEventPage()
  const transition = useLifecycleTransition(replace)
  const navigate = useNavigate()
  const { links } = useAbout()

  // When the album goes, on the server's clock (spec 22): the band is on the page from 30 days before.
  const nowMs = useServerNow(offsetMs)
  const purgeAt = event.purge?.at ?? null
  const moment = deletionMoment(purgeAt, nowMs, event.purge?.offboarding === true)
  const archive = useAlbumExport(event.slug, moment !== null)

  const tour = useEventTour({ status: event.status, pendingCount: event.pendingCount })
  const tourButton = useRef<HTMLButtonElement>(null)

  const isOwner = canManageEvent(event.role)
  const settingsPath = sectionHref(event.slug, 'settings')
  const openPanel = (panel: PanelDestination) =>
    void navigate(sectionHref(event.slug, PANEL_SECTION[panel]))

  const discardedAt =
    event.scheduleDiscardedAt === null
      ? null
      : (formatDateTime(event.scheduleDiscardedAt, locale) ?? event.scheduleDiscardedAt)
  const actions = lifecycleActions(event.status, t)

  // What is armed to happen by itself, so the host on the day does not open the doors "to be
  // safe" (revue UX 30/10, HOT-10). Editing it is the settings page's, which is the owner's.
  const scheduleTexts = upcomingMoves(event.status, event).flatMap((move) => {
    const at = scheduleMoment(move.at, new Date(), locale)
    if (at === null) return []
    const text =
      move.kind === 'open'
        ? at.today
          ? t.admin.autoOpenAt(at.text)
          : t.admin.autoOpenOn(at.text)
        : at.today
          ? t.admin.autoCloseAt(at.text)
          : t.admin.autoCloseOn(at.text)
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
              heldReveal: event.reveal?.enabled === true && !event.reveal.revealed,
            })
          }
        >
          {action.label}
        </Button>
      ))}
    </>
  )

  return (
    <div className={styles['page']}>
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
            className={styles['tourButton']}
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

      {/* The disposable camera's reveal, where the host looks first (spec 23b): nothing while the
          mode is off or once the evening is revealed. */}
      <div className={styles['screenOnly']}>
        <RevealBanner control={revealControl} />
      </div>

      {/* From 30 days before the album's date (spec 22): any moderator, like the ZIP. */}
      {moment !== null && purgeAt !== null ? (
        <div className={styles['screenOnly']}>
          <AlbumDeletionBand
            slug={event.slug}
            at={purgeAt}
            moment={moment}
            archive={archive}
            albumUrl={albumUrl}
            {...(event.purge === undefined ? {} : { voices: event.purge.voices })}
          />
        </div>
      ) : null}

      <div className={styles['leadContainer']}>
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
            <EventAccessCard event={event} onChanged={replace} />
          </div>
        </div>
      </div>

      {/* Once the event is closed, and only where the operator set `DONATION_URL` (roadmap G4-02). */}
      {offersSupport(event.status) && links.donate !== undefined ? (
        <div className={styles['screenOnly']}>
          <SupportCard eventId={event.id} donateUrl={links.donate} budgetUrl={links.budget} />
        </div>
      ) : null}

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
    </div>
  )
}
