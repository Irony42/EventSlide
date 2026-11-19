/**
 * The three styles of the photo book, on a demonstration album, for a human to read (spec 26).
 *
 * Not part of any suite and asserting nothing: it composes a plan, draws it with the real renderer
 * and writes the PDFs, then photographs some pages of each into PNGs. A missing file is the report.
 * Nothing it writes belongs in the repository.
 *
 *   npx tsx scripts/bookShowcase.mts --out <dir> [--images <dir of .webp or .jpg>] [--pages 1,2,3]
 *
 * The photographs are the crops of the images in `--images` (the mock-ups' pictures), cut to the
 * shapes guests send: mostly 3:4 phone portraits, some landscapes, a few squares. Pages become PNGs
 * through the browser's own PDF viewer (system Chrome, or Playwright's browser).
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'
import type { BookRenderInput, PageTexts } from '../src/application/ports/bookRenderer'
import type { BookChunk } from '../src/application/ports/bookFileStore'
import { pickCoverPhoto } from '../src/domain/book/bookCover'
import type { BookMessage, BookPhoto } from '../src/domain/book/bookInput'
import { BOOK_STYLES, type BookOptionsV2 } from '../src/domain/book/bookOptionsV2'
import { composeBook, type PlanPage } from '../src/domain/book/bookPlan'
import { planForPrint } from '../src/domain/book/bookPrint'
import { BOOK_STYLE_DEFS, resolveBookColours } from '../src/domain/book/bookStyles'
import { BOOK_TEXTS } from '../src/domain/book/bookTexts'
import { formatLongDate } from '../src/domain/book/bookTime'
import {
  asGuestbookEntryId,
  asGuestId,
  asPhotoId,
  type GuestbookEntryId,
  type PhotoId,
} from '../src/domain/shared/ids'
import { createPdfBookRenderer } from '../src/infrastructure/media/pdfBookRenderer'

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at >= 0 ? process.argv[at + 1] : undefined
}
const OUT = flag('--out') ?? join(process.cwd(), 'book-showcase')
const IMAGES = flag('--images') ?? 'C:/src/eventslide-suivi/maquettes/livre-photo-2026-11-19/img'
const PAGES = (flag('--pages') ?? '1,2,3,4,5,6,8,10,14,18,24,30,36,40').split(',').map(Number)

const GUESTS = ['Léa', 'Hugo', 'Inès', 'Karim', 'Mamie Jo', 'Camille', 'Sacha', 'Noor', 'Tom']
const CAPTIONS = [
  'On y est !',
  'Les guirlandes, enfin allumées.',
  'Le soleil s’en va.',
  'Derrière la grange.',
  'Le bouquet !',
  'Même pas peur de la piste.',
]
const MESSAGES = [
  'Merci pour cette soirée, on n’oubliera jamais la piste de danse sous les guirlandes.',
  'Longue vie aux mariés !',
  'Le gâteau était incroyable, la musique encore mieux. À refaire très vite, avec la même équipe.',
  'Bravo à tous les deux, on vous aime.',
  'Une journée comme on en rêve. Merci de nous avoir fait une place dans votre histoire, c’est un cadeau que nous garderons longtemps, longtemps.',
  'Santé !',
]

const SHAPES: [number, number][] = [
  [1500, 2000],
  [1500, 2000],
  [1500, 2000],
  [2000, 1500],
  [1500, 2000],
  [1600, 1600],
  [2000, 1500],
]

const main = async (): Promise<void> => {
  await mkdir(OUT, { recursive: true })
  const files = (await readdir(IMAGES)).filter((name) => /\.(webp|jpe?g|png)$/i.test(name)).sort()
  const sources = await Promise.all(files.map((name) => readFile(join(IMAGES, name))))

  // ---- the demonstration album: three moments of an evening ----
  const start = Date.UTC(2026, 5, 14, 14, 0)
  const photos: BookPhoto[] = []
  const bytes = new Map<PhotoId, Uint8Array>()
  for (let i = 0; i < 74; i += 1) {
    const [width, height] = SHAPES[i % SHAPES.length] as [number, number]
    const id = asPhotoId(`demo-${String(i).padStart(3, '0')}`)
    const moment = i < 26 ? 0 : i < 52 ? 1 : 2
    photos.push({
      id,
      createdAt: new Date(start + (moment * 4 * 60 + (i % 26) * 3) * 60_000),
      width,
      height,
      guestId: asGuestId(`guest-${i % GUESTS.length}`),
      reactions: i % 7 === 0 ? 3 + (i % 5) : 0,
      highlighted: i === 12 || i === 33,
      missionId: null,
      challengeId: null,
      hasCaption: i % 3 === 0,
    })
    bytes.set(
      id,
      await sharp(sources[i % sources.length])
        .resize(width, height, { fit: 'cover', position: i % 2 === 0 ? 'attention' : 'centre' })
        .jpeg({ quality: 82 })
        .toBuffer(),
    )
  }
  const messages: BookMessage[] = MESSAGES.map((text, i) => ({
    id: asGuestbookEntryId(`m${i}`),
    guestId: asGuestId(`guest-${i % GUESTS.length}`),
    createdAt: new Date(start + (i + 1) * 40 * 60_000),
    length: text.length,
  }))
  const messageText = new Map<GuestbookEntryId, string>(
    messages.map((message, i) => [message.id, MESSAGES[i] as string]),
  )

  for (const style of BOOK_STYLES) {
    const options: BookOptionsV2 = {
      title: 'Camille & Sacha',
      subtitle: '',
      language: 'fr',
      style,
      selection: { kind: 'all' },
      showAuthors: true,
      showCaptions: true,
      includeGuestbook: true,
      printVersion: true,
      timeZone: 'Europe/Paris',
    }
    const plan = composeBook(
      {
        photos,
        messages,
        counts: {
          photos: photos.length,
          photographers: GUESTS.length,
          hearts: photos.reduce((n, p) => n + p.reactions, 0),
          messages: messages.length,
          voices: 2,
          videos: 3,
        },
      },
      options,
    )
    const print = planForPrint(plan.pages, style, new Map(photos.map((p) => [p.id, p])))
    const texts = BOOK_TEXTS.fr
    const nameOf = (guest: string | null): string | null =>
      guest === null ? null : (GUESTS[Number(guest.replace('guest-', ''))] ?? null)
    const photoIndex = new Map(photos.map((p, i) => [p.id, i]))
    const pageTexts = async (page: PlanPage): Promise<PageTexts> => ({
      captions: page.slots.map((slot) => {
        const i = photoIndex.get(slot.photoId) as number
        return i % 3 === 0 ? (CAPTIONS[i % CAPTIONS.length] as string) : null
      }),
      authors: page.slots.map((slot) =>
        nameOf(photos[photoIndex.get(slot.photoId) as number]?.guestId ?? null),
      ),
      missions: page.slots.map(() => null),
      messages: (page.messageIds ?? []).map((id) => ({
        text: messageText.get(id) as string,
        author: nameOf(messages.find((m) => m.id === id)?.guestId ?? null),
      })),
      photographers:
        page.template === 'thanks'
          ? plan.photographers.map((p) => ({
              name: nameOf(p.guestId) as string,
              photoCount: p.photoCount,
            }))
          : [],
    })
    const input: BookRenderInput = {
      plan,
      printPages: print.kind === 'ready' ? print.pages : null,
      style: BOOK_STYLE_DEFS[style],
      colours: resolveBookColours(style, 345),
      language: 'fr',
      timeZone: options.timeZone,
      texts,
      cover: {
        title: options.title,
        subtitle: formatLongDate(start, options.timeZone, 'fr'),
        photoId: pickCoverPhoto(plan),
      },
      logo: null,
      photo: async (id) => bytes.get(id) as Uint8Array,
      pageTexts,
      closing: {
        videosNote: texts.videosNotIncluded(3),
        voicesNote: texts.voicesNotIncluded(2),
        extraMessagesNote: null,
      },
    }

    const parts: Record<BookChunk['kind'], Uint8Array[]> = {
      screen: [],
      printInterior: [],
      printCover: [],
    }
    const t0 = performance.now()
    for await (const chunk of createPdfBookRenderer({}).render(input))
      parts[chunk.kind].push(chunk.bytes)
    console.log(
      `${style}: ${plan.pages.length} plan pages in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    )
    const names = {
      screen: `${style}.pdf`,
      printInterior: `${style}-imprimeur.pdf`,
      printCover: `${style}-couverture.pdf`,
    }
    for (const kind of ['screen', 'printInterior', 'printCover'] as const) {
      if (parts[kind].length === 0) continue
      await writeFile(join(OUT, names[kind]), Buffer.concat(parts[kind]))
    }
  }

  // ---- pages to PNG, through the browser's PDF viewer ----
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  } catch {
    browser = await chromium.launch({ headless: true })
  }
  for (const style of BOOK_STYLES) {
    for (const n of PAGES) {
      const url = `file:///${join(OUT, `${style}.pdf`).replaceAll('\\', '/')}#page=${n}&zoom=page-fit&toolbar=0&navpanes=0&view=Fit`
      // A page of its own each time: the viewer ignores a changed #page on the document it holds.
      const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
      await page.goto(url)
      await page.waitForTimeout(1200)
      await page.screenshot({ path: join(OUT, `${style}-p${String(n).padStart(2, '0')}.png`) })
      await page.close()
    }
  }
  await browser.close()
}

await main()
