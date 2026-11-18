import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVoiceMeter } from './voiceMeter'

/** The sound level of the recording screen: best effort, and silent where the browser has no audio graph. */

afterEach(() => vi.unstubAllGlobals())

class FakeContext {
  static closed = 0
  static waveform = new Uint8Array(512).fill(128)
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => {
    FakeContext.closed += 1
  })
  createAnalyser = () => ({
    fftSize: 0,
    getByteTimeDomainData: (target: Uint8Array) =>
      target.set(FakeContext.waveform.slice(0, target.length)),
  })
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() })
}

describe('createVoiceMeter', () => {
  it('is null where the browser has no audio context, and the recording goes on without a level', () => {
    vi.stubGlobal('AudioContext', undefined)

    expect(createVoiceMeter()).toBeNull()
  })

  it('is null when the browser refuses to build the graph', () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('refused')
        }
      },
    )

    expect(createVoiceMeter()).toBeNull()
  })

  it('reads silence until the stream is attached, then the loudness of the voice', () => {
    vi.stubGlobal('AudioContext', FakeContext)
    FakeContext.waveform = new Uint8Array(512).fill(128)
    const meter = createVoiceMeter()

    expect(meter?.read()).toBe(0)
    meter?.attach({} as MediaStream)
    expect(meter?.read()).toBe(0)

    FakeContext.waveform = new Uint8Array(512).map((_, index) => (index % 2 === 0 ? 192 : 64))
    expect(meter?.read()).toBeGreaterThan(0.5)
    expect(meter?.read()).toBeLessThanOrEqual(1)
  })

  it('starts the context in the tap and releases it once, however often it is closed', () => {
    vi.stubGlobal('AudioContext', FakeContext)
    FakeContext.closed = 0
    const meter = createVoiceMeter()

    meter?.close()
    meter?.close()

    expect(FakeContext.closed).toBe(1)
    expect(meter?.read()).toBe(0)
  })

  it('does not attach a stream to a context that is already released', () => {
    vi.stubGlobal('AudioContext', FakeContext)
    const meter = createVoiceMeter()
    meter?.close()

    meter?.attach({} as MediaStream)

    expect(meter?.read()).toBe(0)
  })
})
