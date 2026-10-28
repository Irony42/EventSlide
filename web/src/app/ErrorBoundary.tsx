import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../design-system/components/Button'
import {
  isChunkLoadError,
  pageReload,
  reloadForStaleBundle,
  surfaceOfPath,
  WALL_RETRY_DELAY_MS,
  type CrashSurface,
} from '../lib/crashRecovery'
import { localeContext, type LocaleState } from '../lib/i18n/localeContext'
import styles from './ErrorBoundary.module.css'

export interface ErrorBoundaryProps {
  readonly children: ReactNode
  /** Ran alongside the internal reset, for a caller that must also refetch. */
  readonly onReset?: () => void
  /**
   * Whose screen this covers, which decides two things: the link home (the guest's start, the
   * host's `/admin`, **nothing** on the wall) and whether the boundary tries again by itself
   * (the wall does, after `WALL_RETRY_DELAY_MS`, because nobody is in front of the projector).
   * Left out, it is read from the address, which is what the boundary above the router needs.
   */
  readonly surface?: CrashSurface
  /**
   * When this value changes, a crash is cleared and the tree is rendered again.
   *
   * Layouts pass the pathname, so Back from a screen that crashed lands on a screen that
   * renders instead of on the crash screen, which used to outlive the navigation.
   * Left out, nothing resets the boundary but its own retry.
   */
  readonly resetKey?: string
}

interface ErrorBoundaryState {
  readonly error: Error | null
  /** The `resetKey` this state was last reconciled with. */
  readonly trackedKey: string | undefined
}

/**
 * The last line of defence against a white screen.
 *
 * The wall runs unattended for eight hours on a projector. A render error at 1 a.m.
 * with nobody at the laptop is a black rectangle for the rest of the party, so the
 * boundary always shows what happened and a way back — never a blank page, and never
 * the error text itself, which would put a stack trace on a wall in front of guests.
 *
 * A class component because that is still the only way to catch a render error in
 * React: there is no hook equivalent.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /**
   * `contextType` rather than `useTranslations`, because a class cannot call a hook and
   * only a class can catch a render error.
   *
   * It is worth the ceremony: this boundary sits above the router, so it is the one
   * screen a guest can reach that no layout is responsible for, and a guest whose phone
   * has just shown them a crash is exactly the person who should be told "nothing is
   * lost" in a language they read.
   */
  static override contextType = localeContext
  declare context: LocaleState

  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null, trackedKey: props.resetKey }
  }

  private retryTimer: ReturnType<typeof setTimeout> | null = null

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  /** A new `resetKey` is a new place: whatever crashed in the old one does not follow. */
  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey === state.trackedKey) return null
    return { error: null, trackedKey: props.resetKey }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only sink available in the browser, and it is what a host is
    // asked to copy when they report a problem.
    console.error('EventSlide render error', error, info.componentStack)

    // A lazy chunk that is gone after a deploy: only a new document fixes it, and doing it
    // once, now, is what the host would have done by hand. The guard inside refuses a second
    // reload within a minute, so a build that is broken for real ends on the crash screen.
    if (isChunkLoadError(error) && reloadForStaleBundle()) return

    if (this.surface() === 'wall') this.scheduleRetry()
  }

  override componentDidUpdate(_previous: ErrorBoundaryProps, previousState: ErrorBoundaryState) {
    if (previousState.error !== null && this.state.error === null) this.clearRetry()
  }

  override componentWillUnmount(): void {
    this.clearRetry()
  }

  private surface(): CrashSurface {
    return this.props.surface ?? surfaceOfPath(window.location.pathname)
  }

  private clearRetry(): void {
    if (this.retryTimer === null) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  /** The wall's own "Réessayer", pressed after a delay by nobody. */
  private scheduleRetry(): void {
    this.clearRetry()
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.handleReset()
    }, WALL_RETRY_DELAY_MS)
  }

  private readonly handleReset = () => {
    this.clearRetry()
    // `React.lazy` keeps a rejected import for the life of the page, so rendering again would
    // throw the same error at once. A chunk that did not load needs a new document.
    if (this.state.error !== null && isChunkLoadError(this.state.error)) {
      pageReload.reload()
      return
    }
    this.setState({ error: null })
    this.props.onReset?.()
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children

    const { text } = this.context
    const surface = this.surface()

    return (
      <div className={styles['boundary']}>
        <div className={styles['panel']} role="alert">
          <h1 className={styles['title']}>{text.shell.crashTitle}</h1>
          <p className={styles['hint']}>{text.shell.crashHint}</p>
          {surface === 'wall' ? (
            <p className={styles['hint']}>{text.shell.crashAutoRetry}</p>
          ) : null}
          <Button variant="primary" onClick={this.handleReset}>
            {text.app.retry}
          </Button>
          {/* A plain anchor and not a router link: this boundary also sits above the router,
              and a full load is the right way home from a screen that just failed. Nothing on
              the wall, where nobody is meant to press anything. */}
          {surface === 'wall' ? null : (
            <a className={styles['home']} href={surface === 'host' ? '/admin' : '/'}>
              {surface === 'host' ? text.shell.hostHome : text.shell.notFoundHome}
            </a>
          )}
        </div>
      </div>
    )
  }
}
