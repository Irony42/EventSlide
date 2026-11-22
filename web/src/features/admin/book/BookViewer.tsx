import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { cx } from '../../../design-system/classNames'
import type { BookPreviewDto } from '../../../lib/api/dto'
import type { UiText } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { BookPageView } from './BookPageView'
import {
  findSpread,
  sheetsOf,
  singlesOf,
  spreadOfFace,
  spreadsOf,
  type Sheet,
  type Spread,
} from './bookSpreads'
import styles from './BookViewer.module.css'

/** Under this width, in pixels, the viewer shows one face at a time. */
export const SINGLE_BELOW_PX = 560
/** Miniatures are drawn this many spreads around the open one; farther ones are numbered chips. */
export const STRIP_WINDOW = 20

export interface BookViewerFocus {
  /** Changes when the host did something that deserves a look (a different value jumps again). */
  readonly nonce: number
  readonly wanted: (sheet: Sheet) => boolean
}

export interface BookViewerProps {
  readonly preview: BookPreviewDto
  /** The face the viewer is open on (an index in the faces), shared by every viewer of the page. */
  readonly face: number
  readonly onFace: (face: number) => void
  /** Where to jump when a setting changed something: the cover for a title, the guest book... */
  readonly focus?: BookViewerFocus | undefined
  /**
   * Whether the plan shown is the one for the settings as they are now. A jump waits for it: the
   * guest-book pages are not there yet in the plan made before the box was ticked.
   */
  readonly settled?: boolean
  /** Draws the strip of miniatures under the book. */
  readonly strip?: boolean
  /** Forces one face at a time, whatever the width (the phone's pinned preview). */
  readonly single?: boolean
}

const faceLabel = (text: UiText, sheet: Sheet | null): string => {
  if (sheet === null) return ''
  switch (sheet.kind) {
    case 'cover':
      return text.bookPage.cover
    case 'inside':
      return text.bookPage.inside
    case 'blank':
      return ''
    case 'back':
      return text.bookPage.backCover
    case 'page':
      return text.bookPage.pageNumber(sheet.number)
  }
}

/** What the two faces of a spread are called: "Pages 4 et 5", "Couverture"... */
export const spreadLabel = (text: UiText, spread: Spread): string => {
  const { left, right } = spread
  if (left?.kind === 'page' && right?.kind === 'page') {
    return text.bookPage.pageNumbers(left.number, right.number)
  }
  return [faceLabel(text, left), faceLabel(text, right)].filter((part) => part !== '').join(' · ')
}

/**
 * The book lying open, with the controls to turn it: previous and next, the arrow keys, and a strip of
 * miniatures. The faces come from the server's plan (`sheetsOf`); two at a time on a wide stage, one on
 * a narrow one. Reading it needs no pointer: the stage is focusable and the arrows turn the pages.
 */
export function BookViewer({
  preview,
  face,
  onFace,
  focus,
  settled = true,
  strip = true,
  single,
}: BookViewerProps) {
  const t = useTranslations()
  const root = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)

  // One face at a time under 560 px of viewer. `ResizeObserver` is absent from some test and
  // embedded environments: the viewer then stays on two faces.
  useEffect(() => {
    const node = root.current
    if (node === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setNarrow(entry.contentRect.width < SINGLE_BELOW_PX)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const sheets = useMemo(() => sheetsOf(preview), [preview])
  const alone = single === true || narrow
  const spreads = useMemo(() => (alone ? singlesOf(sheets) : spreadsOf(sheets)), [alone, sheets])
  const index = spreadOfFace(spreads, Math.min(face, sheets.length - 1))
  const spread = spreads[index]!

  // A setting that changed something jumps to it, once per change.
  const jumped = useRef(focus?.nonce ?? 0)
  useEffect(() => {
    if (focus === undefined || focus.nonce === jumped.current || !settled) return
    jumped.current = focus.nonce
    const target = findSpread(spreads, focus.wanted)
    if (target !== null) onFace(spreads[target]!.at)
  }, [focus, settled, spreads, onFace])

  // The miniature of the open spread stays in view.
  const current = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    current.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [index])

  const go = (to: number): void => {
    const clamped = Math.max(0, Math.min(spreads.length - 1, to))
    onFace(spreads[clamped]!.at)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowLeft') go(index - 1)
    else if (event.key === 'ArrowRight') go(index + 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(spreads.length - 1)
    else return
    event.preventDefault()
  }

  return (
    <div className={styles['viewer']} ref={root}>
      <div
        className={styles['stage']}
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label={t.bookPage.previewLabel}
        onKeyDown={onKeyDown}
      >
        <div className={cx(styles['spread'], alone && styles['alone'])} data-spread={index}>
          <div className={styles['face']}>
            {spread.left === null ? null : (
              <BookPageView preview={preview} sheet={spread.left} quality="display" />
            )}
          </div>
          {alone ? null : (
            <div className={styles['face']}>
              {spread.right === null ? null : (
                <BookPageView preview={preview} sheet={spread.right} quality="display" />
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles['controls']}>
        <Button
          variant="secondary"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label={t.bookPage.prev}
        >
          ‹
        </Button>
        <span className={styles['position']} role="status" aria-live="polite">
          <span>{spreadLabel(t, spread)}</span>
          <span className={styles['count']}>
            {alone
              ? `${index + 1} / ${spreads.length}`
              : t.bookPage.spreadPosition(index + 1, spreads.length)}
          </span>
        </span>
        <Button
          variant="secondary"
          onClick={() => go(index + 1)}
          disabled={index === spreads.length - 1}
          aria-label={t.bookPage.next}
        >
          ›
        </Button>
      </div>

      {strip ? (
        <div
          className={styles['strip']}
          data-part="strip"
          role="group"
          aria-label={t.bookPage.stripLabel}
        >
          {spreads.map((item, position) => {
            const near = Math.abs(position - index) <= STRIP_WINDOW
            return (
              <button
                key={item.at}
                ref={position === index ? current : undefined}
                type="button"
                className={cx(
                  styles['thumb'],
                  item.left !== null && item.right !== null && styles['pair'],
                )}
                aria-current={position === index ? 'true' : undefined}
                aria-label={t.bookPage.stripItem(spreadLabel(t, item))}
                onClick={() => go(position)}
              >
                {near ? (
                  <>
                    {item.left === null ? (
                      <span />
                    ) : (
                      <BookPageView preview={preview} sheet={item.left} quality="thumb" />
                    )}
                    {alone ? null : item.right === null ? (
                      <span />
                    ) : (
                      <BookPageView preview={preview} sheet={item.right} quality="thumb" />
                    )}
                  </>
                ) : (
                  <span className={styles['chip']}>{position + 1}</span>
                )}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
