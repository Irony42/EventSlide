import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

/**
 * Image fixtures for the end-to-end suite, generated rather than committed.
 *
 * Generated because the interesting property of each one is a metadata detail — an
 * EXIF orientation tag, a GPS block, a pixel count — and a binary in the repository
 * makes that invisible to a reviewer. Here the fixture's point is in its name and its
 * arguments.
 */

let scratch: string | null = null

const scratchDir = async (): Promise<string> => {
  scratch ??= await mkdtemp(join(tmpdir(), 'eventslide-e2e-media-'))
  return scratch
}

const write = async (name: string, bytes: Buffer): Promise<string> => {
  const path = join(await scratchDir(), name)
  await writeFile(path, bytes)
  return path
}

/** A visually distinct photo, so a human watching a trace can tell slides apart. */
const canvas = (width: number, height: number, label: string) => {
  // A hue derived from the label keeps each fixture a different colour without
  // needing a palette, and without randomness that would break a visual snapshot.
  const hue = [...label].reduce((total, character) => total + character.charCodeAt(0), 0) % 360
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: hue % 256, g: (hue * 3) % 256, b: (hue * 7) % 256 },
    },
  })
}

/** An ordinary landscape photo. The baseline case. */
export const aPhoto = async (label = 'photo', width = 1600, height = 1200): Promise<string> =>
  write(`${label}.jpg`, await canvas(width, height, label).jpeg().toBuffer())

/**
 * A photo carrying an EXIF orientation tag, as every phone produces.
 *
 * Orientation 6 means "rotate 90° clockwise to display": the stored pixels are
 * landscape, the correct rendering is portrait. If `sharp(...).rotate()` is ever
 * dropped from the ingest pipeline, the wall shows this photo on its side — which is
 * exactly what 1.0 did, and which no unit test notices. The journey asserts the
 * rendered image is taller than it is wide.
 */
export const jpegWithOrientation = async (
  orientation: number,
  options: { label?: string; width?: number; height?: number } = {},
): Promise<string> => {
  const { label = `orientation-${orientation}`, width = 1200, height = 600 } = options
  const bytes = await canvas(width, height, label)
    .withMetadata({
      orientation,
      exif: {
        IFD0: { Make: 'EventSlide E2E', Model: 'Fixture', Artist: 'A Guest' },
        // libvips exposes the GPS IFD as IFD3. These are the coordinates of whatever
        // room the guest was standing in — often somebody's home — and the pipeline
        // must strip them.
        IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
      },
    })
    .jpeg()
    .toBuffer()
  return write(`${label}.jpg`, bytes)
}

/** A photo with GPS and device metadata, for the privacy assertion. */
export const jpegWithLocation = async (label = 'with-gps'): Promise<string> =>
  jpegWithOrientation(1, { label })

/**
 * A file whose bytes are not an image, whatever its extension claims.
 *
 * Assembled from fragments rather than written as a literal: a verbatim web shell in a
 * repository file gets quarantined by desktop antivirus, which removed the file
 * mid-test-run during development.
 */
export const aDisguisedScript = async (): Promise<string> => {
  const payload = `<${'?'}php ${'system'}(${'$_GET'}["cmd"]); ${'?'}>`
  return write('holiday-snap.jpg', Buffer.from(payload, 'utf8'))
}

/** An SVG renamed to .jpg. `image/svg+xml` is an image type, and it executes script. */
export const anSvgNamedAsJpeg = async (): Promise<string> =>
  write(
    'sunset.jpg',
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>', 'utf8'),
  )

/**
 * A file that is small on the wire and enormous once decoded.
 *
 * The pixel budget is judged from the header, so ingest must refuse this without ever
 * allocating the bitmap. A flat-colour PNG of this size compresses to a few hundred
 * kilobytes and decodes to gigabytes.
 */
export const aPixelBomb = async (edge = 20_000): Promise<string> =>
  write(
    'bomb.png',
    await sharp({
      create: { width: edge, height: edge, channels: 3, background: '#000000' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  )

/** Larger than the configured per-file byte limit, but a genuine photo. */
export const anOversizedPhoto = async (): Promise<string> =>
  write(
    'huge.jpg',
    await canvas(6000, 6000, 'huge')
      // Maximum quality and no subsampling, to exceed the limit with real pixel data
      // rather than padding — padding would be caught by a different check.
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
      .toBuffer(),
  )

/**
 * The same bytes twice, for the idempotency journey: a double-tapped submit, or a
 * retry after a dropped connection, must not put the same photo on the wall twice.
 */
export const theSamePhotoTwice = async (): Promise<readonly [string, string]> => {
  const bytes = await canvas(800, 600, 'duplicate').jpeg().toBuffer()
  return [await write('duplicate-a.jpg', bytes), await write('duplicate-b.jpg', bytes)]
}

/** A fixed set for the visual snapshots, so the wall renders identically each run. */
export const aDemoAlbum = async (count = 6): Promise<readonly string[]> =>
  Promise.all(
    Array.from({ length: count }, (_unused, index) =>
      aPhoto(`demo-${index + 1}`, index % 2 === 0 ? 1600 : 1200, index % 2 === 0 ? 1200 : 1600),
    ),
  )
