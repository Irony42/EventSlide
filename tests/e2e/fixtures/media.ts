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
  // Assembling the fragments kept the *source file* out of quarantine, but this fixture
  // then writes the reassembled bytes to a real path on disk, and that file is what got
  // quarantined instead — Playwright failed with `UNKNOWN: unknown error, open
  // 'holiday-snap.jpg'` because the scanner had removed it between write and upload.
  //
  // The control under test is magic-byte sniffing: ingest must refuse anything whose
  // leading bytes are not a known image format, whatever the extension and whatever
  // `Content-Type` the client claims. A shell script proves that exactly as well as a
  // web shell does, and no scanner objects to it.
  const payload = '#!/bin/sh\necho "not a photograph"\n'
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
 * allocating the bitmap.
 *
 * Hand-built rather than produced by `sharp`, for the reason the test exists: asking
 * `sharp` to *create* a 20000×20000 surface trips its own guard and fails the fixture
 * with `Input image exceeds pixel limit` before the server is ever involved. The header
 * is the whole payload anyway — a decoder that reads `IHDR` and allocates
 * `width * height` has already lost, so declaring the dimensions is precisely the
 * attack, and this keeps the fixture a few hundred bytes instead of a few hundred
 * kilobytes.
 */
export const aPixelBomb = async (edge = 20_000): Promise<string> => {
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let c = index
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })

  const crc32 = (bytes: Buffer): number => {
    let c = 0xffffffff
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, checksum])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(edge, 0)
  ihdr.writeUInt32BE(edge, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  // compression, filter, interlace all 0.

  return write(
    'bomb.png',
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      // A single empty data chunk: enough to be a structurally valid PNG, nowhere near
      // enough to fill the canvas the header promises. Refusal must come from the
      // header, so the body never needs to be plausible.
      chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

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
