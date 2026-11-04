import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocaleOverride } from '../../../lib/i18n/LocaleProvider'
import { SouvenirCounter } from './SouvenirCounter'

describe('SouvenirCounter (spec 11)', () => {
  it('prints nothing at zero, where the empty wall has its own words', () => {
    const { container } = render(<SouvenirCounter count={0} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('says one souvenir in the singular and many in the plural, in the wall’s language', () => {
    const { rerender } = render(<SouvenirCounter count={1} />)
    expect(screen.getByTestId('souvenir-counter')).toHaveTextContent('1 souvenir partagé')

    rerender(<SouvenirCounter count={17} />)
    expect(screen.getByTestId('souvenir-counter')).toHaveTextContent('17 souvenirs partagés')

    rerender(
      <LocaleOverride locale="de">
        <SouvenirCounter count={17} />
      </LocaleOverride>,
    )
    expect(screen.getByTestId('souvenir-counter')).toHaveTextContent('17 Erinnerungen geteilt')
  })

  it('formats a large total with the language’s own grouping', () => {
    render(
      <LocaleOverride locale="en">
        <SouvenirCounter count={1200} />
      </LocaleOverride>,
    )

    expect(screen.getByTestId('souvenir-counter')).toHaveTextContent('1,200 memories shared')
  })

  it('sits outside any live region, which would announce every photograph', () => {
    render(<SouvenirCounter count={3} />)

    expect(screen.getByTestId('souvenir-counter').closest('[aria-live]')).toBeNull()
  })
})
