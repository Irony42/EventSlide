import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SUPPORTED_CLIP_CONTAINERS } from '../../ports/videoTranscoder'
import type { TranscodeSpec, VideoTranscoder } from '../../ports/videoTranscoder'

/**
 * The shared `VideoTranscoder` contract.
 *
 * Run against real ffmpeg (ring 3) and against `FakeVideoTranscoder` (the double every
 * ring-2 test uses). A double that drifts from the encoder makes every use-case test
 * about clips a statement about nothing, and the drift here would be invisible until a
 * clip reached a projector.
 *
 * The clips themselves cannot be shared — one implementation needs a real H.264 file and
 * the other a descriptor — so the suite takes them as a parameter. What *is* shared is
 * every property, and three of them are the expensive traps written out as assertions:
 *
 * - a **portrait** clip must probe as portrait. `ffprobe`'s `streams[].width`/`height`
 *   are pre-rotation and the rotation lives in a display matrix in `side_data_list`, so
 *   an implementation reading the raw stream fields judges a phone's portrait clip as
 *   landscape and scales it against the wrong axis.
 * - the output's edges must be **even**. `yuv420p` cannot represent an odd edge, and
 *   `scale=-1:720` is exactly how one arrives.
 * - the output's duration must obey the **spec**, not the source header. A truncated
 *   container declares whatever it declared before the phone died.
 *
 * The round-trip case — probing the transcoder's own output — is what proves the result
 * is a file this pipeline can open at all, which is the cheapest available stand-in for
 * "a browser will decode it".
 */

export interface ClipFixtures {
  /** Ordinary landscape, with sound, comfortably inside the cap. */
  readonly landscape: Uint8Array
  /** Recorded in portrait: it must **display** taller than it is wide. */
  readonly portrait: Uint8Array
  /** No audio track at all — a phone with the microphone muted. */
  readonly silent: Uint8Array
  /** Longer than {@link CONTRACT_SPEC}'s cap, so the bound can be observed. */
  readonly long: Uint8Array
  /** Not a video: a guest's screenshot, or a renamed document. */
  readonly notAVideo: Uint8Array
  /** A container whose header will not parse. */
  readonly corrupt: Uint8Array
}

/** Small on purpose: ring 3 runs this against a real encoder on a developer's laptop. */
export const CONTRACT_SPEC: TranscodeSpec = {
  maxHeight: 240,
  maxDurationMs: 2_000,
  maxOutputBytes: 20_000_000,
  posterMaxEdge: 120,
}

export interface TranscoderSubject {
  readonly transcoder: VideoTranscoder
  readonly fixtures: ClipFixtures
  readonly dispose?: () => Promise<void>
}

