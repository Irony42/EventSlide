import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  ICONS,
  ICONS_DIR,
  MASK_SAFE_RADIUS,
  SOURCE,
  generateIcons,
  renderIcon,
} from './generateIcons'
import type { IconSpec } from './generateIcons'

/**
 * The guard that keeps five raster files honest.
 *
 * The icons are committed rather than built, because Vite copies `web/public` at the
 * start of a build and a fresh clone running `npm run dev` would otherwise have a
 * manifest pointing at four 404s. The cost of committing them is that they can drift
 * from the mark they were rendered from, silently, and nobody notices until an installed
 * app on somebody's phone has last quarter's logo on it.
 */

const scratch: string[] = []

afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true })
})

const pixelsOf = (png: Buffer) => sharp(png).raw().toBuffer({ resolveWithObject: true })

describe('app icons', () => {
  it.each(ICONS.map((spec) => [spec.file, spec] as const))(
    '%s is what the current favicon.svg renders to',
    async (file, spec) => {
      const source = await readFile(SOURCE)

      const [committed, expected] = await Promise.all([
        readFile(join(ICONS_DIR, file)),
        renderIcon(source, spec),
      ])

      // Compared on decoded pixels rather than on file bytes: a sharp upgrade can change
      // PNG encoding without changing a single pixel, and a test that went red on a
      // dependency bump is a test people delete. A librsvg upgrade that changes
      // antialiasing will still fail this, and should — the icons would genuinely differ.
      const [actual, wanted] = await Promise.all([pixelsOf(committed), pixelsOf(expected)])
      expect(actual.data.equals(wanted.data)).toBe(true)
    },
  )

  /**
   * The geometry the comments in `generateIcons.ts` claim, measured rather than trusted.
   *
   * An Android launcher guarantees a **circle** of 80% diameter, not an 80% square, and
   * the mark's own internal padding counts towards fitting inside it. So a redraw that
   * spends that padding can push ink outside the safe circle without anyone touching the
   * inset constant — and the drift test above would still pass, because it re-renders
   * from the same SVG and gets the same answer.
   */
  it.each(ICONS.filter((spec) => spec.fit === 'masked').map((spec) => [spec.file, spec] as const))(
    '%s keeps every mark pixel inside the circle a launcher will not crop',
    async (file, spec) => {
      const { data, info } = await pixelsOf(await readFile(join(ICONS_DIR, file)))

      // The ground is the flat dark the icon is composited onto; anything else is mark.
      const ground = { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 }
      const centre = info.width / 2
      let furthest = 0

      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          const at = (y * info.width + x) * info.channels
          const isGround =
            data[at] === ground.r && data[at + 1] === ground.g && data[at + 2] === ground.b
          if (isGround) continue
          furthest = Math.max(furthest, Math.hypot(x + 0.5 - centre, y + 0.5 - centre))
        }
      }

      expect(furthest / info.width).toBeLessThanOrEqual(MASK_SAFE_RADIUS)
      // And not absurdly small either: an icon inset to nothing passes the line above
      // while looking like a stamp on a dark square.
      expect(furthest / info.width).toBeGreaterThan(MASK_SAFE_RADIUS * 0.6)
      expect(spec.size).toBe(info.width)
    },
  )

  it('fills the canvas for iOS, which crops corners rather than masking to a circle', async () => {
    // Android's inset here would leave the mark visibly smaller than every neighbouring
    // app on the home screen.
    const apple = ICONS.find((spec) => spec.fit === 'padded') as IconSpec
    const { data, info } = await pixelsOf(await readFile(join(ICONS_DIR, apple.file)))

    const ground = { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 }
    let widest = 0
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const at = (y * info.width + x) * info.channels
        if (data[at] === ground.r && data[at + 1] === ground.g && data[at + 2] === ground.b)
          continue
        widest = Math.max(widest, Math.abs(x + 0.5 - info.width / 2) * 2)
      }
    }

    expect(widest / info.width).toBeGreaterThan(0.75)
  })

  it('writes every icon it promises, under the names the manifest asks for', async () => {
    // The drift test drives `renderIcon`; without this the write path could put the
    // files in the wrong place or under the wrong names and every test would still pass,
    // while the drift test happily compared stale committed files against a fresh render.
    const into = await mkdtemp(join(tmpdir(), 'eventslide-icons-'))
    scratch.push(into)

    const written = await generateIcons(into)

    expect([...written].sort()).toEqual(ICONS.map((spec) => spec.file).sort())
    expect((await readdir(into)).sort()).toEqual(ICONS.map((spec) => spec.file).sort())
  })

  it('has the two sizes Chromium refuses to offer an install without', async () => {
    // Neither Chrome nor Edge says why: the manifest simply never becomes installable
    // and `beforeinstallprompt` never fires, so the feature is silently absent.
    const manifest = JSON.parse(
      await readFile(join(ICONS_DIR, '..', 'manifest.webmanifest'), 'utf8'),
    ) as { icons: readonly { sizes: string; purpose?: string }[] }

    // A maskable entry does not satisfy Chromium: it wants an icon with `any`.
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
