import { describe, expect, it } from 'vitest'
import type { ArchiveEntry } from '../ports/archiveWriter'
import { FakeArchiveWriter, ZIP_LOCAL_FILE_HEADER } from './fakeArchiveWriter'

const MODIFIED = new Date('2026-06-01T10:00:00.000Z')

const entry = (name: string, ...chunks: readonly number[][]): ArchiveEntry => ({
  name,
  modifiedAt: MODIFIED,
  bytes: (async function* () {
    for (const chunk of chunks) yield Uint8Array.from(chunk)
  })(),
})

const source = (...entries: readonly ArchiveEntry[]): AsyncIterable<ArchiveEntry> =>
  (async function* () {
    for (const next of entries) yield next
  })()

const drain = async (chunks: AsyncIterable<Uint8Array>): Promise<number[][]> => {
  const out: number[][] = []
  for await (const chunk of chunks) out.push([...chunk])
  return out
}

describe('FakeArchiveWriter', () => {
  describe('by default', () => {
    it('emits one numbered byte per entry', async () => {
      const archive = new FakeArchiveWriter()

      const chunks = await drain(archive.stream(source(entry('a.jpg', [1]), entry('b.jpg', [2]))))

      expect(chunks).toEqual([[1], [2]])
    })

    it('records each entry with its name, its time and the bytes it pulled', async () => {
      const archive = new FakeArchiveWriter()

      await drain(archive.stream(source(entry('a.jpg', [1, 2], [3]), entry('b.jpg'))))

      expect(archive.entries).toEqual([
        { name: 'a.jpg', modifiedAt: MODIFIED, bytesRead: 3 },
        { name: 'b.jpg', modifiedAt: MODIFIED, bytesRead: 0 },
      ])
      expect(archive.names).toEqual(['a.jpg', 'b.jpg'])
    })

    it('records nothing for an album with no entries', async () => {
      const archive = new FakeArchiveWriter()

      expect(await drain(archive.stream(source()))).toEqual([])
      expect(archive.entries).toEqual([])
    })
  })

  describe('emitting content', () => {
    it('opens with a zip local file header, then names and bytes in order', async () => {
      const archive = new FakeArchiveWriter({ emits: 'content' })

      const chunks = await drain(archive.stream(source(entry('a', [9, 8], [7]), entry('b', [6]))))

      expect(chunks).toEqual([[...ZIP_LOCAL_FILE_HEADER], [97], [9, 8], [7], [98], [6]])
    })

    it('opens with the header even for an album with no entries', async () => {
      const archive = new FakeArchiveWriter({ emits: 'content' })

      expect(await drain(archive.stream(source()))).toEqual([[...ZIP_LOCAL_FILE_HEADER]])
    })
  })

  describe('failing', () => {
    it('rejects with the cause when it meets its first entry, after the header', async () => {
      const cause = new Error('the file went away')
      const archive = new FakeArchiveWriter({ emits: 'content', failsWith: cause })
      const seen: number[][] = []

      const failure = (async () => {
        for await (const chunk of archive.stream(source(entry('a', [1])))) seen.push([...chunk])
      })()

      await expect(failure).rejects.toBe(cause)
      expect(seen).toEqual([[...ZIP_LOCAL_FILE_HEADER]])
      expect(archive.entries).toEqual([])
    })

    it('treats a rejection value of any shape as a failure, an empty string included', async () => {
      const archive = new FakeArchiveWriter({ failsWith: '' })

      await expect(drain(archive.stream(source(entry('a', [1]))))).rejects.toBe('')
    })

    it('does not fail an album with no entries, which it never met', async () => {
      const archive = new FakeArchiveWriter({ failsWith: new Error('never reached') })

      expect(await drain(archive.stream(source()))).toEqual([])
    })
  })

  describe('the port’s promises about reading', () => {
    it('asks for the next entry only after it has dealt with the previous one', async () => {
      const log: string[] = []
      const entries = (async function* () {
        for (const name of ['a', 'b']) {
          log.push(`pull ${name}`)
          yield entry(name, [1])
        }
      })()

      for await (const chunk of new FakeArchiveWriter().stream(entries))
        log.push(`chunk ${chunk[0]}`)

      expect(log).toEqual(['pull a', 'chunk 1', 'pull b', 'chunk 2'])
    })

    it('stops pulling, and closes what it was handed, when the consumer stops reading', async () => {
      let closed = false
      const entries = (async function* () {
        try {
          yield entry('a', [1])
          yield entry('b', [2])
        } finally {
          closed = true
        }
      })()

      for await (const chunk of new FakeArchiveWriter().stream(entries)) {
        void chunk
        break
      }

      expect(closed).toBe(true)
    })
  })
})
