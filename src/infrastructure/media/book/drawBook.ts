import type { BookRenderInput, PageTexts } from '../../../application/ports/bookRenderer'
import type { PlanPage } from '../../../domain/book/bookPlan'
import { polaroidRotation } from '../../../domain/book/bookStyles'
import { BOOK_TEMPLATES, type TemplateId, type TemplateSlot } from '../../../domain/book/bookTemplates'
import { chapterSubtitleText, chapterTitleText } from '../../../domain/book/bookChapters'
import type { PhotoId } from '../../../domain/shared/ids'
import {
  kraftTexture,
  pixelsFor,
  prepareContain,
  prepareCover,
  reduce,
  shadowImage,
  type Prepared,
} from './bookImages'
import { covers, facesOf, type FaceRole, type Faces } from './bookFonts'

/**
 * The drawing of one page (spec 26, section 6). **The renderer decides nothing**: it reads the plan
 * and the style and puts what they say where they say, in points.
 *
 * A page is a square: 210 mm to the cut. For the printer version the same page is drawn on 216 mm,
 * the cut inset by 3 mm, so that what bleeds runs into the extra millimetres and everything else is
 * where it is on screen. The geometry is the template's, in percent of the cut page.
 */

export const MM = 72 / 25.4
export const TRIM_PT = 210 * MM
export const BLEED_PT = 3 * MM

export type Mode = 'screen' | 'print'

/** Resolution and quality of each file (spec 26, 4.8). */
const SCREEN = { dpi: 150, quality: 82 } as const
const PRINT = { dpi: 300, quality: 90 } as const

/** Fixed sizes: the 500-character message and the 280-character quote fit their boxes at these. */
/** The line under a message (the first name) takes this much of its box. */
const AUTHOR_LINE = 12
export const MESSAGE_FONT_SIZE = 7
export const QUOTE_FONT_SIZE = 15

export interface DrawContext {
  readonly doc: PDFKit.PDFDocument
  readonly mode: Mode
  /** Whether a printer version is made too: a prepared photograph is then kept at printer size. */
  readonly withPrint: boolean
  readonly input: BookRenderInput
  readonly faces: Faces
  /** Photograph bytes of the page being drawn, and what was prepared from them. */
  readonly bytes: ReadonlyMap<PhotoId, Uint8Array>
  readonly prepared: Map<string, Prepared>
  readonly texts: PageTexts
}

const origin = (mode: Mode): number => (mode === 'print' ? BLEED_PT : 0)

/** A box in percent of the cut page, as points on the sheet. `spanOffset` shifts the right half of a double page. */
interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

const toRect = (
  mode: Mode,
  box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  span = 1,
): Rect => ({
  x: origin(mode) + (box.x / 100) * TRIM_PT * span,
  y: origin(mode) + (box.y / 100) * TRIM_PT,
  w: (box.w / 100) * TRIM_PT * span,
  h: (box.h / 100) * TRIM_PT,
})

// ------------------------------------------------------------------- text --

/** The face a text is drawn in: the style's own if it has every glyph, the family's fallback if not. */
const faceFor = (ctx: DrawContext, role: FaceRole, text: string): string => {
  const { faces } = ctx
  if (faces.designed[role] && covers(faces.paths[role], text)) return faces.paths[role]
  if (!faces.designed[role]) return faces.paths[role]
  return role === 'title' ? faces.fallback.bold : faces.fallback.regular
}

interface TextOptions {
  readonly role: FaceRole
  readonly size: number
  readonly color: string
  readonly align?: 'left' | 'center' | 'right'
  /** Shrink to fit the box height (down to `minSize`). */
  readonly fit?: boolean
  readonly minSize?: number
  readonly valign?: 'top' | 'middle'
  readonly lineGap?: number
  readonly opacity?: number
}

