import { describe, expect, it } from 'vitest'
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

    expect(pulled).toEqual(['', 'second.jpg'])
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
