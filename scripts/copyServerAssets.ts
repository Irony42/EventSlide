import { cp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `tsc` emits JavaScript and nothing else, so the files the compiled server reads at run time
 * are copied here, after it: the photo book's Noto fonts and their licence (SIL OFL 1.1), which
 * `pdfBookRenderer` loads from `fonts/` beside itself. Without this the image builds, boots, and
 * every book fails at its first page.
 *
 * `scripts/copyServerAssets.test.ts` runs the real copy, and asserts the source and the
 * destination agree on the list.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** Source directory (under `src`) of each directory the server reads at run time. */
export const SERVER_ASSET_DIRECTORIES: readonly string[] = ['infrastructure/media/fonts']

export const copyServerAssets = async (
  sourceRoot = join(root, 'src'),
  outputRoot = join(root, 'dist', 'server'),
): Promise<readonly string[]> => {
  const copied: string[] = []
  for (const directory of SERVER_ASSET_DIRECTORIES) {
    await cp(join(sourceRoot, directory), join(outputRoot, directory), { recursive: true })
    copied.push(directory)
  }
  return copied
}

/** What the `build:api` step runs (`tsx -e`, so this module has no entry point of its own to leave uncovered): the exit code is what the build reads, the line is what a person reads. */
export const runCli = async (
  copy: () => Promise<readonly string[]>,
  log: (line: string) => void,
  fail: (line: string) => void,
): Promise<number> => {
  try {
    const copied = await copy()
    log(`Copied ${copied.join(', ')} to dist/server/`)
    return 0
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}
