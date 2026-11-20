import { describe, expect, it } from 'vitest'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import type { BookChunk } from '../../application/ports/bookFileStore'
import type { BookRenderInput, PageTexts } from '../../application/ports/bookRenderer'
import { pickCoverPhoto } from '../../domain/book/bookCover'
import type { BookMessage, BookPhoto } from '../../domain/book/bookInput'
import { BOOK_STYLES, type BookOptionsV2, type BookStyle } from '../../domain/book/bookOptionsV2'
import { composeBook, type PlanPage } from '../../domain/book/bookPlan'
import { planForPrint } from '../../domain/book/bookPrint'
import { BOOK_STYLE_DEFS, resolveBookColours } from '../../domain/book/bookStyles'
import { pageCountOf } from '../../domain/book/bookTemplates'
import { BOOK_TEXTS } from '../../domain/book/bookTexts'
import { COUNTS, OPTIONS, guest, makeMessage, makePhoto } from '../../domain/book/testing/bookFixtures'
import { TRIM_PT, drawPage, type TextTrace } from './book/drawBook'
import { messageFits } from './book/testing/messageFits'
import { facesOf } from './book/bookFonts'
import { createPdfBookRenderer } from './pdfBookRenderer'

const jpeg = async (width: number, height: number, shade = 120): Promise<Uint8Array> =>
  sharp({ create: { width, height, channels: 3, background: { r: shade, g: 80, b: 60 } } })
    .jpeg()
    .toBuffer()

interface Files {
  readonly screen: Buffer
  readonly interior: Buffer | null
  readonly cover: Buffer | null
}

interface Setup {
  readonly photos: BookPhoto[]
  readonly messages?: BookMessage[]
  readonly options?: Partial<BookOptionsV2>
  readonly captions?: Record<string, string>
  readonly authors?: Record<string, string>
  readonly missions?: Record<string, string>
  readonly messageTexts?: Record<string, string>
  readonly logo?: Uint8Array | null
  readonly onPhoto?: (id: string) => void
  readonly failOn?: string
}

/** Builds the input of a book the way the use case does, with real JPEGs. */
const inputOf = async (setup: Setup): Promise<BookRenderInput> => {
  const options: BookOptionsV2 = { ...OPTIONS, ...setup.options }
  const messages = setup.messages ?? []
  const plan = composeBook(
    { photos: setup.photos, messages, counts: { ...COUNTS, messages: messages.length } },
    options,
  )
  const print = options.printVersion
    ? planForPrint(plan.pages, options.style, new Map(setup.photos.map((p) => [p.id, p])))
    : null
  const bytes = new Map<string, Uint8Array>()
  for (const photo of setup.photos) bytes.set(photo.id, await jpeg(photo.width / 4, photo.height / 4))
  const texts = BOOK_TEXTS[options.language]
  const pageTexts = async (page: PlanPage): Promise<PageTexts> => ({
    captions: page.slots.map((s) => setup.captions?.[s.photoId] ?? null),
    authors: page.slots.map((s) => setup.authors?.[s.photoId] ?? null),
    missions: page.slots.map((s) => setup.missions?.[s.photoId] ?? null),
    messages: (page.messageIds ?? []).map((id) => ({
      text: setup.messageTexts?.[id] ?? 'Merci',
      author: 'Zoë',
    })),
    photographers:
      page.template === 'thanks'
        ? plan.photographers.map((p, i) => ({ name: `Invité ${i + 1}`, photoCount: p.photoCount }))
        : [],
  })
  return {
    plan,
    printPages: print !== null && print.kind === 'ready' ? print.pages : null,
    style: BOOK_STYLE_DEFS[options.style],
    colours: resolveBookColours(options.style, 345),
    language: options.language,
    timeZone: options.timeZone,
    texts,
    cover: { title: 'Mariage de Léa', subtitle: '14 juin 2026', photoId: pickCoverPhoto(plan) },
    logo: setup.logo ?? null,
    photo: async (id) => {
      setup.onPhoto?.(id)
      if (id === setup.failOn) throw new Error('unreadable')
      return bytes.get(id) as Uint8Array
    },
    pageTexts,
    closing: { videosNote: texts.videosNotIncluded(2), voicesNote: null, extraMessagesNote: null },
  }
}

