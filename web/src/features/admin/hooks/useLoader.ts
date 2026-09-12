import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../errorMessage'

export interface LoaderState<T> {
  /** `null` until the first answer arrives. Absence is not emptiness. */
  readonly data: T | null
  readonly loading: boolean
  /** A French sentence, or `null`. */
  readonly error: string | null
  readonly reload: () => void
  /** Store what a mutation returned, so the screen updates without a second round trip. */
  readonly replace: (value: T) => void
}

type Load<T> = (signal: AbortSignal) => Promise<T>

/**
 * One answer, tagged with the request that produced it.
 *
 * The tag is what makes `loading` a derived value rather than a third piece of state:
 * a request is in flight exactly while the newest answer belongs to an older one.
 * Setting a flag in the effect body instead would be a second render pass on every
 * fetch, and the react-hooks rule that forbids it is right.
 */
interface Answer<T> {
  readonly load: Load<T> | null
  readonly attempt: number
  readonly data: T | null
  readonly error: string | null
}

const NOTHING_ASKED = -1

/**
 * One read, with the four states every screen owes its user.
 *
 * `loading`, `error` and "loaded but empty" are kept genuinely distinct: 1.0 rendered
 * an empty grid for all three, and a host with a projector waiting cannot tell a
 * working screen from a broken one — so they reload, then reboot.
 *
 * `load` must be stable (a `useCallback` over `useApi()`); it identifies the request,
 * and an inline lambda would refetch on every render. Its identity is part of the tag:
 * navigating from one event's settings to another's must not show the first event's
 * answer as though it were loaded.
 */
export const useLoader = <T>(load: Load<T>): LoaderState<T> => {
  const [attempt, setAttempt] = useState(0)
  const [answer, setAnswer] = useState<Answer<T>>({
    load: null,
    attempt: NOTHING_ASKED,
    data: null,
    error: null,
  })

  const reload = useCallback(() => setAttempt((current) => current + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let current = true

    load(controller.signal).then(
      (value) => {
        if (current) setAnswer({ load, attempt, data: value, error: null })
      },
      (cause: unknown) => {
        if (!current) return
        // The abort came from this effect's own cleanup — StrictMode mounts twice —
        // and is not a failure to report to the host.
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        // The previous data stays: a failed refresh must not blank a page the host is
        // reading, it must say that the refresh failed.
        setAnswer((previous) => ({
          load,
          attempt,
          data: previous.data,
          error: errorMessage(cause),
        }))
      },
    )

    return () => {
      current = false
      controller.abort()
    }
  }, [load, attempt])

  const replace = useCallback(
    (value: T) => setAnswer((previous) => ({ ...previous, data: value, error: null })),
    [],
  )

  return {
    data: answer.data,
    loading: answer.load !== load || answer.attempt !== attempt,
    error: answer.error,
    reload,
    replace,
  }
}
