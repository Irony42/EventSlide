import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AmbianceMarker } from './AmbianceMarker'

describe('AmbianceMarker', () => {
  it('dresses the page in a festive ambiance with one hidden attribute', () => {
    const { container } = render(<AmbianceMarker ambiance="guinguette" />)
    const marker = container.querySelector('[data-event-ambiance]')

    expect(marker).toHaveAttribute('data-event-ambiance', 'guinguette')
    // Hidden, so it is never announced or laid out: the attribute is the whole job.
    expect(marker).not.toBeVisible()
  })

  describe('with the host’s own photograph of the venue (ADR 0010, decision 8)', () => {
    const URL_PATH = `/api/events/camille-et-sacha/venue-photo/${'ab'.repeat(32)}`

    it('carries the photograph on the marker itself, which is then the layer’s element', () => {
      const { container } = render(<AmbianceMarker ambiance="guinguette" groundUrl={URL_PATH} />)
      const marker = container.querySelector('[data-ambiance-marker]')

      expect(marker).toHaveAttribute('data-venue-ground', 'guest')
      expect(marker).toHaveStyle({ '--ambiance-ground': `url("${URL_PATH}")` })
      // Not hidden (a hidden element has no `::before`), and out of the accessibility tree.
      expect(marker).not.toHaveAttribute('hidden')
      expect(marker).toHaveAttribute('aria-hidden', 'true')
    })

    it('stays the hidden one-attribute marker with no photograph', () => {
      const { container } = render(<AmbianceMarker ambiance="guinguette" groundUrl={null} />)
      const marker = container.querySelector('[data-ambiance-marker]')

      expect(marker).toHaveAttribute('hidden')
      expect(marker).not.toHaveAttribute('data-venue-ground')
    })

    it('ignores a URL that is not a path this product mints', () => {
      const { container } = render(
        <AmbianceMarker ambiance="guinguette" groundUrl="https://evil.example/x.png" />,
      )

      expect(container.querySelector('[data-venue-ground]')).toBeNull()
    })

    it('renders nothing for the product’s own look, whatever it is handed', () => {
      const { container } = render(<AmbianceMarker ambiance="darkroom" groundUrl={URL_PATH} />)

      expect(container).toBeEmptyDOMElement()
    })
  })

  it.each([['darkroom'], [null], [undefined]] as const)(
    'renders nothing for %s, so the product’s own look is the page it was',
    (ambiance) => {
      const { container } = render(<AmbianceMarker ambiance={ambiance} />)
      expect(container).toBeEmptyDOMElement()
    },
  )
})
