import { useCallback, useState } from 'react'
import { useApi } from '../../../app/useApi'
import type { Locale } from '../../../lib/i18n/locale'
import { ApiError } from '../../../lib/http'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { messageForError } from '../../../lib/i18n/translations'

/**
 * The two halves of a forgotten password (G2-08 / P3-09, G2-10 / P3-11): asking for the
 * mailed link, and choosing the password with it.
 */

export interface RequestPasswordResetState {
  /** Resolves `true` when the server took the request, which says nothing about the address. */
  readonly submit: (email: string, locale: Locale) => Promise<boolean>
  readonly submitting: boolean
  readonly error: string | null
}

/**
 * Asks for the link. The answer is `202` for **every** address, so the page that reads this
 * has exactly one success to show, and this hook has no way to say whether the address was
 * known — which is the property, not a gap.
 *
 * The one refusal that is about the box and not the person is `feature.unavailable`: a server
 * with no mail relay cannot send a link to anybody. It gets a sentence that says so, because
 * the generic one ("this function is not available") leaves a person who followed a bookmark
 * with no idea whom to ask.
 */
export const useRequestPasswordReset = (): RequestPasswordResetState => {
  const api = useApi()
  const t = useTranslations()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async (email: string, locale: Locale): Promise<boolean> => {
      setSubmitting(true)
      setError(null)
      try {
        await api.requestPasswordReset(email, locale)
        return true
      } catch (cause) {
        setError(
          cause instanceof ApiError && cause.code === 'feature.unavailable'
            ? t.auth.forgotUnavailable
            : messageForError(cause, t),
        )
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [api, t],
  )

  return { submit, submitting, error }
}

/** What choosing a password with the link came to. */
export type ConfirmResetOutcome =
  | { readonly kind: 'done' }
  /** Never issued, expired, used, replaced, for another purpose or another account: one answer. */
  | { readonly kind: 'dead' }
  /** The password was refused. The link is **not** spent by that, so the form stays. */
  | { readonly kind: 'refused' }

export interface ConfirmPasswordResetState {
  readonly submit: (password: string) => Promise<ConfirmResetOutcome>
  readonly submitting: boolean
  readonly error: string | null
  /** For a page that stops the next attempt itself: the old verdict is about a password that has gone. */
  readonly clearError: () => void
}

export const useConfirmPasswordReset = (token: string): ConfirmPasswordResetState => {
  const api = useApi()
  const t = useTranslations()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clearError = useCallback(() => setError(null), [])

  const submit = useCallback(
    async (password: string): Promise<ConfirmResetOutcome> => {
      setSubmitting(true)
      setError(null)
      try {
        await api.confirmPasswordReset(token, password)
        return { kind: 'done' }
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 'auth.invalidToken') {
          return { kind: 'dead' }
        }
        // Length, "too common", "same as your name": the server judges, and its code picks the
        // sentence. Nothing is cleared — the link still works, and a person fixing one rule
        // should not retype the rest.
        setError(messageForError(cause, t))
        return { kind: 'refused' }
      } finally {
        setSubmitting(false)
      }
    },
    [api, t, token],
  )

  return { submit, submitting, error, clearError }
}
