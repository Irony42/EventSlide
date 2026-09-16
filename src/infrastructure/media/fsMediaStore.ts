import { createReadStream } from 'node:fs'
import { mkdir, rename, rm, stat, unlink, writeFile, readFile, readdir } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ByteRange,
  MediaMetadata,
  MediaStore,
  MediaVariant,
  StoredObject,
} from '../../application/ports/mediaStore'
import { ALL_MEDIA_VARIANTS } from '../../application/ports/mediaStore'
import { ContentHash } from '../../domain/photos/contentHash'
import { asEventId, type EventId } from '../../domain/shared/ids'

/**
 * Media on the local filesystem, laid out as:
 *
 *     <root>/<eventId>/<variant>/<ab>/<contentHash>.<ext>
 *
 * Three deliberate properties:
 *
 * 1. **The event id is the first path segment**, so purging an event is one `rm -r`
 *    and two events can never collide on a name.
 * 2. **The name is the content hash**, so no guest-supplied string ever reaches a path.
 *    1.0 built the filename from the client's own `originalname` and relied on a regex
 *    to keep `..` out of it; here there is nothing to sanitise.
 * 3. **A two-character shard directory**, because ext4 and NTFS both slow down
 *    noticeably once a single directory holds tens of thousands of entries, and a
 *    conference with four thousand photos across three variants gets there.
 */

/**
 * The declared type of each rendition, indexed rather than assumed.
 *
 * This table used to be three entries all reading `image/jpeg`, with the extension a
 * single `const EXTENSION = 'jpg'` beside it — which was true while every byte in the
 * store was a JPEG and became a bug the moment one of them was not. A clip served
 * through that store would have reached the projector labelled `image/jpeg` inside a
 * file called `.jpg`, and with `X-Content-Type-Options: nosniff` on every media response
 * the browser would have believed the label and rendered nothing.
 */
const CONTENT_TYPE: Readonly<Record<MediaVariant, string>> = {
  original: 'image/jpeg',
  display: 'image/jpeg',
  thumb: 'image/jpeg',
  video: 'video/mp4',
  poster: 'image/jpeg',
  // Never served (`source` is outside `SERVED_VARIANTS`), so the honest answer is "some
  // bytes" rather than a type that would invite something to open them.
  source: 'application/octet-stream',
}

const EXTENSION: Readonly<Record<MediaVariant, string>> = {
  original: 'jpg',
  display: 'jpg',
  thumb: 'jpg',
  video: 'mp4',
  poster: 'jpg',
  source: 'bin',
}

/** UUIDs from the id generator; anything else is a bug upstream, not user input. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** What `put` names a file while it is writing it, before the atomic rename. */
const TEMPORARY_SUFFIX = '.tmp'

/**
 * How old an abandoned `.tmp` must be before `list` reaps it on the way past.
 *
 * A `put` writes and renames in milliseconds, so an hour is a hundred thousand times the
 * window it has to protect — and the cost of being generous is that one interrupted
 * upload's bytes survive one more pass. The cost of being mean is deleting a file another
 * request is writing right now.
 *
 * `Date.now()` rather than an injected clock: this is a filesystem housekeeping decision
 * made against `mtime`, which comes from the same wall clock. Handing it a `Clock` would
 * let a test set one and not the other, which would make the comparison a fiction.
 */
const ABANDONED_TEMPORARY_MS = 60 * 60 * 1000

export interface FsMediaStoreOptions {
  readonly root: string
}

