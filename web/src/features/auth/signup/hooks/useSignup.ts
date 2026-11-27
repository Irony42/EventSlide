import { useCallback, useState } from 'react'
import type { SignupInput } from '../../../../lib/api/client'
import type { SignupPreviewDto } from '../../../../lib/api/dto'
import { ApiError } from '../../../../lib/http'
import { messageForError } from '../../../../lib/i18n/translations'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { useApi } from '../../../../lib/useApi'
import { useLoader } from '../../../../lib/useLoader'

/**
 * The two halves of signing up (spec 31): asking for an account, and confirming the address
 * with the mailed link.
 */

export interface RequestSignupState {
  /**
   * Resolves what the server said (`sent`, or `busy` when the whole box has reached its day),
   * or `null` when the request failed and `error` says why. `sent` says nothing about the
   * address: the answer is the same for a new one, a known one and one over its caps.
   */
  readonly submit: (input: SignupInput) => Promise<'sent' | 'busy' | null>
  readonly submitting: boolean
  readonly error: string | null
}

export const useRequestSignup = (): RequestSignupState => {
  const api = useApi()
  const t = useTranslations()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async (input: SignupInput): Promise<'sent' | 'busy' | null> => {
      setSubmitting(true)
      setError(null)
      try {
        return (await api.requestSignup(input)).status
      } catch (cause) {
        // `feature.unavailable` is about the box (signup is off), not about what was typed, so
        // it gets a sentence that says so rather than the generic one.
        setError(
          cause instanceof ApiError && cause.code === 'feature.unavailable'
            ? t.signup.unavailable
            : messageForError(cause, t),
        )
        return null
      } finally {
        setSubmitting(false)
      }
    },
    [api, t],
  )

  return { submit, submitting, error }
}

export interface SignupConfirmationState {
  /** What the link is, read without spending it; `null` until it has been read. */
  readonly preview: SignupPreviewDto | null
  readonly loading: boolean
  /** A sentence, when the link could not be read at all (a dropped connection, signup off). */
  readonly loadError: string | null
  readonly reload: () => void
  /** Spends the link. Resolves what comes next, or `null` when it failed and `error` says why. */
  readonly confirm: () => Promise<'review' | 'mail' | null>
  readonly confirming: boolean
  readonly error: string | null
}

/**
 * The confirmation link in front of the reader. **Reading it spends nothing**: a mail client's
 * antivirus opens links before the person does, so only {@link SignupConfirmationState.confirm},
 * which the page calls from a button, writes anything.
 */
export const useSignupConfirmation = (token: string): SignupConfirmationState => {
  const api = useApi()
  const t = useTranslations()
  const read = useCallback((signal: AbortSignal) => api.signupPreview(token, signal), [api, token])
  const { data, loading, error: loadError, reload } = useLoader(read)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = useCallback(async (): Promise<'review' | 'mail' | null> => {
    setConfirming(true)
    setError(null)
    try {
      return (await api.confirmSignup(token)).next
    } catch (cause) {
      setError(messageForError(cause, t))
      return null
    } finally {
      setConfirming(false)
    }
  }, [api, t, token])

  return { preview: data, loading, loadError, reload, confirm, confirming, error }
}
