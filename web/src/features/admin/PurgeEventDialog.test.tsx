import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PurgeEventDialog } from './PurgeEventDialog'
import { fr } from '../../lib/i18n/fr'
import { installDialogStub } from '../../testing/dialogStub'

// The component is a `<dialog>`; jsdom implements the element but none of its methods.
installDialogStub()

const renderDialog = (overrides: { onConfirm?: () => void; onCancel?: () => void } = {}) => {
  const onConfirm = overrides.onConfirm ?? vi.fn()
  const onCancel = overrides.onCancel ?? vi.fn()

  render(
    <PurgeEventDialog
      open
      slug="camille-et-sacha"
      eventName="Camille & Sacha"
      busy={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )

  return { onConfirm, onCancel }
}

const confirmButton = () => screen.getByRole('button', { name: fr.admin.purge })

describe('PurgeEventDialog', () => {
  it('says what will be destroyed and which event it is', () => {
    renderDialog()

    expect(screen.getByText(fr.admin.purgeWarning)).toBeVisible()
    expect(screen.getByText('Camille & Sacha')).toBeVisible()
    expect(screen.getByText(fr.admin.purgeConfirmHint('camille-et-sacha'))).toBeVisible()
  })

  it('refuses to delete until the address has been typed', async () => {
    const { onConfirm } = renderDialog()

    expect(confirmButton()).toBeDisabled()

    await userEvent.type(screen.getByLabelText(fr.admin.purgeConfirmLabel), 'camille')

    // A partial match is a host who is about to delete the wrong event: two tabs open,
    // two similar addresses.
    expect(confirmButton()).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('deletes once the address matches exactly', async () => {
    const { onConfirm } = renderDialog()

    await userEvent.type(screen.getByLabelText(fr.admin.purgeConfirmLabel), 'camille-et-sacha')
    await userEvent.click(confirmButton())

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('forgives the spaces a copy-paste brings with it', async () => {
    const { onConfirm } = renderDialog()

    await userEvent.type(screen.getByLabelText(fr.admin.purgeConfirmLabel), '  camille-et-sacha  ')
    await userEvent.click(confirmButton())

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('is not dismissed by a stray click beside the panel', async () => {
    const { onCancel } = renderDialog()

    // A backdrop click here would be a half-typed confirmation lost, and the dialog is
    // deliberately the one that has to be answered. Escape still works.
    expect(screen.queryByRole('button', { name: fr.ui.dialogClose })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
  it('empties the box on the way out, so a reopened dialog still has to be answered', async () => {
    renderDialog()
    await userEvent.type(screen.getByLabelText(fr.admin.purgeConfirmLabel), 'camille-et-sacha')

    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    // A confirmation that arrives pre-satisfied because the host typed the address,
    // cancelled, and came back is not a confirmation.
    expect(screen.getByLabelText(fr.admin.purgeConfirmLabel)).toHaveValue('')
    expect(confirmButton()).toBeDisabled()
  })
})
