import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * Pixel dimensions of a stored image.
 *
 * Bounded on both ends. The upper bound is a security control, not tidiness: a 60 000
 × 60 000 PNG is a few hundred kilobytes on the wire and several gigabytes once
 * decoded, which is how a single upload takes a self-hosted box down. The pixel count
 * is checked against the configured limit *before* the image is decoded, using the
 * dimensions read from the header.
 *
 * The scaling arithmetic lives here rather than next to `sharp`, so the thumbnail
 * sizes and the wall's letterboxing are testable without touching an image.
 */

const MIN_EDGE = 1
const MAX_EDGE = 60_000

export type Orientation = 'portrait' | 'landscape' | 'square'

export class Dimensions {
  private constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  static create(width: number, height: number): Result<Dimensions, DomainError> {
    for (const [name, value] of [
      ['width', width],
      ['height', height],
    ] as const) {
      if (!Number.isInteger(value)) {
        return err(DomainError.invalid('dimensions.notInteger', { field: name }))
      }
      if (value < MIN_EDGE) {
        return err(DomainError.invalid('dimensions.tooSmall', { field: name, min: MIN_EDGE }))
      }
      if (value > MAX_EDGE) {
        return err(DomainError.invalid('dimensions.tooLarge', { field: name, max: MAX_EDGE }))
      }
    }
    return ok(new Dimensions(width, height))
  }

  get pixels(): number {
    return this.width * this.height
  }

  get aspectRatio(): number {
    return this.width / this.height
  }

  get orientation(): Orientation {
    if (this.width > this.height) return 'landscape'
    if (this.width < this.height) return 'portrait'
    return 'square'
  }

  /** True when decoding this image would exceed the configured pixel budget. */
  exceedsPixelBudget(maxPixels: number): boolean {
    return this.pixels > maxPixels
  }

  /**
   * Largest size that fits inside `box` while keeping the aspect ratio.
   *
   * Never enlarges: a 400 × 300 photo asked to fit a 1920 × 1080 wall stays 400 × 300,
   * because upscaling a guest's phone photo only makes it blurry and bigger to send.
   * Rounds to whole pixels and never returns a zero edge.
   */
  scaleToFit(box: Dimensions): Dimensions {
    const factor = Math.min(box.width / this.width, box.height / this.height, 1)
    return new Dimensions(
      Math.max(MIN_EDGE, Math.round(this.width * factor)),
      Math.max(MIN_EDGE, Math.round(this.height * factor)),
    )
  }

  equals(other: Dimensions): boolean {
    return this.width === other.width && this.height === other.height
  }

  toString(): string {
    return `${this.width}x${this.height}`
  }

  static readonly minEdge = MIN_EDGE
  static readonly maxEdge = MAX_EDGE
}
