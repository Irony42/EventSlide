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

/**
 * How much of the canvas the mark occupies, and why each platform differs.
 *
 * - `bleed` — the mark fills the canvas. The browser tab, and the manifest's
 *   `purpose: "any"` entries, where nothing crops.
 * - `masked` — Android's adaptive icon. The launcher crops to its own shape and the
 *   specification guarantees only a **circle** of 80% diameter, not an 80% square.
 * - `padded` — iOS. It applies a superellipse to the full canvas and clips a few percent
 *   at the corners, so an Android-sized inset would leave a small mark floating in a
 *   dark square beside every other app on the home screen.
 */
export type IconFit = 'bleed' | 'masked' | 'padded'

export interface IconSpec {
  readonly file: string
  readonly size: number
  readonly fit: IconFit
}

export const ICONS: readonly IconSpec[] = [
  // The two Chromium requires. Without both there is no install offer at all, and it
  // never says so: the manifest simply fails to become installable.
  { file: 'icon-192.png', size: 192, fit: 'bleed' },
  { file: 'icon-512.png', size: 512, fit: 'bleed' },
  // Android's adaptive icon, at the two densities launchers ask for.
  { file: 'icon-maskable-192.png', size: 192, fit: 'masked' },
  { file: 'icon-maskable-512.png', size: 512, fit: 'masked' },
  // iOS reads this from a <link> and never looks at the manifest.
  { file: 'apple-touch-icon.png', size: 180, fit: 'padded' },
]

/** The radius, as a fraction of the width, that a maskable launcher will not crop. */
export const MASK_SAFE_RADIUS = 0.4

/**
 * The side of the square the mark is drawn into, as a fraction of the canvas.
 *
 * The maskable number is the one with a specification behind it, and it is not 0.8. A
 * launcher guarantees a circle of 80% diameter; the corners of an 80% *square* reach a
 * radius of 0.566 and are outside it. Inscribing the square in the circle is 0.8 over
 * root two, and any ink inside that is safe under every mask shape.
 *
 * The test measures the rendered ink against the circle rather than trusting this
 * constant, because the mark's own internal padding counts too and a redraw can spend
 * it without touching this file.
 */
const FIT_SCALE: Record<IconFit, number> = {
  bleed: 1,
  masked: (MASK_SAFE_RADIUS * 2) / Math.SQRT2,
  padded: 0.92,
}

export const renderIcon = async (source: Buffer, spec: IconSpec): Promise<Buffer> => {
  if (spec.fit === 'bleed') {
    return sharp(source, { density: 384 }).resize(spec.size, spec.size).png().toBuffer()
  }

  const inner = Math.round(spec.size * FIT_SCALE[spec.fit])
  const mark = await sharp(source, { density: 384 }).resize(inner, inner).png().toBuffer()

  // Composited onto an opaque ground rather than padded with transparency: both
  // platforms composite a transparent icon onto something, and neither asks first.
  return sharp({
    create: { width: spec.size, height: spec.size, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer()
}

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
