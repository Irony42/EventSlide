import { describe, expect, it } from 'vitest'
import type { BookInput, BookPhoto } from '../ports/bookRenderer'
import { FakeBookRenderer } from './fakeBookRenderer'

const photo = (n: number): BookPhoto => ({ bytes: Uint8Array.of(n), caption: null, author: null })

const inputOf = (count: number, pulled: number[] = []): BookInput => ({
  layout: 'four',
  cover: { title: 'Mariage', subtitle: '14 juin' },
  closing: { createdWith: 'Album créé avec EventSlide', videosNote: null },
  photos: {
    async *[Symbol.asyncIterator]() {
      for (let n = 1; n <= count; n += 1) {
        pulled.push(n)
        yield photo(n)
      }
    },
  },
})

const collect = async (chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> => {
  const out: Uint8Array[] = []
  for await (const chunk of chunks) out.push(chunk)
  return out
}

const text = (chunks: readonly Uint8Array[]): string =>
  chunks.map((chunk) => new TextDecoder().decode(chunk)).join('')

describe('FakeBookRenderer', () => {
  it('answers a PDF envelope with one marker byte per photograph', async () => {
    const chunks = await collect(new FakeBookRenderer().render(inputOf(3)))

    expect(text(chunks.slice(0, 1))).toBe('%PDF-1.7\n')
    expect(chunks.slice(1, 4).map((chunk) => [...chunk])).toEqual([[1], [2], [3]])
    expect(text(chunks.slice(4))).toBe('\n%%EOF')
  })

  it('records the book it was handed, photographs included, in order', async () => {
    const renderer = new FakeBookRenderer()

    await collect(renderer.render(inputOf(2)))

    expect(renderer.books).toHaveLength(1)
    expect(renderer.books[0]?.input).toMatchObject({
      layout: 'four',
      cover: { title: 'Mariage', subtitle: '14 juin' },
    })
    expect(renderer.books[0]?.photos.map((p) => [...p.bytes])).toEqual([[1], [2]])
  })

  it('pulls photographs one at a time: none is asked for before the previous was written', async () => {
    const pulled: number[] = []
    const iterator = new FakeBookRenderer().render(inputOf(3, pulled))[Symbol.asyncIterator]()

    await iterator.next()
    expect(pulled).toEqual([])
    await iterator.next()
    expect(pulled).toEqual([1])
    await iterator.next()
    expect(pulled).toEqual([1, 2])
  })

  it('fails after the scripted number of photographs, which stay recorded', async () => {
    const renderer = new FakeBookRenderer()
    renderer.failsAfter = 1
    renderer.failure = new Error('disk full')

    await expect(collect(renderer.render(inputOf(3)))).rejects.toThrow('disk full')

    expect(renderer.books[0]?.photos).toHaveLength(1)
  })

  it('pads the book to a large size without a large fixture', async () => {
    const renderer = new FakeBookRenderer()
    renderer.paddingBytes = 5_000

    const chunks = await collect(renderer.render(inputOf(1)))

    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBeGreaterThan(5_000)
    expect(chunks.some((chunk) => chunk.length === 5_000)).toBe(true)
  })
})
