import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from './ErrorBoundary'
import {
  pageReload,
  STALE_BUNDLE_MARKER,
  STALE_BUNDLE_WINDOW_MS,
  WALL_RETRY_DELAY_MS,
} from '../lib/crashRecovery'
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

/** A child that fails the way a lazy chunk does after a deploy. */
const StaleChunk = (): never => {
  throw new Error('Failed to fetch dynamically imported module: /assets/WallPage-8c1d04.js')
}

describe('ErrorBoundary: a chunk that failed to load after a deploy', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('reloads the page once by itself, because only a new document can fetch the new chunks', () => {
    const log = silenceReactErrorLog()
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})

    render(
      <ErrorBoundary surface="host">
        <StaleChunk />
      </ErrorBoundary>,
    )

    expect(reload).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })

  it('does not reload a second time within a minute: a loop would be worse than the crash screen', () => {
    const log = silenceReactErrorLog()
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})
    sessionStorage.setItem(STALE_BUNDLE_MARKER, String(Date.now()))

    render(
      <ErrorBoundary surface="host">
        <StaleChunk />
      </ErrorBoundary>,
    )

    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(fr.shell.crashTitle)
    log.mockRestore()
  })

  it('reloads the page, and does not re-render the tree, when Réessayer is pressed on it', async () => {
    const log = silenceReactErrorLog()
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})
    sessionStorage.setItem(STALE_BUNDLE_MARKER, String(Date.now()))
    render(
      <ErrorBoundary surface="host">
        <StaleChunk />
      </ErrorBoundary>,
    )

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    // React.lazy keeps a rejected import, so a plain re-render would throw the same error.
    expect(reload).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })

  it('does not reload for an ordinary render error', () => {
    const log = silenceReactErrorLog()
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})

    render(
      <ErrorBoundary surface="host">
        <Boom fail />
      </ErrorBoundary>,
    )

    expect(reload).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('ErrorBoundary: the way home fits the audience', () => {
  it('offers the guest the start of the app', () => {
    const log = silenceReactErrorLog()

    render(
      <ErrorBoundary surface="guest">
        <Boom fail />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('link', { name: fr.shell.notFoundHome })).toHaveAttribute('href', '/')
    log.mockRestore()
  })

  it('offers the host their events, not the guest screen', () => {
    const log = silenceReactErrorLog()

    render(
      <ErrorBoundary surface="host">
        <Boom fail />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('link', { name: fr.shell.hostHome })).toHaveAttribute('href', '/admin')
    expect(screen.queryByRole('link', { name: fr.shell.notFoundHome })).toBeNull()
    log.mockRestore()
  })

  it('offers nothing on the wall: a guest must not be able to drop the projector', () => {
    const log = silenceReactErrorLog()

    render(
      <ErrorBoundary surface="wall">
        <Boom fail />
      </ErrorBoundary>,
    )

    expect(screen.queryByRole('link')).toBeNull()
    log.mockRestore()
  })

  it('reads the audience from the address when no layout says', () => {
    const log = silenceReactErrorLog()
    window.history.pushState({}, '', '/admin/events/mariage')

    render(
      <ErrorBoundary>
        <Boom fail />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('link', { name: fr.shell.hostHome })).toBeVisible()
    window.history.pushState({}, '', '/')
    log.mockRestore()
  })
})

