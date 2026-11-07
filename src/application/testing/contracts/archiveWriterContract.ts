import { describe, expect, it } from 'vitest'
import type { ArchiveEntry, ArchiveWriter } from '../../ports/archiveWriter'

/**
 * What a download leans on in `ArchiveWriter`, held against the fake and `archiver`: every
 * source is read to its end, one entry at a time and in order; a failure of a source, of the
 * listing, or of the entry itself rejects the stream (never a truncated success).
 *
 * Not here: what happens when the consumer goes away (the real writer closes the listing
 * asynchronously, so `archiverWriter.test.ts` waits for it) and the bytes of the archive. The fake emits markers, and `archiverWriter.test.ts` holds
 * the real ZIP's header, compression and dates.
 */
const MODIFIED_AT = new Date('2026-06-20T21:04:11.000Z')
const CHUNK = new Uint8Array(64 * 1024)

const entryOf = (name: string, log: string[] = []): ArchiveEntry => ({
  name,
  modifiedAt: MODIFIED_AT,
  bytes: {
    async *[Symbol.asyncIterator]() {
      log.push(`open:${name}`)
      yield CHUNK
      yield CHUNK
      log.push(`end:${name}`)
    },
  },
})

const listing = (names: readonly string[], log: string[]): AsyncIterable<ArchiveEntry> => ({
  async *[Symbol.asyncIterator]() {
    for (const name of names) {
      log.push(`list:${name}`)
      yield entryOf(name, log)
    }
  },
})

const drain = async (chunks: AsyncIterable<Uint8Array>): Promise<void> => {
  for await (const chunk of chunks) void chunk
}

export const archiveWriterContract = (name: string, makeWriter: () => ArchiveWriter): void => {
  describe(`ArchiveWriter contract: ${name}`, () => {
    it('reads every source to its end, asking for the next entry only after the previous one', async () => {
      const log: string[] = []

      await drain(makeWriter().stream(listing(['a', 'b', 'c'], log)))

      expect(log).toEqual([
        'list:a',
        'open:a',
        'end:a',
        'list:b',
        'open:b',
        'end:b',
        'list:c',
        'open:c',
        'end:c',
      ])
    })

    it('resolves for an empty listing', async () => {
      await expect(drain(makeWriter().stream(listing([], [])))).resolves.toBeUndefined()
    })

    it('rejects the stream when an entry’s bytes fail part-way', async () => {
      const broken: ArchiveEntry = {
        name: 'broken',
        modifiedAt: MODIFIED_AT,
        bytes: {
          async *[Symbol.asyncIterator]() {
            yield CHUNK
            throw new Error('the media store lost the file')
          },
        },
      }
      const source: AsyncIterable<ArchiveEntry> = {
        async *[Symbol.asyncIterator]() {
          yield broken
        },
      }

      await expect(drain(makeWriter().stream(source))).rejects.toThrow()
    })

    it('rejects the stream when the listing itself fails', async () => {
      const source: AsyncIterable<ArchiveEntry> = {
        // eslint-disable-next-line require-yield -- the point is that it throws
        async *[Symbol.asyncIterator]() {
          throw new Error('the database went away')
        },
      }

      await expect(drain(makeWriter().stream(source))).rejects.toThrow()
    })
  })
}
