import { Readable } from 'node:stream'
import type { ArchiveEntry, ArchiveWriter } from '../../application/ports/archiveWriter'

/**
 * The album ZIP, streamed both ways.
 *
 * A four-thousand-photo wedding album is several gigabytes: the entries arrive from an
 * async iterable over database rows, each photo's bytes arrive from the media store,
 * and the archive is emitted as chunks the HTTP layer pipes to the response. Nothing
 * is materialised, which is the difference between a download that works and a
 * self-hosted box that runs out of memory.
 *
 * `store: true` — no compression. Photos are already compressed; deflating a JPEG
 * spends CPU on a machine that is simultaneously re-encoding uploads, to gain
 * essentially nothing.
 *
 * `archiver` 8 is ESM-only, and this package is CommonJS (`package.json` has no
 * `"type"`, and the server builds with `module: node16` — CLAUDE.md §9 trap 8), where
 * a static `import` of it is `error TS1479`. A dynamic `import()` is the one form
 * Node16 accepts from a CommonJS file and leaves untouched in the emitted JavaScript,
 * so the library is loaded the first time an album is downloaded rather than at boot.
 * That is also why `stream` is an async generator: the load is asynchronous, and the
 * port's signature (a synchronous call returning an iterable) is the one the use case
 * and its tests are written against.
 */
export const archiverWriter: ArchiveWriter = {
  stream: async function* (entries: AsyncIterable<ArchiveEntry>): AsyncGenerator<Uint8Array> {
    // `archiver` 8 dropped the `archiver('zip', …)` factory for one class per format.
    const { ZipArchive } = await import('archiver')
    const archive = new ZipArchive({ store: true })

    /**
     * Turns any failure into a rejection of the returned iterable.
     *
     * `destroy(error)` rather than `emit('error')`: emitting is what an earlier
     * version did, and with no listener attached it became an *uncaught exception*
     * instead of reaching the consumer — so a lost media file would have crashed the
     * process rather than failing one download. Destroying propagates to the
     * `for await` that is reading the archive, which is what the HTTP layer needs in
     * order to abort the response.
     *
     * The flag stops the recursion `destroy` would otherwise cause through the
     * `error` listener below.
     */
    let failed = false
    const fail = (cause: unknown): void => {
      if (failed) return
      failed = true
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (!archive.destroyed) archive.destroy(error)
    }

    // Without a listener, an error `archiver` raises itself is also an uncaught
    // exception.
    archive.on('error', fail)

    // Feeding runs alongside consumption rather than before it, so the first bytes leave
    // while the album is still being listed. That is not backpressure: `archiver` queues
    // every entry it is handed and starts reading its source at once, so a client that has
    // stopped reading does not slow this loop (measured, with archiver 7 and 8 alike: 300
    // of 300 entries pulled and opened after one chunk was read). Bounding it is open work.
    const feed = async (): Promise<void> => {
      for await (const entry of entries) {
        if (failed) return
        const source = Readable.from(entry.bytes)
        // A media file that has gone missing surfaces here, on the entry's own
        // stream, not on the archive.
        source.on('error', fail)
        archive.append(source, { name: entry.name, date: entry.modifiedAt })
      }
      if (!failed) await archive.finalize()
    }

    // Headers went out long ago, so a rejection is the only honest signal left: a
    // truncated ZIP served with a 200 would look like a complete album.
    feed().catch(fail)

    // `yield*` hands the consumer's early exit on to the archive's own iterator, which
    // destroys the archive, as iterating it directly did. It does not stop `feed` or close
    // the sources already queued, so a client that aborts a download leaves them open: the
    // same on archiver 7, and nothing here tests it.
    yield* archive as AsyncIterable<Uint8Array>
  },
}

/**
 * A filename that is unique within the archive and safe to extract.
 *
 * Guest-supplied names never reach this: the media store is content-addressed, so the
 * album is named from the photo's own metadata. The date prefix makes the extracted
 * folder sort chronologically, which is what a host actually wants when they open it.
 */
export const albumEntryName = (input: {
  readonly createdAt: Date
  readonly contentHashShort: string
  readonly index: number
}): string => {
  const stamp = input.createdAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  // The index disambiguates two photos taken in the same second; the hash fragment
  // keeps the name stable across exports so a re-download overwrites rather than
  // duplicating.
  return `${stamp}_${String(input.index).padStart(4, '0')}_${input.contentHashShort}.jpg`
}
