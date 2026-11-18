import { describe, expect, it } from 'vitest'
import { CONTRACT_SPEC } from '../../application/testing/contracts/audioTranscoderContract'
import { detectAudioContainer } from './magicBytes'
import { nullAudioTranscoder } from './nullAudioTranscoder'

/** An `ftyp` box at offset 4, which is what a real mp4 starts with. */
const anMp4 = (): Uint8Array =>
  Uint8Array.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0x00, 0x00, 0x02, 0x00,
  ])

describe('nullAudioTranscoder', () => {
  const transcoder = nullAudioTranscoder(detectAudioContainer)

  it('says it cannot transcode, which is why the voice button is not offered', () => {
    expect(transcoder.available()).toBe(false)
  })

  it('refuses to probe, with the code the guest is given a sentence for', async () => {
    const probed = await transcoder.probe(anMp4())

    expect(!probed.ok && probed.error.code).toBe('voice.transcoderUnavailable')
    expect(!probed.ok && probed.error.kind).toBe('unexpected')
  })

  it('refuses to transcode', async () => {
    const result = await transcoder.transcode(anMp4(), CONTRACT_SPEC)

    expect(!result.ok && result.error.code).toBe('voice.transcoderUnavailable')
  })

  it('still recognises a recording, so the guest is not told "that is not a voice message"', () => {
    expect(transcoder.identify(anMp4())).toBe('mp4')
    expect(transcoder.identify(new TextEncoder().encode('%PDF-1.7'))).toBeNull()
  })
})
