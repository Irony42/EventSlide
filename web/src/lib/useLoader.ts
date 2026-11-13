import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAbortError } from './http'
import { useTranslations } from './i18n/useTranslations'
import { messageForError } from './i18n/translations'
import { useReadScheduler } from './realtime/useReadScheduler'

export interface LoaderState<T> {
  /** `null` until the first answer arrives. Absence is not emptiness. */
  readonly data: T | null
  readonly loading: boolean
  /** A sentence in the language the reader is using, or `null`. */
  readonly error: string | null
  readonly reload: () => void
  /** Store what a mutation returned, so the screen updates without a second round trip. */
  readonly replace: (value: T) => void
}

type Load<T> = (signal: AbortSignal) => Promise<T>

/**
 * What went wrong, kept as the thrown value rather than as a finished sentence.
 *
 * The sentence is composed at render, from the active table, and that is the whole
 * reason this wrapper exists: storing the finished copy would put the table into the
 * read effect's dependencies, so a reader changing language would re-read every screen —
 * and a refresh that then failed would replace the page they were looking at with an
 * error, for no reason except that they had chosen a language. `useMyPhotos` keeps the
 * guest's side of the same rule.
 *
 * A wrapper rather than a bare `unknown`, because `null` is a value something can throw
 * and "nothing has failed" has to stay distinguishable from it.
 */
interface Failure {
  readonly cause: unknown
}

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
  readonly failure: Failure | null
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
  const t = useTranslations()
  const [attempt, setAttempt] = useState(0)
  const [answer, setAnswer] = useState<Answer<T>>({
    load: null,
    attempt: NOTHING_ASKED,
    data: null,
    failure: null,
  })

  /**
   * How many times `replace` has stored a value. A read remembers the count it started under, and
   * an answer that comes back under an older count is older than what a mutation just returned:
   * it is dropped, or the screen would go back to the values from before a save that succeeded.
   */
  const replacements = useRef(0)

  /**
   * `reload` never restarts a read that is on its way (see `readScheduler`): it marks it stale and
   * one more read follows its answer. The press is already paced by the person or by a visibility
   * event, so it skips the burst window.
   */
  const reads = useReadScheduler(() => setAttempt((current) => current + 1))
  const reload = useCallback(() => reads.request({ immediate: true }), [reads])

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    const startedUnder = replacements.current
    reads.began()

    load(controller.signal).then(
      (value) => {
        if (!current) return
        reads.settled()
        if (replacements.current !== startedUnder) {
          // Asked before a mutation's own answer was stored: only the bookkeeping moves on.
          setAnswer((previous) => ({ ...previous, load, attempt }))
          return
        }
        setAnswer({ load, attempt, data: value, failure: null })
      },
      (cause: unknown) => {
        if (!current) return
        // The abort came from this effect's own cleanup — StrictMode mounts twice —
        // and is not a failure to report to the reader.
        // A read that ends must free the slot, even one the transport itself aborted (its own
        // deadline): otherwise every later reload would only mark it stale.
        reads.settled()
        if (isAbortError(cause)) return
        if (replacements.current !== startedUnder) {
          setAnswer((previous) => ({ ...previous, load, attempt }))
          return
        }
        // The previous data stays: a failed refresh must not blank a page the reader is
        // reading, it must say that the refresh failed.
        setAnswer((previous) => ({
          load,
          attempt,
          data: previous.data,
          failure: { cause },
        }))
      },
    )

    return () => {
      current = false
      controller.abort()
    }
  }, [load, attempt, reads])

  const replace = useCallback((value: T) => {
    replacements.current += 1
    setAnswer((previous) => ({ ...previous, data: value, failure: null }))
  }, [])

  /**
   * The sentence, composed here rather than where the failure was caught — so a reader who
   * changes language while a refusal is on screen reads it in the language they just
   * chose, and the read effect above depends on nothing but the request.
   */
  const error = useMemo<string | null>(
    () => (answer.failure === null ? null : messageForError(answer.failure.cause, t)),
    [answer.failure, t],
  )

  return {
    data: answer.data,
    loading: answer.load !== load || answer.attempt !== attempt,
    error,
    reload,
    replace,
  }
}
