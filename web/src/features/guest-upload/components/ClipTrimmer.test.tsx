import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../../lib/i18n/fr'
import { ClipTrimmer } from './ClipTrimmer'
import { renderWithProviders } from '../../../testing/renderWithProviders'

/** The trim screen: what a guest, or a screen reader, finds on it. */

const FILE = new File([new Uint8Array([1])], 'danse.mp4', { type: 'video/mp4' })
const TRIM = { durationMs: 40_000, startMs: 0, endMs: 15_000 }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})

const mount = (onChange = vi.fn(), disabled = false, trim = TRIM) => {
  renderWithProviders(
    <ClipTrimmer file={FILE} trim={trim} maxSeconds={15} disabled={disabled} onChange={onChange} />,
  )
  return onChange
}

describe('ClipTrimmer', () => {
  it('names the group and both handles, and reads their values in seconds', () => {
    mount()

    expect(screen.getByRole('group', { name: fr.upload.clipTrimTitle(15) })).toBeTruthy()
    const start = screen.getByRole('slider', { name: fr.upload.clipTrimStart })
    const end = screen.getByRole('slider', { name: fr.upload.clipTrimEnd })
    expect(start.getAttribute('aria-valuetext')).toBe(fr.upload.clipTrimValue(0))
    expect(end.getAttribute('aria-valuetext')).toBe(fr.upload.clipTrimValue(15))
  })

  it('says the length of the chosen part against the cap, in a status region', () => {
    mount()

    expect(screen.getByRole('status').textContent).toBe(fr.upload.clipTrimSummary(15, 15))
  })

  it('moves the start through the pure rules: the end follows to hold the cap', () => {
    const onChange = mount(vi.fn(), false, { durationMs: 40_000, startMs: 10_000, endMs: 20_000 })

    fireEvent.change(screen.getByTestId('clip-trim-start'), { target: { value: '2000' } })

    expect(onChange).toHaveBeenCalledWith({ startMs: 2_000, endMs: 17_000 })
  })

  it('moves the end, and the start follows to hold the cap', () => {
    const onChange = mount()

    fireEvent.change(screen.getByTestId('clip-trim-end'), { target: { value: '30000' } })

    expect(onChange).toHaveBeenCalledWith({ startMs: 15_000, endMs: 30_000 })
  })

  it('holds the handles still while the clip is on its way', () => {
    mount(vi.fn(), true)

    expect((screen.getByTestId('clip-trim-start') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('clip-trim-end') as HTMLInputElement).disabled).toBe(true)
  })

  it('replaces the picture with a sentence when this browser cannot decode it, keeping the handles', () => {
    mount()

    fireEvent.error(document.querySelector('video') as HTMLVideoElement)

    expect(screen.getByText(fr.upload.clipTrimNoPreview)).toBeTruthy()
    expect(screen.getByTestId('clip-trim-start')).toBeTruthy()
  })

  it('revokes the object URL it made when it goes away', () => {
    const view = renderWithProviders(
      <ClipTrimmer file={FILE} trim={TRIM} maxSeconds={15} disabled={false} onChange={vi.fn()} />,
    )

    view.unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  describe('the play button', () => {
    let play: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    })

    it('is an icon button named for what it does, and toggles name and glyph', async () => {
      mount()
      const button = screen.getByRole('button', { name: fr.upload.clipTrimPlay })
      const glyph = () => button.querySelector('path')?.getAttribute('d')
      const playGlyph = glyph()

      await act(async () => fireEvent.click(button))

      expect(play).toHaveBeenCalledTimes(1)
      const paused = screen.getByRole('button', { name: fr.upload.clipTrimPause })
      expect(paused).toBe(button)
      expect(glyph()).not.toBe(playGlyph)
      expect(button.textContent).toBe('')

      await act(async () => fireEvent.click(button))

      expect(screen.getByRole('button', { name: fr.upload.clipTrimPlay })).toBe(button)
      expect(glyph()).toBe(playGlyph)
    })
  })

  describe('the frame under the handle', () => {
    let frames: FrameRequestCallback[]
    let seeks: number[]
    let pause: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      frames = []
      seeks = []
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      })
      vi.stubGlobal('cancelAnimationFrame', vi.fn())
      vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation((value) => {
        seeks.push(value)
      })
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
      pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    })

    const flush = () => act(() => frames.splice(0).forEach((frame) => frame(0)))

    it('shows the frame at the start handle and pauses the preview', async () => {
      mount(vi.fn(), false, { durationMs: 40_000, startMs: 10_000, endMs: 20_000 })
      await act(async () => fireEvent.click(screen.getByTestId('clip-trim-play')))
      seeks.length = 0

      fireEvent.change(screen.getByTestId('clip-trim-start'), { target: { value: '12300' } })

      expect(pause).toHaveBeenCalled()
      expect(screen.getByRole('button', { name: fr.upload.clipTrimPlay })).toBeTruthy()
      flush()
      expect(seeks).toEqual([12.3])
    })

    it('shows the frame at the end handle, not at the start that follows it', () => {
      mount()

      fireEvent.change(screen.getByTestId('clip-trim-end'), { target: { value: '30000' } })

      flush()
      expect(seeks).toEqual([30])
    })

    it('applies only the latest position of a fast drag, in one seek', () => {
      mount()
      const end = screen.getByTestId('clip-trim-end')

      fireEvent.change(end, { target: { value: '20000' } })
      fireEvent.change(end, { target: { value: '25000' } })
      fireEvent.change(end, { target: { value: '31000' } })

      expect(frames).toHaveLength(1)
      flush()
      expect(seeks).toEqual([31])
    })

    it('does nothing new when the browser cannot decode the video', () => {
      mount()
      fireEvent.error(document.querySelector('video') as HTMLVideoElement)

      fireEvent.change(screen.getByTestId('clip-trim-end'), { target: { value: '30000' } })

      expect(frames).toHaveLength(0)
      expect(pause).not.toHaveBeenCalled()
    })
  })
})
