import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SUPPORTED_VOICE_CONTAINERS } from '../../ports/audioTranscoder'
import type { AudioTranscoder, TranscodeVoiceSpec } from '../../ports/audioTranscoder'

/**
 * The shared `AudioTranscoder` contract (spec 25).
 *
 * Run against `FakeAudioTranscoder` (the double every ring-2 test uses) and, in the change that
 * brings the ffmpeg adapter, against real ffmpeg: a double that drifts from the encoder makes
 * every use-case test about voices a statement about nothing. The recordings themselves cannot be
 * shared (one implementation needs a real container, the other a descriptor), so the suite takes
 * them as a parameter. What is shared is every property, and three of them are the traps written
 * out as assertions:
 *
 * - **a header with no duration is the normal case**, not a refusal: a browser recording has none;
 * - **the output is bounded by the spec, not by the header**: a truncated or lying container
 *   declares whatever it declared, and the stored duration is the one measured on what was written;
 * - **a video is not a voice**: a file with a picture is refused here and its bytes never stored,
 *   because this is not the route of clips and `allowClips` and the clip ceilings do not apply.
 *
 * The round trip (the output goes back through the same demuxer) is the cheapest available
 * stand-in for "a browser will play it".
 */

export interface VoiceFixtures {
  /** An ordinary recording a few seconds long, comfortably inside the cap. */
  readonly spoken: Uint8Array
  /** A recording whose container declares no duration at all (a `MediaRecorder` WebM). */
  readonly noDuration: Uint8Array
  /** Longer than {@link CONTRACT_SPEC}'s cap, so the bound can be observed. */
  readonly long: Uint8Array
  /** A header claiming far more than the sound holds, so what is measured can be told from it. */
  readonly lyingHeader: Uint8Array
  /** Shorter than {@link CONTRACT_SPEC}'s floor: a stray tap. */
  readonly tap: Uint8Array
  /** A picture and sound. */
  readonly video: Uint8Array
  /** A container with no stream to hear. */
  readonly silentContainer: Uint8Array
  /** Not a recording: a renamed document. */
  readonly notAVoice: Uint8Array
  /** A container whose header will not parse. */
  readonly corrupt: Uint8Array
}

/** Small on purpose: the real adapter runs this against a real encoder on a laptop. */
export const CONTRACT_SPEC: TranscodeVoiceSpec = {
  maxDurationMs: 2_000,
  minDurationMs: 1_000,
  maxOutputBytes: 1_000_000,
}

export interface AudioTranscoderSubject {
  readonly transcoder: AudioTranscoder
  readonly fixtures: VoiceFixtures
  readonly dispose?: () => Promise<void>
}