/** Draws text in a box; answers the height it took. */
const drawText = (ctx: DrawContext, text: string, box: Rect, options: TextOptions): number => {
  if (text === '') return 0
  const { doc } = ctx
  doc.font(faceFor(ctx, options.role, text))
  let size = options.size
  const lineGap = options.lineGap ?? 0
  const measure = (): number => {
    doc.fontSize(size)
    return doc.heightOfString(text, { width: box.w, lineGap })
  }
  let height = measure()
  if (options.fit === true) {
    const floor = options.minSize ?? 6
    while (height > box.h && size > floor) {
      size -= 0.5
      height = measure()
    }
  }
  const y = options.valign === 'middle' ? box.y + Math.max(0, (box.h - height) / 2) : box.y
  doc.save()
  doc.fillColor(options.color).opacity(options.opacity ?? 1)
  doc.text(text, box.x, y, {
    width: box.w,
    height: box.h,
    align: options.align ?? 'left',
    lineGap,
    ellipsis: true,
  })
  doc.restore()
  return height
}

/** Does a message of this text fit the box of a `messages` page at the fixed size? (the render test asks) */
export const messageFits = (doc: PDFKit.PDFDocument, font: string, text: string): boolean => {
  const box = toRect('screen', BOOK_TEMPLATES.messages.texts[0]!)
  doc.font(font).fontSize(MESSAGE_FONT_SIZE)
  return doc.heightOfString(text, { width: box.w, lineGap: 1 }) <= box.h - AUTHOR_LINE
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

// ----------------------------------------------------------------- images --

const keyOf = (id: PhotoId, rect: Rect, fit: 'cover' | 'contain'): string =>
  `${id}|${Math.round(rect.w)}x${Math.round(rect.h)}|${fit}`

/**
 * A photograph at the size of its box: decoded and cropped once at the printer's resolution when the
 * printer version is made, the screen copy being a reduction of it; at screen resolution otherwise.
 */
const imageFor = async (
  ctx: DrawContext,
  id: PhotoId,
  rect: Rect,
  fit: 'cover' | 'contain',
): Promise<Prepared> => {
  const bytes = ctx.bytes.get(id) as Uint8Array
  const key = keyOf(id, rect, fit)
  const wMm = rect.w / MM
  const hMm = rect.h / MM
  const make = fit === 'cover' ? prepareCover : prepareContain
  if (!ctx.withPrint) {
    return make(bytes, pixelsFor(wMm, SCREEN.dpi), pixelsFor(hMm, SCREEN.dpi), SCREEN.quality)
  }
  let big = ctx.prepared.get(key)
  if (big === undefined) {
    big = await make(bytes, pixelsFor(wMm, PRINT.dpi), pixelsFor(hMm, PRINT.dpi), PRINT.quality)
    ctx.prepared.set(key, big)
  }
  if (ctx.mode === 'print') return big
  const ratio = SCREEN.dpi / PRINT.dpi
  return reduce(
    big,
    Math.max(1, Math.round(big.width * ratio)),
    Math.max(1, Math.round(big.height * ratio)),
    SCREEN.quality,
  )
}

/** Puts a prepared photograph in a box, centred (a contained one keeps its own shape). */
const putImage = (ctx: DrawContext, image: Prepared, rect: Rect): void => {
  const scale = Math.min(rect.w / image.width, rect.h / image.height)
  const w = image.width * scale
  const h = image.height * scale
  ctx.doc.image(image.jpeg, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, {
    width: w,
    height: h,
  })
}

const imageBox = (image: Prepared, rect: Rect): Rect => {
  const scale = Math.min(rect.w / image.width, rect.h / image.height)
  const w = image.width * scale
  const h = image.height * scale
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h }
}

// ------------------------------------------------------------- the paper --

export const drawPaper = async (ctx: DrawContext): Promise<void> => {
  const { doc, input, mode } = ctx
  const size = TRIM_PT + 2 * origin(mode)
  doc.rect(0, 0, size, size).fill(input.colours.paper)
  if (input.style.id === 'souvenir') {
    const tile = await kraftTexture()
    const edge = 256 * 0.6
    for (let x = 0; x < size; x += edge) {
      for (let y = 0; y < size; y += edge) doc.image(tile, x, y, { width: edge, height: edge })
    }
  }
}

