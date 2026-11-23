import { useId } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { cx } from '../../../design-system/classNames'
import { VisuallyHidden } from '../../../design-system/components/VisuallyHidden'
import type { EventDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { EventActionIcon, type EventActionGlyph } from '../components/EventActionIcon'
import { MOMENT_GLYPH, SECTION_GLYPH } from './sectionGlyphs'
import { EventStatusBadge } from '../components/EventStatusBadge'
import {
  eventBase,
  eventMenu,
  hasSettings,
  MOMENT_PATH,
  momentOf,
  SECTION_KIND,
  SECTION_MOMENT,
  SECTION_PATH,
  sectionHref,
  type EventMoment,
  type EventSection,
} from './eventSections'
import { unseenLabel } from '../../../lib/rsvp/rsvpList'
import { sectionFactsOf } from './useEventPage'
import styles from './EventNav.module.css'

type NavEvent = Pick<
  EventDto,
  'slug' | 'name' | 'status' | 'role' | 'pendingCount' | 'unseenRsvps' | 'settings' | 'reveal'
>

/**
 * One entry of the menu: a page under the layout, the console, or the wall in a new tab.
 *
 * The queue's entry carries the number of photos waiting, the one figure on the menu that asks
 * for a gesture: it is read out with the entry ("Modération, 3 photos en attente"), not as a lone
 * number after it.
 */
export function SectionLink({
  event,
  section,
  className,
  hint,
}: {
  readonly event: NavEvent
  readonly section: EventSection
  readonly className?: string | undefined
  /** The line under the name, on the moments' pages. */
  readonly hint?: string | undefined
}) {
  const t = useTranslations()
  const name = t.eventMenu.sections[section]
  const pending = section === 'moderation' ? event.pendingCount : 0
  // The replies' entry carries how many guests' replies the host has not seen (spec 30).
  const unseen = section === 'rsvps' ? (event.unseenRsvps ?? 0) : 0
  const count = pending + unseen
  const countSentence =
    section === 'rsvps' ? unseenLabel(unseen, t.rsvp.list) : t.moderation.pending(pending)
  // The guided tour's « two gestures of the day » light these two entries when the home page has
  // no tile for them (before the evening).
  const tour = section === 'moderation' ? 'moderate' : section === 'wall' ? 'wall' : undefined
  const body = (
    <>
      <EventActionIcon glyph={SECTION_GLYPH[section]} className={styles['glyph']} />
      <span className={styles['text']}>
        <span className={styles['name']}>{name}</span>
        {hint === undefined ? null : <span className={styles['hint']}>{hint}</span>}
      </span>
      {count > 0 ? (
        <>
          <span className={styles['count']} aria-hidden="true">
            {count}
          </span>
          <VisuallyHidden>{`, ${countSentence}`}</VisuallyHidden>
        </>
      ) : null}
      {SECTION_KIND[section] === 'wall' ? (
        <>
          <EventActionIcon glyph="external" className={styles['external']} />
          <VisuallyHidden>{t.eventMenu.newTab}</VisuallyHidden>
        </>
      ) : null}
    </>
  )

  if (SECTION_KIND[section] === 'wall') {
    return (
      <a
        className={cx(styles['entry'], className)}
        href={sectionHref(event.slug, section)}
        target="_blank"
        rel="noopener"
        title={name}
        data-tour={tour}
      >
        {body}
      </a>
    )
  }
  return (
    <NavLink
      className={({ isActive }) => cx(styles['entry'], className, isActive && styles['active'])}
      to={sectionHref(event.slug, section)}
      title={name}
      data-tour={tour}
    >
      {body}
    </NavLink>
  )
}

/**
 * The menu beside every page of an event, on a laptop (surface: the host and the moderator).
 *
 * The way back to the list, the event's name and status, the home page, then the three moments
 * with the one the event is in marked « maintenant », then the settings apart. Below 64rem it
 * folds to its glyphs (the names stay, for a screen reader and as the tooltip), and below 48rem the
 * phone's tab bar takes over (`EventTabBar`).
 */
export function EventNav({
  event,
  folded = false,
}: {
  readonly event: NavEvent
  /** A page that works on something to print or send: the menu folds to its glyphs up to 90rem. */
  readonly folded?: boolean
}) {
  const t = useTranslations()
  const idPrefix = useId()
  const menu = eventMenu(sectionFactsOf(event))
  const base = eventBase(event.slug)

  return (
    // `data-tour`: the guided tour's last region before the replay ("Tout le reste est ici").
    <nav
      className={cx(styles['nav'], folded && styles['folded'])}
      aria-label={t.eventMenu.label}
      data-tour="overview"
    >
      <Link className={styles['back']} to="/admin" title={t.admin.events}>
        <span aria-hidden="true">←</span>
        <span className={styles['backText']}>{t.admin.events}</span>
      </Link>
      <div className={styles['event']}>
        <p className={styles['eventName']}>{event.name}</p>
        <EventStatusBadge status={event.status} />
      </div>

      <ul className={styles['list']}>
        <li>
          <NavLink
            end
            to={base}
            title={t.eventMenu.home}
            className={({ isActive }) => cx(styles['entry'], isActive && styles['active'])}
          >
            <EventActionIcon glyph="home" className={styles['glyph']} />
            <span className={styles['text']}>
              <span className={styles['name']}>{t.eventMenu.home}</span>
            </span>
          </NavLink>
        </li>
      </ul>

      {menu.map((group) => {
        const labelId = `${idPrefix}-${group.moment}`
        return (
          <div key={group.moment} className={styles['group']}>
            <p id={labelId} className={styles['groupLabel']}>
              <span>{t.eventMenu.moments[group.moment]}</span>
              {group.current ? <span className={styles['now']}>{t.eventMenu.current}</span> : null}
            </p>
            <ul className={styles['list']} aria-labelledby={labelId}>
              {group.sections.map((section) => (
                <li key={section}>
                  <SectionLink event={event} section={section} />
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      {hasSettings(event.role) ? (
        <ul className={cx(styles['list'], styles['foot'])}>
          <li>
            <SectionLink event={event} section="settings" />
          </li>
        </ul>
      ) : null}
    </nav>
  )
}

/** The moment a page belongs to: its section's, or the moment's own page. */
const momentOfPath = (slug: string, pathname: string): EventMoment | 'home' | null => {
  const base = eventBase(slug)
  if (pathname === base || pathname === `${base}/`) return 'home'
  const rest = pathname.slice(base.length + 1).split('/')[0] ?? ''
  for (const moment of ['before', 'during', 'after'] as const) {
    if (rest === MOMENT_PATH[moment]) return moment
  }
  for (const [section, path] of Object.entries(SECTION_PATH)) {
    if (path === rest && section !== 'settings' && section !== 'moderation') {
      return SECTION_MOMENT[section as Exclude<EventSection, 'settings' | 'wall'>]
    }
  }
  return null
}

/**
 * The phone's way around an event: four tabs at the bottom of the screen, under the thumb.
 *
 * Home, then the three moments; each moment's tab opens the list of its pages, and stays lit on
 * every one of them. The evening's tab carries the photos waiting, because on a phone during the
 * party that is the one number that matters. Hidden from 48rem up, where the menu is on the side.
 */
export function EventTabBar({
  event,
  besideTools = false,
}: {
  readonly event: NavEvent
  /** The page has its own bar of tools at the bottom of a phone: the tab bar steps aside there. */
  readonly besideTools?: boolean
}) {
  const t = useTranslations()
  const { pathname } = useLocation()
  const base = eventBase(event.slug)
  const here = momentOfPath(event.slug, pathname)
  const now = momentOf(event.status)
  const pending = event.pendingCount

  const tab = (key: EventMoment | 'home', to: string, glyph: EventActionGlyph, label: string) => {
    const current = here === key
    // The moment's own list is the page; a page inside the moment only belongs to it.
    const exact = pathname === to || pathname === `${to}/`
    return (
      <li key={key}>
        <Link
          to={to}
          className={cx(styles['tab'], current && styles['tabActive'])}
          aria-current={current ? (exact ? 'page' : 'true') : undefined}
        >
          <span className={styles['tabGlyph']}>
            <EventActionIcon glyph={glyph} />
            {key === 'during' && pending > 0 ? (
              <span className={styles['tabCount']} aria-hidden="true">
                {pending}
              </span>
            ) : null}
            {key !== 'home' && key === now ? (
              <span className={styles['tabNow']} aria-hidden="true" />
            ) : null}
          </span>
          <span className={styles['tabLabel']}>{label}</span>
          {key === 'during' && pending > 0 ? (
            <VisuallyHidden>{`, ${t.moderation.pending(pending)}`}</VisuallyHidden>
          ) : null}
          {key !== 'home' && key === now ? (
            <VisuallyHidden>{`, ${t.eventMenu.current}`}</VisuallyHidden>
          ) : null}
        </Link>
      </li>
    )
  }

  return (
    <nav
      className={cx(styles['tabBar'], besideTools && styles['besideTools'])}
      aria-label={t.eventMenu.tabBar}
      data-tour="overview"
    >
      <ul className={styles['tabs']}>
        {tab('home', base, 'home', t.eventMenu.home)}
        {(['before', 'during', 'after'] as const).map((moment) =>
          tab(
            moment,
            `${base}/${MOMENT_PATH[moment]}`,
            MOMENT_GLYPH[moment],
            t.eventMenu.momentsShort[moment],
          ),
        )}
      </ul>
    </nav>
  )
}
