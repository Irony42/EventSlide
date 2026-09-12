import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSharpImageProcessor } from './sharpImageProcessor'
import { PAYLOADS, asFileBytes } from './testPayloads'
import type { ImageProcessor, RenderSpec } from '../../application/ports/imageProcessor'

const DISPLAY: RenderSpec = { maxWidth: 2560, maxHeight: 2560, quality: 82, format: 'jpeg' }
const THUMB: RenderSpec = { maxWidth: 480, maxHeight: 480, quality: 78, format: 'jpeg' }

/** A plain JPEG of the given size. */
const jpeg = async (width: number, height: number): Promise<Uint8Array> =>
  new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: { r: 200, g: 60, b: 120 } },
    })
      .jpeg()
      .toBuffer(),
  )

/**
 * A JPEG carrying what a real phone photo carries: an EXIF orientation tag, GPS
 * coordinates, and a device description.
 */
const jpegWithMetadata = async (
  width: number,
  height: number,
  orientation: number,
): Promise<Uint8Array> =>
  new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: { r: 30, g: 90, b: 200 } },
    })
      .withMetadata({
        orientation,
        exif: {
          IFD0: { Make: 'EventSlide Test', Model: 'Fixture 1', Artist: 'A Guest' },
          // libvips exposes the GPS IFD as IFD3, which is why the coordinates go here
          // rather than in a block called GPS. These are the tags that carry the
          // location of a private venue and must never survive ingest.
          IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
        },
      })
      .jpeg()
      .toBuffer(),
  )

/**
 * A PNG that is 65 bytes on the wire and declares `edge × edge` pixels.
 *
 * Hand-built, because that is the only way to build one: asking `sharp` to *create* a
 * 20 000 × 20 000 surface trips its own pixel guard and fails the fixture before the
 * code under test runs. The header is the whole attack anyway — a decoder that reads
 * `IHDR` and allocates `width × height` has already lost — so declaring the dimensions
 * is enough, and nothing here has to fill the canvas it promises.
 */
