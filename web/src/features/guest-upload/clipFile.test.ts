import { describe, expect, it } from 'vitest'
import { megabytes, refuseClipDuration, refuseClipFile, type ClipLimits } from './clipFile'

/**
 * The refusals a phone can make before a byte leaves it.
 *
 * Every one of them is a refusal the server would make anyway; what is tested here is
 * that the early copy neither refuses more than the server does — which loses a guest's
 * clip for nothing — nor less, which is the four minutes of venue Wi-Fi this exists to
 * save.
 */

const limits: ClipLimits = { maxBytes: 80_000_000, maxSeconds: 15 }

describe('refuseClipFile', () => {
  it('refuses a recording larger than this deployment allows', () => {
    expect(refuseClipFile({ type: 'video/mp4', size: 80_000_001 }, limits)).toBe('tooLarge')
  })

  it('accepts one exactly at the limit, which the server also accepts', () => {
    expect(refuseClipFile({ type: 'video/mp4', size: 80_000_000 }, limits)).toBeNull()
  })

  it('judges against the event’s own limit rather than a constant', () => {
    // The number is deployment configuration. A build that hardcoded 80 MB would keep
    // accepting 80 MB on a box whose operator lowered `MAX_CLIP_BYTES` to 20.
    const strict: ClipLimits = { maxBytes: 20_000_000, maxSeconds: 15 }

    expect(refuseClipFile({ type: 'video/mp4', size: 40_000_000 }, strict)).toBe('tooLarge')
  })

  it('refuses a file the picker declared as something other than a video', () => {
    expect(refuseClipFile({ type: 'image/jpeg', size: 1_000 }, limits)).toBe('notAVideo')
  })

  it('accepts a file whose type the picker did not declare at all', () => {
    // Several Android pickers and every share-sheet path hand over a `File` with an
    // empty type. Refusing those would refuse ordinary videos from ordinary phones for
    // a check the server does properly, from the signature.
    expect(refuseClipFile({ type: '', size: 1_000 }, limits)).toBeNull()
  })

  it('refuses an empty file rather than spending a round trip on it', () => {
    expect(refuseClipFile({ type: 'video/mp4', size: 0 }, limits)).toBe('empty')
  })
})

describe('refuseClipDuration', () => {
  it('refuses a recording longer than the cap', () => {
    expect(refuseClipDuration(16_000, limits)).toBe('tooLong')
  })

  it('accepts one at the cap', () => {
    expect(refuseClipDuration(15_000, limits)).toBeNull()
  })

  it('refuses on exactly the bound the domain applies, not a rounded one', () => {
    // `ClipDuration.create` refuses `ms > maxMs`. Rounding to whole seconds here is
    // generous in the one direction that costs the guest something: a 15.4 s recording
    // would round to 15, pass, go up the venue's Wi-Fi in full, and come back
    // `clip.tooLong` — the round trip this module exists to save them.
    expect(refuseClipDuration(15_001, limits)).toBe('tooLong')
    expect(refuseClipDuration(15_400, limits)).toBe('tooLong')
  })

  it('does not refuse a container this browser could not read', () => {
    // `null` is our ignorance, not the file's fault: the server has ffprobe and a phone
    // has whatever the platform ships. Refusing here would lose a clip for a reason
    // that is ours.
    expect(refuseClipDuration(null, limits)).toBeNull()
  })
})

describe('megabytes', () => {
  it('reads the limit in the same decimal megabytes the sentence says', () => {
    // `MAX_CLIP_BYTES` is 80 000 000. A binary conversion would put "76 Mo" in the hint
    // and "80 Mo" nowhere, for one limit.
    expect(megabytes(80_000_000)).toBe(80)
  })
})
