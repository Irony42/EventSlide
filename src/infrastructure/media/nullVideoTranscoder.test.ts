import { describe, expect, it } from 'vitest'
import { CONTRACT_SPEC } from '../../application/testing/contracts/videoTranscoderContract'
import { detectVideoContainer } from './magicBytes'
import { nullVideoTranscoder } from './nullVideoTranscoder'

/** An `ftyp` box at offset 4, which is what a real mp4 starts with. */
const anMp4 = (): Uint8Array =>
  Uint8Array.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  ])

describe('nullVideoTranscoder', () => {
  const transcoder = nullVideoTranscoder(detectVideoContainer)

  it('refuses to probe, with the code the guest is given a French sentence for', async () => {
    const probed = await transcoder.probe(anMp4())

    expect(!probed.ok && probed.error.code).toBe('clip.transcoderUnavailable')
  })

  it('refuses to transcode', async () => {
    const result = await transcoder.transcode(anMp4(), CONTRACT_SPEC)

    expect(!result.ok && result.error.code).toBe('clip.transcoderUnavailable')
  })

  it('still recognises a clip, so the guest is told the truth about why', async () => {
    // Answering `clip.unsupportedFormat` would tell a guest "that is not a video" when
    // the truth is that this server cannot process it — and they would spend the evening
    // trying other files.
    expect(transcoder.identify(anMp4())).toBe('mp4')
    expect(transcoder.identify(new TextEncoder().encode('%PDF-1.7'))).toBeNull()
  })
})
