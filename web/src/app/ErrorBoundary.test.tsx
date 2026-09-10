import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from './ErrorBoundary'
import { fr } from '../lib/i18n/fr'

/** A child that fails on demand, so the recovery path can actually be exercised. */
const Boom = ({ fail }: { readonly fail: boolean }) => {
  if (fail) throw new Error('sharp: unexpected end of stream')
  return <p>Diaporama</p>
}

const silenceReactErrorLog = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('ErrorBoundary', () => {
  it('renders its children while nothing fails', () => {
    render(
      <ErrorBoundary>
        <Boom fail={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Diaporama')).toBeVisible()
  })

  it('shows a way back instead of a blank screen', () => {
    const log = silenceReactErrorLog()

    render(
      <ErrorBoundary>
        <Boom fail />
      </ErrorBoundary>,
    )

    // The wall runs unattended for eight hours; a white rectangle at 1 a.m. is the
    // failure this exists to prevent.
    expect(screen.getByRole('alert')).toHaveTextContent(fr.shell.crashTitle)
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeVisible()
    log.mockRestore()
  })

  it('never puts the error text on the screen', () => {
    const log = silenceReactErrorLog()

    render(
      <ErrorBoundary>
        <Boom fail />
      </ErrorBoundary>,
    )

    // A stack trace projected in front of a room full of guests is its own incident.
    expect(screen.queryByText(/sharp/)).toBeNull()
    log.mockRestore()
  })

  it('renders the tree again when the recovery is taken', async () => {
    const log = silenceReactErrorLog()
    const { rerender } = render(
      <ErrorBoundary>
        <Boom fail />
      </ErrorBoundary>,
    )

    rerender(
      <ErrorBoundary>
        <Boom fail={false} />
      </ErrorBoundary>,
    )
    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(screen.getByText('Diaporama')).toBeVisible()
    log.mockRestore()
  })

  it('tells the caller a reset happened, so it can refetch as well', async () => {
    const log = silenceReactErrorLog()
    const onReset = vi.fn()
    const { rerender } = render(
      <ErrorBoundary onReset={onReset}>
        <Boom fail />
      </ErrorBoundary>,
    )

    rerender(
      <ErrorBoundary onReset={onReset}>
        <Boom fail={false} />
      </ErrorBoundary>,
    )
    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(onReset).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })
})
