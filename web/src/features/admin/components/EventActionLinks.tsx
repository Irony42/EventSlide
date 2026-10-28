import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { EventStatus } from '../../../lib/api/dto'
import { allowsModeration, servesWall } from '../eventLifecycle'
import { EventActionIcon, type EventActionGlyph } from './EventActionIcon'
import styles from './EventActionLinks.module.css'

export interface EventActionLinksProps {
  readonly slug: string
  readonly status: EventStatus
  /** Built by the API client, so the link and the endpoint cannot drift apart. */
  readonly albumUrl: string
}

type Priority = 'primary' | 'secondary'

interface TileProps {
  readonly priority: Priority
  readonly glyph: EventActionGlyph
  readonly children: ReactNode
}

/** What is inside a tile. The glyph is decoration: the label is the link's name. */
function TileBody({ glyph, children }: Omit<TileProps, 'priority'>) {
  return (
    <>
      <EventActionIcon glyph={glyph} className={styles['glyph']} />
      <span className={styles['label']}>{children}</span>
    </>
  )
}

/**
 * What makes an element a tile of a tier. The attribute is the whole mechanism: the
 * stylesheet reads `data-priority` and nothing else, so what the test asserts is what is drawn,
 * and a tile cannot say one tier and wear the other's look.
 */
const tileProps = (priority: Priority) => ({
  className: styles['tile'],
  'data-priority': priority,
})

/** A route inside the app: a real `<a href>`, so middle-click and "open in a new tab" work. */
function RouteTile({ to, priority, glyph, children }: TileProps & { readonly to: string }) {
  return (
    <Link {...tileProps(priority)} to={to}>
      <TileBody glyph={glyph}>{children}</TileBody>
    </Link>
  )
}

/**
 * Where a host goes from the event page, as navigation tiles in two tiers.
 *
 * Surface: the host, on the laptop and on the phone they are holding by the end of the
 * evening. The two actions the night turns on, the wall and the moderation queue, are the
 * big tiles; everything else is a compact one beneath them. Every tile is a link and stays
 * one — a route in the app, or the ZIP — so the browser's own behaviour (a new tab, a copied
 * address, the download manager) is intact, and a tile never becomes a button to get a
 * border. Which tiles exist is the lifecycle's decision (`servesWall`, `allowsModeration`),
 * not this component's: an archived event has no wall and no queue, and the grid simply
 * holds fewer of them.
 */
export function EventActionLinks({ slug, status, albumUrl }: EventActionLinksProps) {
  const t = useTranslations()
  const wall = servesWall(status)
  const moderation = allowsModeration(status)

  return (
    <div className={styles['links']}>
      {wall || moderation ? (
        <div className={styles['group']}>
          {wall ? (
            <RouteTile priority="primary" glyph="wall" to={`/e/${slug}/display`}>
              {t.admin.openWall}
            </RouteTile>
          ) : null}
          {moderation ? (
            <RouteTile priority="primary" glyph="moderate" to={`/admin/events/${slug}/moderation`}>
              {t.admin.openModeration}
            </RouteTile>
          ) : null}
        </div>
      ) : null}
      <div className={styles['group']}>
        {moderation ? (
          /*
            The same queue, one photo at a time. It lives here rather than only on the
            console because the host who needs it has already walked away from the
            laptop: this page is what they reach on a phone, and an address they would
            otherwise have to type is an address nobody uses.
          */
          <RouteTile
            priority="secondary"
            glyph="phone"
            to={`/admin/events/${slug}/moderation/mobile`}
          >
            {t.mobileModeration.title}
          </RouteTile>
        ) : null}
        <RouteTile priority="secondary" glyph="settings" to={`/admin/events/${slug}/settings`}>
          {t.admin.settings}
        </RouteTile>
        {/*
          A plain link, not a fetch: the ZIP is streamed and can be hundreds of
          megabytes, so the browser's own download manager is the right tool —
          buffering it through JavaScript is how a laptop runs out of memory
          halfway through an album.
        */}
        <a {...tileProps('secondary')} href={albumUrl} download>
          <TileBody glyph="album">{t.admin.download}</TileBody>
        </a>
      </div>
    </div>
  )
}