export const videoTranscoderContract = (
  name: string,
  makeSubject: () => Promise<TranscoderSubject>,
): void => {
  describe(`VideoTranscoder contract: ${name}`, () => {
    let subject: TranscoderSubject

    // Built once: producing the real fixtures means running ffmpeg six times, and every
    // case below reads them without mutating anything.
    beforeAll(async () => {
      subject = await makeSubject()
    })

    afterAll(async () => {
      await subject.dispose?.()
    })

    describe('identify', () => {
      it('recognises a clip from its signature alone', () => {
        // The cheap gate, and the only call on this port that runs on a guest's request.
        expect(subject.transcoder.identify(subject.fixtures.landscape)).toBe('mp4')
      })

      it('recognises a container even when its header is unusable', () => {
        // Signature and header are two different questions. A truncated recording is
        // still an mp4, and telling a guest "not a video" would be wrong.
        expect(subject.transcoder.identify(subject.fixtures.corrupt)).toBe('mp4')
      })

      it('refuses bytes that are not a video at all', () => {
        expect(subject.transcoder.identify(subject.fixtures.notAVideo)).toBeNull()
      })
    })

    describe('probe', () => {
      it('reads the header of a clip it can open', async () => {
        const probed = await subject.transcoder.probe(subject.fixtures.landscape)

        expect(probed.ok).toBe(true)
        if (!probed.ok) return
        // Inside the allow-list, never merely "some string": the container decides which
        // demuxer the input is pinned to, and a value outside this tuple would be one no
        // pinning covers — which is how content sniffing gets a second chance.
        expect([...SUPPORTED_CLIP_CONTAINERS]).toContain(probed.value.container)
        expect(probed.value.container).toBe('mp4')
        expect(probed.value.durationMs).toBeGreaterThan(0)
        expect(probed.value.dimensions.orientation).toBe('landscape')
      })

      it('reports a portrait clip as portrait', async () => {
        // The rotation trap. A phone records landscape frames and writes a display
        // matrix; the raw stream fields say the opposite of what the guest filmed.
        const probed = await subject.transcoder.probe(subject.fixtures.portrait)

        expect(probed.ok).toBe(true)
        if (!probed.ok) return
        expect(probed.value.dimensions.orientation).toBe('portrait')
      })

      it('says whether there is anything to hear', async () => {
        const withSound = await subject.transcoder.probe(subject.fixtures.landscape)
        const silent = await subject.transcoder.probe(subject.fixtures.silent)

        expect(withSound.ok && withSound.value.hasAudio).toBe(true)
        expect(silent.ok && silent.value.hasAudio).toBe(false)
      })

      it('refuses bytes that are not a video at all', async () => {
        const probed = await subject.transcoder.probe(subject.fixtures.notAVideo)

        expect(!probed.ok && probed.error.code).toBe('clip.unsupportedFormat')
      })

      it('refuses a container whose header will not parse', async () => {
        const probed = await subject.transcoder.probe(subject.fixtures.corrupt)

        expect(!probed.ok && probed.error.code).toBe('clip.corrupt')
      })
    })

    describe('transcode', () => {
      it('produces something this pipeline can open again', async () => {
        // The cheapest stand-in available for "a browser will decode it": the output
        // goes back through the same demuxer that accepted the input.
        const result = await subject.transcoder.transcode(subject.fixtures.landscape, CONTRACT_SPEC)

        expect(result.ok).toBe(true)
        if (!result.ok) return

        const reprobed = await subject.transcoder.probe(result.value.video.bytes)
        expect(reprobed.ok).toBe(true)
        expect(reprobed.ok && reprobed.value.container).toBe('mp4')
      })

      it('reports the size of the bytes it actually returned', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.landscape, CONTRACT_SPEC)

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value.video.byteSize).toBe(result.value.video.bytes.length)
        expect(result.value.poster.byteSize).toBe(result.value.poster.bytes.length)
      })

      it('never exceeds the height it was given, and never lands on an odd edge', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.landscape, CONTRACT_SPEC)

        expect(result.ok).toBe(true)
        if (!result.ok) return

        const { width, height } = result.value.video.dimensions
        expect(height).toBeLessThanOrEqual(CONTRACT_SPEC.maxHeight)
        expect(width % 2).toBe(0)
        expect(height % 2).toBe(0)
      })

      it('keeps a portrait clip portrait', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.portrait, CONTRACT_SPEC)

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value.video.dimensions.orientation).toBe('portrait')
      })

      it('bounds the output to the duration it was given, not to the source header', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.long, CONTRACT_SPEC)

        expect(result.ok).toBe(true)
        if (!result.ok) return
        // Generous: a keyframe-aligned cut lands near the bound rather than exactly on it.
        expect(result.value.video.durationMs).toBeLessThanOrEqual(CONTRACT_SPEC.maxDurationMs + 500)
      })

      it('transcodes a clip with no audio track rather than failing on it', async () => {
        // `-map 0:a:0` without the `?` fails outright here, and a muted phone is normal.
        const result = await subject.transcoder.transcode(subject.fixtures.silent, CONTRACT_SPEC)

        expect(result.ok).toBe(true)
      })

      it('cuts a poster that fits the box it was given', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.landscape, CONTRACT_SPEC)

        expect(result.ok).toBe(true)
        if (!result.ok) return

        const poster = result.value.poster.dimensions
        expect(Math.max(poster.width, poster.height)).toBeLessThanOrEqual(
          CONTRACT_SPEC.posterMaxEdge,
        )
        expect(result.value.poster.byteSize).toBeGreaterThan(0)
      })

      it('refuses bytes that are not a video at all', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.notAVideo, CONTRACT_SPEC)

        expect(!result.ok && result.error.code).toBe('clip.unsupportedFormat')
      })
    })
  })
}
