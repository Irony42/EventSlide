import type { DomainError } from '../../domain/shared/errors'
import type { Dimensions } from '../../domain/photos/dimensions'
import type { Result } from '../../domain/shared/result'

/**
 * The image pipeline, behind a port so the use case can be tested without decoding a
 * real JPEG and without `sharp` in the test process.
 *
 * The contract has three obligations the adapter must honour, each closing a defect
 * that 1.0 shipped:
 *
 * 1. **Rotate before resize.** Phone photos carry their orientation in EXIF. 1.0
 *    resized without rotating, so portrait photos were projected on their side.
 * 2. **Strip all metadata after rotating.** A guest photo carries GPS coordinates —
 *    at a wedding, of someone's home — plus the device serial and the owner's name.
 *    None of it may reach the stored file or the ZIP a host hands out afterwards.
 * 3. **Re-encode, never pass through.** The stored bytes are always the pipeline's
 *    output, so a polyglot file that is a valid JPEG *and* something else cannot
 *    survive ingest.
 */

export const SUPPORTED_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'heif', 'gif'] as const

export type ImageFormat = (typeof SUPPORTED_INPUT_FORMATS)[number]

export type OutputFormat = 'jpeg' | 'webp'

/**
 * Header-level inspection. Deliberately separate from `render`, and called first: the
 * pixel count is checked against the budget **before** anything is decoded, which is
 * the only order that stops a decompression bomb.
 */
export interface ImageProbe {
  readonly format: ImageFormat
  readonly dimensions: Dimensions
  readonly hasAlpha: boolean
  /** EXIF orientation 1-8 when present. Informational: `render` always applies it. */
  readonly exifOrientation: number | null
  /** True when the input carries EXIF, XMP or ICC data that `render` will strip. */
  readonly hasMetadata: boolean
  /** Frame count. A 900-frame animated GIF is a resource problem, not a photo. */
  readonly frames: number
}

export interface RenderSpec {
  readonly maxWidth: number
  readonly maxHeight: number
  /** 1-100. */
  readonly quality: number
  readonly format: OutputFormat
}

export interface RenderedImage {
  readonly bytes: Uint8Array
  readonly dimensions: Dimensions
  readonly byteSize: number
  readonly format: OutputFormat
}

export interface ImageProcessor {
  /**
   * Read the header. Fails with `image.unsupportedFormat` when the bytes are not an
   * image the pipeline handles, or `image.corrupt` when the header cannot be parsed.
   * Never decodes the full image.
   */
  probe(bytes: Uint8Array): Promise<Result<ImageProbe, DomainError>>

  /**
   * Rotate to upright, strip every metadata block, downscale to fit within the spec
   * without enlarging, and re-encode.
   *
   * Fails with `image.renderFailed`. A failure must leave nothing behind — the caller
   * has not written anything to the media store or the database at this point, which
   * is the ordering that stops 1.0's orphaned rows.
   */
  render(bytes: Uint8Array, spec: RenderSpec): Promise<Result<RenderedImage, DomainError>>
}
