import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { breeze } from '../breeze'
import { Garland } from './Garland'

describe('Garland', () => {
  it('is decorative: hidden from assistive technology, with nine photos and no inline style', () => {
    const { container } = render(<Garland />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('[data-breeze-photo]')).toHaveLength(9)
    expect(container.innerHTML).not.toContain('style=')
  })

  it('declares every animation inside the no-preference query, so reduced motion gets a still garland', () => {
    const css = readFileSync(join(__dirname, 'Garland.module.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )
    const open = css.indexOf('@media (prefers-reduced-motion: no-preference)')
    const close = css.indexOf('\n}\n', open)
    const outside = css.slice(0, open) + css.slice(close)

    expect(open).toBeGreaterThanOrEqual(0)
    expect(outside).not.toMatch(/animation(-name)?\s*:/)
  })
})

describe('breeze', () => {
  const setup = (reduce: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    const { container } = render(<Garland />)
    const svg = container.querySelector('svg') as SVGSVGElement
    const area = svg.parentElement as HTMLElement
    const photo = svg.querySelector('[data-breeze-photo]') as SVGElement
    // jsdom measures nothing: give the invisible circle a box so the pointer can reach it.
    svg.querySelectorAll('circle').forEach((circle) => {
      circle.getBoundingClientRect = () => new DOMRect(0, 0, 40, 40)
    })
    return { svg, area, photo }
  }

  const sweep = (area: HTMLElement) => {
    fireEvent.pointerMove(area, { clientX: 0, clientY: 20 })
    fireEvent.pointerMove(area, { clientX: 30, clientY: 20 })
  }

  it('pushes a photo when the pointer crosses it', () => {
    let tick: FrameRequestCallback = () => {}
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      tick = callback
      return 1
    })
    const { svg, area, photo } = setup(false)
    const stop = breeze(svg, area)

    sweep(area)
    tick(16)

    expect(photo.style.transform).toMatch(/rotate\(/)
    stop()
    expect(photo.style.transform).toBe('')
    vi.restoreAllMocks()
  })

  it('does nothing under prefers-reduced-motion: reduce', () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame')
    const { svg, area, photo } = setup(true)
    const stop = breeze(svg, area)

    sweep(area)

    expect(frame).not.toHaveBeenCalled()
    expect(photo.style.transform).toBe('')
    stop()
    vi.restoreAllMocks()
  })
})
