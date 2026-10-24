import { useCallback, useState } from 'react'
import { ApiError } from '../../../lib/http'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { errorMessage } from '../../admin/errorMessage'
import { useStepUp } from '../useStepUp'

/**
 * What a write attempt came to. `message: null` is a person who was asked to confirm themselves
 * and chose not to: there is nothing to say, and a toast about it would be noise.
 */
export type OperatorResult<R> =
  { readonly ok: true; readonly value: R } | { readonly ok: false; readonly message: string | null }

export interface OperatorAction<A extends readonly unknown[], R> {
  /** `key` names the row that is busy, so a list disables the one button that was pressed. */
  readonly run: (key: string, ...args: A) => Promise<OperatorResult<R>>
  readonly pending: string | null
  readonly busy: boolean
}

const STEP_UP_REQUIRED = 'auth.stepUpRequired'

/**
 * One write of the operator's console, with the confirmation built in.
 *
 * The write is sent. If the server answers `403 auth.stepUpRequired` (the session has not
 * confirmed the person in the last five minutes: the route judges it **before** reading the
 * body, so nothing happened), the prompt opens, and on a confirmation the same write is sent once
 * more. A person who gives up gets `{ ok: false, message: null }`; a second refusal, of any kind,
 * is the answer, with no third attempt, so a clock that disagrees cannot loop.
 *
 * `action` must be stable (a `useCallback` over `useApi()`), as for `useAction` in the host's
 * console.
 */
export const useOperatorAction = <A extends readonly unknown[], R>(
  action: (...args: A) => Promise<R>,
): OperatorAction<A, R> => {
  const t = useTranslations()
  const { confirm } = useStepUp()
  const [pending, setPending] = useState<string | null>(null)

  const run = useCallback(
    async (key: string, ...args: A): Promise<OperatorResult<R>> => {
      setPending(key)
      try {
        try {
          return { ok: true, value: await action(...args) }
        } catch (cause) {
          if (!(cause instanceof ApiError) || cause.code !== STEP_UP_REQUIRED) throw cause
          if (!(await confirm())) return { ok: false, message: null }
          return { ok: true, value: await action(...args) }
        }
      } catch (cause) {
        return { ok: false, message: errorMessage(cause, t) }
      } finally {
        setPending(null)
      }
    },
    [action, confirm, t],
  )

  return { run, pending, busy: pending !== null }
}
