import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { TextInput } from './TextInput'
import { installDialogStub } from '../../testing/dialogStub'
import { fr } from '../../lib/i18n/fr'

installDialogStub()

const TITLE = 'Supprimer cette photo ?'

interface HarnessProps {
  readonly dismissible?: boolean
}

const Harness = ({ dismissible = true }: HarnessProps) => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Ouvrir</Button>
      <Dialog
        open={open}
        title={TITLE}
        description="Elle disparaîtra de l’écran et ne pourra pas être récupérée."
        onClose={() => setOpen(false)}
        dismissible={dismissible}
      >
        <TextInput aria-label="Motif" />
      </Dialog>
    </>
  )
}

/** The same harness, but pointing initial focus at the input instead of the header. */
const InitialFocusHarness = () => {
  const [isOpen, setOpen] = useState(false)
  const motifRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Ouvrir</Button>
      <Dialog open={isOpen} title={TITLE} onClose={() => setOpen(false)} initialFocusRef={motifRef}>
        <TextInput aria-label="Motif" ref={motifRef} />
      </Dialog>
    </>
  )
}

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }))
}

describe('Dialog', () => {
  it('is absent until it is opened', () => {
    render(<Harness />)

    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('is named by its title and described by its consequence', async () => {
    render(<Harness />)

    await open()

    const dialog = screen.getByRole('dialog', { name: TITLE })
    expect(dialog).toHaveAccessibleDescription(
      'Elle disparaîtra de l’écran et ne pourra pas être récupérée.',
    )
  })

  it('moves focus into itself when it opens', async () => {
    render(<Harness />)

    await open()

    expect(screen.getByRole('button', { name: fr.ui.dialogClose })).toHaveFocus()
  })

  it('gives focus back to the control that opened it', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Ouvrir' })

    await open()
    await userEvent.keyboard('{Escape}')

    // Without this the next Tab restarts at the top of the document, which on the
    // moderation console means scrolling back to the tile the host was working on.
    expect(trigger).toHaveFocus()
  })

  it('closes on Escape', async () => {
    render(<Harness />)

    await open()
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('closes on Escape even when it is not dismissible', async () => {
    render(<Harness dismissible={false} />)

    await open()
    await userEvent.keyboard('{Escape}')

    // Trapping somebody in a modal is worse than a decision they can retake.
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('closes on a click outside the panel when it is dismissible', async () => {
    render(<Harness />)

    await open()
    await userEvent.click(screen.getByRole('dialog'))

    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('ignores a click outside the panel when it is not dismissible', async () => {
    render(<Harness dismissible={false} />)

    await open()
    await userEvent.click(screen.getByRole('dialog'))

    // A stray tap beside the panel must not throw away a half-typed answer.
    expect(screen.getByText(TITLE)).toBeVisible()
  })

  it('offers no close button when it is not dismissible', async () => {
    render(<Harness dismissible={false} />)

    await open()

    expect(screen.queryByRole('button', { name: fr.ui.dialogClose })).toBeNull()
  })

  it('closes from its close button', async () => {
    render(<Harness />)

    await open()
    await userEvent.click(screen.getByRole('button', { name: fr.ui.dialogClose }))

    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('keeps Tab inside itself', async () => {
    render(<Harness />)

    await open()
    const close = screen.getByRole('button', { name: fr.ui.dialogClose })
    const input = screen.getByLabelText('Motif')

    input.focus()
    await userEvent.tab()

    // The last focusable wraps to the first instead of landing on the trigger behind
    // the backdrop, which in jsdom has no top layer to hide it.
    expect(close).toHaveFocus()
  })

  it('keeps Shift+Tab inside itself', async () => {
    render(<Harness />)

    await open()
    const close = screen.getByRole('button', { name: fr.ui.dialogClose })
    const input = screen.getByLabelText('Motif')

    close.focus()
    await userEvent.tab({ shift: true })

    expect(input).toHaveFocus()
  })

  it('honours an explicit initial focus', async () => {
    render(<InitialFocusHarness />)

    await open()

    expect(screen.getByLabelText('Motif')).toHaveFocus()
  })

  it('reports a native close back to the caller', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open title={TITLE} onClose={onClose}>
        <p>Corps</p>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInstanceOf(HTMLDialogElement)
    if (dialog instanceof HTMLDialogElement) dialog.close()

    // A `<form method="dialog">` closes the element behind React's back; syncing here
    // is what stops the DOM and the state disagreeing.
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
