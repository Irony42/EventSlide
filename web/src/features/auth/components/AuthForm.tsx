import type { FormEvent, ReactNode } from 'react'
import { Button } from '../../../design-system/components/Button'
import { StatusIcon } from '../../../design-system/components/StatusIcon'
import styles from './AuthForm.module.css'

export interface AuthFormProps {
  readonly title: string
  readonly intro?: string
  /** The whole-form failure, already in French. `null` while there is nothing to say. */
  readonly error: string | null
  readonly submitting: boolean
  readonly submitLabel: string
  readonly onSubmit: () => void
  /** The fields. Each one brings its own `Field` so the label wiring stays local. */
  readonly children: ReactNode
  readonly footer?: ReactNode
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
    <div className={styles['page']}>
      <h1 className={styles['title']}>{title}</h1>
      {intro === undefined ? null : <p className={styles['intro']}>{intro}</p>}

      <form className={styles['form']} onSubmit={handleSubmit} noValidate>
        {children}

        {/*
          Mounted only when there is a failure: inserting a role="alert" node is what
          every current screen reader announces, and an always-present empty alert
          would make getByRole('alert') ambiguous for the rest of the page.
        */}
        {error === null ? null : (
          <p className={styles['alert']} role="alert">
            <span className={styles['alertGlyph']}>
              <StatusIcon tone="danger" />
            </span>
            {error}
          </p>
        )}

        <div className={styles['actions']}>
          <Button type="submit" variant="primary" loading={submitting}>
            {submitLabel}
          </Button>
          {footer}
        </div>
      </form>
    </div>
  )
}
