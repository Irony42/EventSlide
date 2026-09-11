import { createReadStream } from 'node:fs'
import { mkdir, rename, rm, stat, unlink, writeFile, readFile, readdir } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  MediaMetadata,
  MediaStore,
  MediaVariant,
} from '../../application/ports/mediaStore'
import { MEDIA_VARIANTS } from '../../application/ports/mediaStore'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { EventId } from '../../domain/shared/ids'

/**
 * Photos on the local filesystem, laid out as:
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

const CONTENT_TYPE: Readonly<Record<MediaVariant, string>> = {
  original: 'image/jpeg',
  display: 'image/jpeg',
  thumb: 'image/jpeg',
}

const EXTENSION = 'jpg'

/** UUIDs from the id generator; anything else is a bug upstream, not user input. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

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
      join(absoluteRoot, eventId, variant, shard, `${hash.value}.${EXTENSION}`),
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
          // Best effort. A leaked temporary file is swept by the media reconciliation
          // job; failing the upload over it would be worse.
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
        return { byteSize: stats.size, contentType: CONTENT_TYPE[variant] }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },

    openRead: async (eventId, hash, variant): Promise<AsyncIterable<Uint8Array> | null> => {
      const target = pathFor(eventId, hash, variant)
      try {
        // Stat first: `createReadStream` reports a missing file asynchronously, on the
        // stream, by which point the HTTP layer has already committed to a 200.
        await stat(target)
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
      return createReadStream(target)
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
        MEDIA_VARIANTS.map((variant) =>
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
  }
}
