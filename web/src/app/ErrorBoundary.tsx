import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../design-system/components/Button'
import { localeContext, type LocaleState } from '../lib/i18n/localeContext'
import styles from './ErrorBoundary.module.css'

export interface ErrorBoundaryProps {
  readonly children: ReactNode
  /** Ran alongside the internal reset, for a caller that must also refetch. */
  readonly onReset?: () => void
}

interface ErrorBoundaryState {
  readonly error: Error | null
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
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only sink available in the browser, and it is what a host is
    // asked to copy when they report a problem.
    console.error('EventSlide render error', error, info.componentStack)
  }

  private readonly handleReset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children

    const { text } = this.context

    return (
      <div className={styles['boundary']}>
        <div className={styles['panel']} role="alert">
          <h1 className={styles['title']}>{text.shell.crashTitle}</h1>
          <p className={styles['hint']}>{text.shell.crashHint}</p>
          <Button variant="primary" onClick={this.handleReset}>
            {text.app.retry}
          </Button>
        </div>
      </div>
    )
  }
}
