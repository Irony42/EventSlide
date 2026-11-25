import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { SidePanel } from './SidePanel'

const render = (onClose = vi.fn(), focusOnMount = false) => {
  renderWithProviders(
    <SidePanel
      id="p"
      title="Réponses"
      onClose={onClose}
      focusOnMount={focusOnMount}
      footer={<span>pied</span>}
    >
      <button type="button">dedans</button>
    </SidePanel>,
  )
  return onClose
}

describe('a panel in place of the column', () => {
  it('is a region named by its title, with a Fermer button and a footer', () => {
    render()

    expect(screen.getByRole('region', { name: 'Réponses' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: 'Réponses' })).toBeVisible()
    expect(screen.getByText('pied')).toBeVisible()
  })

  it('closes on Fermer', async () => {
    const onClose = render()

    await userEvent.click(screen.getByRole('button', { name: fr.app.close }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape wherever the focus is', async () => {
    const onClose = render()

    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape to a dialog that is open', () => {
    const onClose = render()
    const dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.setAttribute('open', '')
    const inner = dialog.appendChild(document.createElement('button'))

    fireEvent.keyDown(inner, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    dialog.remove()
  })

  it('ignores the other keys', async () => {
    const onClose = render()

    await userEvent.keyboard('a{Enter}')

    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes the focus on its title when it was opened by the host', () => {
    render(vi.fn(), true)
    expect(screen.getByRole('heading', { name: 'Réponses' })).toHaveFocus()
  })

  it('leaves the focus alone when it was opened by a reload on its address', () => {
    render(vi.fn(), false)
    expect(screen.getByRole('heading', { name: 'Réponses' })).not.toHaveFocus()
  })
})
