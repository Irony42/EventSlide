import { useCallback, useState } from 'react'
import { useApi } from '../../../app/ApiProvider'
import { errorMessage } from '../errorMessage'

/**
 * The two write actions of the auth surface, as view-state.
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
  /** A French sentence, or `null`. Cleared when a new attempt starts. */
  readonly error: string | null
}

export const useLogin = (): AuthActionState<Credentials> => {
  const api = useApi()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async ({ email, password }: Credentials) => {
      setSubmitting(true)
      setError(null)
      try {
        await api.login(email, password)
        return true
      } catch (cause) {
        // One message for every failure, because the server sends one code for an
        // unknown address and for a wrong password. Telling the two apart in the UI
        // would turn the form into an account-enumeration oracle.
        setError(errorMessage(cause))
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [api],
  )

  return { submit, submitting, error }
}

export interface PasswordChange {
  readonly currentPassword: string
  readonly newPassword: string
}

export const useChangePassword = (): AuthActionState<PasswordChange> => {
  const api = useApi()
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
        setError(errorMessage(cause))
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [api],
  )

  return { submit, submitting, error }
}
