import { useCallback, useState } from 'react'
import { useApi } from '../../../app/useApi'
import type { SecondFactorProof } from '../../../lib/api/dto'
import { ApiError } from '../../../lib/http'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { errorMessage } from '../errorMessage'

/**
 * The write actions of the auth surface, as view-state.
 *
 * They exist so the pages never touch the transport: the hook calls `useApi()`, which
 * is what lets a test hand the page a fake instead of a server.
 */

export interface Credentials {
  readonly email: string
  readonly password: string
}

export interface AuthActionState<T> {
  /** Resolves `true` when the server accepted; the page decides where to go next. */
  readonly submit: (input: T) => Promise<boolean>
  readonly submitting: boolean
  /**
   * A sentence in the language the reader chose, or `null`. Cleared when a new attempt
   * starts.
   */
  readonly error: string | null
}

/**
 * What a sign-in came to: in, refused, or — for an account with an authenticator — the
 * password was right and the server wants a code before it starts a session.
 */
export type LoginOutcome = 'signedIn' | 'secondFactor' | 'refused'

export interface LoginState {
  readonly submit: (input: Credentials) => Promise<LoginOutcome>
  readonly submitting: boolean
  readonly error: string | null
}

export const useLogin = (): LoginState => {
  const api = useApi()
  const t = useTranslations()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async ({ email, password }: Credentials): Promise<LoginOutcome> => {
      setSubmitting(true)
      setError(null)
      try {
        const answer = await api.login(email, password)
        return 'secondFactorRequired' in answer ? 'secondFactor' : 'signedIn'
      } catch (cause) {
        // One message for every failure, because the server sends one code for an
        // unknown address and for a wrong password. Telling the two apart in the UI
        // would turn the form into an account-enumeration oracle.
        setError(errorMessage(cause, t))
        return 'refused'
      } finally {
        setSubmitting(false)
      }
    },
    [api, t],
  )

  return { submit, submitting, error }
}

/**
 * The second step of a sign-in. `expired` is the server saying this half-finished sign-in is
 * over — five minutes passed, five wrong codes, the account changed under it — and the page
 * goes back to the password with the sentence the server's code picks.
 */
export type SecondFactorOutcome =
  | { readonly kind: 'signedIn' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'expired'; readonly reason: string }

export interface SecondFactorLoginState {
  readonly submit: (proof: SecondFactorProof) => Promise<SecondFactorOutcome>
  readonly submitting: boolean
  readonly error: string | null
}

/**
 * The one code that means the half-finished sign-in is gone. The account-wide
 * `auth.tooManySecondFactorAttempts` is deliberately not here: it leaves the sign-in alive, and
 * sending the person back to retype a password would only cost a hash and bring them back to the
 * same refusal until the quarter of an hour passes.
 */
const OVER_FOR_GOOD = new Set(['auth.secondFactorExpired'])

export const useSecondFactorLogin = (): SecondFactorLoginState => {
  const api = useApi()
  const t = useTranslations()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async (proof: SecondFactorProof): Promise<SecondFactorOutcome> => {
      setSubmitting(true)
      setError(null)
      try {
        await api.loginSecondFactor(proof)
        return { kind: 'signedIn' }
      } catch (cause) {
        const reason = errorMessage(cause, t)
        setError(reason)
        return cause instanceof ApiError && OVER_FOR_GOOD.has(cause.code)
          ? { kind: 'expired', reason }
          : { kind: 'refused' }
      } finally {
        setSubmitting(false)
      }
    },
    [api, t],
  )

  return { submit, submitting, error }
}

export interface PasswordChange {
  readonly currentPassword: string
  readonly newPassword: string
}

export const useChangePassword = (): AuthActionState<PasswordChange> => {
  const api = useApi()
  const t = useTranslations()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async ({ currentPassword, newPassword }: PasswordChange) => {
      setSubmitting(true)
      setError(null)
      try {
        await api.changePassword(currentPassword, newPassword)
        return true
      } catch (cause) {
        // Every rule about what makes a password acceptable lives on the server, and
        // its code is what picks the sentence — length, reuse, and "too common" all
        // arrive here the same way.
        setError(errorMessage(cause, t))
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [api, t],
  )

  return { submit, submitting, error }
}
