import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Field } from './Field'
import { TextInput } from './TextInput'

describe('Field', () => {
  it('names the control with a real label, so touching the text focuses the input', async () => {
    render(<Field label="Code de la soirée">{(control) => <TextInput {...control} />}</Field>)

    await userEvent.click(screen.getByText('Code de la soirée'))

    expect(screen.getByLabelText('Code de la soirée')).toHaveFocus()
  })

  it('describes the control with its hint', () => {
    render(
      <Field label="Légende" hint="140 caractères maximum.">
        {(control) => <TextInput {...control} />}
      </Field>,
    )

    expect(screen.getByLabelText('Légende')).toHaveAccessibleDescription('140 caractères maximum.')
  })

  it('marks the control invalid and announces the error', () => {
    render(
      <Field label="Légende" error="Légende trop longue.">
        {(control) => <TextInput {...control} />}
      </Field>,
    )

    expect(screen.getByLabelText('Légende')).toBeInvalid()
    expect(screen.getByRole('alert')).toHaveTextContent('Légende trop longue.')
  })

  it('describes the control with the hint and the error together', () => {
    render(
      <Field label="Légende" hint="140 caractères maximum." error="Légende trop longue.">
        {(control) => <TextInput {...control} />}
      </Field>,
    )

    // Both, in reading order: the format is context for the correction that follows.
    expect(screen.getByLabelText('Légende')).toHaveAccessibleDescription(
      '140 caractères maximum. Légende trop longue.',
    )
  })

  it('leaves the control undescribed and valid when there is nothing to say', () => {
    render(<Field label="Votre prénom">{(control) => <TextInput {...control} />}</Field>)

    const input = screen.getByLabelText('Votre prénom')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('says when a field can be skipped', () => {
    render(
      <Field label="Votre prénom" optional>
        {(control) => <TextInput {...control} />}
      </Field>,
    )

    expect(screen.getByLabelText(/Votre prénom/)).toBeInTheDocument()
    expect(screen.getByText('Facultatif')).toBeInTheDocument()
  })
})
