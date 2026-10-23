import { createReadStream, type ReadStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { albumEntryName, archiverWriter } from './archiverWriter'
import type { ArchiveEntry } from '../../application/ports/archiveWriter'

const bytesOf = (...values: number[]): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    yield new Uint8Array(values)
  },
})

const entry = (name: string, size = 3): ArchiveEntry => ({
  name,
  bytes: bytesOf(1, 2, 3),
  byteSize: size,
  modifiedAt: new Date('2026-06-20T21:04:11.000Z'),
})

const entries = (...items: readonly ArchiveEntry[]): AsyncIterable<ArchiveEntry> => ({
  async *[Symbol.asyncIterator]() {
    for (const item of items) yield item
  },
})

const collect = async (chunks: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const parts: Buffer[] = []
  for await (const chunk of chunks) parts.push(Buffer.from(chunk))
  return Buffer.concat(parts)
}

describe('archiverWriter', () => {
  it('produces a ZIP archive', async () => {
    const zip = await collect(archiverWriter.stream(entries(entry('a.jpg'))))

    // The local file header signature. Asserting the bytes rather than trusting the
    // library means a future swap of `archiver` is caught here.
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  })

  it('includes every entry it was given', async () => {
    const zip = await collect(
      archiverWriter.stream(entries(entry('one.jpg'), entry('two.jpg'), entry('three.jpg'))),
    )
    const text = zip.toString('latin1')

    expect(text).toContain('one.jpg')
    expect(text).toContain('two.jpg')
    expect(text).toContain('three.jpg')
  })

  it('stores photos without compressing them', async () => {
    // Photos are already compressed. Deflating a JPEG spends CPU on a box that is
    // simultaneously re-encoding uploads, to gain essentially nothing — so the
    // compression method must be 0 (stored), not 8 (deflate).
    const zip = await collect(archiverWriter.stream(entries(entry('a.jpg'))))

    // Bytes 8-9 of the local file header are the compression method, little-endian.
    expect(zip.readUInt16LE(8)).toBe(0)
  })

  it('stamps each entry with the photograph’s own date, not the moment of the download', async () => {
    // What a host sees in the extracted folder's "date modified" column, and what a
    // viewer that sorts by date uses to put the evening back in order. The library
    // falls back to `new Date()` for an entry given no date, so dropping the option
    // changes nothing visible but this.
    // A zone twelve hours from UTC, set on purpose: CI runs in UTC, where an archive built
    // with `forceLocalTime` would carry the same bytes and this test could not tell.
    vi.stubEnv('TZ', 'Pacific/Auckland')
    const zip = await collect(archiverWriter.stream(entries(entry('a.jpg')))).finally(() => {
      vi.unstubAllEnvs()
    })

    // Bytes 10-13 of the local file header are the MS-DOS time then date, little-endian.
    // UTC by default, so the same bytes on a machine in any time zone; two-second
    // resolution, hence the 10 for a photograph taken at :11.
    const time = zip.readUInt16LE(10)
    const date = zip.readUInt16LE(12)
    expect({
      year: 1980 + (date >> 9),
      month: (date >> 5) & 0b1111,
      day: date & 0b11111,
      hour: time >> 11,
      minute: (time >> 5) & 0b111111,
      second: (time & 0b11111) * 2,
    }).toEqual({ year: 2026, month: 6, day: 20, hour: 21, minute: 4, second: 10 })
  })

  it('produces an empty but valid archive for an empty album', async () => {
    // A host whose event has no published photos should get an empty ZIP rather than
    // a stream that never ends or a 500.
    const zip = await collect(archiverWriter.stream(entries()))

    // The end-of-central-directory signature, which is all an empty archive contains.
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  })

  it('rejects the iterable when an entry’s bytes fail mid-archive', async () => {
    // Headers went out long ago, so the only honest signal is the stream failing. The
    // HTTP layer destroys the socket; a truncated ZIP served with a 200 would look
    // like a complete album.
    const failing: ArchiveEntry = {
      name: 'broken.jpg',
      byteSize: 3,
      modifiedAt: new Date('2026-06-20T21:04:11.000Z'),
      bytes: {
        // eslint-disable-next-line require-yield -- the point is that it throws
        async *[Symbol.asyncIterator]() {
          throw new Error('the media store lost the file')
        },
      },
    }

    await expect(collect(archiverWriter.stream(entries(failing)))).rejects.toThrow()
  })

  it('rejects the iterable when an entry cannot be added to the archive at all', async () => {
    // An entry `archiver` refuses raises on the archive itself rather than on a byte
    // stream. With no listener that is an *uncaught exception*, which is the shape of
    // the bug this file exists to avoid: one bad entry would take the process down
    // instead of failing one download.
    const nameless = { ...entry('a.jpg'), name: '' }

    await expect(collect(archiverWriter.stream(entries(nameless)))).rejects.toThrow()
  })

  it('stops reading entries once the archive has failed', async () => {
    // The entries arrive from a query over every published photo. Continuing to read
    // four thousand rows and their bytes for a download that can no longer be served
    // is work nobody will ever see.
    const pulled: string[] = []
    const source: AsyncIterable<ArchiveEntry> = {
      async *[Symbol.asyncIterator]() {
        for (const name of ['', 'second.jpg', 'third.jpg']) {
          pulled.push(name)
          yield { ...entry('x.jpg'), name }
        }
      },
    }

    await expect(collect(archiverWriter.stream(source))).rejects.toThrow()

    // Only the entry that failed: the next is not asked for once the archive is lost.
    expect(pulled).toEqual([''])
  })

  it('reports a non-Error failure as an Error, so the consumer can read a message', async () => {
    // The HTTP layer logs `error.message` when it aborts the response. A thrown string
    // reaching it as-is would log `undefined` and lose the only record of why a host's
    // album download died.
    const throwsAString: AsyncIterable<ArchiveEntry> = {
      // eslint-disable-next-line require-yield -- the point is that it throws
      async *[Symbol.asyncIterator]() {
        throw 'the database went away'
      },
    }

    const failure: unknown = await collect(archiverWriter.stream(throwsAString)).catch(
      (cause: unknown) => cause,
    )

    expect(failure).toBeInstanceOf(Error)
    expect(failure instanceof Error && failure.message).toContain('the database went away')
  })

  it('rejects the iterable when the entry source itself fails', async () => {
    const brokenSource: AsyncIterable<ArchiveEntry> = {
      // eslint-disable-next-line require-yield -- the point is that it throws
      async *[Symbol.asyncIterator]() {
        throw new Error('the database went away')
      },
    }

    await expect(collect(archiverWriter.stream(brokenSource))).rejects.toThrow()
  })
})