// ---------------------------------------------------------------- photos --

interface PhotoExtras {
  readonly caption: string | null
  readonly author: string | null
  readonly mission: string | null
  readonly hearts: number
}

const heart = (doc: PDFKit.PDFDocument, x: number, y: number, size: number, color: string): void => {
  const s = size / 20
  doc
    .save()
    .translate(x, y)
    .scale(s)
    .path('M10 18 C-6 6 2 -4 10 4 C18 -4 26 6 10 18 Z')
    .fill(color)
    .restore()
}

/** The slot a template gives a photograph in this style (`full` is a `single` in Classique, inset in Souvenir). */
const slotFor = (ctx: DrawContext, template: TemplateId, index: number): TemplateSlot => {
  const style = ctx.input.style.id
  if (template === 'full' && style === 'classique') return BOOK_TEMPLATES.single.slots[0]!
  if (template === 'full' && style === 'souvenir') {
    return { x: 8, y: 8, w: 84, h: 84, role: 'hero' }
  }
  return BOOK_TEMPLATES[template].slots[index]!
}

const drawPolaroid = async (
  ctx: DrawContext,
  id: PhotoId,
  slot: Rect,
  extras: PhotoExtras,
  contain: boolean,
): Promise<void> => {
  const { doc, input } = ctx
  const pad = 0.045 * Math.min(slot.w, slot.h)
  const bottom = 0.17 * slot.h
  const inner: Rect = {
    x: slot.x + pad,
    y: slot.y + pad,
    w: slot.w - 2 * pad,
    h: slot.h - pad - bottom,
  }
  const image = await imageFor(ctx, id, inner, contain ? 'contain' : 'cover')
  const shown = contain ? imageBox(image, inner) : inner
  const cx = slot.x + slot.w / 2
  const cy = slot.y + slot.h / 2
  doc.save()
  doc.rotate(polaroidRotation(id), { origin: [cx, cy] })
  doc.image(await shadowImage(), slot.x - slot.w * 0.15, slot.y - slot.h * 0.1, {
    width: slot.w * 1.3,
    height: slot.h * 1.3,
  })
  doc.rect(slot.x, slot.y, slot.w, slot.h).fill('#ffffff')
  doc.image(image.jpeg, shown.x, shown.y, { width: shown.w, height: shown.h })
  const line: Rect = {
    x: slot.x + pad,
    y: slot.y + slot.h - bottom + pad * 0.3,
    w: slot.w - 2 * pad,
    h: bottom - pad * 0.6,
  }
  if (extras.caption !== null) {
    drawText(ctx, extras.caption, line, {
      role: 'body',
      size: 10,
      minSize: 6,
      fit: true,
      color: input.colours.ink,
      align: 'center',
      valign: 'middle',
    })
  }
  // The ribbon in the theme's colour, and the host's mission as a sticker.
  doc.save()
  doc.rotate(-5, { origin: [cx, slot.y + slot.h] })
  doc.opacity(0.85).rect(cx - slot.w * 0.14, slot.y + slot.h - slot.h * 0.024, slot.w * 0.28, slot.h * 0.045)
  doc.fill(input.colours.accent)
  doc.restore()
  if (extras.mission !== null) {
    const sticker: Rect = { x: slot.x - pad, y: slot.y + slot.h * 0.04, w: slot.w * 0.62, h: slot.h * 0.09 }
    doc.rect(sticker.x, sticker.y, sticker.w, sticker.h).fill(input.colours.accent)
    drawText(ctx, input.texts.mission(extras.mission), { ...sticker, x: sticker.x + 3, w: sticker.w - 6 }, {
      role: 'authors',
      size: 7,
      fit: true,
      minSize: 5,
      color: '#ffffff',
      valign: 'middle',
    })
  }
  doc.restore()
}

