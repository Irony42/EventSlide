import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'

/**
 * True when `error` is a filesystem error saying the path does not exist.
 *
 * One spelling for what three adapters each wrote on their own. Narrow on purpose:
 * `ENOTDIR`, `EACCES` and the rest are not "missing" and must keep propagating.
 */
export const isMissing = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'ENOENT'

/**
 * `readdir`, answering an empty list for a directory that does not exist (yet, or any
 * more: a retention purge removes whole trees while a listing walks them). Every other
 * error is thrown.
 */
export function readdirOrEmpty(path: string): Promise<string[]>
export function readdirOrEmpty(path: string, options: { withFileTypes: true }): Promise<Dirent[]>
export async function readdirOrEmpty(
  path: string,
  options?: { withFileTypes: true },
): Promise<string[] | Dirent[]> {
  try {
    return options === undefined ? await readdir(path) : await readdir(path, options)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}
