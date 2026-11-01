import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { WelcomeMessageField } from './WelcomeMessageField'

describe('WelcomeMessageField', () => {
  it('counts code points against the ceiling, so an emoji counts once', () => {
    renderWithProviders(
      <WelcomeMessageField
        value={String.fromCodePoint(0x1f389) + 'ab'}
        onChange={() => {}}
        disabled={false}
      />,
    )

    expect(screen.getByText('3 / 280')).toBeVisible()
  })

  it('links the counter to the field for assistive technology', () => {
    renderWithProviders(<WelcomeMessageField value="Salut" onChange={() => {}} disabled={false} />)

    const field = screen.getByLabelText(new RegExp(fr.admin.welcomeMessage))
    const counter = screen.getByText('5 / 280')
    expect(field.getAttribute('aria-describedby')).toContain(counter.id)
  })

  it('sends null when the host clears the message', async () => {
    const onChange = vi.fn()
    renderWithProviders(<WelcomeMessageField value="Salut" onChange={onChange} disabled={false} />)

    await userEvent.click(screen.getByRole('button', { name: fr.admin.welcomeMessageClear }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('offers no clear button when there is nothing to clear', () => {
    renderWithProviders(<WelcomeMessageField value={null} onChange={() => {}} disabled={false} />)

    expect(screen.queryByRole('button', { name: fr.admin.welcomeMessageClear })).toBeNull()
  })

  it('is read-only on an event that can no longer be changed', () => {
    renderWithProviders(<WelcomeMessageField value="Salut" onChange={() => {}} disabled />)

    expect(screen.getByLabelText(new RegExp(fr.admin.welcomeMessage))).toBeDisabled()
  })
})