const render = async (input: BookRenderInput, compress = true): Promise<Files> => {
  const parts: Record<BookChunk['kind'], Buffer[]> = { screen: [], printInterior: [], printCover: [] }
  for await (const chunk of createPdfBookRenderer({ compress }).render(input)) {
    parts[chunk.kind].push(Buffer.from(chunk.bytes))
  }
  const join = (list: Buffer[]): Buffer | null => (list.length === 0 ? null : Buffer.concat(list))
  return {
    screen: Buffer.concat(parts.screen),
    interior: join(parts.printInterior),
    cover: join(parts.printCover),
  }
}

/** Landscape, portrait and square photographs a minute apart, each by its own guest. */
const album = (count: number): BookPhoto[] =>
  Array.from({ length: count }, (_, i) => {
    const shape = [
      [1600, 1200],
      [1200, 1600],
      [1200, 1200],
    ][i % 3] as [number, number]
    return makePhoto({ minute: i, width: shape[0], height: shape[1], guestId: guest(i) })
  })

const pageCount = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page(?![s\w])/g) ?? []).length

/**
 * The text of an uncompressed PDF, read the way a viewer reads it: the glyph ids of each string
 * mapped back through the font's own `ToUnicode` table. It is what proves the embedded fonts cover
 * the text, since a glyph the font lacks has no entry and decodes to nothing.
 */
const textsOf = (pdf: Buffer): string[] => {
  const source = pdf.toString('latin1')
  const maps: Map<number, string>[] = []
  for (const block of source.matchAll(/begincmap([\s\S]*?)endcmap/g)) {
    const map = new Map<number, string>()
    const text = String(block[1])
    for (const chars of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of String(chars[1]).matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        map.set(parseInt(String(pair[1]), 16), String.fromCodePoint(parseInt(String(pair[2]), 16)))
      }
    }
    for (const ranges of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      // pdfkit writes the array form: <from> <to> [<unicode> <unicode> ...], one entry per code.
      const body = String(ranges[1])
      const arrays = /<([0-9a-fA-F]+)>\s*<[0-9a-fA-F]+>\s*\[([^\]]*)\]/g
      for (const row of body.matchAll(arrays)) {
        const from = parseInt(String(row[1]), 16)
        const targets = [...String(row[2]).matchAll(/<([0-9a-fA-F]+)>/g)]
        targets.forEach((target, offset) => {
          map.set(from + offset, String.fromCodePoint(parseInt(String(target[1]), 16)))
        })
      }
      for (const row of body.replace(arrays, '').matchAll(
        /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g,
      )) {
        const [from, to, start] = [1, 2, 3].map((index) => parseInt(String(row[index]), 16)) as [
          number,
          number,
          number,
        ]
        for (let code = from; code <= to; code += 1) {
          map.set(code, String.fromCodePoint(start + code - from))
        }
      }
    }
    maps.push(map)
  }
  const decoded: string[] = []
  // Two linear passes: a nested quantifier here backtracks catastrophically on a long stream.
  for (const shown of source.matchAll(/\[([^\]]*)\]\s*TJ|(<[0-9a-fA-F]+>)\s*Tj/g)) {
    const inside = String(shown[1] ?? shown[2])
    const codes = [...inside.matchAll(/<([0-9a-fA-F]+)>/g)].flatMap((hex) =>
      (String(hex[1]).match(/.{4}/g) ?? []).map((code) => parseInt(code, 16)),
    )
    for (const map of maps) decoded.push(codes.map((code) => map.get(code) ?? '').join(''))
  }
  return decoded
}

const MM = 72 / 25.4