const pixelBombPng = (edge: number): Uint8Array => {
  const crcTable = Array.from({ length: 256 }, (_unused, index) => {
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
  ihdr[9] = 2 // truecolour; compression, filter and interlace all 0

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      // Structurally a PNG, nowhere near enough data for the canvas the header
      // promises. Refusal has to come from the header, so the body never needs to be
      // plausible.
      chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

describe('sharpImageProcessor', () => {
  let processor: ImageProcessor

  beforeAll(() => {
    processor = createSharpImageProcessor({ maxPixels: 50_000_000 })
  })

  describe('probe', () => {
    it('reports the format and dimensions of a real JPEG', async () => {
      const result = await processor.probe(await jpeg(800, 600))

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.format).toBe('jpeg')
      expect(result.value.dimensions.width).toBe(800)
      expect(result.value.dimensions.height).toBe(600)
      expect(result.value.frames).toBe(1)
    })

    it('rejects an executable script renamed to look like a photo', async () => {
      // 1.0 decided with `file.mimetype.startsWith('image/')`, a string the client
      // chooses, so this file passed the filter and was written to disk.
      const result = await processor.probe(asFileBytes(PAYLOADS.phpWebShell))

      expect(!result.ok && result.error.code).toBe('image.unsupportedFormat')
      expect(!result.ok && result.error.details['detected']).toBe('php')
    })

    it('rejects an SVG and names it, since an SVG rendered in a browser runs script', async () => {
      const result = await processor.probe(asFileBytes(PAYLOADS.svg))

      expect(!result.ok && result.error.code).toBe('image.unsupportedFormat')
      expect(!result.ok && result.error.details['detected']).toBe('svg')
    })

    it('rejects an empty upload', async () => {
      const result = await processor.probe(new Uint8Array(0))

      expect(!result.ok && result.error.code).toBe('image.unsupportedFormat')
    })

    it('rejects a file with a valid JPEG header and nothing decodable after it', async () => {
      const result = await processor.probe(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00]))

      expect(!result.ok && result.error.code).toBe('image.corrupt')
    })

    it('rejects an image over the pixel budget before decoding it', async () => {
      // The decompression-bomb control: judged from the header, so the megapixels are
      // never materialised. A 60000x60000 PNG is a few hundred kilobytes on the wire
      // and several gigabytes once decoded.
      const strict = createSharpImageProcessor({ maxPixels: 1_000 })

      const result = await strict.probe(await jpeg(100, 100))

      expect(!result.ok && result.error.code).toBe('image.tooManyPixels')
      expect(!result.ok && result.error.kind).toBe('quotaExceeded')
      expect(!result.ok && result.error.details['pixels']).toBe(10_000)
    })

    it('refuses a pixel bomb larger than sharp can even report on as too many pixels', async () => {
      // The attack this gate exists for, and the case it used to miss. sharp's own
      // `limitInputPixels` default is 268 402 689 px, and `metadata()` throws above it
      // rather than returning a header — so a 20 000 × 20 000 PNG was reported as
      // `image.corrupt` and the configured budget was never consulted. Still refused,
      // but for the wrong reason: the guest was told their photo was broken when it
      // was too large, and the documented control was dead code above 268 MP.
      const result = await processor.probe(pixelBombPng(20_000))

      expect(!result.ok && result.error.code).toBe('image.tooManyPixels')
      expect(!result.ok && result.error.kind).toBe('quotaExceeded')
      expect(!result.ok && result.error.details['pixels']).toBe(400_000_000)
      expect(!result.ok && result.error.details['max']).toBe(50_000_000)
    })

    it('still calls a broken header corrupt, so too-large and broken stay distinguishable', async () => {
      // The other half of the pair above. Disabling sharp's pixel limit must not
      // collapse the two refusals into one: a file that really will not parse has to
      // keep saying so, or "abîmée" and "trop grande" stop meaning different things to
      // the guest reading them.
      const truncated = new Uint8Array([
        ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        ...[...'not a chunk'].map((character) => character.charCodeAt(0)),
      ])

      const result = await processor.probe(truncated)

      expect(!result.ok && result.error.code).toBe('image.corrupt')
    })

    it('lets a budget above sharp’s own limit actually take effect', async () => {
      // The configured number is the gate, not a value sharp's default quietly
      // overrides. Before the fix, raising `MAX_IMAGE_PIXELS` past 268 MP changed
      // nothing at all — the header never came back to be measured.
      const generous = createSharpImageProcessor({ maxPixels: 500_000_000 })

      const result = await generous.probe(pixelBombPng(20_000))

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.dimensions.pixels).toBe(400_000_000)
    })

    it('accepts an image exactly at the pixel budget', async () => {
      const strict = createSharpImageProcessor({ maxPixels: 10_000 })

      const result = await strict.probe(await jpeg(100, 100))

      expect(result.ok).toBe(true)
    })

    it('refuses an image whose edge is longer than a stored photo may be', async () => {
      // A 65 000 px edge is inside JPEG's own limit and only a few kilobytes on the
      // wire, so nothing before this point rejects it. The dimensions a stored photo
      // may have are bounded by the domain, and the header is where that is decided —
      // the pixel budget alone would let this one through.
      const result = await processor.probe(await jpeg(65_000, 1))

      expect(!result.ok && result.error.code).toBe('dimensions.tooLarge')
    })

    it('reports the EXIF orientation a phone photo arrives with', async () => {
      const result = await processor.probe(await jpegWithMetadata(400, 200, 6))

      expect(result.ok && result.value.exifOrientation).toBe(6)
      expect(result.ok && result.value.hasMetadata).toBe(true)
    })

    it('reports no metadata for an image that carries none', async () => {
      const result = await processor.probe(await jpeg(64, 64))

      expect(result.ok && result.value.hasMetadata).toBe(false)
    })

    it('reports a frame count, so the animation limit has something to act on', async () => {
      const result = await processor.probe(await jpeg(32, 32))

      expect(result.ok && result.value.frames).toBe(1)
    })

    it('refuses an image whose frame count exceeds the configured limit', async () => {
      // Driven by lowering the limit rather than by building a real animation:
      // producing a genuinely multi-page GIF in-process needs an input that already
      // has pages, and the guard under test is the comparison, not sharp's decoder.
      // A 900-frame GIF is a resource problem, and the wall shows one still frame
      // regardless.
      const noFrames = createSharpImageProcessor({ maxPixels: 50_000_000, maxFrames: 0 })

      const result = await noFrames.probe(await jpeg(32, 32))

      expect(!result.ok && result.error.code).toBe('image.animated')
      expect(!result.ok && result.error.details['max']).toBe(0)
    })
  })

  describe('render', () => {
    it('applies EXIF orientation so a portrait photo is stored upright', async () => {
      // Orientation 6 means "rotate 90 degrees clockwise to display". The stored
      // pixels are 400x200; displayed correctly they are 200x400. Without `.rotate()`
      // the output stays 400x200 and every phone portrait is projected on its side —
      // exactly the 1.0 defect.
      const result = await processor.render(await jpegWithMetadata(400, 200, 6), DISPLAY)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.dimensions.width).toBe(200)
      expect(result.value.dimensions.height).toBe(400)
      expect(result.value.dimensions.orientation).toBe('portrait')
    })

    it('leaves an unrotated photo alone', async () => {
      const result = await processor.render(await jpegWithMetadata(400, 200, 1), DISPLAY)

      expect(result.ok && result.value.dimensions.width).toBe(400)
      expect(result.ok && result.value.dimensions.height).toBe(200)
    })

    it('strips EXIF, GPS and device metadata from the stored bytes', async () => {
      // The privacy control. A guest's photo carries the coordinates of the venue —
      // at a wedding, of someone's home — plus the device serial and owner name, and
      // 1.0 wrote all of it to disk and shipped it in the album ZIP.
      const input = await jpegWithMetadata(300, 300, 1)
      // The fixture has to really carry the EXIF block — including the GPS IFD, which
      // libvips exposes as IFD3 — or the assertions below pass vacuously.
      const before = await processor.probe(input)
      expect(before.ok && before.value.hasMetadata).toBe(true)

      const result = await processor.render(input, DISPLAY)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const stored = await sharp(result.value.bytes).metadata()
      expect(stored.exif).toBeUndefined()
      expect(stored.icc).toBeUndefined()
      expect(stored.xmp).toBeUndefined()
      expect(stored.orientation).toBeUndefined()
    })

    it('downscales a large photo to fit the box', async () => {
      const result = await processor.render(await jpeg(4000, 3000), DISPLAY)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.dimensions.width).toBe(2560)
      expect(result.value.dimensions.height).toBe(1920)
    })

    it('never enlarges a small photo', async () => {
      // Upscaling a 320px photo to 2560px makes it blurry and twenty times the bytes
      // to send over venue Wi-Fi.
      const result = await processor.render(await jpeg(320, 240), DISPLAY)

      expect(result.ok && result.value.dimensions.width).toBe(320)
      expect(result.ok && result.value.dimensions.height).toBe(240)
    })

    it('preserves the aspect ratio when fitting a thumbnail', async () => {
      const result = await processor.render(await jpeg(1600, 900), THUMB)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.dimensions.width).toBe(480)
      expect(result.value.dimensions.height).toBe(270)
    })

    it('produces a smaller thumb than display variant from the same input', async () => {
      const input = await jpeg(2000, 1500)

      const display = await processor.render(input, DISPLAY)
      const thumb = await processor.render(input, THUMB)

      expect(display.ok).toBe(true)
      expect(thumb.ok).toBe(true)
      if (!display.ok || !thumb.ok) return
      expect(thumb.value.byteSize).toBeLessThan(display.value.byteSize)
    })

    it('re-encodes to JPEG whatever the input format was', async () => {
      // Re-encoding rather than passing bytes through is what stops a polyglot file —
      // a valid JPEG with something else appended — from surviving ingest.
      const png = new Uint8Array(
        await sharp({ create: { width: 100, height: 100, channels: 3, background: '#123456' } })
          .png()
          .toBuffer(),
      )

      const result = await processor.render(png, DISPLAY)

      expect(result.ok && result.value.format).toBe('jpeg')
      if (!result.ok) return
      expect((await sharp(result.value.bytes).metadata()).format).toBe('jpeg')
    })

    it('can emit WebP when asked', async () => {
      const result = await processor.render(await jpeg(200, 200), { ...DISPLAY, format: 'webp' })

      expect(result.ok && result.value.format).toBe('webp')
      if (!result.ok) return
      expect((await sharp(result.value.bytes).metadata()).format).toBe('webp')
    })

    it('reports the byte size of what it produced', async () => {
      const result = await processor.render(await jpeg(500, 500), DISPLAY)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.byteSize).toBe(result.value.bytes.length)
      expect(result.value.byteSize).toBeGreaterThan(0)
    })

    it('refuses output whose dimensions the domain cannot describe', async () => {
      // `withoutEnlargement` means a box wider than the domain's maximum edge leaves a
      // very wide photo untouched, so the encoder can hand back something no `Photo`
      // can record. Reporting the domain error is what stops a row being written with
      // dimensions that were never validated.
      const wideBox: RenderSpec = { ...DISPLAY, maxWidth: 65_000, maxHeight: 65_000 }

      const result = await processor.render(await jpeg(65_000, 1), wideBox)

      expect(!result.ok && result.error.code).toBe('dimensions.tooLarge')
    })

    it('keeps a decode ceiling of its own, since this step really does decode', async () => {
      // `probe` hands its pixel decision to the application, which is safe only while
      // nothing is decoded before the verdict. This step decodes, so it keeps a hard
      // limit — the configured budget, which `probe` has already applied, making this a
      // backstop that can only fire if someone calls `render` without probing first.
      //
      // The code alone proves nothing here: this fixture's `IDAT` is deliberately
      // implausible, so the decoder would answer `image.renderFailed` on its own even
      // with no ceiling at all. The reason string is what separates "refused by the
      // budget" from "could not be decoded", so that is what this asserts.
      const result = await processor.render(pixelBombPng(20_000), DISPLAY)

      expect(!result.ok && result.error.code).toBe('image.renderFailed')
      expect(!result.ok && result.error.details['reason']).toBe('Input image exceeds pixel limit')
    })

    it('raises that ceiling with the configured budget, so it is never sharp’s default', async () => {
      // The half of the pair that catches a ceiling pinned to a constant. With a budget
      // above both 268 MP and the fixture's 400 MP, the pixel limit must no longer be
      // what stops this render — it has to get as far as the decoder and fail there on
      // the implausible `IDAT` instead.
      const generous = createSharpImageProcessor({ maxPixels: 500_000_000 })

      const result = await generous.render(pixelBombPng(20_000), DISPLAY)

      expect(!result.ok && result.error.code).toBe('image.renderFailed')
      expect(!result.ok && result.error.details['reason']).not.toBe(
        'Input image exceeds pixel limit',
      )
    })

    it('fails cleanly on bytes it cannot decode, before anything is persisted', async () => {
      const result = await processor.render(asFileBytes(PAYLOADS.notAnImage), DISPLAY)

      expect(!result.ok && result.error.code).toBe('image.renderFailed')
      expect(!result.ok && typeof result.error.details['reason']).toBe('string')
    })
  })
})
