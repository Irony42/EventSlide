import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { ExportFileStore } from '../../application/ports/exportFileStore'
import { DomainError } from '../../domain/shared/errors'
import { asEventId, type EventId } from '../../domain/shared/ids'
import { isMissing, readdirOrEmpty } from '../system/fsErrors'

/**
 * `ExportFileStore` on the local disk: `<MEDIA_ROOT>/.exports/<eventId>.zip` (spec 22).
 *
 * **A dot-folder at the root of the media root, on purpose**, beside `.books`: `fsMediaStore.listEvents`
 * and the backup already skip such folders, so an archive, which is a derived copy of the album, is
 * neither counted against an event's quota, nor copied into every hourly backup, nor reported as an
 * unreferenced object. The price is that `deleteEvent` does not reach it: the purge deletes the
 * archive explicitly, next to the row.
 *
 * The file name is the validated event id and nothing else. Never the title. A write goes to
 * `.exports/.tmp/<id>.<uuid>.tmp` and is renamed into place, so **a temporary file is never listed**
 * and a reader never sees half an archive.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const EXPORT_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.zip$/
const TEMPORARY_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.tmp$/

export const createFsExportFileStore = (mediaRoot: string): ExportFileStore => {
  const exportsDir = resolve(mediaRoot, '.exports')
  const tmpDir = join(exportsDir, '.tmp')

  const finalPath = (eventId: EventId): string => {
    if (!SAFE_SEGMENT.test(eventId)) throw new Error('export store received an unsafe event id')
    const candidate = resolve(exportsDir, `${eventId}.zip`)
    if (!candidate.startsWith(exportsDir + sep)) throw new Error('export store refused a path')
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
          if (size > maxBytes) throw DomainError.quotaExceeded('export.tooLarge')
          await handle.write(chunk)
        }
        await handle.sync()
      } catch (error) {
        await handle.close()
        await rm(temporary, { force: true })
        throw error
      }
      await handle.close()
      // A rename that fails leaves the temporary file, which the archive sweep collects once it is old.
      await rename(temporary, target)
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
      const names = await readdirOrEmpty(exportsDir)
      return names.flatMap((name) => {
        const match = EXPORT_FILE.exec(name)
        return match?.[1] === undefined ? [] : [asEventId(match[1])]
      })
    },

    listTemporary: async () => {
      const names = (await readdirOrEmpty(tmpDir)).filter((name) => TEMPORARY_FILE.test(name))
      // A file renamed into place or removed between the listing and the stat is not temporary any
      // more: it is left out, not an error.
      const stats = await Promise.allSettled(names.map((name) => stat(join(tmpDir, name))))
      return names.flatMap((name, index) => {
        const found = stats[index]
        return found?.status === 'fulfilled'
          ? [{ name, size: found.value.size, modifiedAt: found.value.mtime }]
          : []
      })
    },

    deleteTemporary: async (name) => {
      if (!TEMPORARY_FILE.test(name)) throw new Error('export store received an unsafe file name')
      await rm(join(tmpDir, name), { force: true })
    },
  }
}
