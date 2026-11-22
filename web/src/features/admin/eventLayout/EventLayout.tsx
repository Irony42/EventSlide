import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { EventChromeContext } from '../../../app/eventChrome'
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
import { eventBase } from './eventSections'
import { EventNav, EventTabBar } from './EventNav'
import type { EventPageContext } from './useEventPage'
import styles from './EventLayout.module.css'

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
  const { data: event, loading, error, reload, replace, offsetMs } = useEvent(slug)
  const api = useApi()
  const albumUrl = useAlbumUrl(slug)
  const { pathname } = useLocation()

  // Without `reload`, whose pending state would swap every page for the loading screen (a half-typed
  // announcement, an open dialog and the scroll position would go with it). A failed read changes
  // nothing on screen.
  const refresh = useCallback(() => {
    api.getEvent(slug).then(replace, () => undefined)
  }, [api, slug, replace])
  const revealControl = useRevealControl({ event, onChanged: replace, onReload: refresh })
  useRevalidateWhenVisible(refresh)

  // A fresh read on each move inside the event, but not on arrival: the loader has just read it.
  const firstPath = useRef(pathname)
  useEffect(() => {
    if (pathname === firstPath.current) return
    firstPath.current = pathname
    refresh()
  }, [pathname, refresh])

  const context = useMemo<EventPageContext | null>(
    () => (event === null ? null : { event, replace, refresh, offsetMs, albumUrl, revealControl }),
    [event, replace, refresh, offsetMs, albumUrl, revealControl],
  )

  if (event === null && loading) return <Pending label={t.admin.eventLoading} />
  // A page that failed to load is still a dead end without the way out: a mistyped or revoked
  // address is exactly when the host needs the list.
  if (event === null || context === null) {
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

  const home = pathname === eventBase(event.slug) || pathname === `${eventBase(event.slug)}/`

  return (
    <EventChromeContext.Provider value={true}>
      <AmbianceMarker
        ambiance={event.settings.theme.ambiance}
        custom={event.settings.theme.custom}
        groundUrl={event.settings.theme.groundUrl}
      />
      <div className={styles['layout']}>
        <EventNav event={event} />
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
      <EventTabBar event={event} />
      {revealControl.dialog}
    </EventChromeContext.Provider>
  )
}
