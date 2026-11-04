import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Icon, type IconName } from './Icon'

const NAMES: readonly IconName[] = ['settings', 'pause', 'play', 'fullscreen', 'close']

describe('Icon', () => {
  it.each(NAMES)('draws %s inline, hidden from assistive technology', (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg?.querySelector('path')?.getAttribute('d')).toMatch(/^M/)
  })

  it('draws a different shape for each name', () => {
    const shapes = NAMES.map((name) =>
      render(<Icon name={name} />)
        .container.querySelector('path')
        ?.getAttribute('d'),
    )

    expect(new Set(shapes).size).toBe(NAMES.length)
  })

  it('fetches nothing: no image, no use of a sprite', () => {
    const { container } = render(<Icon name="settings" />)

    expect(container.querySelector('image, use')).toBeNull()
  })
})
