import { useCallback, useState } from 'react'
import { errorMessage } from '../errorMessage'

/**
 * What a write attempt produced.
 *
 * A discriminated result rather than a nullable value, because several of these
 * actions resolve to nothing at all — `undefined` would then be indistinguishable from
 * a refusal, and a purge that silently "succeeded" is the worst version of that bug.
 */
export type ActionResult<R> =
  { readonly ok: true; readonly value: R } | { readonly ok: false; readonly message: string }

export interface ActionState<A extends readonly unknown[], R> {
  /**
   * `key` identifies which row is busy, so a list can disable the one button the host
   * pressed instead of the whole panel.
   */
  readonly run: (key: string, ...args: A) => Promise<ActionResult<R>>
  readonly pending: string | null
  readonly busy: boolean
}

/**
 * One write, with a per-row busy key.
 *
 * `action` must be stable (a `useCallback` over `useApi()`), for the same reason
 * `useLoader`'s does.
 */
export const useAction = <A extends readonly unknown[], R>(
  action: (...args: A) => Promise<R>,
): ActionState<A, R> => {
  const [pending, setPending] = useState<string | null>(null)

  const run = useCallback(
    async (key: string, ...args: A): Promise<ActionResult<R>> => {
      setPending(key)
      try {
        return { ok: true, value: await action(...args) }
      } catch (cause) {
        return { ok: false, message: errorMessage(cause) }
      } finally {
        setPending(null)
      }
    },
    [action],
  )

  return { run, pending, busy: pending !== null }
}
