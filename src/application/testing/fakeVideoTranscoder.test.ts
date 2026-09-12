import { describe, expect, it } from 'vitest'
import { CONTRACT_SPEC, videoTranscoderContract } from './contracts/videoTranscoderContract'
import { FakeVideoTranscoder, fakeClipBytes, notAClip } from './fakeVideoTranscoder'

videoTranscoderContract('fake', async () => ({
  transcoder: new FakeVideoTranscoder(),
  fixtures: {
    landscape: fakeClipBytes({ width: 1920, height: 1080, durationMs: 1_500 }),
    // As a phone writes it: landscape frames plus a rotation, displaying portrait.
    portrait: fakeClipBytes({ width: 1080, height: 1920, durationMs: 1_500 }),
    silent: fakeClipBytes({ width: 1280, height: 720, durationMs: 1_500, hasAudio: false }),
    long: fakeClipBytes({ width: 1280, height: 720, durationMs: 9_000 }),
    notAVideo: notAClip(),
    corrupt: fakeClipBytes({ width: 1280, height: 720, durationMs: 1_500, corrupt: true }),
  },
}))

describe('FakeVideoTranscoder', () => {
  it('records the order of its calls, so a test can prove probe came before encode', async () => {
    const transcoder = new FakeVideoTranscoder()
    const clip = fakeClipBytes({ width: 1280, height: 720, durationMs: 1_000 })

    await transcoder.probe(clip)
    await transcoder.transcode(clip, CONTRACT_SPEC)

    expect(transcoder.calls).toEqual(['probe', 'transcode'])
  })

  it('models a box with no encoder installed', async () => {
    // Same code the Null Object adapter answers with, so a ring-2 test and a production
    // deployment with no ffmpeg agree on what the guest is told.
    const transcoder = new FakeVideoTranscoder().unavailable()

    const probed = await transcoder.probe(fakeClipBytes({ width: 8, height: 8, durationMs: 1 }))
    const encoded = await transcoder.transcode(
      fakeClipBytes({ width: 8, height: 8, durationMs: 1 }),
      CONTRACT_SPEC,
    )

    expect(!probed.ok && probed.error.code).toBe('clip.transcoderUnavailable')
    expect(!encoded.ok && encoded.error.code).toBe('clip.transcoderUnavailable')
  })

  it('refuses a container with sound and no picture', async () => {
    const transcoder = new FakeVideoTranscoder()
    const clip = fakeClipBytes({ width: 2, height: 2, durationMs: 1_000, noVideo: true })

    expect(!(await transcoder.probe(clip)).ok).toBe(true)
    const encoded = await transcoder.transcode(clip, CONTRACT_SPEC)
    expect(!encoded.ok && encoded.error.code).toBe('clip.noVideoStream')
  })

  it('can be told to fail the encode on an input whose header is fine', async () => {
    const transcoder = new FakeVideoTranscoder()
    const clip = fakeClipBytes({
      width: 1280,
      height: 720,
      durationMs: 1_000,
      transcodeError: 'clip.transcodeFailed',
    })

    expect((await transcoder.probe(clip)).ok).toBe(true)
    const encoded = await transcoder.transcode(clip, CONTRACT_SPEC)
    expect(!encoded.ok && encoded.error.code).toBe('clip.transcodeFailed')
  })

  it('makes a clip cost the number of bytes a test asked for', async () => {
    const clip = fakeClipBytes({ width: 4, height: 4, durationMs: 1_000, byteSize: 4_096 })

    expect(clip.length).toBe(4_096)
  })
})
