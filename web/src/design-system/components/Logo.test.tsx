import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Logo } from './Logo'

describe('Logo', () => {
  it('is an image named EventSlide, whatever the language', () => {
    render(<Logo />)

    expect(screen.getByRole('img', { name: 'EventSlide' })).toBeInTheDocument()
  })

  it('names the mark alone the same way', () => {
    render(<Logo variant="mark" />)

    expect(screen.getByRole('img', { name: 'EventSlide' })).toHaveAttribute(
      'viewBox',
      '0 0 100 100',
    )
  })

  it('is hidden from assistive technology when it only decorates, so the name is not read twice', () => {
    const { container } = render(<Logo decorative />)

    expect(screen.queryByRole('img')).toBeNull()
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(container.firstElementChild).not.toHaveAttribute('aria-label')
  })

  it('picks its ink from the theme by default, and from the ground when told', () => {
    const { rerender } = render(<Logo />)
    const classOf = () => screen.getByRole('img').getAttribute('class') ?? ''
    const auto = classOf()

    rerender(<Logo tone="on-dark" />)
    const onDark = classOf()
    rerender(<Logo tone="on-light" />)
    const onLight = classOf()

    expect(new Set([auto, onDark, onLight]).size).toBe(3)
  })

  it('draws the lockup wider than the mark and writes no colour and no style of its own', () => {
    const { container } = render(<Logo />)

    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('-8 -0.86 473.86 101.71')
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}|style=|fill="#|stroke="#/i)
  })
})
