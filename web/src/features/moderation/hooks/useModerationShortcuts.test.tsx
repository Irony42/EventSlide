import { describe, expect, it, vi, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useModerationShortcuts, type ModerationShortcutHandlers } from './useModerationShortcuts'

/**
 * The shortcuts are asserted through a harness with the elements that actually sit on
 * a host's screen — a caption field, a selection checkbox, an ordinary button —
 * because every interesting rule here is about *where* the keystroke happened.
 */

type Handlers = { readonly [K in keyof ModerationShortcutHandlers]: Mock<() => void> }

const makeHandlers = (): Handlers => ({
  onNext: vi.fn<() => void>(),
  onPrevious: vi.fn<() => void>(),
  onPublish: vi.fn<() => void>(),
  onReject: vi.fn<() => void>(),
  onHide: vi.fn<() => void>(),
  onUndo: vi.fn<() => void>(),
  onToggleSelect: vi.fn<() => void>(),
  onClear: vi.fn<() => void>(),
})

interface HarnessProps {
  readonly handlers: ModerationShortcutHandlers
  readonly enabled?: boolean
  /** Stands in for the lightbox: a subtree that claims the key before it reaches us. */
  readonly claimKeys?: boolean
}

const Harness = ({ handlers, enabled = true, claimKeys = false }: HarnessProps) => {
  useModerationShortcuts(handlers, { enabled })

  return (
    <div onKeyDown={claimKeys ? (event) => event.preventDefault() : undefined}>
      <label htmlFor="caption">Légende</label>
      <input id="caption" type="text" />
      <label htmlFor="note">Note</label>
      <textarea id="note" />
      <input type="checkbox" aria-label="Sélectionner la photo de Léa" />
      <button type="button">Ouvrir</button>
    </div>
  )
}

describe('useModerationShortcuts', () => {
  it.each([
    ['j', 'onNext'],
    ['k', 'onPrevious'],
    ['p', 'onPublish'],
    ['r', 'onReject'],
    ['h', 'onHide'],
    ['z', 'onUndo'],
  ] as const)('runs %s as %s', async (key, handler) => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    await userEvent.keyboard(key)

    expect(handlers[handler]).toHaveBeenCalledTimes(1)
  })

  it('runs an uppercase key too, so Caps Lock does not disarm the console', async () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    await userEvent.keyboard('P')

    expect(handlers.onPublish).toHaveBeenCalledTimes(1)
  })

  it('selects the focused photo on Space', async () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    await userEvent.keyboard(' ')

    expect(handlers.onToggleSelect).toHaveBeenCalledTimes(1)
  })

  it('drops the selection on Escape', async () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    await userEvent.keyboard('{Escape}')

    expect(handlers.onClear).toHaveBeenCalledTimes(1)
  })

  it('stays out of the way while a caption is being typed', async () => {
    // The defect this prevents: typing "photo" into a text field would publish, hide,
    // refuse and navigate — four decisions from one word.
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    await userEvent.click(screen.getByLabelText('Légende'))
    await userEvent.keyboard('photo')

    expect(handlers.onPublish).not.toHaveBeenCalled()
    expect(handlers.onHide).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Légende')).toHaveValue('photo')
  })

  it('stays out of the way in a multi-line field', async () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    await userEvent.click(screen.getByLabelText('Note'))
    await userEvent.keyboard('rejet')

    expect(handlers.onReject).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Note')).toHaveValue('rejet')
  })

  it('still works when the focus is on a selection checkbox', async () => {
    // A checkbox is an input, but it takes no typing — and tabbing through tiles must
    // not silently disarm the keyboard the host is working with.
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    screen.getByRole('checkbox').focus()
    await userEvent.keyboard('p')

    expect(handlers.onPublish).toHaveBeenCalledTimes(1)
  })

  it('leaves Space to a focused checkbox, so a photo is not selected twice', async () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)
    const checkbox = screen.getByRole('checkbox')

    checkbox.focus()
    await userEvent.keyboard(' ')

    expect(handlers.onToggleSelect).not.toHaveBeenCalled()
    expect(checkbox).toBeChecked()
  })

  it('does nothing for a key it does not own', async () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    await userEvent.keyboard('x')

    expect(Object.values(handlers).every((handler) => handler.mock.calls.length === 0)).toBe(true)
  })

  it('leaves the browser its own shortcuts', async () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    await userEvent.keyboard('{Control>}p{/Control}')

    expect(handlers.onPublish).not.toHaveBeenCalled()
  })

  it('ignores a key another component already acted on', async () => {
    // Escape closing the lightbox must not also clear the selection behind it.
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} claimKeys />)

    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }))
    await userEvent.keyboard('{Escape}')

    expect(handlers.onClear).not.toHaveBeenCalled()
  })

  it('does not listen while a modal owns the keyboard', async () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} enabled={false} />)

    await userEvent.keyboard('p')

    expect(handlers.onPublish).not.toHaveBeenCalled()
  })

  it('stops listening once the console is gone', async () => {
    const handlers = makeHandlers()
    const { unmount } = render(<Harness handlers={handlers} />)

    unmount()
    await userEvent.keyboard('p')

    expect(handlers.onPublish).not.toHaveBeenCalled()
  })

  it('runs the handlers the console has now, not the ones it mounted with', async () => {
    // The handlers close over the queue, so they are new objects on every render. A
    // console that kept the first set would decide on a photo that has since left.
    const first = makeHandlers()
    const second = makeHandlers()
    const { rerender } = render(<Harness handlers={first} />)

    rerender(<Harness handlers={second} />)
    await userEvent.keyboard('p')

    expect(first.onPublish).not.toHaveBeenCalled()
    expect(second.onPublish).toHaveBeenCalledTimes(1)
  })
})
