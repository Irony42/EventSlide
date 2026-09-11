import sharp from 'sharp'
import type {
  ImageFormat,
  ImageProbe,
  ImageProcessor,
  RenderSpec,
  RenderedImage,
} from '../../application/ports/imageProcessor'
import { Dimensions } from '../../domain/photos/dimensions'
import { DomainError } from '../../domain/shared/errors'
import { err, ok, type Result } from '../../domain/shared/result'
import { detectImageFormat, identifySuspicious } from './magicBytes'

/**
 * The ingest pipeline: **detect, probe, then rotate → strip → resize → re-encode**.
 *
 * Every step exists because 1.0 lacked it:
 *
 * - It trusted `file.mimetype`, a client-chosen string, so a renamed `.php` passed the
 *   filter. Here `detectImageFormat` reads the actual bytes.
 * - It resized without `.rotate()`, so every portrait photo from a phone was projected
 *   on its side. Orientation lives in EXIF, and resizing discards EXIF.
 * - It kept metadata, so the GPS coordinates of a private venue — and the device serial
 *   and the owner's name — were written to disk and handed out in the ZIP export.
 * - It had no pixel budget, so a 60 000 × 60 000 PNG of a few hundred kilobytes would
 *   have been decoded into gigabytes of memory.
 *
 * Order matters twice over. `.rotate()` before `.resize()`, or a portrait photo is
 * resized against the wrong axis; and the metadata check before any decode, or the
 * bomb has already exploded.
 *
 * ## Why `limitInputPixels` is switched off on the probe
 *
 * `sharp`'s own `limitInputPixels` defaults to `0x3FFF ** 2` = 268 402 689 px, and
 * `metadata()` honours it: for anything larger it throws *before returning a header*.
 * Left at the default, this adapter reported the 20 000 × 20 000 PNG this gate exists
 * for as `400 image.corrupt` — the configured budget was never consulted, so the
 * documented control was dead code for exactly its own threat model, and the guest was
 * told their photo was broken when it was too large. Raising `MAX_IMAGE_PIXELS` above
 * 268 MP had no effect at all.
 *
 * So the probe reads the header with **no** `sharp` limit and the application's budget
 * decides. **Do not "fix" this back.** Switching a real defence off is only safe
 * because what replaces it is strictly stricter, and it is, on every path:
 *
 * - `metadata()` reads the header and nothing else. No bitmap is allocated for a
 *   400 MP declaration — the whole payload is a 65-byte `IHDR`.
 * - Nothing is decoded between the header and the verdict. `Dimensions.create` bounds
 *   each side to 60 000 px and `exceedsPixelBudget` applies `maxPixels`, both from the
 *   declared numbers, before any `toBuffer` or `resize` exists.
 * - The transcode is a second `sharp` instance and it really does decode, so it keeps a
 *   limit — `maxPixels`, the same budget, rather than `sharp`'s unrelated default.
 *   Tying it to the configured value is what stops the defect reappearing one step
 *   later as `image.renderFailed` for an operator who raises the budget past 268 MP.
 *
 * A genuinely corrupt header still throws (`pngload_buffer: end of stream`), so
 * `image.corrupt` and `image.tooManyPixels` stay distinguishable — the guest is told
 * which of the two happened, and the operator's log says the same.
 */

export interface SharpImageProcessorOptions {
  /**
   * Rejected before decoding, from the header — and the ceiling the transcode's own
   * decoder is given, so one configured number governs both.
   */
  readonly maxPixels: number
  /**
   * An animation is not a photo. A 900-frame GIF is a resource problem, and the wall
   * shows a still frame regardless, so anything beyond a single frame is refused
   * rather than silently flattened.
   */
  readonly maxFrames?: number
}

const DEFAULT_MAX_FRAMES = 1

/** sharp's format names, narrowed to what the port accepts. */
const FORMAT_BY_SHARP: Readonly<Record<string, ImageFormat>> = {
  jpeg: 'jpeg',
  jpg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  heif: 'heif',
  gif: 'gif',
}

