import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

/**
 * Renders the app icons from `scripts/icon-source.svg`.
 *
 * Chromium will not offer to install a web app without a 192px and a 512px icon, and
 * neither will it tell you why — the manifest simply never becomes installable and the
 * prompt never fires. iOS ignores the manifest's icons entirely and reads
 * `apple-touch-icon`, so that one is rendered too.
 *
 * Rendered rather than drawn, and rendered from one source, so there is a single place
 * that says what this product looks like on a home screen. The source is the brand's
 * « tirage suspendu » on a full cream square (the tab icon `web/public/favicon.svg` is
 * the same drawing on a rounded square). Its drawing already sits inside the circle of
 * 80% that an Android launcher guarantees, so one render serves the `any` and the
 * `maskable` entries and iOS alike: no per-platform inset, no ground to composite onto.
 * `generateIcons` is exported and `scripts/generateIcons.test.ts` runs it against the
 * committed files: edit the SVG without re-running this and the test says so, which is
 * the only thing that keeps five raster files honest.
 *
 * The PNGs are committed rather than built, because `web/public` is copied by Vite at
 * the start of a build and a developer running `npm run dev` on a fresh clone would
 * otherwise have a manifest pointing at four 404s.
 */

const here = dirname(fileURLToPath(import.meta.url))
export const PUBLIC_DIR = join(here, '..', 'web', 'public')
export const SOURCE = join(here, 'icon-source.svg')
export const ICONS_DIR = join(PUBLIC_DIR, 'icons')

export interface IconSpec {
  readonly file: string
  readonly size: number
  /** Whether the manifest offers it as `maskable`: the launcher crops it to its own shape. */
  readonly maskable: boolean
}

export const ICONS: readonly IconSpec[] = [
  // The two Chromium requires. Without both there is no install offer at all, and it
  // never says so: the manifest simply fails to become installable.
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  // Android's adaptive icon, at the two densities launchers ask for.
  { file: 'icon-maskable-192.png', size: 192, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS reads this from a <link> and never looks at the manifest.
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
]

/**
 * The radius, as a fraction of the width, that a maskable launcher will not crop: the
 * specification guarantees a circle of 80% diameter, not an 80% square. The test measures
 * the rendered ink against it rather than trusting the drawing.
 */
export const MASK_SAFE_RADIUS = 0.4

export const renderIcon = async (source: Buffer, spec: IconSpec): Promise<Buffer> =>
  sharp(source, { density: 384 }).resize(spec.size, spec.size).png().toBuffer()

/** `into` is a parameter so the write path itself is testable against a temp directory. */
export const generateIcons = async (into: string = ICONS_DIR): Promise<readonly string[]> => {
  const source = await readFile(SOURCE)
  await mkdir(into, { recursive: true })

  const written: string[] = []
  for (const spec of ICONS) {
    await writeFile(join(into, spec.file), await renderIcon(source, spec))
    written.push(spec.file)
  }
  return written
}

/**
 * Run directly (`npm run build:icons`) rather than imported by the test.
 *
 * Compared on the resolved path because `import.meta.url` means the same thing under tsx
 * whichever module format it emits. Same shape as scripts/backup.ts and restore.ts.
 */
const invokedDirectly = (): boolean => {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === pathToFileURL(entry).href
}

if (invokedDirectly()) {
  // `.then` rather than top-level await: `package.json` has no `"type"` field on
  // purpose (CLAUDE.md section 9), so tsx transpiles this to CommonJS, where a
  // top-level await is a syntax error. Every script here is written the same way.
  void generateIcons().then(
    (written) => {
      console.log(`Wrote ${written.length} icons to web/public/icons/`)
    },
    (cause: unknown) => {
      // A message rather than an unhandled-rejection stack. The exit code is what the
      // build reads; the line above it is what a person reads.
      console.error(cause instanceof Error ? cause.message : String(cause))
      process.exitCode = 1
    },
  )
}
