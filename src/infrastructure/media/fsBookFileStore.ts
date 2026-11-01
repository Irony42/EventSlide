import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { BookFileStore } from '../../application/ports/bookFileStore'
import { DomainError } from '../../domain/shared/errors'
import { asEventId, type EventId } from '../../domain/shared/ids'

/**
 * `BookFileStore` on the local disk: `<MEDIA_ROOT>/.books/<eventId>.pdf`.
 *
 * **A dot-folder at the root of the media root, on purpose.** `fsMediaStore.listEvents`,
 * `usedBytes` and the backup (`backupArchive.walkFiles`) already skip such folders (`.uploads`,
 * `.scratch`), so a book, which is a derived file, is neither counted against an event's
 * quota, nor copied into every hourly backup, nor reported as an unreferenced object. The price
 * is that `deleteEvent` does not reach it: the purge deletes the book explicitly.
 *
 * The file name is the validated event id and nothing else. Never the title.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const BOOK_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.pdf$/

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'

export const createFsBookFileStore = (mediaRoot: string): BookFileStore => {
  const booksDir = resolve(mediaRoot, '.books')
  const tmpDir = join(booksDir, '.tmp')

  const finalPath = (eventId: EventId): string => {
    if (!SAFE_SEGMENT.test(eventId)) throw new Error('book store received an unsafe event id')
    const candidate = resolve(booksDir, `${eventId}.pdf`)
    if (!candidate.startsWith(booksDir + sep)) throw new Error('book store refused a path')
    return candidate
  }

  return {
    write: async (eventId, bytes, { maxBytes }): Promise<number> => {
      const target = finalPath(eventId)
      await mkdir(tmpDir, { recursive: true })
      const temporary = join(tmpDir, `${eventId}.${randomUUID()}.tmp`)
      const handle = await open(temporary, 'w')
      let size = 0
      try {
        for await (const chunk of bytes) {
          size += chunk.byteLength
          if (size > maxBytes) throw DomainError.quotaExceeded('book.tooLarge')
          await handle.write(chunk)
        }
        await handle.sync()
      } catch (error) {
        await handle.close()
        await rm(temporary, { force: true })
        throw error
      }
      await handle.close()
      try {
        await rename(temporary, target)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
      return size
    },

    stat: async (eventId) => {
      try {
        return { size: (await stat(finalPath(eventId))).size }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },

    openRead: async (eventId, range) => {
      const path = finalPath(eventId)
      try {
        await stat(path)
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
      return createReadStream(path, range === undefined ? {} : { start: range.start, end: range.end })
    },

    delete: async (eventId) => {
      await rm(finalPath(eventId), { force: true })
    },

    list: async () => {
      let names: string[]
      try {
        names = await readdir(booksDir)
      } catch (error) {
        if (isMissing(error)) return []
        throw error
      }
      return names.flatMap((name) => {
        const match = BOOK_FILE.exec(name)
        return match?.[1] === undefined ? [] : [asEventId(match[1])]
      })
    },
  }
}
