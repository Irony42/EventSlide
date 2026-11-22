import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../../../design-system/classNames'
import type { BookPreviewDto, BookPreviewPageDto, BookPreviewPhotoDto } from '../../../lib/api/dto'
import {
  containBox,
  fitSize,
  polaroidFrame,
  polaroidRotation,
  ptPct,
  TRIM_PT,
  usedPct,
} from './bookGeometry'
import type { Sheet } from './bookSpreads'
import styles from './BookPageView.module.css'

/**
 * One face of the book, drawn in HTML and CSS the way `drawBook.ts` draws it in the PDF.
 *
 * It decides nothing: the server's plan says which template a page is, which photographs it holds,
 * where each sits in this style (`slots`), where the texts go (`boxes`) and every word that is printed
 * (the book's own language included). This file only puts them there, in the PDF's proportions: the
 * page is a container, a point of the PDF is `100cqw / 595.28`, so everything scales with the page,
 * from the big spread to the thumbnail of the strip.
 *
 * A browser cannot shrink a title to fit a box as the PDF does, so `fitSize` runs the same loop on an
 * estimate of the glyphs' width. Souvenir's kraft texture is a flat tone here, and Magazine's body
 * face (Inter) is the system sans: the app ships neither, and the preview says it is a preview.
 */

export interface BookPageViewProps {
  readonly preview: BookPreviewDto
  readonly sheet: Sheet
  /** `thumb` for the strip's miniatures, `display` for the open spread. */
  readonly quality: 'thumb' | 'display'
}

type Vars = CSSProperties & Record<`--${string}`, string | number>

const pt = (size: number): Vars => ({ '--fs': size })

const boxVars = (box: { x: number; y: number; w: number; h: number }): Vars => ({
  '--x': box.x,
  '--y': box.y,
  '--w': box.w,
  '--h': box.h,
})

const at = (box: { x: number; y: number; w: number; h: number }, size?: number): Vars => ({
  ...boxVars(box),
  ...(size === undefined ? {} : pt(size)),
})

/** The chapter's text box of a chapter opening: the template's own, which a `wide` page borrows. */
const CHAPTER_BOX = { x: 20, y: 34, w: 60, h: 32 }

interface Context {
  readonly preview: BookPreviewDto
  readonly quality: 'thumb' | 'display'
}

const urlOf = (context: Context, photo: BookPreviewPhotoDto): string =>
  context.quality === 'thumb' ? photo.thumbUrl : photo.displayUrl

const aspectOf = (photo: BookPreviewPhotoDto): number => photo.width / photo.height

export function BookPageView({ preview, sheet, quality }: BookPageViewProps) {
  const context: Context = { preview, quality }
  const colours: Vars = {
    '--bk-paper': preview.colours.paper,
    '--bk-ink': preview.colours.ink,
    '--bk-accent': preview.colours.accent,
    '--bk-accent-text': preview.colours.accentText,
    '--bk-accent-strong': preview.colours.accentStrong,
  }
  return (
    <div
      className={cx(styles['sheet'], styles[preview.style])}
      style={colours}
      data-book-page=""
      data-kind={sheet.kind === 'page' ? sheet.page.template : sheet.kind}
    >
      <div className={styles['in']}>{content(context, sheet)}</div>
    </div>
  )
}

const content = (context: Context, sheet: Sheet): ReactNode => {
  switch (sheet.kind) {
    case 'cover':
      return <Cover context={context} />
    case 'back':
      return <BackCover context={context} />
    case 'inside':
    case 'blank':
      return null
    case 'page':
      return <PlanPage context={context} page={sheet.page} half={sheet.half} />
  }
}

// ------------------------------------------------------------------ covers --

/** The short rule under a title: `share` of the box's width, centred, `y` percent down the page. */
const Rule = ({ box, share, y }: { box: { x: number; w: number }; share: number; y: number }) => (
  <i
    className={styles['rule']}
    style={{ '--x': box.x + (box.w * (1 - share)) / 2, '--w': box.w * share, '--y': y } as Vars}
  />
)

