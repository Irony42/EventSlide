import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { EventChromeContext, type EventChrome } from '../../../app/eventChrome'
import type { EventDto } from '../../../lib/api/dto'
import { HostBreadcrumb } from '../../../app/HostBreadcrumb'
import { HostEventsLink } from '../../../app/HostEventsLink'
import { LoadFailure, Pending } from '../../../design-system/components/Async'
import { AmbianceMarker } from '../../../design-system/components/AmbianceMarker'
import { useApi } from '../../../lib/useApi'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { EventStatusBadge } from '../components/EventStatusBadge'
import { useAlbumUrl, useEvent } from '../hooks/useEventData'
import { useRevalidateWhenVisible } from '../hooks/useRevalidateWhenVisible'
import { useRevealControl } from '../useRevealControl'
import { cx } from '../../../design-system/classNames'
import { eventBase, SECTION_PATH } from './eventSections'
import { EventNav, EventTabBar } from './EventNav'
import type { EventPageContext } from './useEventPage'
import styles from './EventLayout.module.css'

/** The pages with a preview of their own and a bar of tools: the menu folds beside them. */
const WORKSHOPS = [SECTION_PATH.print, SECTION_PATH.invitations, SECTION_PATH.book] as const

/**
 * The pages that widen while the menu keeps its names: the appearance's sticky preview beside its
 * settings, and the replies' table and guest list, whose columns a wide screen should all show.
 */
const WIDE = [
  SECTION_PATH.appearance,
  SECTION_PATH.rsvps,
  `${SECTION_PATH.rsvps}/guests`,
] as const

/**
 * Every page of one event, around its menu (surface: the host and the moderator; laptop, tablet
 * and phone). Pierre's choice of 22/11, maquette A of `apercus-2026-11-22/evenement.html`.
 *
 * The layout reads the event once and hands it to the page in the outlet (`useEventPage`), so
 * moving from the guests to the album reads nothing again but the page's own list. It reads it
 * once more, quietly, each time the host moves to another page and when the tab comes back into
 * view: a guestbook switched off on the settings page leaves the menu at the next click, and a
 * host who left the laptop for an hour does not come back to an evening that closed without them.
 *
 * It also dresses the console in the event's ambiance and says where the host is, which is why
 * the trail the pages used to carry steps aside under it (`EventChromeContext`).
 */
export function EventLayout() {
  const t = useTranslations()
  const { slug = '' } = useParams()
  const { data: event, loading, error, reload, replace: store, offsetMs } = useEvent(slug)
  const api = useApi()
  const albumUrl = useAlbumUrl(slug)
  const { pathname } = useLocation()

  // Every write of the event counts: a quiet read answers only if nothing was written since it left.
  // Without it, a read sent on a move or on the tab's return could land after "Terminer la soirée"
  // and put the evening back to live on screen, or land on the next event after a change of slug.
  const generation = useRef(0)
  const replace = useCallback(
    (next: EventDto) => {
      generation.current += 1
      store(next)
    },
    [store],
  )
  useEffect(() => {
    generation.current += 1
  }, [slug])

  // Without `reload`, whose pending state would swap every page for the loading screen (a half-typed
  // announcement, an open dialog and the scroll position would go with it). A failed read changes
  // nothing on screen.
  const refresh = useCallback(() => {
    generation.current += 1
    const sent = generation.current
    api.getEvent(slug).then(
      (next) => {
        if (generation.current === sent) store(next)
      },
      () => undefined,
    )
  }, [api, slug, store])
  const chrome = useMemo<EventChrome>(() => ({ inside: true, adopt: replace }), [replace])
  const revealControl = useRevealControl({ event, onChanged: replace, onReload: refresh })
  useRevalidateWhenVisible(refresh)

  // A fresh read on each move inside the event, but not on arrival: the loader has just read it.
  const firstPath = useRef(pathname)
  useEffect(() => {
    if (pathname === firstPath.current) return
    firstPath.current = pathname
    refresh()
  }, [pathname, refresh])

  if (event === null && loading) return <Pending label={t.admin.eventLoading} />
  // A page that failed to load is still a dead end without the way out: a mistyped or revoked
  // address is exactly when the host needs the list.
  if (event === null) {
    return (
      <div className={styles['failed']}>
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

  const context: EventPageContext = { event, replace, refresh, offsetMs, albumUrl, revealControl }
  const base = eventBase(event.slug)
  const home = pathname === base || pathname === `${base}/`
  // The pages where the host composes something to print or send, each with its own preview.
  const workshop = WORKSHOPS.some((page) => pathname.startsWith(`${base}/${page}`))
  // The appearance page's own address only: its custom ambiance editor lives under the settings.
  const wide = WIDE.some((page) => pathname === `${base}/${page}`)

  return (
    <EventChromeContext.Provider value={chrome}>
      <AmbianceMarker
        ambiance={event.settings.theme.ambiance}
        custom={event.settings.theme.custom}
        groundUrl={event.settings.theme.groundUrl}
      />
      <div className={cx(styles['layout'], workshop && styles['workshop'], wide && styles['wide'])}>
        <EventNav event={event} folded={workshop} />
        <div className={styles['content']}>
          {/* The phone has no menu on the side: the way back and the event's name sit above the
              page. On the home page the name is the page's own heading, so it is not said twice. */}
          <div className={styles['phoneHead']}>
            <Link className={styles['phoneBack']} to="/admin">
              <span aria-hidden="true">←&nbsp;</span>
              {t.admin.events}
            </Link>
            {home ? null : (
              <p className={styles['phoneEvent']}>
                <Link className={styles['phoneEventName']} to={eventBase(event.slug)}>
                  {event.name}
                </Link>
                <EventStatusBadge status={event.status} />
              </p>
            )}
          </div>
          {/* Its own boundary: a page's chunk on its way leaves the menu where it is. */}
          <Suspense fallback={<Pending label={t.admin.eventLoading} />}>
            <Outlet context={context} />
          </Suspense>
        </div>
      </div>
      <EventTabBar event={event} besideTools={workshop} />
      {revealControl.dialog}
    </EventChromeContext.Provider>
  )
}
