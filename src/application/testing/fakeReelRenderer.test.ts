import { describe, expect, it } from 'vitest'
import { FakeReelRenderer } from './fakeReelRenderer'
import { reelRendererContract, REEL_CONTRACT_SPEC } from './contracts/reelRendererContract'

reelRendererContract('fake', async () => ({
  renderer: new FakeReelRenderer(),
  frames: [Uint8Array.of(1, 2), Uint8Array.of(3), Uint8Array.of(4, 5, 6)],
}))

describe('FakeReelRenderer options', () => {
  it('can be a box with no encoder', () => {
    expect(new FakeReelRenderer({ available: false }).available()).toBe(false)
  })

  it('fails with the code a test chooses', async () => {
    const made = await new FakeReelRenderer({ failsWith: 'reel.timedOut' }).render(
      [Uint8Array.of(1)],
      REEL_CONTRACT_SPEC,
    )

    expect(!made.ok && made.error.code).toBe('reel.timedOut')
  })

  it('records which frames went into each montage, in order', async () => {
    const renderer = new FakeReelRenderer()
    await renderer.render([Uint8Array.of(9), Uint8Array.of(8)], REEL_CONTRACT_SPEC)

    expect(renderer.rendered.map((frames) => frames.map((frame) => [...frame]))).toEqual([
      [[9], [8]],
    ])
  })

  it('runs a hook while rendering, which is where a test removes a photograph', async () => {
    let ran = false
    const renderer = new FakeReelRenderer({
      whileRendering: async () => {
        ran = true
      },
    })

    await renderer.render([Uint8Array.of(1)], REEL_CONTRACT_SPEC)

    expect(ran).toBe(true)
  })
})