export const createSharpImageProcessor = ({
  maxPixels,
  maxFrames = DEFAULT_MAX_FRAMES,
}: SharpImageProcessorOptions): ImageProcessor => {
  // sharp caches decoded input and holds worker threads. On a single-venue box the
  // cache competes with the page cache for the SQLite database, and concurrency above
  // the core count only adds latency to a guest's upload.
  sharp.cache({ files: 0, memory: 64 })
  sharp.concurrency(2)

  return {
    probe: async (bytes: Uint8Array): Promise<Result<ImageProbe, DomainError>> => {
      // Gate one: the bytes must actually be an image we accept. This runs before
      // sharp sees them, so an unsupported or hostile file never reaches a decoder.
      const detected = detectImageFormat(bytes)
      if (!detected) {
        const suspicious = identifySuspicious(bytes)
        return err(
          DomainError.invalid(
            'image.unsupportedFormat',
            suspicious ? { detected: suspicious } : {},
          ),
        )
      }

      let metadata: sharp.Metadata
      try {
        // Header only — sharp reads the metadata without decoding pixel data.
        //
        // `limitInputPixels: false` hands the pixel decision to gate two below instead
        // of letting sharp's own 268 MP default throw here, where it would surface as
        // `image.corrupt` and bypass the configured budget entirely. See the note at
        // the top of this file before changing it: nothing is allocated for a header,
        // and the budget is applied before anything is decoded.
        metadata = await sharp(bytes, {
          failOn: 'error',
          animated: false,
          limitInputPixels: false,
        }).metadata()
      } catch {
        return err(DomainError.invalid('image.corrupt'))
      }

      const { width, height } = metadata
      if (width === undefined || height === undefined) {
        return err(DomainError.invalid('image.corrupt'))
      }

      const dimensions = Dimensions.create(width, height)
      if (!dimensions.ok) return dimensions

      // Gate two: the pixel budget, from the header, before any decode. This is the
      // decompression-bomb control.
      if (dimensions.value.exceedsPixelBudget(maxPixels)) {
        return err(
          DomainError.quotaExceeded('image.tooManyPixels', {
            pixels: dimensions.value.pixels,
            max: maxPixels,
          }),
        )
      }

      const frames = metadata.pages ?? 1
      if (frames > maxFrames) {
        return err(DomainError.invalid('image.animated', { frames, max: maxFrames }))
      }

      return ok({
        // sharp's reported format is authoritative for what it will decode; the
        // magic-byte result is what decided whether we accept the file at all.
        format: FORMAT_BY_SHARP[metadata.format ?? ''] ?? detected,
        dimensions: dimensions.value,
        hasAlpha: metadata.hasAlpha === true,
        exifOrientation: metadata.orientation ?? null,
        hasMetadata:
          metadata.exif !== undefined ||
          metadata.icc !== undefined ||
          metadata.xmp !== undefined ||
          metadata.iptc !== undefined,
        frames,
      })
    },

    render: async (
      bytes: Uint8Array,
      spec: RenderSpec,
    ): Promise<Result<RenderedImage, DomainError>> => {
      try {
        // Unlike `probe`, this instance genuinely decodes, so it keeps a hard ceiling.
        // It is the configured budget rather than sharp's default: `probe` has already
        // refused anything above `maxPixels` from the header, so this can only ever
        // fire as a backstop, and pinning it to the same number means raising the
        // budget cannot turn a too-large image into `image.renderFailed`.
        const pipeline = sharp(bytes, {
          failOn: 'error',
          animated: false,
          limitInputPixels: maxPixels,
        })
          // 1. Apply EXIF orientation, so the stored pixels are upright. With no
          //    argument this uses the EXIF tag; it is a no-op when there is none.
          .rotate()
          // 2. Fit inside the box without enlarging. `withoutEnlargement` matters: a
          //    400px photo upscaled to 2560px is blurry and twenty times the bytes.
          .resize({
            width: spec.maxWidth,
            height: spec.maxHeight,
            fit: 'inside',
            withoutEnlargement: true,
          })

        // 3. Re-encode. sharp drops all input metadata unless `withMetadata()` is
        //    called, which it deliberately is not: this is the line that keeps GPS
        //    coordinates out of the stored file. Do not add `withMetadata()` here.
        const encoded =
          spec.format === 'webp'
            ? pipeline.webp({ quality: spec.quality, effort: 4 })
            : pipeline.jpeg({
                quality: spec.quality,
                // Renders progressively over venue Wi-Fi instead of top to bottom.
                progressive: true,
                // Chroma subsampling on by default; keeping 4:4:4 off saves ~15% with
                // no visible difference on a projected photograph.
                mozjpeg: true,
              })

        const { data, info } = await encoded.toBuffer({ resolveWithObject: true })

        const dimensions = Dimensions.create(info.width, info.height)
        if (!dimensions.ok) return dimensions

        return ok({
          bytes: new Uint8Array(data),
          dimensions: dimensions.value,
          byteSize: data.byteLength,
          format: spec.format,
        })
      } catch (cause) {
        // Nothing has been written to the media store or the database at this point.
        // That ordering — render, then verify, then persist — is what stops 1.0's
        // orphaned rows pointing at files that were never created.
        return err(
          DomainError.invalid('image.renderFailed', {
            reason: cause instanceof Error ? cause.message.slice(0, 200) : 'unknown',
          }),
        )
      }
    },
  }
}
