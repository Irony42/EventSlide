import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

/**
 * Renders the app icons from `web/public/favicon.svg`.
 *
 * Chromium will not offer to install a web app without a 192px and a 512px icon, and
 * neither will it tell you why — the manifest simply never becomes installable and the
 * prompt never fires. iOS ignores the manifest's icons entirely and reads
 * `apple-touch-icon`, so that one is rendered too.
 *
 * Rendered rather than drawn, and rendered from the one mark that already exists, so
 * there is a single source of truth for what this product looks like. `generateIcons`
 * is exported and `scripts/generateIcons.test.ts` runs it against the committed files:
 * edit the SVG without re-running this and the test says so, which is the only thing
 * that keeps five raster files honest.
 *
 * The PNGs are committed rather than built, because `web/public` is copied by Vite at
 * the start of a build and a developer running `npm run dev` on a fresh clone would
 * otherwise have a manifest pointing at four 404s.
 */

const here = dirname(fileURLToPath(import.meta.url))
export const PUBLIC_DIR = join(here, '..', 'web', 'public')
export const SOURCE = join(PUBLIC_DIR, 'favicon.svg')
export const ICONS_DIR = join(PUBLIC_DIR, 'icons')

/** The dark from the mark itself, and from `theme-color` in index.html. */
const BACKGROUND = { r: 0x10, g: 0x17, b: 0x25, alpha: 1 }

export interface IconSpec {
  readonly file: string
  readonly size: number
  /**
   * Whether the platform will crop this icon to its own shape.
   *
   * Android does, aggressively — a circle on one launcher, a squircle on another — and
   * it only guarantees the middle 80%. A maskable icon therefore draws the mark inside
   * that safe zone on a full-bleed background, which is why it cannot simply be the
   * same file at a different size.
   */
  readonly maskable: boolean
}

export const ICONS: readonly IconSpec[] = [
  // The two Chromium requires. Without both, there is no install prompt at all.
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  // Android's adaptive icon, at the two densities launchers ask for.
  { file: 'icon-maskable-192.png', size: 192, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS reads this from a <link> and never looks at the manifest.
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
]

/** The fraction of a maskable icon a launcher promises not to crop. */
const SAFE_ZONE = 0.8

export const renderIcon = async (source: Buffer, spec: IconSpec): Promise<Buffer> => {
  if (!spec.maskable) {
    return sharp(source, { density: 384 }).resize(spec.size, spec.size).png().toBuffer()
  }

  const inner = Math.round(spec.size * SAFE_ZONE)
  const mark = await sharp(source, { density: 384 }).resize(inner, inner).png().toBuffer()

  // Composited onto a full-bleed ground rather than padded with transparency: a
  // transparent maskable icon is cropped to a shape with holes in it.
  return sharp({
    create: { width: spec.size, height: spec.size, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer()
}

export const generateIcons = async (): Promise<readonly string[]> => {
  const source = await readFile(SOURCE)
  await mkdir(ICONS_DIR, { recursive: true })

  const written: string[] = []
  for (const spec of ICONS) {
    await writeFile(join(ICONS_DIR, spec.file), await renderIcon(source, spec))
    written.push(spec.file)
  }
  return written
}

/**
 * Run directly (`npm run build:icons`) rather than imported by the test.
 *
 * Compared on the resolved path rather than with a `require.main` check, because this
 * file is ESM under tsx and there is no `require` to consult.
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
  void generateIcons().then((written) => {
    console.log(`Wrote ${written.length} icons to web/public/icons/`)
  })
}
