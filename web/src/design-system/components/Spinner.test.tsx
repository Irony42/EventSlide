import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Spinner } from './Spinner'

describe('Spinner', () => {
  it('announces its label as a status, in text a sighted reader never sees', () => {
    render(<Spinner label="Chargement…" />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Chargement…')
    expect(screen.getByText('Chargement…')).toHaveClass('visually-hidden')
  })

  it('says nothing, and is hidden from assistive technology, without a label', () => {
    // Inside a button with `aria-busy` the wait is already announced; a second
    // announcement of the same wait is worse than one.
    const { container } = render(<Spinner />)

    expect(screen.queryByRole('status')).toBeNull()
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})
