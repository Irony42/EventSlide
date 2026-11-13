import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { VisuallyHidden } from '../../../design-system/components/VisuallyHidden'
import type { EventDto, EventStatus } from '../../../lib/api/dto'
import { canManageEvent } from '../../../lib/eventLifecycle'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { UiText } from '../../../lib/i18n/translations'
import { nowTiles } from '../eventOverview'
import { EventDestinationTile, type PanelDestination } from './EventDestinationTile'
import { TileGroup } from './EventTiles'
import styles from './EventNowCard.module.css'

export interface EventNowCardProps {
  readonly event: Pick<
    EventDto,
    'slug' | 'status' | 'role' | 'pendingCount' | 'guestCount' | 'settings'
  >
  readonly albumUrl: string
  readonly onOpenPanel: (panel: PanelDestination) => void
  /** What is armed to happen by itself (the opening, the closing) and the way to change it. */
  readonly schedule?: ReactNode
  /** The lifecycle's buttons: the owner's, so absent for a moderator. */
  readonly lifecycle?: ReactNode
}

const HEADINGS: Readonly<
  Record<EventStatus, (text: UiText) => { readonly eyebrow: string; readonly title: string }>
> = {
  draft: (text) => ({ eyebrow: text.admin.nowDraftEyebrow, title: text.admin.nowDraftTitle }),
  live: (text) => ({ eyebrow: text.admin.nowLiveEyebrow, title: text.admin.nowLiveTitle }),
  closed: (text) => ({ eyebrow: text.admin.nowClosedEyebrow, title: text.admin.nowClosedTitle }),
  archived: (text) => ({
    eyebrow: text.admin.nowArchivedEyebrow,
    title: text.admin.nowArchivedTitle,
  }),
}

/**
 * The first card of the event page: what the moment asks of the host, and nothing else
 * (surface: the host and the moderator).
 *
 * Before the evening it is the short list of things to get ready, with the button that opens
 * the doors; during it, the queue (with what is waiting) and the screen; after it, the album to
 * download and to share. The lifecycle's next step sits at the bottom of the card, always in the
 * same place, with what is armed to happen by itself beside it: the host on the day must not
 * have to look for "Terminer la soirée", nor open the doors "to be safe".
 */
export function EventNowCard({
  event,
  albumUrl,
  onOpenPanel,
  schedule,
  lifecycle,
}: EventNowCardProps) {
  const t = useTranslations()
  const titleId = useId()
  const { eyebrow, title } = HEADINGS[event.status](t)
  const tiles = nowTiles({
    status: event.status,
    role: event.role,
    allowGuestbook: event.settings.allowGuestbook,
  })

  return (
    // `data-tour`: the regions the first visit's guided tour lights (`eventTour.ts`).
    <section className={styles['card']} aria-labelledby={titleId} data-tour="now">
      <header className={styles['header']}>
        <p className={styles['eyebrow']}>{eyebrow}</p>
        <h2 id={titleId} className={styles['title']}>
          {title}
        </h2>
      </header>

      {event.status === 'draft' ? (
        <DraftSteps event={event} onOpenPanel={onOpenPanel} />
      ) : (
        <TileGroup size="large">
          {tiles.map((destination) => (
            <EventDestinationTile
              key={destination}
              destination={destination}
              size="large"
              event={event}
              albumUrl={albumUrl}
              onOpenPanel={onOpenPanel}
            />
          ))}
        </TileGroup>
      )}

      {schedule === undefined && lifecycle === undefined ? null : (
        <footer className={styles['footer']}>
          {schedule === undefined ? null : <div className={styles['schedule']}>{schedule}</div>}
          {lifecycle === undefined ? null : (
            <div className={styles['lifecycle']} data-tour="lifecycle">
              {lifecycle}
            </div>
          )}
        </footer>
      )}
    </section>
  )
}

/**
 * What to get ready before the doors open, as links to where each thing is done. No ticks: the
 * page cannot know whether the cards were printed, and a list that guessed would be a list
 * nobody trusts. A moderator gets the steps that are theirs to take.
 */
function DraftSteps({
  event,
  onOpenPanel,
}: {
  readonly event: EventNowCardProps['event']
  readonly onOpenPanel: (panel: PanelDestination) => void
}) {
  const t = useTranslations()
  const newTabId = useId()
  const owner = canManageEvent(event.role)
  const base = `/admin/events/${event.slug}`

  return (
    <ol className={styles['steps']}>
      {owner ? (
        <li className={styles['step']}>
          <Link to={`${base}/settings`}>{t.admin.nowDraftSettings}</Link>
        </li>
      ) : null}
      <li className={styles['step']}>
        <Link to={`${base}/print`}>{t.admin.nowDraftPrint}</Link>
      </li>
      <li className={styles['step']}>
        <Link
          to={`/e/${event.slug}/display`}
          target="_blank"
          rel="noopener"
          aria-describedby={newTabId}
        >
          {t.admin.nowDraftWall}
        </Link>
        <VisuallyHidden id={newTabId}>{t.about.opensInNewTab}</VisuallyHidden>
      </li>
      {owner ? (
        <li className={styles['step']}>
          <button
            type="button"
            className={styles['stepButton']}
            onClick={() => onOpenPanel('moderators')}
          >
            {t.admin.nowDraftModerators}
          </button>
        </li>
      ) : null}
    </ol>
  )
}
