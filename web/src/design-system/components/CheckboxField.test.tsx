import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CheckboxField } from './CheckboxField'

/**
 * One boolean setting, on the host's laptop.
 *
 * `EventSettingsPage.test.tsx` covers what each setting means. What is asserted here is
 * the field's own contract: the whole row is a label, so the space bar works without a
 * keydown handler, and an explanatory sentence is *described* rather than named.
 */

describe('CheckboxField', () => {
  it('reports the new value when the row is pressed, not the old one', async () => {
    const onChange = vi.fn()
    render(<CheckboxField label="Réactions autorisées" checked={false} onChange={onChange} />)

    await userEvent.click(screen.getByText('Réactions autorisées'))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('describes a hint instead of folding it into the name', async () => {
    // Named, a screen reader reads the whole sentence again every time focus lands on
    // the box — which on this form is once per Tab, five settings in a row.
    render(
      <CheckboxField
        label="Suppression par les invités"
        hint="Un invité peut retirer sa propre photo pendant le délai ci-dessous."
        checked
        onChange={vi.fn()}
      />,
    )

    const box = screen.getByRole('checkbox', { name: 'Suppression par les invités' })
    const describedBy = box.getAttribute('aria-describedby')
    if (describedBy === null) throw new Error('the hint was not described')

    expect(document.getElementById(describedBy)).toHaveTextContent(
      'Un invité peut retirer sa propre photo pendant le délai ci-dessous.',
    )
  })

  it('describes nothing when there is no hint to describe', async () => {
    // An `aria-describedby` pointing at an element that does not exist is worse than
    // none: a screen reader announces nothing and the author believes it is wired.
    render(<CheckboxField label="Légendes autorisées" checked onChange={vi.fn()} />)

    expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-describedby')
  })
})
