import { useCallback, useState } from 'react'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { messageForError } from '../../../lib/i18n/translations'

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
  /** Whether the write started under `key` has not answered yet. Rows are independent. */
  readonly isPending: (key: string) => boolean
  readonly busy: boolean
}

/** The list without the first occurrence of `key` (the run that just answered). */
const withoutOne = (keys: readonly string[], key: string): readonly string[] => {
  const at = keys.indexOf(key)
  return at < 0 ? keys : [...keys.slice(0, at), ...keys.slice(at + 1)]
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
  const t = useTranslations()
  // Every key still running, one entry per run: two rows pressed together are both pending,
  // and the first to answer must not re-enable the other.
  const [pending, setPending] = useState<readonly string[]>([])

  const run = useCallback(
    async (key: string, ...args: A): Promise<ActionResult<R>> => {
      setPending((current) => [...current, key])
      try {
        return { ok: true, value: await action(...args) }
      } catch (cause) {
        return { ok: false, message: messageForError(cause, t) }
      } finally {
        setPending((current) => withoutOne(current, key))
      }
    },
    [action, t],
  )

  const isPending = useCallback((key: string) => pending.includes(key), [pending])

  return { run, isPending, busy: pending.length > 0 }
}