function Cover({ context }: { readonly context: Context }) {
  const { preview } = context
  const { cover, look } = preview
  const photo = cover.photo
  if (preview.style === 'magazine') {
    const box = { x: 8, y: 66 + ptPct(14), w: 84, h: 22 }
    const size = fitSize(cover.title, box, 60, 24)
    const used = usedPct(cover.title, box.w, size)
    return (
      <>
        <img className={styles['bleed']} src={urlOf(context, photo)} alt="" loading="lazy" />
        <i className={styles['shade']} />
        <p className={cx(styles['text'], styles['title'], styles['left'])} style={at(box, size)}>
          {cover.title}
        </p>
        <p
          className={cx(styles['text'], styles['authors'], styles['kicker'], styles['light'])}
          style={at({ ...box, y: box.y + used + ptPct(10), h: 4 }, Math.max(9, look.minBodySize))}
        >
          {cover.subtitle}
        </p>
      </>
    )
  }
  const box = { x: 12, y: 72, w: 76, h: 14 }
  const size = fitSize(cover.title, box, 32, 14)
  const used = usedPct(cover.title, box.w, size)
  return (
    <>
      {look.polaroid ? (
        <PolaroidPhoto
          context={context}
          photo={photo}
          slot={{ x: 17, y: 8, w: 66, h: 62 }}
          caption={null}
          mission={null}
        />
      ) : (
        <img
          className={styles['photo']}
          style={boxVars({ x: 14, y: 10, w: 72, h: 56 })}
          src={urlOf(context, photo)}
          alt=""
          loading="lazy"
        />
      )}
      <p className={cx(styles['text'], styles['title'], styles['center'])} style={at(box, size)}>
        {cover.title}
      </p>
      <Rule box={box} share={0.2} y={box.y + used + ptPct(8)} />
      <p
        className={cx(styles['text'], styles['body'], styles['center'])}
        style={at({ ...box, y: box.y + used + ptPct(18), h: 8 }, Math.max(12, look.minBodySize))}
      >
        {cover.subtitle}
      </p>
    </>
  )
}

function BackCover({ context }: { readonly context: Context }) {
  const { preview } = context
  const box = { x: 15, y: 36, w: 70, h: 14 }
  const size = fitSize(preview.cover.title, box, 22, 12)
  const used = usedPct(preview.cover.title, box.w, size)
  return (
    <>
      <p className={cx(styles['text'], styles['title'], styles['center'])} style={at(box, size)}>
        {preview.cover.title}
      </p>
      <Rule box={box} share={0.2} y={box.y + used + ptPct(8)} />
      <p
        className={cx(styles['text'], styles['body'], styles['center'])}
        style={at(
          { ...box, y: box.y + used + ptPct(18), h: 8 },
          Math.max(10, preview.look.minBodySize),
        )}
      >
        {preview.cover.subtitle}
      </p>
      <p
        className={cx(styles['text'], styles['authors'], styles['center'], styles['faint'])}
        style={at({ x: 25, y: 86, w: 50, h: 4 }, Math.max(8, preview.look.minBodySize))}
      >
        {preview.texts.createdWith}
      </p>
    </>
  )
}

// -------------------------------------------------------------- plan pages --

