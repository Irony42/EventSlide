import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { VisuallyHidden } from '../../../design-system/components/VisuallyHidden'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useArchiveDownload } from '../hooks/useArchiveDownload'
import { EventActionIcon, type EventActionGlyph } from './EventActionIcon'
import styles from './EventTiles.module.css'

/**
 * The event page's tiles, in two sizes.
 *
 * Surface: the host and the moderator, on the laptop and on the phone they are holding by the
 * end of the evening. A **large** tile is one of the two things the moment turns on (the queue
 * and the screen during the evening, the album after it) and lives in the "Maintenant" card; a
 * **small** one is everything else, in the overview grid under it. Each tile is what it does: a
 * route stays a real `<a href>` (a new tab, a copied address), the ZIP stays a download, and the
 * one kind that is a button is the one that moves within the page, to a panel further down.
 */

export type TileSize = 'large' | 'small'

interface TileContent {
  readonly size: TileSize
  readonly glyph: EventActionGlyph
  readonly children: ReactNode
  /** A line under the label, for what the tile will do or what is waiting there. */
  readonly hint?: string | undefined
  /** A number that wants the host's attention (photos waiting): drawn as a badge, said in the hint. */
  readonly count?: number | undefined
  /** The region name the first visit's guided tour lights this tile by (`data-tour`). */
  readonly tour?: string | undefined
}

/**
 * What makes an element a tile of a size. The attribute is the whole mechanism: the stylesheet
 * reads `data-size` and nothing else, so what a test asserts is what is drawn.
 */
const tileProps = (size: TileSize, attention: boolean, tour: string | undefined) => ({
  className: styles['tile'],
  'data-size': size,
  ...(attention ? { 'data-attention': '' } : {}),
  ...(tour === undefined ? {} : { 'data-tour': tour }),
})

/** What is inside a tile. The glyph and the badge are decoration: the label is the name. */
function TileBody({
  glyph,
  children,
  hint,
  hintId,
  count,
}: Omit<TileContent, 'size'> & { readonly hintId: string }) {
  return (
    <>
      <EventActionIcon glyph={glyph} className={styles['glyph']} />
      <span className={styles['text']}>
        <span className={styles['label']}>{children}</span>
        {/* Seen, but not part of the name: the tile describes itself with this line. */}
        {hint === undefined ? null : (
          <span id={hintId} className={styles['hint']} aria-hidden="true">
            {hint}
          </span>
        )}
      </span>
      {/* The hint says the number in words; the badge is the same number for the eye. */}
      {count === undefined || count === 0 ? null : (
        <span className={styles['count']} aria-hidden="true">
          {count}
        </span>
      )}
    </>
  )
}

/**
 * A route inside the app: a real `<a href>`, so middle-click and "open in a new tab" work.
 *
 * `newTab` is the wall's alone: it is the projector's screen, the console must still be there,
 * one tab away, when the host comes back, and the wall has no way back to it of its own.
 * `noopener`, so the wall cannot reach the console that opened it.
 */
export function RouteTile({
  to,
  size,
  glyph,
  children,
  hint,
  count,
  tour,
  newTab = false,
}: TileContent & { readonly to: string; readonly newTab?: boolean }) {
  const t = useTranslations()
  const newTabId = useId()
  const hintId = useId()
  // The link's description: that it opens a tab, and what the tile says under its name.
  const described = (): string => {
    if (newTab && hint !== undefined) return `${newTabId} ${hintId}`
    if (newTab) return newTabId
    return hint === undefined ? '' : hintId
  }
  const describedBy = described()
  return (
    <>
      <Link
        {...tileProps(size, count !== undefined && count > 0, tour)}
        to={to}
        {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
        {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
      >
        <TileBody glyph={glyph} hint={hint} hintId={hintId} count={count}>
          {children}
        </TileBody>
      </Link>
      {newTab ? <VisuallyHidden id={newTabId}>{t.about.opensInNewTab}</VisuallyHidden> : null}
    </>
  )
}

/**
 * The album as a ZIP. A plain link: the ZIP is streamed and can be hundreds of
 * megabytes, so the browser's own download manager is the right tool — buffering it through
 * JavaScript is how a laptop runs out of memory halfway through an album. A click only asks the server
 * first (headers, never the body) so that a `429` or `503` becomes a sentence (`useArchiveDownload`).
 */
export function DownloadTile({
  href,
  size,
  glyph,
  children,
  hint,
  tour,
}: Omit<TileContent, 'count'> & { readonly href: string }) {
  const hintId = useId()
  const downloadArchive = useArchiveDownload()
  return (
    <a
      {...tileProps(size, false, tour)}
      href={href}
      download
      onClick={downloadArchive}
      {...(hint === undefined ? {} : { 'aria-describedby': hintId })}
    >
      <TileBody glyph={glyph} hint={hint} hintId={hintId}>
        {children}
      </TileBody>
    </a>
  )
}

/** A panel further down this page: a button, because it moves within the page rather than away. */
export function PanelTile({
  onOpen,
  size,
  glyph,
  children,
  hint,
  count,
  tour,
}: TileContent & { readonly onOpen: () => void }) {
  const hintId = useId()
  return (
    <button
      type="button"
      {...tileProps(size, count !== undefined && count > 0, tour)}
      onClick={onOpen}
      {...(hint === undefined ? {} : { 'aria-describedby': hintId })}
    >
      <TileBody glyph={glyph} hint={hint} hintId={hintId} count={count}>
        {children}
      </TileBody>
    </button>
  )
}

/** A row of tiles that wraps as a whole, each growing to fill what is left. */
export function TileGroup({
  size,
  children,
}: {
  readonly size: TileSize
  readonly children: ReactNode
}) {
  return (
    <div className={styles['group']} data-size={size}>
      {children}
    </div>
  )
}
