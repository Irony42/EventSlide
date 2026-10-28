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

  it.each([['guinguette'], [null], [undefined]] as const)(
    'renders nothing for %s, so the product’s own look is the page it was',
    (ambiance) => {
      const { container } = render(<AmbianceMarker ambiance={ambiance} />)
      expect(container).toBeEmptyDOMElement()
    },
  )
})