/** One photograph of a slot, drawn the way the style draws it. */
const drawPhoto = async (
  ctx: DrawContext,
  id: PhotoId,
  template: TemplateId,
  index: number,
  extras: PhotoExtras,
): Promise<void> => {
  const { doc, input, mode } = ctx
  const style = input.style
  const slot = slotFor(ctx, template, index)
  const rect = toRect(mode, slot, BOOK_TEMPLATES[template].span)
  const contain = slot.contain === true || (template === 'full' && style.id === 'classique')

  if (style.polaroid && template !== 'wide') {
    await drawPolaroid(ctx, id, rect, extras, contain)
    return
  }

  // Magazine runs a full page and a double page to the edge, bleed included.
  const bleeds = style.fullBleed && (template === 'full' || template === 'wide')
  const target: Rect = bleeds
    ? {
        x: rect.x - origin(mode),
        y: rect.y - origin(mode),
        w: rect.w + 2 * origin(mode),
        h: rect.h + 2 * origin(mode),
      }
    : rect
  const image = await imageFor(ctx, id, target, contain ? 'contain' : 'cover')
  putImage(ctx, image, target)

  const shown = contain ? imageBox(image, target) : target
  const below: Rect = { x: rect.x, y: shown.y + shown.h + 4, w: rect.w, h: 0.07 * TRIM_PT }
  if (template === 'single' || (template === 'full' && style.id === 'classique')) {
    let y = shown.y + shown.h + 6
    if (extras.caption !== null) {
      y += drawText(ctx, extras.caption, { ...below, y }, {
        role: 'body',
        size: 11,
        fit: true,
        minSize: 7,
        color: input.colours.ink,
        align: 'center',
      })
      y += 3
    }
    if (extras.author !== null) {
      y += drawText(ctx, extras.author, { ...below, y, h: 14 }, {
        role: 'authors',
        size: 7.5,
        color: input.colours.accent,
        align: 'center',
      })
    }
    if (extras.mission !== null) {
      drawText(ctx, input.texts.mission(extras.mission), { ...below, y: y + 3, h: 14 }, {
        role: 'body',
        size: 8,
        color: input.colours.ink,
        align: 'center',
        opacity: 0.7,
      })
    }
  } else if (bleeds && (extras.caption !== null || extras.author !== null)) {
    const band: Rect = {
      x: rect.x,
      y: rect.y + rect.h - 0.12 * TRIM_PT,
      w: template === 'wide' ? rect.w : rect.w,
      h: 0.12 * TRIM_PT,
    }
    doc.save().opacity(0.45).rect(band.x, band.y, band.w, band.h).fill('#000000').restore()
    drawText(ctx, [extras.caption, extras.author].filter(Boolean).join('  '), { ...band, x: band.x + 0.06 * TRIM_PT, w: band.w - 0.12 * TRIM_PT, y: band.y + 6 }, {
      role: 'body',
      size: 11,
      fit: true,
      minSize: 7,
      color: '#ffffff',
    })
  } else if (extras.mission !== null && style.id === 'magazine') {
    drawText(ctx, extras.mission.toUpperCase(), { ...below, h: 12 }, {
      role: 'authors',
      size: 6.5,
      color: input.colours.accent,
    })
  }
  if (style.id === 'magazine' && extras.hearts > 0 && slot.role === 'hero') {
    const badge: Rect = { x: rect.x + 8, y: rect.y + 8, w: 38, h: 16 }
    doc.roundedRect(badge.x, badge.y, badge.w, badge.h, 8).fill(input.colours.accentStrong)
    heart(doc, badge.x + 6, badge.y + 3.5, 9, '#ffffff')
    drawText(ctx, String(extras.hearts), { x: badge.x + 18, y: badge.y + 3.5, w: 18, h: 10 }, {
      role: 'authors',
      size: 8,
      color: '#ffffff',
    })
  }
}

// ------------------------------------------------------------ story pages --

const rule = (ctx: DrawContext, centreX: number, y: number, width: number): void => {
  ctx.doc
    .save()
    .moveTo(centreX - width / 2, y)
    .lineTo(centreX + width / 2, y)
    .lineWidth(0.8)
    .strokeColor(ctx.input.colours.accent)
    .stroke()
    .restore()
}

