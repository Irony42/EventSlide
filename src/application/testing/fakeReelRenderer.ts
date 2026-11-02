import { DomainError } from '../../domain/shared/errors'
import { err, ok, type Result } from '../../domain/shared/result'
import type { ReelRenderer, ReelSpec, RenderedReel } from '../ports/reelRenderer'

export interface FakeReelRendererOptions {
  /** `false` is a box with no encoder. */
  readonly available?: boolean
  /** Every render fails with this code. */
  readonly failsWith?: string
  /** Runs after the frames arrive and before the answer: where a test removes a photograph mid-render. */
  readonly whileRendering?: () => Promise<void>
}

/**
 * A `ReelRenderer` that makes a stand-in file, so the use cases can be tested without an encoder
 * (spec 08). The bytes encode what was asked (the frames, in order), so a test can tell which
 * photographs went into a montage; the duration follows the spec exactly as the real encoder's
 * does. `reelRendererContract` holds it to the properties it shares with the ffmpeg adapter.
 */
export class FakeReelRenderer implements ReelRenderer {
  /** The frames of every render, in the order they were asked for. */
  readonly rendered: (readonly Uint8Array[])[] = []

  constructor(private readonly options: FakeReelRendererOptions = {}) {}

  available(): boolean {
    return this.options.available ?? true
  }

  async render(
    frames: readonly Uint8Array[],
    spec: ReelSpec,
  ): Promise<Result<RenderedReel, DomainError>> {
    if (this.options.failsWith !== undefined) {
      return err(DomainError.unexpected(this.options.failsWith))
    }
    if (frames.length === 0) return err(DomainError.invalid('reel.renderFailed'))

    this.rendered.push(frames)
    await this.options.whileRendering?.()

    // A header and one byte per input byte, in order: distinct for distinct selections.
    const header = new TextEncoder().encode('FAKE-REEL')
    const bytes = new Uint8Array(header.length + frames.reduce((sum, f) => sum + f.length, 0))
    bytes.set(header, 0)
    let offset = header.length
    for (const frame of frames) {
      bytes.set(frame, offset)
      offset += frame.length
    }
    if (bytes.length > spec.maxOutputBytes) return err(DomainError.unexpected('reel.renderFailed'))

    return ok({
      bytes,
      byteSize: bytes.length,
      durationMs: frames.length * spec.secondsPerPhoto * 1000,
    })
  }
}
