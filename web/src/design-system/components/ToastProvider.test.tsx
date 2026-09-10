import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'
import { ToastProvider, useToast, type ToastOptions } from './ToastProvider'
import { fr } from '../../lib/i18n/fr'

interface HarnessProps {
  readonly message?: string
  readonly options?: ToastOptions
}

const Harness = ({ message = 'Photo publiée.', options }: HarnessProps) => {
  const { show } = useToast()
  return <Button onClick={() => show(message, options)}>Déclencher</Button>
}

const renderHarness = (props: HarnessProps = {}) =>
  render(
    <ToastProvider>
      <Harness {...props} />
    </ToastProvider>,
  )

const trigger = () => screen.getByRole('button', { name: 'Déclencher' })

describe('ToastProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('announces a notice politely', async () => {
    renderHarness()

    await userEvent.click(trigger())

    const toast = screen.getByText('Photo publiée.')
    expect(toast).toBeVisible()
    expect(toast.closest('[aria-live="polite"]')).not.toBeNull()
  })

  it('reports a failure as an alert', async () => {
    renderHarness({
      message: 'Connexion interrompue. Vérifiez votre réseau puis réessayez.',
      options: { tone: 'danger' },
    })

    await userEvent.click(trigger())

    expect(screen.getByRole('alert')).toHaveTextContent('Connexion interrompue.')
  })

  it('presents no empty alert before anything has failed', () => {
    renderHarness()

    // An always-mounted empty alert region would make `getByRole('alert')` ambiguous
    // in every screen test, and would announce nothing anyway.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('can be dismissed by hand', async () => {
    renderHarness()

    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('button', { name: fr.ui.dismissNotification }))

    expect(screen.queryByText('Photo publiée.')).toBeNull()
  })

  it('clears a notice on its own after a few seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    renderHarness()

    await user.click(trigger())
    expect(screen.getByText('Photo publiée.')).toBeVisible()

    act(() => {
      vi.advanceTimersByTime(4_000)
    })

    expect(screen.queryByText('Photo publiée.')).toBeNull()
  })

  it('keeps an undo reachable for its whole window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    const onAction = vi.fn()
    renderHarness({
      message: 'Photo refusée.',
      options: { tone: 'success', action: { label: fr.moderation.undo, onAction } },
    })

    await user.click(trigger())

    // The host looks up at the projector to check the decision, then looks back. A
    // toast that had already gone would make the undo a lie.
    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    expect(screen.getByRole('button', { name: fr.moderation.undo })).toBeVisible()

    await user.click(screen.getByRole('button', { name: fr.moderation.undo }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('lets an undo window outlast a shorter duration asked for by the caller', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    renderHarness({
      message: 'Photo refusée.',
      options: { durationMs: 500, action: { label: fr.moderation.undo, onAction: vi.fn() } },
    })

    await user.click(trigger())
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByRole('button', { name: fr.moderation.undo })).toBeVisible()
  })

  it('pins a toast asked to stay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    renderHarness({ options: { durationMs: 0 } })

    await user.click(trigger())
    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(screen.getByText('Photo publiée.')).toBeVisible()
  })

  it('clears its pending timers when the tree unmounts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    const { unmount } = renderHarness()

    await user.click(trigger())
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    // Navigating away from the moderation console with an undo still counting down
    // otherwise leaves a timer holding a setState on an unmounted provider.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stacks several messages without losing any', async () => {
    renderHarness()

    await userEvent.click(trigger())
    await userEvent.click(trigger())

    expect(screen.getAllByText('Photo publiée.')).toHaveLength(2)
  })

  it('refuses to be used outside a provider', () => {
    const failure = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Harness />)).toThrow(/ToastProvider/)

    failure.mockRestore()
  })
})