const textBox = (ctx: DrawContext, template: TemplateId, index: number): Rect =>
  toRect(ctx.mode, BOOK_TEMPLATES[template].texts[index]!)

const sheetBox = (ctx: DrawContext, x: number, y: number, w: number, h: number): Rect =>
  toRect(ctx.mode, { x, y, w, h })

const drawTitlePage = async (ctx: DrawContext): Promise<void> => {
  const { input } = ctx
  const box = textBox(ctx, 'title', 0)
  if (input.logo !== null) {
    const slot = sheetBox(ctx, 38, 12, 24, 20)
    const logo = await prepareContain(input.logo, pixelsFor(slot.w / MM, 150), pixelsFor(slot.h / MM, 150), 85)
    putImage(ctx, logo, slot)
  }
  const used = drawText(ctx, input.cover.title, box, {
    role: 'title',
    size: 34,
    fit: true,
    minSize: 16,
    color: input.colours.ink,
    align: 'center',
    valign: 'middle',
  })
  const middle = box.x + box.w / 2
  rule(ctx, middle, box.y + (box.h + used) / 2 + 10, box.w * 0.3)
  drawText(ctx, input.cover.subtitle, { ...box, y: box.y + box.h + 14, h: 30 }, {
    role: 'body',
    size: 12,
    color: input.colours.ink,
    align: 'center',
  })
}

const drawContents = (ctx: DrawContext): void => {
  const { input } = ctx
  const heading = textBox(ctx, 'contents', 0)
  const list = textBox(ctx, 'contents', 1)
  drawText(ctx, input.texts.contents, heading, {
    role: 'title',
    size: 24,
    color: input.colours.ink,
    align: 'center',
  })
  const lines: { label: string; page: number }[] = input.plan.chapters.map((chapter) => ({
    label: `${ROMAN[chapter.index] ?? String(chapter.index + 1)} · ${chapterTitleText(chapter.title, input.language)}`,
    page: chapter.firstPage,
  }))
  if (input.plan.favouritesPage !== null) {
    lines.push({ label: input.texts.favourites, page: input.plan.favouritesPage })
  }
  if (input.plan.guestbookPage !== null) {
    lines.push({ label: input.texts.guestbook, page: input.plan.guestbookPage })
  }
  const step = Math.min(26, list.h / Math.max(1, lines.length))
  lines.forEach((line, i) => {
    const row: Rect = { x: list.x, y: list.y + i * step, w: list.w, h: step }
    drawText(ctx, line.label, { ...row, w: row.w - 40 }, { role: 'body', size: 12, color: input.colours.ink })
    drawText(ctx, String(line.page), { ...row, x: row.x + row.w - 40, w: 40 }, {
      role: 'authors',
      size: 10,
      color: input.colours.accent,
      align: 'right',
    })
  })
}

const drawStats = (ctx: DrawContext): void => {
  const { input } = ctx
  drawText(ctx, input.texts.statsTitle, sheetBox(ctx, 15, 12, 70, 6), {
    role: 'authors',
    size: 10,
    color: input.colours.accent,
    align: 'center',
  })
  const { counts } = input.plan
  const cells: [number, string][] = [
    [counts.photos, input.texts.statPhotos],
    [counts.photographers, input.texts.statPhotographers],
    [counts.hearts, input.texts.statHearts],
    [counts.messages, input.texts.statMessages],
  ]
  cells.forEach(([value, label], i) => {
    const box = textBox(ctx, 'stats', i)
    drawText(ctx, value.toLocaleString(input.language), { ...box, h: 40 }, {
      role: 'title',
      size: 38,
      color: input.colours.accent,
      align: 'center',
    })
    drawText(ctx, label, { ...box, y: box.y + 48, h: 30 }, {
      role: 'body',
      size: 11,
      color: input.colours.ink,
      align: 'center',
    })
  })
}

