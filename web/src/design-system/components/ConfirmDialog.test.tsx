import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog'
import { installDialogStub } from '../../testing/dialogStub'
import buttonStyles from './Button.module.css'
import { fr } from '../../lib/i18n/fr'
import { classesOf, cls } from '../../testing/classesOf'

installDialogStub()

const TITLE = 'Supprimer cette photo ?'
const CONSEQUENCE = 'Elle disparaîtra de l’écran et ne pourra pas être récupérée.'

const renderConfirm = ({ busy = false }: { readonly busy?: boolean } = {}) => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmDialog
      open
      title={TITLE}
      description={CONSEQUENCE}
      confirmLabel="Supprimer"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
  return { onConfirm, onCancel }
}

describe('ConfirmDialog', () => {
  it('states the consequence, not the filename', () => {
    renderConfirm()

    expect(screen.getByRole('dialog', { name: TITLE })).toHaveAccessibleDescription(CONSEQUENCE)
  })

  it('opens with focus on the safe choice', () => {
    renderConfirm()

    // A destructive dialog that opens with the destructive button focused turns a
    // reflexive Enter into a deleted photo.
    expect(screen.getByRole('button', { name: fr.app.cancel })).toHaveFocus()
  })

  it('confirms when the destructive action is chosen', async () => {
    const { onConfirm, onCancel } = renderConfirm()

    await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels from the cancel button', async () => {
    const { onConfirm, onCancel } = renderConfirm()

    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('treats Escape as a cancellation', async () => {
    const { onConfirm, onCancel } = renderConfirm()

    await userEvent.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps the confirm label while the request is in flight', () => {
    renderConfirm({ busy: true })

    // A spinner that replaced the label would announce nothing and would drop the
    // button out of the tab order at the moment the host is waiting on it.
    const confirm = screen.getByRole('button', { name: 'Supprimer' })
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    expect(confirm).toBeDisabled()
  })

  it('falls back to the shared confirm and cancel wording', () => {
    render(
      <ConfirmDialog open title="Clore l’évènement ?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )

    expect(screen.getByRole('button', { name: fr.app.confirm })).toBeVisible()
    expect(screen.getByRole('button', { name: fr.app.cancel })).toBeVisible()
  })

  it('confirms in the danger colour by default, because it exists for destructive acts', () => {
    renderConfirm()

    expect(classesOf(screen.getByRole('button', { name: 'Supprimer' }))).toContain(
      cls(buttonStyles, 'danger'),
    )
  })

  it('confirms in the primary colour for a commitment that is not a loss', () => {
    render(
      <ConfirmDialog
        open
        title="Ouvrir aux invités ?"
        confirmLabel="Ouvrir"
        confirmVariant="primary"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const confirm = screen.getByRole('button', { name: 'Ouvrir' })
    expect(classesOf(confirm)).toContain(cls(buttonStyles, 'primary'))
    expect(classesOf(confirm)).not.toContain(cls(buttonStyles, 'danger'))
  })
})
