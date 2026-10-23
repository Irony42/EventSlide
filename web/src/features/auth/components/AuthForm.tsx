import type { FormEvent, ReactNode } from 'react'
import { Button } from '../../../design-system/components/Button'
import { StatusIcon } from '../../../design-system/components/StatusIcon'
import { AuthPage } from './AuthPage'
import styles from './AuthForm.module.css'

export interface AuthFormProps {
  readonly title: string
  readonly intro?: string
  /** See {@link AuthPage}: for a form that appears in answer to something. */
  readonly focusTitle?: boolean
  /**
   * The whole-form failure, already a sentence in the reader's language. `null` while
   * there is nothing to say.
   */
  readonly error: string | null
  readonly submitting: boolean
  readonly submitLabel: string
  readonly onSubmit: () => void
  /** The fields. Each one brings its own `Field` so the label wiring stays local. */
  readonly children: ReactNode
  readonly footer?: ReactNode
}

/**
 * A failure the reader has to be told about, announced when it appears.
 *
 * Mounted only when there is something to say: inserting a `role="alert"` node is what
 * every current screen reader announces, and an always-present empty alert would make
 * `getByRole('alert')` ambiguous for the rest of the page.
 */
export function AuthAlert({ children }: { readonly children: ReactNode }) {
  return (
    <p className={styles['alert']} role="alert">
      <span className={styles['alertGlyph']}>
        <StatusIcon tone="danger" />
      </span>
      {children}
    </p>
  )
}

/**
 * The shell both auth screens share: heading, real `<form>`, one failure region.
 *
 * A real form element rather than a button with a click handler, so <kbd>Enter</kbd>
 * in either field submits — a host signing in at a venue types their password and
 * presses Enter without looking, and 1.0's login was a `div` with an `onClick`.
 */
export function AuthForm({
  title,
  intro,
  focusTitle = false,
  error,
  submitting,
  submitLabel,
  onSubmit,
  children,
  footer,
}: AuthFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <AuthPage title={title} {...(intro === undefined ? {} : { intro })} focusTitle={focusTitle}>
      <form className={styles['form']} onSubmit={handleSubmit} noValidate>
        {children}

        {/*
          Mounted only when there is a failure: inserting a role="alert" node is what
          every current screen reader announces, and an always-present empty alert
          would make getByRole('alert') ambiguous for the rest of the page.
        */}
        {error === null ? null : <AuthAlert>{error}</AuthAlert>}

        <div className={styles['actions']}>
          <Button type="submit" variant="primary" loading={submitting}>
            {submitLabel}
          </Button>
          {footer}
        </div>
      </form>
    </AuthPage>
  )
}