const drawChapter = (ctx: DrawContext, page: PlanPage, overPhoto: boolean): void => {
  const { input } = ctx
  const chapter = input.plan.chapters[page.chapter ?? 0]
  if (chapter === undefined) return
  const box = textBox(ctx, 'chapter', 0)
  const ink = overPhoto ? '#ffffff' : input.colours.ink
  const accent = overPhoto ? '#ffffff' : input.colours.accent
  if (overPhoto) {
    ctx.doc.save().opacity(0.35).rect(box.x - 10, box.y - 10, box.w + 20, box.h + 20).fill('#000000').restore()
  }
  let y = box.y
  y += drawText(ctx, ROMAN[chapter.index] ?? String(chapter.index + 1), { ...box, y }, {
    role: 'title',
    size: 40,
    color: accent,
    align: 'center',
  })
  y += 6
  y += drawText(ctx, chapterTitleText(chapter.title, input.language), { ...box, y, h: 70 }, {
    role: 'title',
    size: 26,
    fit: true,
    minSize: 14,
    color: ink,
    align: 'center',
  })
  rule(ctx, box.x + box.w / 2, y + 8, box.w * 0.25)
  drawText(ctx, chapterSubtitleText(chapter, input.timeZone, input.language), { ...box, y: y + 18, h: 30 }, {
    role: 'body',
    size: 11,
    color: ink,
    align: 'center',
  })
}

const drawQuote = (ctx: DrawContext): void => {
  const { input, texts } = ctx
  const message = texts.messages[0]
  if (message === undefined) return
  const box = textBox(ctx, 'quote', 0)
  drawText(ctx, '“', { ...box, y: box.y - 34, h: 40 }, {
    role: 'title',
    size: 44,
    color: input.colours.accent,
    align: 'center',
  })
  const used = drawText(ctx, message.text, { ...box, h: box.h - 18 }, {
    role: 'body',
    size: QUOTE_FONT_SIZE,
    fit: true,
    minSize: 9,
    color: input.colours.ink,
    align: 'center',
    valign: 'middle',
    lineGap: 2,
  })
  if (message.author !== null) {
    drawText(ctx, message.author, { ...box, y: box.y + Math.max(used, box.h - 18) + 8, h: 14 }, {
      role: 'authors',
      size: 9,
      color: input.colours.accent,
      align: 'center',
    })
  }
}

const drawMessages = (ctx: DrawContext, first: boolean): void => {
  const { input, texts } = ctx
  if (first) {
    drawText(ctx, input.texts.guestbook, sheetBox(ctx, 15, 6, 70, 6), {
      role: 'title',
      size: 14,
      color: input.colours.ink,
      align: 'center',
    })
  }
  texts.messages.forEach((message, i) => {
    const box = textBox(ctx, 'messages', i)
    const used = drawText(ctx, message.text, { ...box, h: box.h - AUTHOR_LINE }, {
      role: 'body',
      size: MESSAGE_FONT_SIZE,
      color: input.colours.ink,
      lineGap: 1,
    })
    if (message.author !== null) {
      drawText(ctx, `— ${message.author}`, { ...box, y: box.y + used + 3, h: 11 }, {
        role: 'authors',
        size: 7.5,
        color: input.colours.accent,
      })
    }
  })
}

const drawThanks = (ctx: DrawContext): void => {
  const { input, texts } = ctx
  const heading = textBox(ctx, 'thanks', 0)
  const list = textBox(ctx, 'thanks', 1)
  const named = texts.photographers
  const count = input.plan.photographers.length
  drawText(ctx, named.length > 0 ? input.texts.thanksTo(count) : input.texts.thanksAnonymous(count), heading, {
    role: 'title',
    size: 20,
    fit: true,
    minSize: 12,
    color: input.colours.ink,
    align: 'center',
  })
  drawText(ctx, named.map((p) => `${p.name} (${p.photoCount})`).join('  ·  '), list, {
    role: 'body',
    size: 12,
    fit: true,
    minSize: 7,
    color: input.colours.ink,
    align: 'center',
    lineGap: 4,
  })
}