describe('createPdfBookRenderer', () => {
  it.each(BOOK_STYLES)('draws %s as a PDF whose page count is the plan’s plus the cover and its inside', async (style) => {
    const input = await inputOf({ photos: album(30), options: { style } })

    const { screen, interior } = await render(input)

    expect(screen.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pageCount(screen)).toBe(2 + pageCountOf(input.plan.pages))
    expect(interior).toBeNull()
  })

  it('writes a screen book without a printer file when none is asked for', async () => {
    const files = await render(await inputOf({ photos: album(6) }))

    expect(files.interior).toBeNull()
    expect(files.cover).toBeNull()
  })

  it('draws a printer interior of the printer plan’s pages and a cover of two pages', async () => {
    const input = await inputOf({ photos: album(14), options: { printVersion: true } })

    const files = await render(input)

    expect(files.interior?.subarray(0, 5).toString()).toBe('%PDF-')
    // Worked out here, not read back from the plan the renderer was given: the screen plan's pages
    // (a wide photograph keeps its two), padded with blanks up to 24 before `thanks`, `end` last.
    const screenPages = pageCountOf(input.plan.pages)
    const expected = Math.max(24, screenPages)
    expect(pageCount(files.interior as Buffer)).toBe(expected)
    const printed = input.printPages ?? []
    expect(printed.slice(-2).map((p) => p.template)).toEqual(['thanks', 'end'])
    const blanks = printed.filter((p) => p.template === 'blank').length
    const screenBlanks = input.plan.pages.filter((p) => p.template === 'blank').length
    expect(blanks - screenBlanks).toBe(expected - screenPages)
    expect(printed.at(-3)?.template).toBe('blank')
    expect(pageCount(files.cover as Buffer)).toBe(2)
  })

  it('keeps the boxes and the page layout when the content is compressed, as it is in production', async () => {
    const input = await inputOf({ photos: album(14), options: { printVersion: true } })

    const { screen, interior } = await render(input, true)

    expect(interior?.toString('latin1').match(/\/TrimBox \[/g)).toHaveLength(
      pageCount(interior as Buffer),
    )
    expect(interior?.toString('latin1').match(/\/BleedBox \[/g)).toHaveLength(
      pageCount(interior as Buffer),
    )
    expect(screen.toString('latin1')).toContain('/PageLayout /TwoPageRight')
  })

  it('stops drawing the printer version when the store says it was dropped, and says nothing is lost on screen', async () => {
    const input = await inputOf({ photos: album(30), options: { printVersion: true } })
    let pages = 0
    const stopping: BookRenderInput = {
      ...input,
      pageTexts: async (page) => {
        pages += 1
        return input.pageTexts(page)
      },
      printStopped: () => pages >= 2,
    }

    const full = await render(input)
    const files = await render(stopping)

    expect(pageCount(files.interior as Buffer)).toBeLessThan(pageCount(full.interior as Buffer))
    expect(pageCount(files.screen)).toBe(pageCount(full.screen))
  })

  it('gives every printer page a TrimBox of 210 mm inside a BleedBox of 216 mm, and no screen page one', async () => {
    const input = await inputOf({ photos: album(14), options: { printVersion: true } })

    const { screen, interior, cover } = await render(input, false)

    const boxes = (pdf: Buffer, name: string): number[][] =>
      [...pdf.toString('latin1').matchAll(new RegExp(`/${name} \\[([^\\]]*)\\]`, 'g'))].map(
        (match) => String(match[1]).trim().split(/\s+/).map(Number),
      )
    const trim = 210 * MM
    const bleed = 3 * MM
    for (const pdf of [interior as Buffer, cover as Buffer]) {
      const trims = boxes(pdf, 'TrimBox')
      const bleeds = boxes(pdf, 'BleedBox')
      expect(trims).toHaveLength(pageCount(pdf))
      expect(bleeds).toHaveLength(pageCount(pdf))
      for (const box of trims) {
        expect(box[0]).toBeCloseTo(bleed, 1)
        expect(box[2]! - box[0]!).toBeCloseTo(trim, 1)
        expect(box[3]! - box[1]!).toBeCloseTo(trim, 1)
      }
      for (const box of bleeds) {
        expect(box[2]! - box[0]!).toBeCloseTo(216 * MM, 1)
        expect(box[3]! - box[1]!).toBeCloseTo(216 * MM, 1)
      }
    }
    expect(boxes(screen, 'TrimBox')).toHaveLength(0)
  })

  it('asks a viewer for double pages with the cover alone on the screen book only', async () => {
    const { screen, interior } = await render(
      await inputOf({ photos: album(8), options: { printVersion: true } }),
      false,
    )

    expect(screen.toString('latin1')).toContain('/PageLayout /TwoPageRight')
    expect(interior?.toString('latin1')).not.toContain('PageLayout')
  })

  it('draws the three styles with a theme colour and a logo without failing', async () => {
    const logo = await sharp({
      create: { width: 80, height: 40, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 1 } },
    })
      .png()
      .toBuffer()
    for (const style of BOOK_STYLES) {
      const { screen } = await render(
        await inputOf({ photos: album(20), options: { style, printVersion: true }, logo }),
      )
      expect(screen.length).toBeGreaterThan(5_000)
    }
  })

  it('draws a book with a double-page opening in two halves, the printer version in a chapter page and a photograph', async () => {
    const wide = Array.from({ length: 30 }, (_, i) =>
      makePhoto({ minute: i < 15 ? i : 200 + i, width: 1920, height: 1080, guestId: guest(i) }),
    )
    const input = await inputOf({ photos: wide, options: { style: 'magazine', printVersion: true } })
    expect(input.plan.pages.some((p) => p.template === 'wide')).toBe(true)

    const files = await render(input)

    expect(pageCount(files.screen)).toBe(2 + pageCountOf(input.plan.pages))
    expect(pageCount(files.interior as Buffer)).toBe(pageCountOf(input.printPages ?? []))
    expect(input.printPages?.some((p) => p.template === 'wide')).toBe(false)
  })

  it('draws a caption, a name, a mission and the hearts on every kind of page of every style', async () => {
    const photos = Array.from({ length: 40 }, (_, i) => {
      const shape = [
        [1600, 1200],
        [1200, 1600],
        [1200, 1200],
        [1920, 1080],
      ][i % 4] as [number, number]
      return makePhoto({
        minute: i < 20 ? i : 400 + i,
        width: shape[0],
        height: shape[1],
        guestId: guest(i % 5),
        reactions: i % 3 === 0 ? 5 : 0,
      })
    })
    const long = 'Une très longue légende qui ne tient pas sur une seule ligne et qu’il faut réduire. '.repeat(3)
    const captions = Object.fromEntries(photos.map((p, i) => [p.id, i % 2 === 0 ? long : 'Le gâteau']))
    const authors = Object.fromEntries(photos.map((p, i) => [p.id, i % 4 === 0 ? 'Zoë' : 'Léa']))
    const missions = Object.fromEntries(photos.map((p, i) => [p.id, i % 3 === 0 ? 'Le plus beau sourire' : 'Un selfie']))
    for (const style of BOOK_STYLES) {
      {
        const printVersion = true
        const input = await inputOf({
          photos,
          captions,
          authors,
          missions,
          options: { style, printVersion, showCaptions: true, showAuthors: true },
        })

        const files = await render(input)

        expect(pageCount(files.screen), style).toBe(2 + pageCountOf(input.plan.pages))
      }
    }
  }, 60_000)

  it('writes a caption on the right half of a double-page photograph and a mission where only that is left to say', async () => {
    const wide = Array.from({ length: 30 }, (_, i) =>
      makePhoto({ minute: i < 15 ? i : 200 + i, width: 1920, height: 1080, guestId: guest(i) }),
    )
    const captions = Object.fromEntries(wide.map((p) => [p.id, 'Toute la salle']))
    const withCaptions = await inputOf({
      photos: wide,
      captions,
      options: { style: 'magazine', printVersion: true, showCaptions: true },
    })
    expect(withCaptions.plan.pages.some((p) => p.template === 'wide')).toBe(true)
    expect((await render(withCaptions)).screen.length).toBeGreaterThan(5_000)

    const many = album(40)
    const missionsOnly = await inputOf({
      photos: many,
      missions: Object.fromEntries(many.map((p) => [p.id, 'Le plus beau sourire'])),
      options: { style: 'magazine', showCaptions: true },
    })
    expect((await render(missionsOnly)).screen.length).toBeGreaterThan(5_000)
  }, 60_000)

  it('draws the story pages: contents, quote, guest book, favourites and thanks', async () => {
    const photos = Array.from({ length: 24 }, (_, i) =>
      makePhoto({ minute: i < 12 ? i : 300 + i, guestId: guest(i % 4), reactions: i < 5 ? 4 : 0 }),
    )
    const messages = [makeMessage({ n: 1, length: 120 }), makeMessage({ n: 2, length: 90 })]
    const input = await inputOf({ photos, messages, options: { includeGuestbook: true } })
    const used = new Set(input.plan.pages.map((p) => p.template))
    for (const template of ['contents', 'stats', 'chapter', 'favourites', 'messages', 'thanks', 'end'] as const) {
      expect(used.has(template), template).toBe(true)
    }

    const { screen } = await render(input)

    expect(pageCount(screen)).toBe(2 + pageCountOf(input.plan.pages))
  })

  it('draws a Cyrillic title in the fallback face and a Latin one in the style face', async () => {
    const fonts = async (title: string): Promise<string> => {
      const input = await inputOf({ photos: album(3), options: { style: 'magazine' } })
      const { screen } = await render({ ...input, cover: { ...input.cover, title } }, false)
      return screen.toString('latin1')
    }

    const cyrillic = await fonts('Привет, мир')
    const latin = await fonts('Mariage de Léa')

    expect(cyrillic).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Bold/)
    expect(latin).toMatch(/\/BaseFont \/[A-Z]{6}\+Fraunces/)
    expect(latin).not.toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Bold/)
  })

  it('embeds the kraft paper and the shadow once, however many pages use them', async () => {
    const photos = Array.from({ length: 8 }, (_, i) =>
      makePhoto({ minute: i, width: 3000, height: 1000, guestId: guest(i) }),
    )
    const input = await inputOf({ photos, options: { style: 'souvenir' } })

    const { screen } = await render(input, false)

    const images = screen.toString('latin1').match(/\/Subtype \/Image/g) ?? []
    // the photographs and the cover, plus one kraft tile and one shadow (an SMask is its own image)
    expect(images.length).toBeLessThanOrEqual(photos.length + 8)
    expect(pageCount(screen)).toBeGreaterThan(8)
  })

  it('embeds a double-page photograph once for its two halves', async () => {
    const photos = Array.from({ length: 30 }, (_, i) =>
      makePhoto({ minute: i < 15 ? i : 200 + i, width: 1920, height: 1080, guestId: guest(i) }),
    )
    const input = await inputOf({ photos, options: { style: 'magazine' } })
    const wide = input.plan.pages.find((p) => p.template === 'wide')
    expect(wide).toBeDefined()
    const doc = new PDFDocument({ size: [TRIM_PT, TRIM_PT], margin: 0, autoFirstPage: false })
    const parts: Buffer[] = []
    doc.on('data', (chunk: Buffer) => parts.push(chunk))
    const id = wide?.slots[0]?.photoId as string
    const prepared = new Map()
    const context = async (page: PlanPage) => ({
      doc,
      mode: 'screen' as const,
      withPrint: false,
      input,
      faces: facesOf(input.style),
      bytes: new Map([[id as never, await input.photo(id as never)]]),
      prepared,
      texts: await input.pageTexts(page),
    })

    doc.addPage()
    await drawPage(await context(wide as PlanPage), wide as PlanPage, { firstMessages: false, half: 'left' })
    doc.addPage()
    await drawPage(await context(wide as PlanPage), wide as PlanPage, { firstMessages: false, half: 'right' })
    const done = new Promise<void>((resolve) => doc.on('end', resolve))
    doc.end()
    await done

    const pdf = Buffer.concat(parts).toString('latin1')
    expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(1)
    expect(prepared.size).toBe(1)
  })

  it('reads the title of the cover, accents included, back out of the file', async () => {
    const { screen } = await render(await inputOf({ photos: album(3) }), false)

    expect(textsOf(screen).some((text) => text.includes('Mariage de Léa'))).toBe(true)
  })

  it('draws names, captions and a message in a language the style font may lack, without failing', async () => {
    const photos = Array.from({ length: 3 }, (_, i) =>
      makePhoto({ minute: i, width: 3000, height: 1000, guestId: guest(i) }),
    )
    const message = makeMessage({ n: 5, length: 40 })
    for (const style of BOOK_STYLES) {
      const input = await inputOf({
        photos,
        messages: [message],
        options: { style, includeGuestbook: true },
        captions: { [photos[0]?.id as string]: 'Привет, мир — Ελληνικά — Été à Zürich' },
        authors: { [photos[0]?.id as string]: 'Łukasz' },
        messageTexts: { [message.id]: 'Çok güzel bir akşamdı, teşekkürler' },
      })

      const { screen } = await render(input)

      expect(pageCount(screen)).toBe(2 + pageCountOf(input.plan.pages))
    }
  })

  it.each(BOOK_STYLES)('has the room for a 500-character message in its box, %s', (style: BookStyle) => {
    const doc = new PDFDocument({ size: [100, 100], margin: 0 })
    const faces = facesOf(BOOK_STYLE_DEFS[style])
    const text = 'Une phrase assez longue pour remplir la place. '.repeat(11).slice(0, 500)

    const size = BOOK_STYLE_DEFS[style].minBodySize

    expect(messageFits(doc, faces.paths.body, text, size)).toBe(true)
    expect(messageFits(doc, faces.paths.body, text.repeat(3), size)).toBe(false)
    doc.end()
  })

  it('compresses the content by default', async () => {
    const input = await inputOf({ photos: album(6) })

    const packed = await render(input)
    const readable = await render(input, false)

    expect(packed.screen.length).toBeLessThan(readable.screen.length)
  })

  describe('pulling', () => {
    it('asks for the photographs of a page only when it draws it', async () => {
      const asked: string[] = []
      const input = await inputOf({ photos: album(20), onPhoto: (id) => asked.push(id) })
      const stream = createPdfBookRenderer({}).render(input)
      const iterator = stream[Symbol.asyncIterator]()

      await iterator.next() // the covers
      const afterCover = asked.length
      expect(afterCover).toBeLessThanOrEqual(1)
      await iterator.next() // the first page
      expect(asked.length).toBeLessThan(21)
      await iterator.return?.()
    })

    it('rejects when a photograph cannot be read, without writing the end of the book', async () => {
      const photos = album(8)
      const input = await inputOf({ photos, failOn: photos[4]?.id as string })

      await expect(render(input)).rejects.toThrow('unreadable')
    })

    it('rejects a photograph that is not an image rather than drawing a blank page', async () => {
      const input = await inputOf({ photos: album(4) })
      const broken: BookRenderInput = { ...input, photo: async () => new Uint8Array([1, 2, 3]) }

      await expect(render(broken)).rejects.toThrow()
    })
  })
})


