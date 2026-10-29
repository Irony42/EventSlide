import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AmbianceMarker } from './AmbianceMarker'

describe('AmbianceMarker', () => {
  it('dresses the page in a non-default ambiance with one hidden attribute', () => {
    const { container } = render(<AmbianceMarker ambiance="riviera" />)
    const marker = container.querySelector('[data-event-ambiance]')

    expect(marker).toHaveAttribute('data-event-ambiance', 'riviera')
    // Hidden, so it is never announced or laid out: the attribute is the whole job.
    expect(marker).not.toBeVisible()
  })

  describe('with the host’s own photograph of the venue (ADR 0010, decision 8a)', () => {
    const URL_PATH = `/api/events/camille-et-sacha/venue-photo/${'ab'.repeat(32)}`

    it('carries the photograph on the marker itself, which is then the layer’s element', () => {
      const { container } = render(<AmbianceMarker ambiance="riviera" groundUrl={URL_PATH} />)
      const marker = container.querySelector('[data-ambiance-marker]')

      expect(marker).toHaveAttribute('data-event-ambiance', 'riviera')
      expect(marker).toHaveAttribute('data-venue-ground', 'guest')
      expect(marker).toHaveStyle({ '--ambiance-ground': `url("${URL_PATH}")` })
      // Not hidden (a hidden element has no `::before`), and out of the accessibility tree.
      expect(marker).not.toHaveAttribute('hidden')
      expect(marker).toHaveAttribute('aria-hidden', 'true')
    })

    it('is rendered for the product’s own look too, which has no ambiance attribute', () => {
      const { container } = render(<AmbianceMarker ambiance="guinguette" groundUrl={URL_PATH} />)
      const marker = container.querySelector('[data-ambiance-marker]')

      expect(marker).toHaveAttribute('data-venue-ground', 'guest')
      expect(marker).not.toHaveAttribute('data-event-ambiance')
    })

    it('stays the hidden one-attribute marker with no photograph', () => {
      const { container } = render(<AmbianceMarker ambiance="riviera" groundUrl={null} />)
      const marker = container.querySelector('[data-ambiance-marker]')

      expect(marker).toHaveAttribute('hidden')
      expect(marker).not.toHaveAttribute('data-venue-ground')
    })

    it('ignores a URL that is not a path this product mints', () => {
      const { container } = render(
        <AmbianceMarker ambiance="riviera" groundUrl="https://evil.example/x.png" />,
      )

      expect(container.querySelector('[data-venue-ground]')).toBeNull()
    })

    it('renders nothing while the event is not known, whatever it is handed', () => {
      const { container } = render(<AmbianceMarker ambiance={undefined} groundUrl={URL_PATH} />)

      expect(container).toBeEmptyDOMElement()
    })
  })

  it.each([['guinguette'], [null], [undefined]] as const)(
    'renders nothing for %s, so the product’s own look is the page it was',
    (ambiance) => {
      const { container } = render(<AmbianceMarker ambiance={ambiance} />)
      expect(container).toBeEmptyDOMElement()
    },
  )
})

describe('AmbianceMarker with a custom ambiance (ADR 0011)', () => {
  const custom = { ground: 'light', groundHue: 40, faces: 'cabaret' } as const

  it('carries the polarity, the borrowed faces and the ground hue as an angle', () => {
    const { container } = render(<AmbianceMarker ambiance="custom" custom={custom} />)
    const marker = container.querySelector('[data-ambiance-marker]')

    expect(marker).toHaveAttribute('data-event-ambiance', 'custom')
    expect(marker).toHaveAttribute('data-ambiance-ground', 'light')
    expect(marker).toHaveAttribute('data-ambiance-faces', 'cabaret')
    expect(marker).toHaveStyle({ '--ground-hue': '40deg' })
  })

  it('keeps the ground hue beside the venue photograph', () => {
    const path = `/api/events/camille-et-sacha/venue-photo/${'ab'.repeat(32)}`
    const { container } = render(
      <AmbianceMarker ambiance="custom" custom={custom} groundUrl={path} />,
    )
    const marker = container.querySelector('[data-ambiance-marker]')

    expect(marker).toHaveAttribute('data-ambiance-ground', 'light')
    expect(marker).toHaveStyle({ '--ground-hue': '40deg', '--ambiance-ground': `url("${path}")` })
  })

  it('ignores the object for any other ambiance', () => {
    const { container } = render(<AmbianceMarker ambiance="noces" custom={custom} />)

    expect(container.querySelector('[data-ambiance-ground]')).toBeNull()
  })
})