/**
 * What an album's sources do while it is downloaded, and when the client goes away.
 *
 * A source is "open" from the first time its bytes are asked for until its generator is
 * closed: the moment a real one holds a file descriptor. `archiver` used to take every
 * entry at once and start every source on the spot, so a client that closed the tab left
 * one open per queued photograph — 292 of 300 generators never closed, measured here.
 */
describe('archiverWriter, sources and a client that goes away', () => {
  const CHUNK = new Uint8Array(64 * 1024)

  interface Counts {
    /** Entries pulled from the listing. */
    listed: number
    /** Sources started: their bytes were asked for. */
    opened: number
    /** Sources closed, whether they ran to their end or were abandoned. */
    closed: number
    /** Started and not closed yet. */
    open: number
    /** The most that were ever open together. */
    mostOpen: number
    /** Whether the listing itself was closed, as a database cursor behind it would be. */
    listingClosed: boolean
  }

  /** An album of `total` photographs, each `chunks` chunks of 64 KiB, that counts itself. */
  const album = (
    total: number,
    chunks: number,
    failAt?: number,
  ): { readonly counts: Counts; readonly entries: AsyncIterable<ArchiveEntry> } => {
    const counts: Counts = {
      listed: 0,
      opened: 0,
      closed: 0,
      open: 0,
      mostOpen: 0,
      listingClosed: false,
    }
    const bytes = async function* (index: number): AsyncGenerator<Uint8Array> {
      counts.opened += 1
      counts.open += 1
      counts.mostOpen = Math.max(counts.mostOpen, counts.open)
      try {
        for (let chunk = 0; chunk < chunks; chunk += 1) {
          if (index === failAt && chunk === 1) throw new Error('the media store lost the file')
          yield CHUNK
        }
      } finally {
        counts.closed += 1
        counts.open -= 1
      }
    }
    return {
      counts,
      entries: {
        async *[Symbol.asyncIterator]() {
          try {
            for (let index = 0; index < total; index += 1) {
              counts.listed += 1
              yield { ...entry(`photo-${index}.jpg`), bytes: bytes(index) }
            }
          } finally {
            counts.listingClosed = true
          }
        },
      },
    }
  }

  /**
   * A consumer that has read until the writer is into the album, and is about to stop, as a
   * client does while the rest is queued. The first chunk is a ZIP header, written before
   * any source is asked for its bytes, so one chunk is not yet "into" it.
   */
  const intoTheAlbum = async (
    chunks: AsyncIterable<Uint8Array>,
    counts: { readonly opened: number },
  ): Promise<AsyncIterator<Uint8Array>> => {
    const iterator = chunks[Symbol.asyncIterator]()
    while (counts.opened === 0) await iterator.next()
    return iterator
  }

  it('keeps one photograph’s source open at a time, however long the album is', async () => {
    // "One file descriptor is open at a time, not one per entry" is what the gallery's
    // lazy `bytesOf` promises. It is only true if the writer asks for an entry's bytes
    // one entry at a time, which is what this counts.
    const { counts, entries: photos } = album(12, 4)

    await collect(archiverWriter.stream(photos))

    expect({ opened: counts.opened, closed: counts.closed, mostOpen: counts.mostOpen }).toEqual({
      opened: 12,
      closed: 12,
      mostOpen: 1,
    })
  })

  it('does not start the album’s sources while the client is not reading it', async () => {
    // Three hundred in the report; thirty is enough to tell "one more than the buffers
    // hold" from "all of them". What the writer may be ahead by is what its own buffers
    // can hold, a few photographs, never the album.
    const { counts, entries: photos } = album(30, 24)

    const iterator = await intoTheAlbum(archiverWriter.stream(photos), counts)
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    const seen = { ...counts }
    await iterator.return?.(undefined)

    expect(seen.opened).toBeLessThanOrEqual(3)
    expect(seen.listed).toBeLessThanOrEqual(3)
  })

  it('closes every source it opened when the client stops reading', async () => {
    // The tab was closed with the album half sent. Nothing is reading, so nothing will
    // ever finish the source that was being read: a descriptor each, for as long as the
    // process lives, on a download anybody holding a gallery link can start.
    const { counts, entries: photos } = album(30, 24)

    const iterator = await intoTheAlbum(archiverWriter.stream(photos), counts)
    await iterator.return?.(undefined)

    await vi.waitFor(() => expect(counts.open).toBe(0), { timeout: 2_000 })
    expect(counts.closed).toBe(counts.opened)
    expect(counts.opened).toBeGreaterThan(0)
    expect(counts.opened).toBeLessThan(30)
  })

  it('closes the listing of entries when the client stops reading', async () => {
    // Whatever the listing holds — a cursor, a page, a lock — is held until it is closed,
    // and the writer is the only thing that knows the download is over.
    const { counts, entries: photos } = album(30, 24)

    const iterator = await intoTheAlbum(archiverWriter.stream(photos), counts)
    await iterator.return?.(undefined)

    await vi.waitFor(() => expect(counts.listingClosed).toBe(true), { timeout: 2_000 })
  })

  it('closes every source it opened when the response is destroyed with an error', async () => {
    // `pipeline` does not call `return()` on a response that dies, it calls `throw()`
    // with the premature-close error: the other way out of the same generator.
    const { counts, entries: photos } = album(30, 24)

    const iterator = await intoTheAlbum(archiverWriter.stream(photos), counts)
    await expect(iterator.throw?.(new Error('premature close'))).rejects.toThrow('premature close')

    await vi.waitFor(() => expect(counts.open).toBe(0), { timeout: 2_000 })
    expect(counts.closed).toBe(counts.opened)
    expect(counts.opened).toBeGreaterThan(0)
    expect(counts.opened).toBeLessThan(30)
  })

  it('closes every source it opened when an entry fails part-way', async () => {
    // The third photograph's file goes missing under the download. The two before it
    // have been written and the one after it was never going to be.
    const { counts, entries: photos } = album(10, 4, 2)

    await expect(collect(archiverWriter.stream(photos))).rejects.toThrow()

    await vi.waitFor(() => expect(counts.open).toBe(0), { timeout: 2_000 })
    expect({ opened: counts.opened, closed: counts.closed }).toEqual({ opened: 3, closed: 3 })
  })

  describe('an entry that is already open when it arrives', () => {
    // What the host's export hands over: the media store opens the file as it builds the
    // entry, and a `ReadStream` has its descriptor from the moment it exists. Nothing has
    // read from it yet, so closing it means destroying that stream itself — a wrapper
    // destroyed before its first read closes nothing, which is how one file was left open
    // for the life of the process.
    let directory: string
    let file: string

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'eventslide-archiver-writer-'))
      file = join(directory, 'photo.jpg')
      await writeFile(file, new Uint8Array(1024 * 1024))
    })

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true })
    })

    /** Resolves when the file's descriptor is released, which `close` is the event for. */
    const closing = (stream: ReadStream): Promise<void> =>
      new Promise<void>((resolve) => {
        if (stream.closed) resolve()
        else stream.once('close', () => resolve())
      })

    it('closes the file of an entry that arrives after the client has gone', async () => {
      // The listing is a database read and takes its time, so the client can leave while
      // the next entry is still being fetched — a few milliseconds per photograph, which
      // over a long album and many abandoned downloads is a descriptor now and then.
      let arrive = (): void => undefined
      const late = new Promise<void>((resolve) => {
        arrive = resolve
      })
      let waiting = (): void => undefined
      const listingIsWaiting = new Promise<void>((resolve) => {
        waiting = resolve
      })
      let stream: ReadStream | undefined
      const slowListing: AsyncIterable<ArchiveEntry> = {
        async *[Symbol.asyncIterator]() {
          yield entry('first.jpg')
          waiting()
          await late
          stream = createReadStream(file)
          yield { ...entry('second.jpg'), bytes: stream }
        },
      }

      const iterator = archiverWriter.stream(slowListing)[Symbol.asyncIterator]()
      await iterator.next()
      // Only now is the writer waiting on the listing, which is the moment this is about.
      await listingIsWaiting
      await iterator.return?.(undefined)
      arrive()

      await vi.waitFor(() => expect(stream).toBeDefined(), { timeout: 2_000 })
      await expect(
        Promise.race([
          closing(stream as ReadStream).then(() => 'closed'),
          new Promise((resolve) => setTimeout(() => resolve('still open'), 2_000)),
        ]),
      ).resolves.toBe('closed')
    })

    it('closes the file of an entry that archiver refuses', async () => {
      // An entry with no name is refused by `archiver` after its source was made. Names are
      // server-generated, so no route reaches this today; the cleanup does not depend on why
      // an entry was not written.
      const stream = createReadStream(file)
      const nameless: ArchiveEntry = { ...entry('x.jpg'), name: '', bytes: stream }

      await expect(collect(archiverWriter.stream(entries(nameless)))).rejects.toThrow()

      await expect(
        Promise.race([
          closing(stream).then(() => 'closed'),
          new Promise((resolve) => setTimeout(() => resolve('still open'), 2_000)),
        ]),
      ).resolves.toBe('closed')
    })
  })
})