describe('the text of the story pages', () => {
  const storyPhotos = (): BookPhoto[] =>
    Array.from({ length: 28 }, (_, i) =>
      makePhoto({ minute: i < 14 ? i : 300 + i, guestId: guest(i % 5), reactions: i < 5 ? 4 : 0 }),
    )

  const traced = async (style: BookStyle) => {
    const messages = [
      makeMessage({ n: 1, length: 500 }),
      makeMessage({ n: 2, length: 120 }),
      makeMessage({ n: 3, length: 90 }),
      makeMessage({ n: 4, length: 200 }),
      makeMessage({ n: 5, length: 60 }),
    ]
    const long = 'Une phrase assez longue pour remplir la place. '.repeat(11).slice(0, 500)
    const input = await inputOf({
      photos: storyPhotos(),
      messages,
      options: { style, includeGuestbook: true },
      messageTexts: { [messages[0]?.id as string]: long, [messages[4]?.id as string]: 'Longue vie aux mariés dans la lumière du soir qui descend, et merci.' },
      authors: {},
    })
    const pages: { template: string; trace: TextTrace[] }[] = []
    for (const page of input.plan.pages) {
      if (!['title', 'contents', 'stats', 'chapter', 'quote', 'messages', 'thanks', 'end'].includes(page.template)) continue
      const doc = new PDFDocument({ size: [TRIM_PT, TRIM_PT], margin: 0, autoFirstPage: true })
      doc.on('data', () => undefined)
      const trace: TextTrace[] = []
      await drawPage(
        {
          doc,
          mode: 'screen',
          withPrint: false,
          input,
          faces: facesOf(input.style),
          bytes: new Map(),
          prepared: new Map(),
          texts: await input.pageTexts(page),
          trace,
        },
        page,
        { firstMessages: true },
      )
      doc.end()
      pages.push({ template: page.template, trace })
    }
    return { input, pages }
  }

  it.each(BOOK_STYLES)('puts no text on top of another, on any story page, in %s', async (style) => {
    const { pages } = await traced(style)

    expect(pages.map((p) => p.template)).toEqual(
      expect.arrayContaining(['title', 'contents', 'stats', 'chapter', 'messages', 'thanks', 'end']),
    )
    for (const { template, trace } of pages) {
      trace.forEach((a, i) =>
        trace.slice(i + 1).forEach((b) => {
          const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
          const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
          expect(
            overlapW > 0.5 && overlapH > 0.5,
            template + ': "' + a.text.slice(0, 20) + '" over "' + b.text.slice(0, 20) + '"',
          ).toBe(false)
        }),
      )
      for (const t of trace) {
        expect(t.x, template).toBeGreaterThanOrEqual(-0.5)
        expect(t.y + t.h, template + ' ' + t.text.slice(0, 20)).toBeLessThanOrEqual(TRIM_PT + 0.5)
      }
    }
  })

  it.each(BOOK_STYLES)('draws every story text at the style minimum or more, in %s', async (style) => {
    const { pages } = await traced(style)
    const floor = BOOK_STYLE_DEFS[style].minBodySize

    for (const { template, trace } of pages) {
      for (const t of trace) {
        // the printed mention under the closing page and the numbers of a page are the style's own
        expect(t.size, template + ': "' + t.text.slice(0, 24) + '"').toBeGreaterThanOrEqual(floor)
      }
    }
  })
})
