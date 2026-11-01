import { useCallback, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useLoader } from '../lib/useLoader'
import { useTranslations } from '../lib/i18n/useTranslations'
import { cx } from '../design-system/classNames'
import { AmbianceMarker } from '../design-system/components/AmbianceMarker'
import type { ThemeAmbiance, ThemeCustom } from '../lib/api/dto'
import { useApi } from './useApi'
import styles from './HostBreadcrumb.module.css'

/** Where the host's list of events is: the one place that offers "Nouvel évènement". */
const EVENTS_PATH = '/admin'

/** The host pages under one event. The page names itself, so a caller never writes a label. */
export type HostEventPage =
  'event' | 'moderation' | 'mobileModeration' | 'settings' | 'ambiance' | 'stats'

export interface HostBreadcrumbProps {
  readonly slug: string
  /** The page that is showing it: the last item of the trail, and the one that is not a link. */
  readonly page: HostEventPage
  /**
   * The event's name, when the page already has it. A string is shown as it is; `null` says
   * the page has none to give (its own read failed), so the trail is the way out and nothing
   * more. Left out, the trail reads the event itself, which is what the moderation pages need.
   */
  readonly eventName?: string | null
  /**
   * The phone's moderation screen, where every line is spent: the trail stops at the event,
   * because the page's own heading directly below already names where the host is.
   */
  readonly compact?: boolean
  /**
   * The event's ambiance, when the page already has the event (ADR 0010): the trail is on every
   * page under one event, so it is where the console is dressed in it. Left out, the trail
   * reads it with the event's name.
   */
  readonly ambiance?: ThemeAmbiance
  /** The host's own ambiance, when `ambiance` is `custom` (ADR 0011). */
  readonly custom?: ThemeCustom | undefined
  /** The host's own photograph of the venue, when the page has the event (ADR 0010, decision 8). */
  readonly groundUrl?: string | null | undefined
}

/**
 * The way back from any page under an event: "← Vos évènements › <event> › <this page>".
 *
 * Surface: **the host and the moderator**, on `/admin/events/:slug/**`. Pierre, testing the
 * console, could not find how to create a second event from an event's page: the header holds
 * the language and the account, and nothing on the page led back to the list that carries
 * "Nouvel évènement". This is that link, in one component so the four pages cannot drift into
 * four spellings of it, and the account menu's "Vos évènements" is the other way to the same
 * place.
 *
 * Both destinations are open to every account that can see the page it is on. The list
 * (`GET /api/events`) is the caller's own events, **owned or moderated**, so an invited
 * moderator's list holds the one event they were invited to, and the event page, the console
 * and the settings page all answer a moderator (the settings read-only, because every save is
 * owner-only). Nothing here is therefore gated on the role: a link a moderator could not follow
 * would be a defect, and there is none to withhold. `HostBreadcrumb.test.tsx` holds a
 * moderator-only account to that by following each link.
 *
 * The name is the event's, which is content and is never translated. A real list with real
 * links, in a `nav` that names itself, and the current page marked `aria-current="page"` — and
 * not a link, because a link to the page you are on is a control that does nothing.
 */
export function HostBreadcrumb({
  slug,
  page,
  eventName,
  compact = false,
  ambiance,
  custom,
  groundUrl,
}: HostBreadcrumbProps) {
  if (eventName === undefined) return <FetchedTrail slug={slug} page={page} compact={compact} />
  return (
    <Trail
      slug={slug}
      page={page}
      name={eventName}
      compact={compact}
      ambiance={ambiance}
      custom={custom}
      groundUrl={groundUrl}
    />
  )
}

/**
 * The trail for a page that does not hold the event itself.
 *
 * Its own small read rather than the admin feature's hook: this lives above the features and
 * a feature never imports another. While the answer is on its way the trail is just the way
 * out — the name arrives a moment later on the same line, so nothing below it moves. A read
 * that failed still offers the event, under the generic title, because the host reached this
 * page from it and a trail that lost that link on a bad network would lose the way back.
 */
function FetchedTrail({
  slug,
  page,
  compact,
}: {
  readonly slug: string
  readonly page: HostEventPage
  readonly compact: boolean
}) {
  const t = useTranslations()
  const api = useApi()
  const load = useCallback((signal: AbortSignal) => api.getEvent(slug, signal), [api, slug])
  const { data, loading } = useLoader(load)
  const name = data !== null ? data.name : loading ? null : t.titles.event
  return (
    <Trail
      slug={slug}
      page={page}
      name={name}
      compact={compact}
      ambiance={data?.settings.theme.ambiance}
      custom={data?.settings.theme.custom}
      groundUrl={data?.settings.theme.groundUrl}
    />
  )
}

function Trail({
  slug,
  page,
  name,
  compact,
  ambiance,
  custom,
  groundUrl,
}: {
  readonly slug: string
  readonly page: HostEventPage
  /** `null`: nothing to name, so the trail is only its first item. */
  readonly name: string | null
  readonly compact: boolean
  readonly ambiance: ThemeAmbiance | undefined
  readonly custom: ThemeCustom | undefined
  readonly groundUrl: string | null | undefined
}) {
  const t = useTranslations()
  const eventPath = `${EVENTS_PATH}/events/${slug}`
  const here: Record<Exclude<HostEventPage, 'event'>, string> = {
    moderation: t.moderation.title,
    mobileModeration: t.mobileModeration.title,
    settings: t.admin.settings,
    ambiance: t.admin.customAmbianceCrumb,
    stats: t.admin.stats.tile,
  }

  return (
    <>
      <AmbianceMarker ambiance={ambiance} custom={custom} groundUrl={groundUrl} />
      <nav
        aria-label={t.admin.breadcrumbLabel}
        className={cx(styles['nav'], compact && styles['compact'])}
      >
        <ol className={styles['list']}>
          <li className={styles['item']}>
            <Link className={styles['link']} to={EVENTS_PATH}>
              {/* The arrow is the same decoration the label has in the copy: the link is named
                "Vos évènements", not "flèche, Vos évènements". */}
              <span aria-hidden="true">←&nbsp;</span>
              {t.admin.events}
            </Link>
          </li>
          {name === null ? null : page === 'event' ? (
            <Crumb shrinks>
              <span className={cx(styles['here'], styles['name'])} aria-current="page">
                {name}
              </span>
            </Crumb>
          ) : (
            <>
              <Crumb shrinks>
                <Link className={cx(styles['link'], styles['name'])} to={eventPath}>
                  {name}
                </Link>
              </Crumb>
              {compact ? null : (
                <Crumb>
                  <span className={styles['here']} aria-current="page">
                    {here[page]}
                  </span>
                </Crumb>
              )}
            </>
          )}
        </ol>
      </nav>
    </>
  )
}

/** One item after the first, with the separator that is only there to the eye. */
function Crumb({
  children,
  shrinks = false,
}: {
  readonly children: ReactNode
  /** The item that holds the event's name, the one that may be too long for the line. */
  readonly shrinks?: boolean
}) {
  return (
    <li className={cx(styles['item'], shrinks && styles['shrinks'])}>
      <span className={styles['separator']} aria-hidden="true">
        ›
      </span>
      {children}
    </li>
  )
}