export const createFsMediaStore = ({ root }: FsMediaStoreOptions): MediaStore => {
  const absoluteRoot = resolve(root)

  /**
   * Builds a path and then proves it is inside the root.
   *
   * Both inputs are already server-generated — a UUID and a 64-character hex digest
   * validated by `ContentHash` — so this cannot fail in practice. It is here because
   * "cannot fail in practice" is exactly what was said about 1.0's filename regex, and
   * a path that escapes the media root is the difference between a broken image and
   * reading `/etc/passwd`.
   */
  const pathFor = (eventId: EventId, hash: ContentHash, variant: MediaVariant): string => {
    if (!SAFE_SEGMENT.test(eventId)) {
      throw new Error('media store received an unsafe event id')
    }
    if (!/^[0-9a-f]{64}$/.test(hash.value)) {
      throw new Error('media store received an unsafe content hash')
    }

    const shard = hash.value.slice(0, 2)
    const candidate = resolve(
      join(absoluteRoot, eventId, variant, shard, `${hash.value}.${EXTENSION[variant]}`),
    )
    if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot + sep)) {
      throw new Error('media store refused a path outside its root')
    }
    return candidate
  }

  const eventDir = (eventId: EventId): string => {
    if (!SAFE_SEGMENT.test(eventId)) {
      throw new Error('media store received an unsafe event id')
    }
    const candidate = resolve(join(absoluteRoot, eventId))
    if (!candidate.startsWith(absoluteRoot + sep)) {
      throw new Error('media store refused a path outside its root')
    }
    return candidate
  }

  const isMissing = (error: unknown): boolean =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'

  const directorySize = async (directory: string): Promise<number> => {
    let total = 0
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) return 0
      throw error
    }
    for (const entry of entries) {
      const child = join(directory, entry.name)
      if (entry.isDirectory()) {
        total += await directorySize(child)
      } else {
        try {
          total += (await stat(child)).size
        } catch (error) {
          // A file removed between the listing and the stat. Skipping it is right:
          // this is a reconciliation figure, not an accounting record.
          if (!isMissing(error)) throw error
        }
      }
    }
    return total
  }

  return {
    put: async (eventId, hash, variant, bytes): Promise<void> => {
      const target = pathFor(eventId, hash, variant)
      await mkdir(join(target, '..'), { recursive: true })

      // Write to a unique temporary name in the same directory, then rename. On both
      // ext4 and NTFS the rename is atomic within a filesystem, so the wall requesting
      // a photo the instant it is published never sees a half-written file. A random
      // suffix means two concurrent uploads of identical bytes cannot clobber each
      // other's temporary file.
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, bytes, { flag: 'wx' })
        await rename(temporary, target)
      } catch (error) {
        await unlink(temporary).catch(() => {
          // Best effort. A `.tmp` left here is not addressable, so `list` will not name
          // it and `sweepOrphanedMedia` will not collect it either — it survives until
          // the event is purged. Failing the upload over it would still be worse.
        })
        throw error
      }
    },

    exists: async (eventId, hash, variant): Promise<boolean> => {
      try {
        await stat(pathFor(eventId, hash, variant))
        return true
      } catch (error) {
        if (isMissing(error)) return false
        throw error
      }
    },

    stat: async (eventId, hash, variant): Promise<MediaMetadata | null> => {
      try {
        const stats = await stat(pathFor(eventId, hash, variant))
        return {
          byteSize: stats.size,
          contentType: CONTENT_TYPE[variant],
          modifiedAt: stats.mtime,
        }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },

    openRead: async (
      eventId,
      hash,
      variant,
      range?: ByteRange,
    ): Promise<AsyncIterable<Uint8Array> | null> => {
      const target = pathFor(eventId, hash, variant)
      let size: number
      try {
        // Stat first: `createReadStream` reports a missing file asynchronously, on the
        // stream, by which point the HTTP layer has already committed to a 200.
        size = (await stat(target)).size
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }

      if (range === undefined) return createReadStream(target)

      // A range the object cannot satisfy answers `null`, exactly as a missing object
      // does: `createReadStream` with a start past the end yields an empty stream under
      // a `206` claiming a length nobody will ever receive, and a player waits on it.
      if (range.start >= size || range.end < range.start) return null

      // Inclusive at both ends, which is what `Range` means and what this option takes.
      return createReadStream(target, { start: range.start, end: Math.min(range.end, size - 1) })
    },

    read: async (eventId, hash, variant): Promise<Uint8Array | null> => {
      try {
        return new Uint8Array(await readFile(pathFor(eventId, hash, variant)))
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },

    delete: async (eventId, hash): Promise<void> => {
      await Promise.all(
        // Every rendition, not the ones a photograph happens to have: a caller holding a
        // digest does not have to know whether it addresses a still, a clip's mp4 or a
        // staged upload, and the extra unlinks miss silently by contract.
        ALL_MEDIA_VARIANTS.map((variant) =>
          unlink(pathFor(eventId, hash, variant)).catch((error: unknown) => {
            // Idempotent by contract: deleting a photo whose thumb was never generated
            // must succeed.
            if (!isMissing(error)) throw error
          }),
        ),
      )
    },

    deleteEvent: async (eventId): Promise<void> => {
      await rm(eventDir(eventId), { recursive: true, force: true })
    },

    usedBytes: async (eventId): Promise<number> => directorySize(eventDir(eventId)),

    listEvents: async (): Promise<readonly EventId[]> => {
      let entries
      try {
        entries = await readdir(absoluteRoot, { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) return []
        throw error
      }
      return entries
        .filter((entry) => entry.isDirectory())
        // `.uploads` and `.scratch` live here too and are not events. `SAFE_SEGMENT`
        // already excludes a leading dot, so this is the same rule the writer enforces
        // rather than a second spelling of it.
        .filter((entry) => SAFE_SEGMENT.test(entry.name))
        .map((entry) => asEventId(entry.name))
    },

    list: async (eventId): Promise<readonly StoredObject[]> => {
      const found: StoredObject[] = []

      for (const variant of ALL_MEDIA_VARIANTS) {
        const variantDir = join(eventDir(eventId), variant)
        let shards
        try {
          shards = await readdir(variantDir, { withFileTypes: true })
        } catch (error) {
          if (isMissing(error)) continue
          throw error
        }

        for (const shard of shards.filter((entry) => entry.isDirectory())) {
          const shardDir = join(variantDir, shard.name)
          // ENOENT-guarded like the read above it, and for a reason that is not
          // hypothetical: the retention purge removes an event's whole tree with `rm -r`,
          // and it runs on the same schedule as the sweep. Without this an ordinary purge
          // landing mid-walk threw out of `list`, the event was reported as failed, and
          // the operator got a warning about routine behaviour.
          let files
          try {
            files = await readdir(shardDir, { withFileTypes: true })
          } catch (error) {
            if (isMissing(error)) continue
            throw error
          }

          for (const file of files) {
            if (!file.isFile()) continue

            // Only names this store could itself have written. A leaked `.tmp` from an
            // interrupted `put` fails here, and so would anything an operator dropped in
            // by hand — a collector must never be handed a path it cannot account for.
            const expected = `.${EXTENSION[variant]}`

            /**
             * **A `.tmp` older than the grace window is reaped here, not listed.**
             *
             * `put` writes `<target>.<uuid>.tmp` and renames; a `SIGKILL` between the two
             * strands up to `MAX_CLIP_BYTES` that is invisible to the quota (no row names
             * it) and to the reconciliation sweep (it is not an address this store could
             * have written, and a collector must never be handed a path it cannot account
             * for). So nothing else would ever remove it.
             *
             * The store reaps its own, because only the store knows that this name is its
             * own wreckage. The age guard is what keeps it from deleting a `put` that is
             * in flight right now — one is written and renamed in milliseconds, so an hour
             * is a hundred thousand times the window.
             */
            if (file.name.endsWith(TEMPORARY_SUFFIX)) {
              const path = join(shardDir, file.name)
              try {
                const info = await stat(path)
                if (info.mtimeMs <= Date.now() - ABANDONED_TEMPORARY_MS) await unlink(path)
              } catch (error) {
                // Gone already, or a disk that will not co-operate. Either way this is
                // housekeeping on the way past, and failing a listing over it would take
                // the whole sweep down with it.
                if (!isMissing(error)) throw error
              }
              continue
            }

            if (!file.name.endsWith(expected)) continue
            const name = file.name.slice(0, -expected.length)
            const digest = ContentHash.create(name)
            if (!digest.ok) continue
            // **The name must already be the digest's own spelling.** `ContentHash.create`
            // lower-cases, so an upper-case filename would be listed under a lower-case
            // digest — and `delete` builds its path from that, unlinking a file that is
            // not this one while the report says these bytes were reclaimed. `put` only
            // ever writes lower-case, so anything else is not ours to name.
            if (digest.value.value !== name) continue

            try {
              const info = await stat(join(shardDir, file.name))
              found.push({
                hash: digest.value,
                variant,
                byteSize: info.size,
                modifiedAt: info.mtime,
              })
            } catch (error) {
              // Removed between the listing and the stat — by a purge, or by a sweep
              // already running. Not listing it is the correct answer.
              if (!isMissing(error)) throw error
            }
          }
        }
      }

      return found
    },
  }
}