export const audioTranscoderContract = (
  name: string,
  makeSubject: () => Promise<AudioTranscoderSubject>,
): void => {
  describe(`AudioTranscoder contract: ${name}`, () => {
    let subject: AudioTranscoderSubject

    beforeAll(async () => {
      subject = await makeSubject()
    })

    afterAll(async () => {
      await subject.dispose?.()
    })

    describe('available', () => {
      it('reports that a working transcoder can transcode', () => {
        // The negative answer belongs to the Null Object, which has its own test; what this holds
        // is that the question is answerable at all and costs nothing, since the upload asks it.
        expect(subject.transcoder.available()).toBe(true)
      })
    })

    describe('identify', () => {
      it('recognises a recording from its signature alone', () => {
        expect(subject.transcoder.identify(subject.fixtures.spoken)).toBe('mp4')
      })

      it('recognises a container even when its header is unusable', () => {
        // Signature and header are two questions: a truncated recording is still an MP4, and
        // telling a guest "not a voice message" would be wrong.
        expect(subject.transcoder.identify(subject.fixtures.corrupt)).toBe('mp4')
      })

      it('refuses bytes that are not a recording at all', () => {
        expect(subject.transcoder.identify(subject.fixtures.notAVoice)).toBeNull()
      })
    })

    describe('probe', () => {
      it('reads the header of a recording it can open', async () => {
        const probed = await subject.transcoder.probe(subject.fixtures.spoken)

        expect(probed.ok).toBe(true)
        if (!probed.ok) return
        // Inside the allow-list, never merely "some string": the container decides which demuxer
        // the input is pinned to.
        expect([...SUPPORTED_VOICE_CONTAINERS]).toContain(probed.value.container)
        expect(probed.value.durationMs).toBeGreaterThan(0)
      })

      it('accepts a container that declares no duration, and says so with null', async () => {
        const probed = await subject.transcoder.probe(subject.fixtures.noDuration)

        expect(probed.ok).toBe(true)
        expect(probed.ok && probed.value.durationMs).toBeNull()
      })

      it('refuses bytes that are not a recording at all', async () => {
        const probed = await subject.transcoder.probe(subject.fixtures.notAVoice)

        expect(!probed.ok && probed.error.code).toBe('voice.unsupportedFormat')
      })

      it('refuses a container whose header will not parse', async () => {
        const probed = await subject.transcoder.probe(subject.fixtures.corrupt)

        expect(!probed.ok && probed.error.code).toBe('voice.corrupt')
      })

      it('refuses a file that carries a picture: this is not the route of clips', async () => {
        const probed = await subject.transcoder.probe(subject.fixtures.video)

        expect(!probed.ok && probed.error.code).toBe('voice.notAudio')
      })

      it('refuses a container with nothing to hear', async () => {
        const probed = await subject.transcoder.probe(subject.fixtures.silentContainer)

        expect(!probed.ok && probed.error.code).toBe('voice.noAudioStream')
      })
    })

    describe('transcode', () => {
      it('produces something this pipeline can open again', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.spoken, CONTRACT_SPEC)

        expect(result.ok).toBe(true)
        if (!result.ok) return

        const reprobed = await subject.transcoder.probe(result.value.bytes)
        expect(reprobed.ok).toBe(true)
        expect(reprobed.ok && reprobed.value.container).toBe('mp4')
      })

      it('reports the size of the bytes it actually returned', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.spoken, CONTRACT_SPEC)

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value.byteSize).toBe(result.value.bytes.length)
        expect(result.value.byteSize).toBeLessThanOrEqual(CONTRACT_SPEC.maxOutputBytes)
      })

      it('bounds the output to the duration it was given, not to the source header', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.long, CONTRACT_SPEC)

        expect(result.ok).toBe(true)
        if (!result.ok) return
        // Generous: a real cut lands near the bound rather than exactly on it.
        expect(result.value.durationMs).toBeLessThanOrEqual(CONTRACT_SPEC.maxDurationMs + 250)
      })

      it('measures the duration on the output and never copies the one the header claims', async () => {
        const result = await subject.transcoder.transcode(
          subject.fixtures.lyingHeader,
          CONTRACT_SPEC,
        )

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value.durationMs).toBeLessThanOrEqual(CONTRACT_SPEC.maxDurationMs + 250)
        expect(result.value.durationMs).toBeGreaterThan(0)
      })

      it('encodes a recording whose container declares no duration', async () => {
        const result = await subject.transcoder.transcode(
          subject.fixtures.noDuration,
          CONTRACT_SPEC,
        )

        expect(result.ok).toBe(true)
        expect(result.ok && result.value.durationMs).toBeGreaterThan(0)
      })

      it('refuses an output shorter than the floor: a stray tap is not a message', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.tap, CONTRACT_SPEC)

        expect(!result.ok && result.error.code).toBe('voice.tooShort')
      })

      it('refuses a file that carries a picture, as the probe does', async () => {
        const result = await subject.transcoder.transcode(subject.fixtures.video, CONTRACT_SPEC)

        expect(!result.ok && result.error.code).toBe('voice.notAudio')
      })

      it('refuses bytes that are not a recording, and a header that will not parse', async () => {
        const notAVoice = await subject.transcoder.transcode(
          subject.fixtures.notAVoice,
          CONTRACT_SPEC,
        )
        const corrupt = await subject.transcoder.transcode(subject.fixtures.corrupt, CONTRACT_SPEC)

        expect(!notAVoice.ok && notAVoice.error.code).toBe('voice.unsupportedFormat')
        expect(!corrupt.ok && corrupt.error.code).toBe('voice.corrupt')
      })
    })
  })
}
