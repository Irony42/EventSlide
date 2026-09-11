import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

/** A harness whose initial focus target changes while the dialog is already open. */
const MovingFocusHarness = () => {
  const [isOpen, setOpen] = useState(false)
  const [aim, setAim] = useState<'motif' | 'note'>('motif')
  const motifRef = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Ouvrir</Button>
      <Dialog
        open={isOpen}
        title={TITLE}
        onClose={() => setOpen(false)}
        initialFocusRef={aim === 'motif' ? motifRef : noteRef}
      >
        <TextInput aria-label="Motif" ref={motifRef} />
        <TextInput aria-label="Note" ref={noteRef} />
        <Button onClick={() => setAim('note')}>Viser la note</Button>
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

  it('lets Tab move between its own controls without interfering', async () => {
    render(<Harness />)

    await open()
    const close = screen.getByRole('button', { name: fr.ui.dialogClose })
    const input = screen.getByLabelText('Motif')

    close.focus()
    await userEvent.tab()

    // Only the two edges wrap. Taking over a Tab in the middle would stop a host moving
    // through a form the normal way.
    expect(input).toHaveFocus()
  })

  it('still remembers who opened it after its focus target moves', async () => {
    render(<MovingFocusHarness />)
    const trigger = screen.getByRole('button', { name: 'Ouvrir' })

    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Viser la note' }))
    expect(screen.getByLabelText('Note')).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    // The opener is captured once, when the dialog actually opens. Capturing it again
    // on every re-run would record a control inside the dialog, and closing would then
    // hand focus to an element that no longer exists.
    expect(trigger).toHaveFocus()
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

  it('answers the browser’s own dismiss gesture without closing behind React’s back', () => {
    const onClose = vi.fn()
    render(
      <Dialog open title={TITLE} onClose={onClose}>
        <p>Corps</p>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')

    const notPrevented = fireEvent(dialog, new Event('cancel', { cancelable: true }))

    // The native gesture is intercepted rather than allowed through: an element closed
    // under an `open` prop is a dialog React can never reopen, because its state never
    // learned it had gone.
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(notPrevented).toBe(false)
    expect(dialog).toHaveAttribute('open')
  })

  it('does not echo a close back to the caller when React was the one that closed it', async () => {
    const onClose = vi.fn()
    const Controlled = ({ open: isOpen }: { readonly open: boolean }) => (
      <Dialog open={isOpen} title={TITLE} onClose={onClose}>
        <p>Corps</p>
      </Dialog>
    )
    const { rerender } = render(<Controlled open />)

    rerender(<Controlled open={false} />)

    // Closing the element emits a native `close` event. Reporting that back would hand
    // the caller a close it asked for — a loop for any parent that toggles on `onClose`.
    // The listener exists only while `open` is true, which is why it can close over
    // `open` instead of reading a ref written during render.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('opens even when it holds nothing focusable', () => {
    render(<Dialog open title={TITLE} onClose={vi.fn()} dismissible={false} />)

    // With no focusable child and no fallback target, the open effect would call focus()
    // on nothing and take the whole screen down with it.
    expect(screen.getByText(TITLE)).toBeVisible()
  })

  it('leaves Tab alone when it holds nothing focusable', () => {
    const onClose = vi.fn()
    render(<Dialog open title={TITLE} onClose={onClose} dismissible={false} />)
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Tab' })

    // Nothing to wrap to, so the trap declines rather than guessing: the dialog stays
    // open and the keypress is the browser's to answer.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(TITLE)).toBeVisible()
  })
})
