import { describe, expect, it } from 'vitest'
import { nullReelRenderer } from './nullReelRenderer'

describe('nullReelRenderer', () => {
  it('says there is no encoder, and refuses to render with the code a host is told', async () => {
    const renderer = nullReelRenderer()

    expect(renderer.available()).toBe(false)
    const made = await renderer.render([Uint8Array.of(1)], { secondsPerPhoto: 4, maxOutputBytes: 1 })
    expect(!made.ok && made.error.code).toBe('reel.transcoderUnavailable')
  })
})
