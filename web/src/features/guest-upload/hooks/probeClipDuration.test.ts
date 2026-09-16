import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeClipDuration } from './probeClipDuration'

/**
 * Reading a recording's duration, and — much more importantly — every way of failing to.
 *
 * jsdom has no media pipeline: a `<video>` there never loads anything and never fires
 * `loadedmetadata` on its own. So the events are dispatched by hand, which is exactly the
 * right shape for this module: what is under test is the promise's behaviour at each
 * outcome, and "did jsdom decode an mp4" is not a question worth asking here — the
 * end-to-end journey plays a real one in a real browser.
 *
 * The property that matters most is that **it never rejects**. A guest's clip must not be
 * lost because our own metadata read failed; `null` means "this phone cannot tell", and
 * the caller reads that as "let the server decide" rather than as a refusal.
 */

const aClipFile = (): File => new File([new Uint8Array([0, 0, 0, 0x18])], 'danse.mp4')

/** The element the module creates, so a test can drive it. */
let created: HTMLVideoElement | null = null

beforeEach(() => {
  created = null
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = realCreate(tag)
    if (tag === 'video') created = element as HTMLVideoElement
    return element
  })
  // jsdom implements neither, and the module calls both when it lets go of the file.
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:clip'),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** The element, once the module has made one. */
const video = (): HTMLVideoElement => {
  if (created === null) throw new Error('the probe created no video element')
  return created
}

const withDuration = (seconds: number): void => {
  Object.defineProperty(video(), 'duration', { value: seconds, configurable: true })
  video().dispatchEvent(new Event('loadedmetadata'))
}

describe('probeClipDuration', () => {
  it('reports the duration the container declares, in milliseconds', async () => {
    const probing = probeClipDuration(aClipFile())
    withDuration(8.4)

    expect(await probing).toBe(8_400)
  })

  it.each([
    ['a stream whose header was never finalised', Number.POSITIVE_INFINITY],
    ['a container it opened but could not measure', Number.NaN],
    ['a duration of zero', 0],
  ])('answers "cannot tell" for %s', async (_case, duration) => {
    // A phone that ran out of battery mid-record produces the first of these. Treating
    // any of them as a real duration would refuse a clip the server can read perfectly
    // well with ffprobe.
    const probing = probeClipDuration(aClipFile())
    withDuration(duration)

    expect(await probing).toBeNull()
  })

  it('answers "cannot tell" when the browser cannot open the file at all', async () => {
    const probing = probeClipDuration(aClipFile())
    video().dispatchEvent(new Event('error'))

    // Never a rejection: an unhandled one here would be an error in a guest's console
    // and a picker that appears to do nothing.
    await expect(probing).resolves.toBeNull()
  })

  it('gives up rather than leaving the guest waiting on a browser that never answers', async () => {
    vi.useFakeTimers()
    const probing = probeClipDuration(aClipFile())

    await vi.advanceTimersByTimeAsync(5_000)

    expect(await probing).toBeNull()
  })

  it('releases the object URL on every path, including the one that timed out', async () => {
    // Thirty recordings picked over an evening is thirty object URLs pinned for the life
    // of the tab, each one holding tens of megabytes.
    vi.useFakeTimers()
    const probing = probeClipDuration(aClipFile())
    await vi.advanceTimersByTimeAsync(5_000)
    await probing

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip')
  })

  it('ignores a late event after it has already answered', async () => {
    const probing = probeClipDuration(aClipFile())
    withDuration(8)
    // The error arrives after the metadata did — a source that loaded and then failed.
    // A second settle would be a promise resolved twice, which is silent, and a second
    // `revokeObjectURL` on a URL that no longer exists.
    video().dispatchEvent(new Event('error'))

    expect(await probing).toBe(8_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})