const drawEnd = (ctx: DrawContext): void => {
  const { input } = ctx
  const notes = [input.closing.videosNote, input.closing.voicesNote, input.closing.extraMessagesNote]
    .filter((note): note is string => note !== null)
    .join('\n')
  drawText(ctx, notes, textBox(ctx, 'end', 0), {
    role: 'body',
    size: 11,
    fit: true,
    minSize: 7,
    color: input.colours.ink,
    align: 'center',
    valign: 'middle',
    lineGap: 3,
  })
  drawText(ctx, input.texts.createdWith, textBox(ctx, 'end', 1), {
    role: 'authors',
    size: 8,
    color: input.colours.ink,
    align: 'center',
    opacity: 0.6,
  })
}

const drawFavourites = async (ctx: DrawContext, page: PlanPage): Promise<void> => {
  const { input, texts } = ctx
  drawText(ctx, input.texts.favourites, sheetBox(ctx, 15, 4.9, 70, 2.8), {
    role: 'authors',
    size: 8.5,
    color: input.colours.accent,
    align: 'center',
  })
  for (const [i, slot] of page.slots.entries()) {
    await drawPhoto(ctx, slot.photoId, 'favourites', i, {
      caption: null,
      author: texts.authors[i] ?? null,
      mission: null,
      hearts: 0,
    })
  }
}

// ------------------------------------------------------------- one page --

/** Draws one page of the plan, or of its printer version, on the page `ctx.doc` just opened. */
export const drawPage = async (
  ctx: DrawContext,
  page: PlanPage,
  options: { readonly firstMessages: boolean; readonly half?: 'left' | 'right' },
): Promise<void> => {
  const { texts, input } = ctx
  await drawPaper(ctx)
  switch (page.template) {
    case 'title':
      return drawTitlePage(ctx)
    case 'contents':
      return drawContents(ctx)
    case 'stats':
      return drawStats(ctx)
    case 'chapter':
      return drawChapter(ctx, page, false)
    case 'quote':
      return drawQuote(ctx)
    case 'messages':
      return drawMessages(ctx, options.firstMessages)
    case 'thanks':
      return drawThanks(ctx)
    case 'end':
      return drawEnd(ctx)
    case 'favourites':
      return drawFavourites(ctx, page)
    case 'blank':
      return
    case 'wide': {
      const id = page.slots[0]!.photoId
      await drawWideHalf(ctx, id, options.half ?? 'left', {
        caption: texts.captions[0] ?? null,
        author: texts.authors[0] ?? null,
        mission: texts.missions[0] ?? null,
        hearts: input.plan.hearts[id] ?? 0,
      })
      if (options.half !== 'right') drawChapter(ctx, page, true)
      return
    }
    default:
      for (const [i, slot] of page.slots.entries()) {
        await drawPhoto(ctx, slot.photoId, page.template, i, {
          caption: texts.captions[i] ?? null,
          author: texts.authors[i] ?? null,
          mission: texts.missions[i] ?? null,
          hearts: input.plan.hearts[slot.photoId] ?? 0,
        })
      }
  }
}

/** One half of a photograph spread over two pages: the whole photograph, clipped to the page. */
const drawWideHalf = async (
  ctx: DrawContext,
  id: PhotoId,
  half: 'left' | 'right',
  extras: PhotoExtras,
): Promise<void> => {
  const { doc, mode } = ctx
  const whole: Rect = {
    x: origin(mode),
    y: origin(mode),
    w: 2 * TRIM_PT,
    h: TRIM_PT,
  }
  const image = await imageFor(ctx, id, whole, 'cover')
  const size = TRIM_PT + 2 * origin(mode)
  doc.save()
  doc.rect(0, 0, size, size).clip()
  doc.image(image.jpeg, half === 'left' ? whole.x : whole.x - TRIM_PT, whole.y, {
    width: whole.w,
    height: whole.h,
  })
  doc.restore()
  if (half === 'right' && extras.caption !== null) {
    drawText(ctx, extras.caption, { x: origin(mode) + 0.06 * TRIM_PT, y: origin(mode) + 0.9 * TRIM_PT, w: 0.88 * TRIM_PT, h: 14 }, {
      role: 'body',
      size: 10,
      color: '#ffffff',
    })
  }
}

