import { Readable } from 'node:stream'
import archiver from 'archiver'
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
 */
export const archiverWriter: ArchiveWriter = {
  stream: (entries: AsyncIterable<ArchiveEntry>): AsyncIterable<Uint8Array> => {
    const archive = archiver('zip', { store: true })

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

    // Feeding runs alongside consumption rather than before it: `archiver` applies
    // backpressure through its own writable side, so a slow client throttles the
    // database read instead of buffering the album in memory.
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

    return archive as AsyncIterable<Uint8Array>
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
