import { Dimensions } from '../../domain/photos/dimensions'
import { DomainError } from '../../domain/shared/errors'
import { ok, type Result } from '../../domain/shared/result'
import type { ImageProbe, ImageProcessor, RenderSpec, RenderedImage } from '../ports/imageProcessor'
import { MEDIA_VARIANTS, type PhotoVariant } from '../ports/mediaStore'
import { VARIANT_SPECS } from '../usecases/photos/uploadPhotos'

/** A file's bytes are its tag, so every double can answer deterministically for it. */
export const tagBytes = (tag: string): Uint8Array =>
  Uint8Array.from([...tag].map((character) => character.charCodeAt(0)))

export const readTag = (bytes: Uint8Array): string => String.fromCharCode(...bytes)

/** Sums to exactly 1 MB per photo, so a quota expectation is arithmetic a reader can do. */
export const DEFAULT_RENDERED_BYTE_SIZES: Readonly<Record<PhotoVariant, number>> = {
  original: 900_000,
  display: 90_000,
  thumb: 10_000,
}

/** What the double answers for one file: its size, a header it cannot read, a render that fails. */
export interface ImageScript {
  readonly width?: number
  readonly height?: number
  readonly probeError?: DomainError
  readonly renderErrorAt?: PhotoVariant
  readonly byteSizes?: Readonly<Record<PhotoVariant, number>>
}

/** Matched on the longest edge, so the double does not depend on object identity. */
const variantFor = (spec: RenderSpec): PhotoVariant => {
  const match = MEDIA_VARIANTS.find((variant) => VARIANT_SPECS[variant].maxWidth === spec.maxWidth)
  if (match === undefined) throw new Error(`no variant renders at ${spec.maxWidth}px`)
  return match
}

const dimensionsFrom = (width: number, height: number): Dimensions => {
  const created = Dimensions.create(width, height)
  if (!created.ok) throw new Error(`fixture rejected by the domain: ${created.error.code}`)
  return created.value
}

/**
 * A deterministic `ImageProcessor`.
 *
 * Not `sharp`: what it models is the port's promises, not pixels. The bytes of a file are
 * its tag (see {@link tagBytes}), `script` says what that tag turns out to be, and a render
 * answers `<tag>/<variant>` bytes of a scripted size, so a test can pre-compute the content
 * hash of what ingest will store.
 *
 * `calls` is the point of it: the port's contract is an *order* — read the header, then
 * decode — and the only way to prove ingest honours it is to show that a refused file
 * produced no render call at all. It lived inside `uploadPhotos.test.ts`, which is where
 * the usecase skill said it already was not.
 */
export class FakeImageProcessor implements ImageProcessor {
  readonly calls: string[] = []

  private readonly scripts = new Map<string, ImageScript>()

  script(tag: string, script: ImageScript): this {
    this.scripts.set(tag, script)
    return this
  }

  /** The exact bytes `render` will produce, so a test can pre-compute a content hash. */
  renderedBytes(tag: string, variant: PhotoVariant): Uint8Array {
    return tagBytes(`${tag}/${variant}`)
  }

  async probe(bytes: Uint8Array): Promise<Result<ImageProbe, DomainError>> {
    const tag = readTag(bytes)
    this.calls.push(`probe:${tag}`)

    const script = this.scripts.get(tag) ?? {}
    if (script.probeError !== undefined) return { ok: false, error: script.probeError }

    return ok({
      format: 'jpeg',
      dimensions: this.dimensionsOf(script),
      hasAlpha: false,
      exifOrientation: 6,
      hasMetadata: true,
      frames: 1,
    })
  }

  async render(bytes: Uint8Array, spec: RenderSpec): Promise<Result<RenderedImage, DomainError>> {
    const tag = readTag(bytes)
    const variant = variantFor(spec)
    this.calls.push(`render:${tag}:${variant}`)

    const script = this.scripts.get(tag) ?? {}
    if (script.renderErrorAt === variant) {
      return { ok: false, error: DomainError.invalid('image.renderFailed') }
    }

    const box = dimensionsFrom(spec.maxWidth, spec.maxHeight)
    return ok({
      bytes: this.renderedBytes(tag, variant),
      dimensions: this.dimensionsOf(script).scaleToFit(box),
      byteSize: (script.byteSizes ?? DEFAULT_RENDERED_BYTE_SIZES)[variant],
      format: spec.format,
    })
  }

  private dimensionsOf(script: ImageScript): Dimensions {
    return dimensionsFrom(script.width ?? 4032, script.height ?? 3024)
  }
}
