import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Notice } from '../../../design-system/components/Notice'
import { allowsModeration, canManageEvent } from '../../../lib/eventLifecycle'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { AlbumBookPanel } from '../AlbumBookPanel'
import { AnnouncementsPanel } from '../AnnouncementsPanel'
import { BestOfPanel } from '../BestOfPanel'
import { ChallengePanel } from '../ChallengePanel'
import { ChannelsPanel } from '../ChannelsPanel'
import { GuestbookPanel } from '../GuestbookPanel'
import { GuestListPanel } from '../GuestListPanel'
import { MissionsPanel } from '../MissionsPanel'
import { ModeratorsPanel } from '../ModeratorsPanel'
import { RevealPanel } from '../RevealPanel'
import { ShareLinkPanel } from '../ShareLinkPanel'
import { EventAccessCard } from './EventAccessCard'
import { EventAlbumSection } from './EventAlbumSection'
import {
  eventBase,
  offersSection,
  SECTION_MOMENT,
  sectionHref,
  type EventSection,
} from './eventSections'
import { sectionFactsOf, useEventPage, type EventPageContext } from './useEventPage'
import styles from './EventSectionPage.module.css'

/** The sections that are one of the event page's former panels, drawn on a page of their own. */
export type PanelSection = Extract<
  EventSection,
  | 'access'
  | 'missions'
  | 'moderators'
  | 'announcements'
  | 'challenge'
  | 'guestbook'
  | 'reveal'
  | 'telegram'
  | 'guests'
  | 'album'
  | 'bestOf'
  | 'book'
  | 'share'
>

/**
 * Each panel with what it is allowed to do. The rules are the ones the single page applied (and the
 * routes behind each one enforce): deciding is moderation, so any moderator decides on a guestbook
 * message or stars a photo while the event is not archived; the challenge and the announcements are
 * the evening's; unlinking a Telegram group and the shared link are the owner's.
 */
const PANELS: Readonly<Record<PanelSection, (context: EventPageContext) => ReactNode>> = {
  access: ({ event, replace }) => <EventAccessCard event={event} onChanged={replace} />,
  missions: ({ event }) => <MissionsPanel slug={event.slug} />,
  moderators: ({ event }) => <ModeratorsPanel slug={event.slug} />,
  announcements: ({ event }) => (
    <AnnouncementsPanel
      slug={event.slug}
      live={event.status === 'live'}
      opensAt={event.scheduledOpenAt}
    />
  ),
  challenge: ({ event }) => <ChallengePanel slug={event.slug} live={event.status === 'live'} />,
  guestbook: ({ event }) => (
    <GuestbookPanel slug={event.slug} canDecide={allowsModeration(event.status)} />
  ),
  reveal: ({ event, revealControl }) => (
    <RevealPanel
      control={revealControl}
      settingsPath={canManageEvent(event.role) ? sectionHref(event.slug, 'settings') : null}
    />
  ),
  telegram: ({ event }) => (
    <ChannelsPanel
      slug={event.slug}
      joinCode={event.joinCode}
      canUnlink={canManageEvent(event.role)}
      canBind={event.status === 'live'}
    />
  ),
  guests: ({ event }) => (
    <GuestListPanel slug={event.slug} canRevoke={allowsModeration(event.status)} />
  ),
  album: () => <EventAlbumSection />,
  bestOf: ({ event }) => <BestOfPanel slug={event.slug} canStar={allowsModeration(event.status)} />,
  book: ({ event }) => (
    <AlbumBookPanel
      slug={event.slug}
      defaultTitle={event.name}
      ambiance={event.settings.theme.ambiance}
    />
  ),
  share: ({ event }) => <ShareLinkPanel slug={event.slug} />,
}

/**
 * One subject of the event on a page of its own (surface: the host and the moderator).
 *
 * The page's heading is the event's name, said to a screen reader (on screen the menu beside it
 * says it): the panel's own title, a level below, names the subject, so the outline reads « Camille &
 * Sacha › Invités » and the subject is not named twice. Above the panel, the moment the section
 * belongs to, which is where the menu has it. A section this viewer does not have (a moderator at the shared
 * link's address, a guestbook switched off) says so and leads back to the event's home, rather
 * than drawing a panel whose every request would be refused.
 */
export function EventSectionPage({ section }: { readonly section: PanelSection }) {
  const t = useTranslations()
  const context = useEventPage()
  const { event } = context

  if (!offersSection(sectionFactsOf(event), section)) {
    return (
      <div className={styles['page']}>
        <h1 className={styles['missingTitle']}>{t.eventMenu.sections[section]}</h1>
        <Notice tone="neutral" role="status" variant="boxed">
          {t.eventMenu.notHere}
        </Notice>
        <Link to={eventBase(event.slug)}>{t.eventMenu.backHome}</Link>
      </div>
    )
  }

  return (
    <div className={styles['page']}>
      <p className={styles['eyebrow']}>{t.eventMenu.moments[SECTION_MOMENT[section]]}</p>
      <h1 className="visually-hidden">{event.name}</h1>
      {PANELS[section](context)}
    </div>
  )
}
