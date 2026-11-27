import { useCallback, useState } from 'react'
import type { SignupInput } from '../../../../lib/api/client'
import type { SignupConfirmedDto, SignupPreviewDto } from '../../../../lib/api/dto'
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
  /** A sentence, when the link could not be read at all (a dropped connection). */
  readonly loadError: string | null
  /** The box answered `404 feature.unavailable`: signup is off, whatever the link. */
  readonly unavailable: boolean
  readonly reload: () => void
  /** Spends the link. Resolves what comes next, or `null` when it failed and `error` says why. */
  readonly confirm: () => Promise<SignupConfirmedDto['next'] | null>
  readonly confirming: boolean
  readonly error: string | null
}

/** What the preview read comes to when the box has signup switched off. */
const UNAVAILABLE = { state: 'unavailable' } as const

const isUnavailable = (cause: unknown): boolean =>
  cause instanceof ApiError && cause.code === 'feature.unavailable'

/**
 * The confirmation link in front of the reader. **Reading it spends nothing**: a mail client's
 * antivirus opens links before the person does, so only {@link SignupConfirmationState.confirm},
 * which the page calls from a button, writes anything.
 *
 * A press that fails re-reads the link: if it died between the preview and the press (spent by
 * another tab, expired), the page then shows that screen instead of a generic alert.
 */
export const useSignupConfirmation = (token: string): SignupConfirmationState => {
  const api = useApi()
  const t = useTranslations()
  const read = useCallback(
    (signal: AbortSignal): Promise<SignupPreviewDto | typeof UNAVAILABLE> =>
      api.signupPreview(token, signal).catch((cause: unknown) => {
        if (isUnavailable(cause)) return UNAVAILABLE
        throw cause
      }),
    [api, token],
  )
  const { data, loading, error: loadError, reload } = useLoader(read)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = useCallback(async (): Promise<SignupConfirmedDto['next'] | null> => {
    setConfirming(true)
    setError(null)
    try {
      return (await api.confirmSignup(token)).next
    } catch (cause) {
      setError(isUnavailable(cause) ? t.signup.unavailable : messageForError(cause, t))
      // The link may have died since it was read: ask again, and let its state speak.
      if (!isUnavailable(cause)) reload()
      return null
    } finally {
      setConfirming(false)
    }
  }, [api, reload, t, token])

  const unavailable = data !== null && 'state' in data && data.state === 'unavailable'
  const preview = data === null || unavailable ? null : (data as SignupPreviewDto)

  return { preview, loading, loadError, unavailable, reload, confirm, confirming, error }
}
