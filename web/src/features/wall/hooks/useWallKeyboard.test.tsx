import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useWallKeyboard } from './useWallKeyboard'

/**
 * The one input surface the wall has.
 *
 * The projector runs untouched for eight hours; the person who does touch it is a host
 * who wants to hold a photo while a speech happens, or skip past one, without opening
 * the admin console on another machine. Each binding below is that host's only way to
 * do the thing it names, so each gets its own test.
 *
 * The probe renders what the wall was asked to do, so every assertion is about the
 * hook's output rather than about a spy.
 */
function Probe() {
  const [done, setDone] = useState<readonly string[]>([])
  const record = (action: string) => setDone((previous) => [...previous, action])

  useWallKeyboard({
    onTogglePause: () => record('pause'),
    onStep: (step) => record(`pas ${step}`),
    onToggleFullscreen: () => record('plein écran'),
    onCycleLayout: () => record('disposition'),
    onToggleHelp: () => record('aide'),
    onDismiss: () => record('fermer'),
  })

  return (
    <div>
      <p>demandé {done.length === 0 ? 'rien' : done.join(', ')}</p>
      <button type="button">Masquer le rappel du code</button>
      <div contentEditable tabIndex={0} aria-label="Légende" suppressContentEditableWarning />
    </div>
  )
}

const asked = (): HTMLElement => screen.getByText(/^demandé /)

describe('useWallKeyboard', () => {
  it.each([
    { key: ' ', name: 'the space bar', action: 'pause' },
    { key: '{ArrowRight}', name: 'the right arrow', action: 'pas 1' },
    { key: '{ArrowDown}', name: 'the down arrow', action: 'pas 1' },
    { key: '{ArrowLeft}', name: 'the left arrow', action: 'pas -1' },
    { key: '{ArrowUp}', name: 'the up arrow', action: 'pas -1' },
    { key: '?', name: 'the question mark', action: 'aide' },
    { key: '{Escape}', name: 'Escape', action: 'fermer' },
    { key: 'f', name: 'F', action: 'plein écran' },
    { key: 'F', name: 'shifted F', action: 'plein écran' },
    { key: 'l', name: 'L', action: 'disposition' },
    { key: 'L', name: 'shifted L', action: 'disposition' },
  ])('answers $name with $action', async ({ key, action }) => {
    render(<Probe />)

    await userEvent.keyboard(key)

    expect(asked()).toHaveTextContent(`demandé ${action}`)
  })

  it('leaves a browser or system shortcut to the browser', async () => {
    render(<Probe />)

    await userEvent.keyboard('{Control>}{ArrowRight}{/Control}')

    // Ctrl+Right jumps a word, Alt+Left goes back, Cmd+F opens find. Skipping the
    // photo as well would make the projector's browser unusable for the host.
    expect(asked()).toHaveTextContent('demandé rien')
  })

  it('leaves the keys alone while a control the host is using has focus', async () => {
    render(<Probe />)
    screen.getByRole('button', { name: 'Masquer le rappel du code' }).focus()

    await userEvent.keyboard(' ')

    // Space activates the focused button — the shortcuts panel's close button, or the
    // join card's. Pausing the slideshow as well would make one keypress do two things.
    expect(asked()).toHaveTextContent('demandé rien')
  })

  it('leaves the keys alone while text is being edited', async () => {
    render(<Probe />)
    const editable = screen.getByLabelText('Légende')
    // jsdom implements no editing host, so `isContentEditable` is `false` there whatever
    // the attribute says. Standing in for it keeps this about the product's rule rather
    // than about jsdom's gap — the same category as the `EventSource` and `<dialog>`
    // shims in `web/src/testing/`.
    Object.defineProperty(editable, 'isContentEditable', { configurable: true, value: true })
    editable.focus()

    await userEvent.keyboard('{ArrowLeft}')

    // An arrow inside editable text moves the caret. Stepping the wall as well would
    // make one keypress do two unrelated things.
    expect(asked()).toHaveTextContent('demandé rien')
  })

  it('ignores a key it has no binding for', async () => {
    render(<Probe />)

    await userEvent.keyboard('x')

    expect(asked()).toHaveTextContent('demandé rien')
  })

  it('stops listening once the wall is gone', async () => {
    const { unmount } = render(<Probe />)

    unmount()
    await userEvent.keyboard(' ')

    // A window listener left behind by a page that has been navigated away from is how
    // an eight-hour session accumulates work it never gives back.
    expect(screen.queryByText(/^demandé /)).toBeNull()
  })
})
