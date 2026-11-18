import { describe, expect, it } from 'vitest'
import { audioTranscoderContract, CONTRACT_SPEC } from './contracts/audioTranscoderContract'
import { FakeAudioTranscoder, fakeVoiceBytes, notARecording } from './fakeAudioTranscoder'

audioTranscoderContract('fake', async () => ({
  transcoder: new FakeAudioTranscoder(),
  fixtures: {
    spoken: fakeVoiceBytes({ audioMs: 1_500 }),
    // A WebM from `MediaRecorder`: sound, and no duration in the header.
    noDuration: fakeVoiceBytes({ audioMs: 1_500, declaredMs: null, container: 'matroska' }),
    long: fakeVoiceBytes({ audioMs: 9_000 }),
    // A header that claims an hour over a second and a half of sound.
    lyingHeader: fakeVoiceBytes({ audioMs: 1_500, declaredMs: 3_600_000 }),
    tap: fakeVoiceBytes({ audioMs: 300 }),
    video: fakeVoiceBytes({ audioMs: 1_500, hasVideo: true }),
    silentContainer: fakeVoiceBytes({ audioMs: 1_500, noAudio: true }),
    notAVoice: notARecording(),
    corrupt: fakeVoiceBytes({ audioMs: 1_500, corrupt: true }),
  },
}))

describe('FakeAudioTranscoder', () => {
  it('records the order of its calls, so a test can prove probe came before encode', async () => {
    const transcoder = new FakeAudioTranscoder()
    const voice = fakeVoiceBytes({ audioMs: 2_000 })

    transcoder.identify(voice)
    await transcoder.probe(voice)
    await transcoder.transcode(voice, CONTRACT_SPEC)

    expect(transcoder.calls).toEqual(['identify', 'probe', 'transcode'])
    expect(transcoder.lastSpec).toBe(CONTRACT_SPEC)
  })

  it('models a box with no encoder installed, with the Null Object’s code', async () => {
    const transcoder = new FakeAudioTranscoder().unavailable()
    const voice = fakeVoiceBytes({ audioMs: 2_000 })

    const probed = await transcoder.probe(voice)
    const encoded = await transcoder.transcode(voice, CONTRACT_SPEC)

    expect(transcoder.available()).toBe(false)
    expect(!probed.ok && probed.error.code).toBe('voice.transcoderUnavailable')
    expect(!encoded.ok && encoded.error.code).toBe('voice.transcoderUnavailable')
  })

  it('still recognises a recording when it cannot process one, so the guest is told the truth', () => {
    const transcoder = new FakeAudioTranscoder().unavailable()

    expect(transcoder.identify(fakeVoiceBytes({ audioMs: 2_000 }))).toBe('mp4')
  })

  it('fails the encoder on a source that says so, whatever its header claims', async () => {
    const transcoder = new FakeAudioTranscoder()
    const voice = fakeVoiceBytes({ audioMs: 2_000, transcodeError: 'voice.transcodeTimedOut' })

    const encoded = await transcoder.transcode(voice, CONTRACT_SPEC)

    expect(!encoded.ok && encoded.error.code).toBe('voice.transcodeTimedOut')
  })

  it('reports the duration it measured, not the header’s, and says so in the probe', async () => {
    const transcoder = new FakeAudioTranscoder()
    const voice = fakeVoiceBytes({ audioMs: 1_500, declaredMs: 90_000 })

    const probed = await transcoder.probe(voice)
    const encoded = await transcoder.transcode(voice, CONTRACT_SPEC)

    expect(probed.ok && probed.value.durationMs).toBe(90_000)
    expect(encoded.ok && encoded.value.durationMs).toBe(1_500)
  })

  it('honours the size a test asks of a recording, which is what the quota is judged on', () => {
    expect(fakeVoiceBytes({ audioMs: 1_000, byteSize: 4_000 }).length).toBe(4_000)
  })

  it('never returns more bytes than the spec allows', async () => {
    const transcoder = new FakeAudioTranscoder()
    const voice = fakeVoiceBytes({ audioMs: 60_000 })

    const encoded = await transcoder.transcode(voice, {
      maxDurationMs: 60_000,
      minDurationMs: 1_000,
      maxOutputBytes: 5_000,
    })

    expect(encoded.ok && encoded.value.byteSize).toBeLessThanOrEqual(5_000)
  })

  it('reads a descriptor that is not valid JSON as an unsupported format', async () => {
    const broken = new TextEncoder().encode('VOICEFAKE:{not json')

    const probed = await new FakeAudioTranscoder().probe(broken)

    expect(!probed.ok && probed.error.code).toBe('voice.unsupportedFormat')
  })
})
