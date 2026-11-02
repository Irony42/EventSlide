import { afterAll, describe, expect, it } from 'vitest'
import type { ReelRenderer, ReelSpec } from '../../ports/reelRenderer'

/**
 * The shared `ReelRenderer` contract (spec 08): run against the real encoder (ring 3) and against
 * `FakeReelRenderer`, the double every ring-2 test uses. What is shared is what a caller relies on;
 * what the file looks like (size, audio, metadata, orientation) is the adapter's own test, since a
 * double cannot say anything true about pixels.
 */

export const REEL_CONTRACT_SPEC: ReelSpec = { secondsPerPhoto: 2, maxOutputBytes: 50_000_000 }

export interface ReelRendererSubject {
  readonly renderer: ReelRenderer
  /** Three ordinary photographs, as `display` renditions the encoder can read. */
  readonly frames: readonly Uint8Array[]
  readonly dispose?: () => Promise<void>
}

export const reelRendererContract = (
  name: string,
  makeSubject: () => Promise<ReelRendererSubject>,
): void => {
  describe(`ReelRenderer contract: ${name}`, () => {
    let subject: ReelRendererSubject | null = null
    const get = async (): Promise<ReelRendererSubject> => {
      subject ??= await makeSubject()
      return subject
    }

    afterAll(async () => {
      await subject?.dispose?.()
    })

    it('is available when it can encode', async () => {
      expect((await get()).renderer.available()).toBe(true)
    })

    it('makes one file as long as the spec says: each photograph, that many seconds', async () => {
      const { renderer, frames } = await get()

      const made = await renderer.render(frames, REEL_CONTRACT_SPEC)

      expect(made.ok).toBe(true)
      if (!made.ok) return
      expect(made.value.byteSize).toBe(made.value.bytes.length)
      expect(made.value.byteSize).toBeGreaterThan(0)
      expect(made.value.durationMs).toBe(frames.length * 2 * 1000)
    })

    it('refuses to make a montage of nothing', async () => {
      const { renderer } = await get()

      const made = await renderer.render([], REEL_CONTRACT_SPEC)

      expect(!made.ok && made.error.code).toBe('reel.renderFailed')
    })

    it('stops at the size ceiling rather than overshoot it', async () => {
      const { renderer, frames } = await get()

      const made = await renderer.render(frames, { ...REEL_CONTRACT_SPEC, maxOutputBytes: 1 })

      expect(made.ok).toBe(false)
    })
  })
}
