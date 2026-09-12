import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { ICONS, ICONS_DIR, SOURCE, renderIcon } from './generateIcons'

/**
 * The guard that keeps five raster files honest.
 *
 * The icons are committed rather than built, because Vite copies `web/public` at the
 * start of a build and a fresh clone running `npm run dev` would otherwise have a
 * manifest pointing at four 404s. The cost of committing them is that they can drift
 * from the mark they were rendered from, silently, and nobody notices until an installed
 * app on somebody's phone has last quarter's logo on it.
 *
 * So this re-renders from `favicon.svg` and compares. Edit the SVG without running
 * `npm run build:icons` and this test says exactly that.
 */

describe('app icons', () => {
  it.each(ICONS.map((spec) => [spec.file, spec] as const))(
    '%s is what the current favicon.svg renders to',
    async (file, spec) => {
      const source = await readFile(SOURCE)

      const [committed, expected] = await Promise.all([
        readFile(join(ICONS_DIR, file)),
        renderIcon(source, spec),
      ])

      // Compared on decoded pixels rather than on file bytes: a sharp or libvips upgrade
      // legitimately changes PNG encoding without changing a single pixel, and a test
      // that went red on a dependency bump is a test people delete.
      const [actualPixels, expectedPixels] = await Promise.all([
        sharp(committed).raw().toBuffer(),
        sharp(expected).raw().toBuffer(),
      ])

      expect(actualPixels.equals(expectedPixels)).toBe(true)
    },
  )

  it('has the two sizes Chromium refuses to offer an install without', async () => {
    // Neither Chrome nor Edge says why: the manifest simply never becomes installable
    // and `beforeinstallprompt` never fires, so the feature is silently absent.
    const manifest = JSON.parse(
      await readFile(join(ICONS_DIR, '..', 'manifest.webmanifest'), 'utf8'),
    ) as { icons: readonly { sizes: string; purpose?: string }[] }

    const anyPurpose = manifest.icons.filter((icon) => icon.purpose !== 'maskable')
    expect(anyPurpose.map((icon) => icon.sizes)).toContain('192x192')
    expect(anyPurpose.map((icon) => icon.sizes)).toContain('512x512')
  })

  it('offers a maskable icon, so Android does not crop the mark off', async () => {
    const manifest = JSON.parse(
      await readFile(join(ICONS_DIR, '..', 'manifest.webmanifest'), 'utf8'),
    ) as { icons: readonly { purpose?: string }[] }

    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })
})
