import { useCallback, useState } from 'react'
import { useForgetSession } from '../../../app/useSession'
import { useApi } from '../../../app/useApi'
import type { SecondFactorProof } from '../../../lib/api/dto'
import { ApiError } from '../../../lib/http'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { messageForError, messageForPasswordError } from '../../../lib/i18n/translations'

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
  /**
   * Forgets the sentence, for a page that stops an attempt itself and has its own thing to say.
   * The sentence is about the attempt that was sent; a page that refuses the next one before
   * it leaves the browser would otherwise show the old verdict beside the new refusal.
   */
  readonly clearError: () => void
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
  const forgetSession = useForgetSession()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async ({ email, password }: Credentials): Promise<LoginOutcome> => {
      setSubmitting(true)
      setError(null)
      try {
        const answer = await api.login(email, password)
        if ('secondFactorRequired' in answer) return 'secondFactor'
        // Whatever the shared session said before ("nobody", read by the page that sent the
        // person here) is not true any more, and the page they return to may be outside the
        // console, where no change of scope will say so.
        forgetSession()
        return 'signedIn'
      } catch (cause) {
        // One message for every failure, because the server sends one code for an
        // unknown address and for a wrong password. Telling the two apart in the UI
        // would turn the form into an account-enumeration oracle.
        setError(messageForError(cause, t))
        return 'refused'
      } finally {
        setSubmitting(false)
      }
    },
    [api, forgetSession, t],
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
  const forgetSession = useForgetSession()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async (proof: SecondFactorProof): Promise<SecondFactorOutcome> => {
      setSubmitting(true)
      setError(null)
      try {
        await api.loginSecondFactor(proof)
        forgetSession()
        return { kind: 'signedIn' }
      } catch (cause) {
        const reason = messageForError(cause, t)
        setError(reason)
        return cause instanceof ApiError && OVER_FOR_GOOD.has(cause.code)
          ? { kind: 'expired', reason }
          : { kind: 'refused' }
      } finally {
        setSubmitting(false)
      }
    },
    [api, forgetSession, t],
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
  const forgetSession = useForgetSession()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clearError = useCallback(() => setError(null), [])

  const submit = useCallback(
    async ({ currentPassword, newPassword }: PasswordChange) => {
      setSubmitting(true)
      setError(null)
      try {
        await api.changePassword(currentPassword, newPassword)
        // The session read before this said the account must choose a password, and the gate
        // holds every admin address shut on that answer: without a new read the host would be
        // sent back to the screen they have just finished.
        forgetSession()
        return true
      } catch (cause) {
        // Every rule about what makes a password acceptable lives on the server, and
        // its code is what picks the sentence — length, reuse, and "too common" all
        // arrive here the same way. The one exception is the current password: this form has no
        // address field, so a refusal of it is worded as the password's, not the sign-in's.
        setError(messageForPasswordError(cause, t))
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [api, forgetSession, t],
  )

  return { submit, submitting, error, clearError }
}

/** What a way out came to. A refusal carries its sentence, because the caller is a menu with a toast. */
export type SignOutResult = { readonly ok: true } | { readonly ok: false; readonly message: string }

export interface SignOutState {
  /** This browser only. */
  readonly signOut: () => Promise<SignOutResult>
  /**
   * Every device, this one included. `ok` only once **both** halves are done: the account's
   * other sessions revoked, then this one destroyed.
   */
  readonly signOutEverywhere: () => Promise<SignOutResult>
  readonly busy: boolean
}

/**
 * The two ways out. `api.logout` had no caller before this: 1.0 had no control that signed
 * anybody out, so a laptop handed to the next person at a venue stayed the host's.
 *
 * "Everywhere" is revoke-others and then logout, in that order and not the other: the first
 * call needs the session the second one destroys. The server's `revoke-others` leaves the
 * caller signed in — right for "sign out my other devices", but a button that says
 * *everywhere* and leaves this one open would say something untrue, so the second call is
 * made here. If it fails, the others are already out and the sentence says the attempt failed;
 * pressing again repeats both, and both are safe to repeat.
 */
export const useSignOut = (): SignOutState => {
  const api = useApi()
  const t = useTranslations()
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (steps: () => Promise<void>): Promise<SignOutResult> => {
      setBusy(true)
      try {
        await steps()
        return { ok: true }
      } catch (cause) {
        return { ok: false, message: messageForError(cause, t) }
      } finally {
        setBusy(false)
      }
    },
    [t],
  )

  const signOut = useCallback(() => run(() => api.logout()), [api, run])
  const signOutEverywhere = useCallback(
    () =>
      run(async () => {
        await api.revokeOtherSessions()
        await api.logout()
      }),
    [api, run],
  )

  return { signOut, signOutEverywhere, busy }
}

/**
 * A person erases their own account (`POST /api/auth/account/delete`), behind their password. On
 * success the session the server just destroyed is forgotten here too, so nothing on screen goes on
 * speaking as an account that no longer exists. A refusal (`account.holdsEvents`, a wrong password)
 * is a sentence, and the account is untouched.
 */
export function useDeleteOwnAccount(): AuthActionState<string> {
  const t = useTranslations()
  const api = useApi()
  const forgetSession = useForgetSession()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clearError = useCallback(() => setError(null), [])

  const submit = useCallback(
    async (password: string) => {
      setSubmitting(true)
      setError(null)
      try {
        await api.deleteOwnAccount(password)
        forgetSession()
        return true
      } catch (cause) {
        setError(messageForPasswordError(cause, t))
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [api, forgetSession, t],
  )

  return { submit, submitting, error, clearError }
}
