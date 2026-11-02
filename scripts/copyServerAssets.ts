import { cp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void copyServerAssets().then(
    (copied) => {
      console.log(`Copied ${copied.join(', ')} to dist/server/`)
    },
    (cause: unknown) => {
      console.error(cause instanceof Error ? cause.message : String(cause))
      process.exitCode = 1
    },
  )
}
