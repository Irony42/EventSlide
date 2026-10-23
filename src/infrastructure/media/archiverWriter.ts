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
 *
 * **One entry at a time, and nothing left open.** `archiver` itself takes every entry it
 * is handed at once and starts reading each source on the spot, whatever the client is
 * doing, so this adapter hands it one at a time and closes what it was handed when the
 * consumer stops. Without both, a client that closed the tab mid-download left one open
 * file per queued photograph. The port states the contract; `feed` below keeps it.
 */
export const archiverWriter: ArchiveWriter = {
  stream: async function* (entries: AsyncIterable<ArchiveEntry>): AsyncGenerator<Uint8Array> {
    // `archiver` 8 dropped the `archiver('zip', …)` factory for one class per format.
    const { ZipArchive } = await import('archiver')
    const archive = new ZipArchive({ store: true })

    /**
     * Set once the download is over without having finished: the archive failed, or the
     * consumer stopped reading — the client closed the tab, and the response aborted.
     *
     * The first reason wins, and what it does is the same either way: nothing further is
     * read from the entries or appended to the archive, and `feed` is woken if it is
     * waiting for its turn.
     */
    let stopped = false

    /** Wakes `feed` when it is waiting for the archive. */
    let wake: (() => void) | undefined
    const nudge = (): void => {
      const waiting = wake
      wake = undefined
      waiting?.()
    }

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
     * The first reason wins: once the download has stopped, whatever else it raises — a
     * source destroyed on purpose, a late error from `archiver` — is not a failure anybody
     * is waiting to hear about. (The recursion `destroy` causes through the `error`
     * listener below is already cut by the `destroyed` check.)
     */
    const fail = (cause: unknown): void => {
      if (stopped) return
      stopped = true
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (!archive.destroyed) archive.destroy(error)
      nudge()
    }

    // Without a listener, an error `archiver` raises itself is also an uncaught
    // exception.
    archive.on('error', fail)

    /**
     * The source `archiver` was handed last, so a download that ends early can close what
     * it opened. One is enough, and that is the rule above rather than a shortcut: an entry
     * is appended only once the previous has been written, so there is never an older source
     * still being read, and a reference per entry would only be a list that grows with the
     * album.
     */
    let current: Readable | undefined

    // How many entries `archiver` has finished writing, as against how many it was handed.
    let appended = 0
    let written = 0
    archive.on('entry', () => {
      written += 1
      nudge()
    })

    /** Resolves once `archiver` has finished the entry it was handed last, or the download stopped. */
    const untilWritten = async (): Promise<void> => {
      while (!stopped && written < appended) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    }

    /**
     * One entry at a time: the next is taken from `entries`, and its source started, only
     * once `archiver` has written the previous one.
     *
     * `archiver` takes every entry it is handed at once, queues it and starts reading its
     * source on the spot, and nothing a slow or vanished client does slows that down. An
     * album of three hundred photographs was three hundred open sources a second after the
     * first chunk left, and a client that closed the tab left them open: measured, 292 of
     * 300 generators never closed and 55 of 60 real files still open. Anybody who can
     * download an album could do that to the box, a host or the holder of a gallery link.
     *
     * So the feed waits for its turn between entries, and an entry's source is not even
     * *requested* until then — which is what lets the use cases open an entry's bytes
     * lazily, one file descriptor at a time. The first bytes still leave while the album
     * is being listed; what no longer happens is listing it ahead of the download.
     */
    const feed = async (): Promise<void> => {
      const iterator = entries[Symbol.asyncIterator]()
      try {
        for (;;) {
          await untilWritten()
          if (stopped) return
          const next = await iterator.next()
          if (next.done === true) break
          const entry = next.value

          // A stream is used as it is: the filesystem store hands out a `ReadStream`, which
          // has its descriptor open from the moment it was made, and destroying that very
          // object is what closes the file. Wrapped, destroying the wrapper before it was
          // first read would never reach the stream inside.
          const source =
            entry.bytes instanceof Readable ? entry.bytes : Readable.from(entry.bytes)
          // A media file that has gone missing surfaces here, on the entry's own
          // stream, not on the archive.
          source.on('error', fail)
          current = source
          // The client may have left while the entry was being fetched. Its bytes may already
          // be open — an entry can be built with its file opened — so it is the source that
          // is destroyed, not the entry that is dropped. (An entry `archiver` refuses is the
          // same case, and `current` below is what closes it.)
          if (stopped) {
            source.destroy()
            return
          }
          appended += 1
          archive.append(source, { name: entry.name, date: entry.modifiedAt })
        }
        if (!stopped) await archive.finalize()
      } finally {
        await iterator.return?.()
      }
    }

    // Headers went out long ago, so a rejection is the only honest signal left: a
    // truncated ZIP served with a 200 would look like a complete album.
    feed().catch(fail)

    try {
      // `yield*` hands the consumer's early exit on to the archive's own iterator, which
      // destroys the archive, as iterating it directly did.
      yield* archive as AsyncIterable<Uint8Array>
    } finally {
      // That is all it does, though: it neither stops `feed` nor closes what `archiver`
      // was handed, so the source being read and the entries queued behind it stayed open
      // for as long as the process lived. Reached on every way out — the archive ending,
      // failing, or the consumer leaving it half read when the response aborts.
      stopped = true
      nudge()
      current?.destroy()
    }
  },
}