describe('albumEntryName', () => {
  it('sorts chronologically when extracted', () => {
    // What a host actually wants when they open the folder.
    const early = albumEntryName({
      createdAt: new Date('2026-06-20T19:00:00.000Z'),
      contentHashShort: 'aaaaaaaaaaaa',
      index: 1,
    })
    const late = albumEntryName({
      createdAt: new Date('2026-06-20T23:30:00.000Z'),
      contentHashShort: 'bbbbbbbbbbbb',
      index: 2,
    })

    expect([late, early].sort()).toEqual([early, late])
  })

  it('contains no character that needs escaping on any filesystem', () => {
    const name = albumEntryName({
      createdAt: new Date('2026-06-20T21:04:11.000Z'),
      contentHashShort: 'abc123def456',
      index: 7,
    })

    expect(name).toMatch(/^[A-Za-z0-9_-]+\.jpg$/)
  })

  it('distinguishes two photos taken in the same second', () => {
    const at = new Date('2026-06-20T21:04:11.000Z')

    const first = albumEntryName({ createdAt: at, contentHashShort: 'aaaaaaaaaaaa', index: 1 })
    const second = albumEntryName({ createdAt: at, contentHashShort: 'bbbbbbbbbbbb', index: 2 })

    expect(first).not.toBe(second)
  })

  it('is stable across exports, so a re-download overwrites rather than duplicating', () => {
    const input = {
      createdAt: new Date('2026-06-20T21:04:11.000Z'),
      contentHashShort: 'abc123def456',
      index: 3,
    }

    expect(albumEntryName(input)).toBe(albumEntryName(input))
  })
})
