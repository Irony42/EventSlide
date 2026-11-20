import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type {
  BookFileKind,
  BookFileSetResult,
  BookFileStore,
} from '../../application/ports/bookFileStore'
import { DomainError } from '../../domain/shared/errors'
import { asEventId, type EventId } from '../../domain/shared/ids'
import { isMissing, readdirOrEmpty } from '../system/fsErrors'

/**
 * `BookFileStore` on the local disk: `<MEDIA_ROOT>/.books/<eventId>.pdf` and, for the printer
 * version, `<eventId>.print.pdf` and `<eventId>.cover.pdf`.
 *
 * **A dot-folder at the root of the media root, on purpose.** `fsMediaStore.listEvents`,
 * `list` and the backup (`backupArchive.walkFiles`) already skip such folders (`.uploads`,
 * `.scratch`), so a book, which is a derived file, is neither counted against an event's
 * quota, nor copied into every hourly backup, nor reported as an unreferenced object. The price
 * is that `deleteEvent` does not reach it: the purge deletes the book explicitly.
 *
 * The file name is the validated event id and a fixed suffix. Never the title. An id that itself
 * ends with one of the suffixes' stems (`.print`, `.cover`) is refused, so a name always has one
 * reading (the ids the product generates never contain a dot).
 */

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const RESERVED_STEM = /\.(print|cover)$/
const BOOK_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127}?)(?:\.print|\.cover)?\.pdf$/

const SUFFIX: Readonly<Record<BookFileKind, string>> = {
  screen: '.pdf',
  printInterior: '.print.pdf',
  printCover: '.cover.pdf',
}
const KINDS: readonly BookFileKind[] = ['screen', 'printInterior', 'printCover']

interface Part {
  readonly handle: FileHandle
  readonly temporary: string
  size: number
}

/**
 * Writes every byte: `FileHandle.write` may write less than it was given (it answers how much), and
 * a PDF with a hole in it is a book nobody can open.
 */
export const writeFully = async (
  handle: Pick<FileHandle, 'write'>,
  bytes: Uint8Array,
): Promise<void> => {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset)
    offset += bytesWritten
  }
}

export const createFsBookFileStore = (mediaRoot: string): BookFileStore => {
  const booksDir = resolve(mediaRoot, '.books')
  const tmpDir = join(booksDir, '.tmp')

  const finalPath = (eventId: EventId, kind: BookFileKind = 'screen'): string => {
    if (!SAFE_SEGMENT.test(eventId) || RESERVED_STEM.test(eventId)) {
      throw new Error('book store received an unsafe event id')
    }
    const candidate = resolve(booksDir, `${eventId}${SUFFIX[kind]}`)
    if (!candidate.startsWith(booksDir + sep)) throw new Error('book store refused a path')
    return candidate
  }

  const closeQuietly = async (handle: FileHandle): Promise<void> => {
    try {
      await handle.close()
    } catch {
      // Already closed: nothing to release.
    }
  }

  const discard = async (part: Part): Promise<void> => {
    await closeQuietly(part.handle)
    await rm(part.temporary, { force: true })
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
          await writeFully(handle, chunk)
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

    writeSet: async (eventId, chunks, options): Promise<BookFileSetResult> => {
      const { maxBytes } = options
      const targets = Object.fromEntries(KINDS.map((kind) => [kind, finalPath(eventId, kind)]))
      await mkdir(tmpDir, { recursive: true })
      const parts = new Map<BookFileKind, Part>()
      /** Printer targets this call has already put in place: removed again if a later rename fails. */
      const placed: string[] = []
      let printTotal = 0
      let printSkipped: 'tooLarge' | null = null

      const partOf = async (kind: BookFileKind): Promise<Part> => {
        const known = parts.get(kind)
        if (known !== undefined) return known
        const temporary = join(tmpDir, `${eventId}.${randomUUID()}.tmp`)
        const made: Part = { handle: await open(temporary, 'w'), temporary, size: 0 }
        parts.set(kind, made)
        return made
      }
      const dropPrint = async (): Promise<void> => {
        for (const kind of ['printInterior', 'printCover'] as const) {
          const part = parts.get(kind)
          if (part === undefined) continue
          parts.delete(kind)
          await discard(part)
        }
      }
      const discardAll = async (): Promise<void> => {
        for (const part of parts.values()) await discard(part)
        parts.clear()
      }

      try {
        for await (const chunk of chunks) {
          if (chunk.kind === 'screen') {
            const screen = await partOf('screen')
            screen.size += chunk.bytes.byteLength
            if (screen.size > maxBytes.screen) throw DomainError.quotaExceeded('book.tooLarge')
            await writeFully(screen.handle, chunk.bytes)
            continue
          }
          if (printSkipped !== null) continue
          printTotal += chunk.bytes.byteLength
          if (printTotal > maxBytes.print) {
            printSkipped = 'tooLarge'
            options.onPrintDropped?.()
            await dropPrint()
            continue
          }
          const part = await partOf(chunk.kind)
          part.size += chunk.bytes.byteLength
          await writeFully(part.handle, chunk.bytes)
        }
        const screen = parts.get('screen')
        const interior = parts.get('printInterior')
        const cover = parts.get('printCover')
        if (screen === undefined) throw new Error('book store: the render produced no screen book')
        if ((interior === undefined) !== (cover === undefined)) {
          throw new Error('book store: the printer version needs both its files')
        }
        for (const part of parts.values()) {
          await part.handle.sync()
          await part.handle.close()
        }

        // The printer files first and the screen book last: a screen book in place says the set is whole.
        for (const [kind, part] of [
          ['printInterior', interior],
          ['printCover', cover],
        ] as const) {
          if (part === undefined) await rm(targets[kind]!, { force: true })
          else {
            await rename(part.temporary, targets[kind]!)
            placed.push(targets[kind]!)
          }
          parts.delete(kind)
        }
        await rename(screen.temporary, targets['screen']!)
        parts.delete('screen')
        return {
          screen: screen.size,
          printInterior: interior?.size ?? null,
          printCover: cover?.size ?? null,
          printSkipped,
        }
      } catch (error) {
        await discardAll()
        // A set is whole or absent: the printer files this call renamed do not stay without their book.
        for (const target of placed) await rm(target, { force: true })
        throw error
      }
    },

    stat: async (eventId, kind) => {
      try {
        return { size: (await stat(finalPath(eventId, kind))).size }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },

    openRead: async (eventId, range, kind) => {
      const path = finalPath(eventId, kind)
      try {
        await stat(path)
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
      return createReadStream(path, range === undefined ? {} : { start: range.start, end: range.end })
    },

    delete: async (eventId) => {
      for (const kind of KINDS) await rm(finalPath(eventId, kind), { force: true })
    },

    list: async () => {
      const names = await readdirOrEmpty(booksDir)
      const ids = new Set<EventId>()
      for (const name of names) {
        const match = BOOK_FILE.exec(name)
        if (match?.[1] !== undefined) ids.add(asEventId(match[1]))
      }
      return [...ids]
    },
  }
}
