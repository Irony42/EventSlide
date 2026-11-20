import { describe, expect, it } from 'vitest'
import { composeBook, type PlanPage } from '../../domain/book/bookPlan'
import { BOOK_STYLE_DEFS, resolveBookColours } from '../../domain/book/bookStyles'
import { BOOK_TEXTS } from '../../domain/book/bookTexts'
import { COUNTS, OPTIONS, makePhoto } from '../../domain/book/testing/bookFixtures'
import type { BookChunk } from '../ports/bookFileStore'
import type { BookRenderInput, PageTexts } from '../ports/bookRenderer'
import { FakeBookRenderer } from './fakeBookRenderer'

const EMPTY: PageTexts = {
  captions: [],
  authors: [],
  missions: [],
  messages: [],
  photographers: [],
}

const inputOf = (
  count: number,
  over: { printPages?: readonly PlanPage[] | null; onPhoto?: (id: string) => void } = {},
): BookRenderInput => {
  const photos = Array.from({ length: count }, (_, i) => makePhoto({ minute: i }))
  const plan = composeBook({ photos, messages: [], counts: COUNTS }, OPTIONS)
  return {
    plan,
    printPages: over.printPages ?? null,
    style: BOOK_STYLE_DEFS.classique,
    colours: resolveBookColours('classique', 305),
    language: 'fr',
    timeZone: 'Europe/Paris',
    texts: BOOK_TEXTS.fr,
    cover: { title: 'T', subtitle: 'S', photoId: photos[0]?.id ?? null },
    logo: null,
    photo: async (id) => {
      over.onPhoto?.(id)
      return new Uint8Array([1])
    },
    pageTexts: async () => EMPTY,
    closing: { videosNote: null, voicesNote: null, extraMessagesNote: null },
  }
}

const drain = async (chunks: AsyncIterable<BookChunk>): Promise<BookChunk[]> => {
  const all: BookChunk[] = []
  for await (const chunk of chunks) all.push(chunk)
  return all
}

describe('FakeBookRenderer', () => {
  it('answers a PDF envelope with one marker byte per photograph, as one screen file', async () => {
    const renderer = new FakeBookRenderer()

    const chunks = await drain(renderer.render(inputOf(3)))

    expect(new Set(chunks.map((c) => c.kind))).toEqual(new Set(['screen']))
    const text = new TextDecoder().decode(chunks[0]?.bytes)
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(new TextDecoder().decode(chunks.at(-1)?.bytes)).toContain('%%EOF')
  })

  it('answers the two printer files too when a printer version is asked', async () => {
    const renderer = new FakeBookRenderer()
    const input = inputOf(3)
    const chunks = await drain(renderer.render({ ...input, printPages: input.plan.pages }))

    expect(new Set(chunks.map((c) => c.kind))).toEqual(
      new Set(['screen', 'printInterior', 'printCover']),
    )
  })

  it('records the book it was handed, and the photographs and words it pulled, in order', async () => {
    const renderer = new FakeBookRenderer()
    const input = inputOf(3)

    await drain(renderer.render(input))

    const [book] = renderer.books
    expect(book?.input.cover.title).toBe('T')
    // the cover photograph first, then those of each page
    expect(book?.photos[0]).toBe(input.cover.photoId)
    expect(new Set(book?.photos)).toEqual(
      new Set(input.plan.pages.flatMap((p) => p.slots.map((s) => s.photoId))),
    )
    expect(book?.texts.length).toBeGreaterThan(0)
  })

  it('pulls a photograph only when a page needs it: none is asked for ahead of the consumer', async () => {
    const renderer = new FakeBookRenderer()
    const asked: string[] = []
    const stream = renderer.render(inputOf(4, { onPhoto: (id) => asked.push(id) }))
    const iterator = stream[Symbol.asyncIterator]()

    await iterator.next()
    expect(asked).toHaveLength(0)
    await iterator.next()
    await iterator.next()
    expect(asked.length).toBeLessThan(5) // the cover and four photographs in all
    await iterator.return?.()
  })

  it('fails after the scripted number of photographs, which stay recorded', async () => {
    const renderer = new FakeBookRenderer()
    renderer.failsAfter = 1
    renderer.failure = new Error('boom')

    await expect(drain(renderer.render(inputOf(3)))).rejects.toThrow('boom')

    expect(renderer.books[0]?.photos).toHaveLength(1)
  })

  it('pads the screen book and the printer interior without a large fixture', async () => {
    const renderer = new FakeBookRenderer()
    renderer.paddingBytes = 1000
    renderer.printPaddingBytes = 500
    const input = inputOf(1)

    const chunks = await drain(renderer.render({ ...input, printPages: input.plan.pages }))
    const size = (kind: string): number =>
      chunks.filter((c) => c.kind === kind).reduce((n, c) => n + c.bytes.byteLength, 0)

    expect(size('screen')).toBeGreaterThanOrEqual(1000)
    expect(size('printInterior')).toBeGreaterThanOrEqual(500)
    expect(size('printCover')).toBeLessThan(100)
  })
})
