import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ExportFolderStore } from '../../application/ports/exportFolderStore'
import { EXPORT_FOLDER_ARCHIVE, EXPORT_FOLDER_MANIFEST } from '../../domain/exports/exportFolder'
import { DomainError } from '../../domain/shared/errors'
import { isMissing } from '../system/fsErrors'

/**
 * `ExportFolderStore` on a directory the operator chose, outside `MEDIA_ROOT` (spec 22, section 8):
 * `<root>/<folder>/album.zip` and `<root>/<folder>/MANIFEST.sha256`.
 *
 * Nothing is created until a write: a dry run constructs this and never touches the disk. A write
 * goes to a `.tmp` beside the archive and is renamed into place, the way the box's own store does,
 * so a cron job that is killed leaves no half archive under the name of a whole one.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export const createFsExportFolderStore = (root: string): ExportFolderStore => {
  const base = resolve(root)

  const dirOf = (folder: string): string => {
    if (!SAFE_SEGMENT.test(folder)) throw new Error('export folder store received an unsafe name')
    return resolve(base, folder)
  }
  const archivePath = (folder: string): string => join(dirOf(folder), EXPORT_FOLDER_ARCHIVE)

  return {
    write: async (folder, bytes, { maxBytes }) => {
      const dir = dirOf(folder)
      await mkdir(dir, { recursive: true })
      const temporary = join(dir, `${EXPORT_FOLDER_ARCHIVE}.${randomUUID()}.tmp`)
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
      await rename(temporary, archivePath(folder))
      return size
    },

    stat: async (folder) => {
      try {
        return { size: (await stat(archivePath(folder))).size }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },

    openRead: async (folder, range) => {
      const path = archivePath(folder)
      try {
        await stat(path)
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
      return createReadStream(path, range === undefined ? {} : { start: range.start, end: range.end })
    },

    writeManifest: async (folder, text) => {
      await writeFile(join(dirOf(folder), EXPORT_FOLDER_MANIFEST), text, 'utf8')
    },

    publish: async (staging, folder) => {
      const from = dirOf(staging)
      const to = dirOf(folder)
      await mkdir(to, { recursive: true })
      await rm(join(to, EXPORT_FOLDER_MANIFEST), { force: true })
      await rename(join(from, EXPORT_FOLDER_ARCHIVE), join(to, EXPORT_FOLDER_ARCHIVE))
      try {
        await rename(join(from, EXPORT_FOLDER_MANIFEST), join(to, EXPORT_FOLDER_MANIFEST))
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      await rmdir(from).catch(() => undefined)
    },

    delete: async (folder) => {
      const dir = dirOf(folder)
      await rm(archivePath(folder), { force: true })
      await rm(join(dir, EXPORT_FOLDER_MANIFEST), { force: true })
      try {
        if ((await readdir(dir)).length === 0) await rmdir(dir)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    },
  }
}