// ------------------------------------------------------------------ cover --

/** The front cover (and the screen book's first page): the cover photograph and the title. */
export const drawFrontCover = async (ctx: DrawContext): Promise<void> => {
  const { doc, input, mode } = ctx
  await drawPaper(ctx)
  const id = input.cover.photoId
  const hasPhoto = id !== null && ctx.bytes.has(id)
  const title = (rect: Rect, color: string, size: number): number =>
    drawText(ctx, input.cover.title, rect, { role: 'title', size, fit: true, minSize: 14, color, align: 'center' })

  if (input.style.id === 'magazine' && hasPhoto) {
    const full: Rect = { x: 0, y: 0, w: TRIM_PT + 2 * origin(mode), h: TRIM_PT + 2 * origin(mode) }
    putImage(ctx, await imageFor(ctx, id, full, 'cover'), full)
    const band = sheetBox(ctx, 0, 62, 100, 38)
    doc.save().opacity(0.7).rect(band.x - origin(mode), band.y - origin(mode), band.w + 2 * origin(mode), band.h + 2 * origin(mode)).fill('#000000').restore()
    const box = sheetBox(ctx, 10, 68, 80, 18)
    const used = title(box, '#ffffff', 40)
    drawText(ctx, input.cover.subtitle, { ...box, y: box.y + used + 8, h: 24 }, {
      role: 'authors',
      size: 11,
      color: input.colours.accent,
      align: 'center',
    })
    return
  }
  const photoBox = sheetBox(ctx, 14, 10, 72, 56)
  if (hasPhoto) {
    if (input.style.polaroid) {
      const frame = sheetBox(ctx, 17, 8, 66, 62)
      await drawPolaroid(ctx, id, frame, { caption: null, author: null, mission: null, hearts: 0 }, false)
    } else {
      putImage(ctx, await imageFor(ctx, id, photoBox, 'cover'), photoBox)
    }
  }
  const box = sheetBox(ctx, 12, hasPhoto ? 72 : 36, 76, 14)
  const used = title(box, input.colours.ink, 32)
  rule(ctx, box.x + box.w / 2, box.y + used + 8, box.w * 0.2)
  drawText(ctx, input.cover.subtitle, { ...box, y: box.y + used + 18, h: 24 }, {
    role: 'body',
    size: 12,
    color: input.colours.ink,
    align: 'center',
  })
}

/** The back cover of the printer version: the title, the date, the mention. */
export const drawBackCover = async (ctx: DrawContext): Promise<void> => {
  const { input } = ctx
  await drawPaper(ctx)
  const box = sheetBox(ctx, 15, 36, 70, 14)
  const used = drawText(ctx, input.cover.title, box, {
    role: 'title',
    size: 22,
    fit: true,
    minSize: 12,
    color: input.colours.ink,
    align: 'center',
  })
  rule(ctx, box.x + box.w / 2, box.y + used + 8, box.w * 0.2)
  drawText(ctx, input.cover.subtitle, { ...box, y: box.y + used + 18, h: 20 }, {
    role: 'body',
    size: 10,
    color: input.colours.ink,
    align: 'center',
  })
  if (input.logo !== null) {
    const slot = sheetBox(ctx, 42, 62, 16, 12)
    putImage(ctx, await prepareContain(input.logo, pixelsFor(slot.w / MM, 150), pixelsFor(slot.h / MM, 150), 85), slot)
  }
  drawText(ctx, input.texts.createdWith, sheetBox(ctx, 25, 86, 50, 4), {
    role: 'authors',
    size: 8,
    color: input.colours.ink,
    align: 'center',
    opacity: 0.6,
  })
}

export { facesOf }