function PlanPage({
  context,
  page,
  half,
}: {
  readonly context: Context
  readonly page: BookPreviewPageDto
  readonly half: 'left' | 'right' | null
}) {
  const { preview } = context
  const body = (size: number): number => Math.max(size, preview.look.minBodySize)
  const loud = preview.style === 'magazine'
  const { texts } = preview
  switch (page.template) {
    case 'title':
      return <TitlePage context={context} page={page} />
    case 'contents':
      return <Contents context={context} page={page} />
    case 'stats': {
      const cells: [number, string][] = [
        [preview.stats.photos, texts.statPhotos],
        [preview.stats.photographers, texts.statPhotographers],
        [preview.stats.hearts, texts.statHearts],
        [preview.stats.messages, texts.statMessages],
      ]
      return (
        <>
          <p
            className={cx(
              styles['text'],
              styles['authors'],
              styles['center'],
              styles['accentText'],
              loud && styles['kicker'],
            )}
            style={at({ x: 15, y: 12, w: 70, h: 6 }, body(10))}
          >
            {texts.statsTitle}
          </p>
          {cells.map(([value, label], i) => (
            <div
              key={label}
              className={cx(styles['text'], styles['stat'])}
              style={boxVars(page.boxes[i]!)}
            >
              <span
                className={cx(styles['title'], styles['accentText'])}
                style={pt(loud ? 54 : 38)}
              >
                {value.toLocaleString(preview.language)}
              </span>
              <span className={styles['body']} style={pt(body(11))}>
                {label}
              </span>
            </div>
          ))}
        </>
      )
    }
    case 'chapter':
      return <Chapter context={context} page={page} overPhoto={false} />
    case 'quote': {
      const message = page.messages[0]
      if (message === undefined) return null
      const box = page.boxes[0]!
      return (
        <>
          <p
            className={cx(
              styles['text'],
              styles['title'],
              styles['center'],
              styles['accentText'],
              styles['quoteMark'],
            )}
            style={at(box, 44)}
          >
            “
          </p>
          <p
            className={cx(styles['text'], styles['body'], styles['center'], styles['quote'])}
            style={at(box, fitSize(message.text, { w: box.w, h: box.h * 0.78 }, 15, 9))}
          >
            {message.text}
          </p>
          {message.author === null ? null : (
            <p
              className={cx(
                styles['text'],
                styles['authors'],
                styles['center'],
                styles['accentText'],
              )}
              style={at({ ...box, y: box.y + box.h - ptPct(10), h: 5 }, body(9))}
            >
              {message.author}
            </p>
          )}
        </>
      )
    }
    case 'messages':
      return (
        <>
          {page.firstMessages ? (
            <p
              className={cx(styles['text'], styles['title'], styles['center'])}
              style={at({ x: 15, y: 6, w: 70, h: 6 }, 14)}
            >
              {texts.guestbook}
            </p>
          ) : null}
          {page.messages.map((message, i) => (
            <div
              key={`${message.text}-${i}`}
              className={cx(styles['text'], styles['message'])}
              style={boxVars(page.boxes[i]!)}
            >
              <span className={styles['body']} style={pt(body(9))}>
                {message.text}
              </span>
              {message.author === null ? null : (
                <span className={cx(styles['authors'], styles['accentText'])} style={pt(body(8))}>
                  {`— ${message.author}`}
                </span>
              )}
            </div>
          ))}
        </>
      )
    case 'thanks': {
      const list = page.boxes[1]!
      const joined = preview.thanks.names.map((p) => `${p.name} (${p.photoCount})`).join('  ·  ')
      return (
        <>
          <p
            className={cx(styles['text'], styles['title'], styles['center'])}
            style={at(page.boxes[0]!, fitSize(preview.thanks.heading, page.boxes[0]!, 20, 12))}
          >
            {preview.thanks.heading}
          </p>
          <p
            className={cx(styles['text'], styles['body'], styles['center'], styles['thanksList'])}
            style={at(list, fitSize(joined, list, body(12), body(7)))}
          >
            {joined}
          </p>
        </>
      )
    }
    case 'end':
      return (
        <>
          <p
            className={cx(styles['text'], styles['body'], styles['center'], styles['notes'])}
            style={at(page.boxes[0]!, body(11))}
          >
            {preview.closingNotes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </p>
          <p
            className={cx(styles['text'], styles['authors'], styles['center'], styles['faint'])}
            style={at(page.boxes[1]!, body(8))}
          >
            {texts.createdWith}
          </p>
        </>
      )
    case 'favourites':
      return (
        <>
          <p
            className={cx(
              styles['text'],
              styles['authors'],
              styles['center'],
              styles['accentText'],
              loud && styles['kicker'],
            )}
            style={at({ x: 15, y: 4.9, w: 70, h: 2.8 }, 8.5)}
          >
            {texts.favourites}
          </p>
          <Photos context={context} page={page} />
        </>
      )
    case 'blank':
      return null
    case 'wide':
      return <Wide context={context} page={page} half={half ?? 'left'} />
    default:
      return <Photos context={context} page={page} />
  }
}

function TitlePage({
  context,
  page,
}: {
  readonly context: Context
  readonly page: BookPreviewPageDto
}) {
  const { preview } = context
  const box = page.boxes[0]!
  const size = fitSize(preview.cover.title, box, 34, 16)
  const used = usedPct(preview.cover.title, box.w, size)
  return (
    <>
      <p
        className={cx(styles['text'], styles['title'], styles['center'], styles['middle'])}
        style={at(box, size)}
      >
        {preview.cover.title}
      </p>
      <Rule box={box} share={0.3} y={box.y + (box.h + used) / 2 + ptPct(10)} />
      <p
        className={cx(styles['text'], styles['body'], styles['center'])}
        style={at(
          { ...box, y: box.y + box.h + ptPct(14), h: 8 },
          Math.max(12, preview.look.minBodySize),
        )}
      >
        {preview.cover.subtitle}
      </p>
    </>
  )
}

function Contents({
  context,
  page,
}: {
  readonly context: Context
  readonly page: BookPreviewPageDto
}) {
  const { preview } = context
  const loud = preview.style === 'magazine'
  const body = Math.max(12, preview.look.minBodySize)
  const heading = page.boxes[0]!
  const list = page.boxes[1]!
  const rows = preview.contents
  const listHeightPt = (list.h / 100) * TRIM_PT
  const step = Math.min(26, listHeightPt / Math.max(1, rows.length))
  return (
    <>
      <p
        className={cx(styles['text'], styles['title'], styles['center'])}
        style={at(heading, loud ? 32 : 24)}
      >
        {preview.texts.contents}
      </p>
      <ol
        className={cx(styles['text'], styles['contents'])}
        style={{ ...boxVars(list), '--step': step } as Vars}
      >
        {rows.map((row) => (
          <li key={`${row.label}-${row.page}`} className={styles['row']}>
            <span className={styles['body']} style={pt(body)}>
              {row.label}
            </span>
            <i className={styles['leader']} />
            <span
              className={cx(styles['authors'], styles['accentText'])}
              style={pt(Math.max(10, preview.look.minBodySize))}
            >
              {row.page}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}

function Chapter({
  context,
  page,
  overPhoto,
}: {
  readonly context: Context
  readonly page: BookPreviewPageDto
  readonly overPhoto: boolean
}) {
  const { preview } = context
  const chapter = preview.chapters[page.chapter ?? 0]
  if (chapter === undefined) return null
  const loud = preview.style === 'magazine'
  const box = page.boxes[0] ?? CHAPTER_BOX
  const body = Math.max(11, preview.look.minBodySize)
  return (
    <div
      className={cx(styles['text'], styles['chapter'], overPhoto && styles['overPhoto'])}
      style={boxVars(box)}
    >
      <span className={cx(styles['title'], styles['chapterNumeral'])} style={pt(loud ? 72 : 40)}>
        {chapter.numeral}
      </span>
      <span
        className={cx(styles['title'], styles['chapterTitle'])}
        style={pt(fitSize(chapter.title, { w: box.w, h: 22 }, loud ? 36 : 26, 14))}
      >
        {chapter.title}
      </span>
      <i className={styles['chapterRule']} />
      <span
        className={cx(loud ? styles['authors'] : styles['body'], loud && styles['kicker'])}
        style={pt(body)}
      >
        {chapter.subtitle}
      </span>
    </div>
  )
}

function Wide({
  context,
  page,
  half,
}: {
  readonly context: Context
  readonly page: BookPreviewPageDto
  readonly half: 'left' | 'right'
}) {
  const photo = page.photos[0]
  if (photo === undefined) return null
  return (
    <>
      <div className={styles['wide']}>
        <img
          className={cx(styles['wideImage'], half === 'right' && styles['wideRight'])}
          src={urlOf(context, photo)}
          alt=""
          loading="lazy"
        />
      </div>
      {half === 'left' ? <Chapter context={context} page={page} overPhoto /> : null}
      {half === 'right' && photo.caption !== null ? (
        <p
          className={cx(styles['text'], styles['body'], styles['wideCaption'])}
          style={at({ x: 6, y: 90, w: 88, h: 4 }, 10)}
        >
          {photo.caption}
        </p>
      ) : null}
    </>
  )
}

// ------------------------------------------------------------------ photos --

function Photos({
  context,
  page,
}: {
  readonly context: Context
  readonly page: BookPreviewPageDto
}) {
  const { preview } = context
  return (
    <>
      {page.photos.map((photo, index) => {
        const slot = page.slots[index]!
        if (preview.look.polaroid) {
          return (
            <PolaroidPhoto
              key={photo.id}
              context={context}
              photo={photo}
              slot={slot}
              caption={photo.caption}
              mission={photo.missionLabel}
            />
          )
        }
        return (
          <FlatPhoto key={photo.id} context={context} page={page} photo={photo} index={index} />
        )
      })}
    </>
  )
}

function FlatPhoto({
  context,
  page,
  photo,
  index,
}: {
  readonly context: Context
  readonly page: BookPreviewPageDto
  readonly photo: BookPreviewPhotoDto
  readonly index: number
}) {
  const { preview } = context
  const slot = page.slots[index]!
  const full = page.template === 'full'
  const bleeds = preview.look.fullBleed && full
  const shown = slot.contain ? containBox(slot, aspectOf(photo)) : slot
  const lone = page.template === 'single' || (full && preview.style === 'classique')
  const loud = preview.style === 'magazine'
  const accentBody = Math.max(8, preview.look.minBodySize)
  let credit: ReactNode = null
  if (lone) {
    credit = (
      <div
        className={cx(styles['text'], styles['credit'])}
        style={
          { ...boxVars({ x: slot.x, y: shown.y + shown.h, w: slot.w, h: 7 }), '--gap': 6 } as Vars
        }
      >
        {photo.caption === null ? null : (
          <span className={styles['body']} style={pt(11)}>
            {photo.caption}
          </span>
        )}
        {photo.author === null ? null : (
          <span className={cx(styles['authors'], styles['accentText'])} style={pt(accentBody)}>
            {photo.author}
          </span>
        )}
        {photo.missionLabel === null ? null : (
          <span className={cx(styles['body'], styles['faint'])} style={pt(8)}>
            {photo.missionLabel}
          </span>
        )}
      </div>
    )
  } else if (bleeds && (photo.caption !== null || photo.author !== null)) {
    credit = (
      <p className={cx(styles['text'], styles['band'], styles['body'])} style={pt(11)}>
        {[photo.caption, photo.author].filter(Boolean).join('  ')}
      </p>
    )
  } else if (photo.caption !== null) {
    credit = (
      <p
        className={cx(styles['text'], styles['bar'], styles['body'])}
        style={{ ...boxVars({ x: shown.x, y: shown.y, w: shown.w, h: shown.h }), ...pt(7) }}
      >
        <span>{photo.caption}</span>
      </p>
    )
  }
  return (
    <>
      <img
        className={cx(styles['photo'], slot.contain && styles['contain'], bleeds && styles['edge'])}
        style={boxVars(bleeds ? { x: 0, y: 0, w: 100, h: 100 } : slot)}
        src={urlOf(context, photo)}
        alt=""
        loading="lazy"
      />
      {credit}
      {loud && photo.hearts > 0 && slot.hero ? (
        <span className={cx(styles['hearts'], styles['authors'])} style={pt(8)}>
          {`♥ ${photo.hearts}`}
        </span>
      ) : null}
    </>
  )
}

function PolaroidPhoto({
  context,
  photo,
  slot,
  caption,
  mission,
}: {
  readonly context: Context
  readonly photo: BookPreviewPhotoDto
  readonly slot: { x: number; y: number; w: number; h: number }
  readonly caption: string | null
  readonly mission: string | null
}) {
  const { frame, photo: inner, bandPt, padPct } = polaroidFrame(slot, aspectOf(photo))
  const vars: Vars = {
    ...boxVars(frame),
    '--rot': `${polaroidRotation(photo.id)}deg`,
    '--band': bandPt,
  }
  return (
    <div className={styles['polaroid']} style={vars}>
      <img
        className={styles['polaroidPhoto']}
        style={
          {
            '--px': ((inner.x - frame.x) / frame.w) * 100,
            '--py': ((inner.y - frame.y) / frame.h) * 100,
            '--pw': (inner.w / frame.w) * 100,
            '--ph': (inner.h / frame.h) * 100,
          } as Vars
        }
        src={urlOf(context, photo)}
        alt=""
        loading="lazy"
      />
      {caption === null ? null : (
        <span
          className={cx(styles['polaroidCaption'], styles['body'])}
          style={{ '--pad': padPct } as Vars}
        >
          {caption}
        </span>
      )}
      <i className={styles['tape']} />
      {mission === null ? null : (
        <span className={cx(styles['sticker'], styles['authors'])}>{mission}</span>
      )}
    </div>
  )
}