describe('ErrorBoundary: a crash does not outlive the page it happened on', () => {
  it('renders the tree again when the reset key changes, as it does after Back', () => {
    const log = silenceReactErrorLog()
    const { rerender } = render(
      <ErrorBoundary surface="host" resetKey="/admin/events/mariage">
        <Boom fail />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeVisible()

    rerender(
      <ErrorBoundary surface="host" resetKey="/admin">
        <Boom fail={false} />
      </ErrorBoundary>,
    )

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Diaporama')).toBeVisible()
    log.mockRestore()
  })

  it('stays on the crash screen while the reset key is the same', () => {
    const log = silenceReactErrorLog()
    const { rerender } = render(
      <ErrorBoundary surface="host" resetKey="/admin/events/mariage">
        <Boom fail />
      </ErrorBoundary>,
    )

    rerender(
      <ErrorBoundary surface="host" resetKey="/admin/events/mariage">
        <Boom fail={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeVisible()
    log.mockRestore()
  })
})

describe('ErrorBoundary: the wall tries again by itself', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** Fails while `crashes.on` is true, so the test decides when the cause goes away. */
  const crashes = { on: true }
  const Flaky = () => {
    if (crashes.on) throw new Error('canvas: out of memory')
    return <p>Diaporama</p>
  }

  it('renders the wall again after the delay, with nobody pressing anything', () => {
    const log = silenceReactErrorLog()
    crashes.on = true
    render(
      <ErrorBoundary surface="wall">
        <Flaky />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(fr.shell.crashTitle)

    crashes.on = false
    act(() => {
      vi.advanceTimersByTime(WALL_RETRY_DELAY_MS)
    })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Diaporama')).toBeVisible()
    log.mockRestore()
  })

  it('does not retry before the delay has passed', () => {
    const log = silenceReactErrorLog()
    crashes.on = true
    render(
      <ErrorBoundary surface="wall">
        <Flaky />
      </ErrorBoundary>,
    )

    crashes.on = false
    act(() => {
      vi.advanceTimersByTime(WALL_RETRY_DELAY_MS - 1)
    })

    expect(screen.getByRole('alert')).toBeVisible()
    log.mockRestore()
  })

  it('keeps trying while the cause persists, and recovers on a later attempt', () => {
    const log = silenceReactErrorLog()
    crashes.on = true
    render(
      <ErrorBoundary surface="wall">
        <Flaky />
      </ErrorBoundary>,
    )

    act(() => {
      vi.advanceTimersByTime(WALL_RETRY_DELAY_MS)
    })
    expect(screen.getByRole('alert')).toBeVisible()

    crashes.on = false
    act(() => {
      vi.advanceTimersByTime(WALL_RETRY_DELAY_MS)
    })

    expect(screen.getByText('Diaporama')).toBeVisible()
    log.mockRestore()
  })

  it('says on screen that it will try again', () => {
    const log = silenceReactErrorLog()
    crashes.on = true

    render(
      <ErrorBoundary surface="wall">
        <Flaky />
      </ErrorBoundary>,
    )

    expect(screen.getByText(fr.shell.crashAutoRetry)).toBeVisible()
    log.mockRestore()
  })

  it('leaves a host screen waiting for the person to press Réessayer', () => {
    const log = silenceReactErrorLog()
    crashes.on = true
    render(
      <ErrorBoundary surface="host">
        <Flaky />
      </ErrorBoundary>,
    )

    crashes.on = false
    act(() => {
      vi.advanceTimersByTime(WALL_RETRY_DELAY_MS * 3)
    })

    expect(screen.getByRole('alert')).toBeVisible()
    log.mockRestore()
  })

  it('reloads a wall whose chunk is gone only when the loop guard allows it, never sooner', async () => {
    const log = silenceReactErrorLog()
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )
    // A reload a moment ago already failed to cure it: the guard refuses for a minute.
    sessionStorage.setItem(STALE_BUNDLE_MARKER, String(Date.now()))
    render(
      <ErrorBoundary surface="wall">
        <StaleChunk />
      </ErrorBoundary>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_BUNDLE_WINDOW_MS - 1)
    })
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WALL_RETRY_DELAY_MS)
    })
    expect(reload).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })

  it('does not reload a wall while the server cannot be reached, and keeps asking', async () => {
    const log = silenceReactErrorLog()
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})
    const server = { up: false }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (!server.up) throw new TypeError('Failed to fetch')
        return new Response(null, { status: 200 })
      }),
    )
    // A reload 40 s ago did not cure it, so the guard still refuses at the first attempts and the
    // server being down is what holds the reload back once the minute has passed.
    sessionStorage.setItem(
      STALE_BUNDLE_MARKER,
      String(Date.now() - (STALE_BUNDLE_WINDOW_MS - 20_000)),
    )
    render(
      <ErrorBoundary surface="wall">
        <StaleChunk />
      </ErrorBoundary>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WALL_RETRY_DELAY_MS * 2)
    })
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeVisible()

    server.up = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WALL_RETRY_DELAY_MS)
    })
    expect(reload).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })

  it('stops the timer when the wall goes away', () => {
    const log = silenceReactErrorLog()
    crashes.on = true
    const { unmount } = render(
      <ErrorBoundary surface="wall">
        <Flaky />
      </ErrorBoundary>,
    )

    unmount()

    expect(vi.getTimerCount()).toBe(0)
    log.mockRestore()
  })
})
