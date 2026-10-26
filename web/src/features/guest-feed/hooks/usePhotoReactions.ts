import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError, isAbortError } from '../../../lib/http'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { ReactionKind } from '../../../lib/api/dto'

/**
 * Which reactions this phone has given to one photo, and the taps on their way.
 *
 * View-state only. Whether a reaction is allowed is the server's decision — the host's
 * switch, the photo being on the wall, one of each kind per guest, the budget — and this
 * hook never re-derives any of it. It sends the tap, shows the answer, and when the answer
 * is a refusal it puts the screen back and says why.
 *
 * **Optimistic, and honest about it.** A tap changes the button before the server has
 * answered, because on venue Wi-Fi the answer is seconds away and a button that does not
 * move gets pressed again. The price of that is owed back: a refusal or a dropped
 * connection takes that tap back, and the sentence under the row says which.
 *
 * **Two things are kept apart, so that nothing has to be undone by arithmetic.** `sent` is
 * what the server last said this phone holds; `asked` is the taps whose answer has not come.
 * The screen shows `sent` with `asked` laid over it. A tap is added to `asked` and leaves it
 * when its request settles — folded into `sent` on a success, simply dropped on a failure —
 * so a rollback is the absence of an overlay, and a re-read, which replaces `sent` only,
 * cannot be doubled or undone by a tap that happened to be in the air.
 *
 * Counts are not held: the screen shows which reactions are this phone's and none of the
 * room's, so the `counts` the server sends with the row are not read.
 */

export type ReactionsPhase = 'loading' | 'ready' | 'failed'

export interface PhotoReactionsState {
  /**
   * `loading` until the server has said which reactions this phone already sent — a tap
   * before that could be answered with a refusal about something the guest was never
   * shown — and again while the row is being read after a refusal that said the screen was
   * out of date. `failed` when the first read did not arrive.
   */
  readonly phase: ReactionsPhase
  readonly mine: ReadonlySet<ReactionKind>
  /** A sentence in the guest's current language, ready to render. `null` when nothing failed. */
  readonly error: string | null
  readonly toggle: (kind: ReactionKind) => void
  /** Reads the row again after the first read failed. */
  readonly retry: () => void
}

/**
 * What went wrong, kept as a fact rather than as a sentence, for the reason `useMyPhotos`
 * gives: the sentence is composed at render, so changing language re-words a refusal that
 * is on screen instead of re-reading anything.
 */
type Failure = { readonly kind: 'load' } | { readonly kind: 'action'; readonly cause: unknown }

interface Loaded {
  readonly phase: ReactionsPhase
  /** Whether the server has answered at all: a failed re-read keeps what an earlier read said. */
  readonly known: boolean
  readonly sent: readonly ReactionKind[]
  /** What each unanswered tap asked for: `true` to give the reaction, `false` to take it back. */
  readonly asked: Readonly<Partial<Record<ReactionKind, boolean>>>
  readonly failure: Failure | null
}

const withReaction = (
  sent: readonly ReactionKind[],
  kind: ReactionKind,
  given: boolean,
): readonly ReactionKind[] => {
  const others = sent.filter((other) => other !== kind)
  return given ? [...others, kind] : others
}

/**
 * Whether a failure leaves the phone not knowing what the server holds.
 *
 * `reaction.alreadyExists`: the server holds a reaction this phone did not know it had.
 * `reaction.notFound`: the one the phone thought it could take back is already gone. A
 * dropped connection (`status 0`) is the same ignorance from the other side: the request may
 * have been processed and only its reply lost, which is exactly what venue Wi-Fi does, and
 * the screen would otherwise say "not sent" about a reaction the wall has already shown.
 * Taking the tap back and stopping would leave the button saying the opposite of the server,
 * so each reads the row again.
 */
const leavesScreenUncertain = (cause: unknown): boolean =>
  cause instanceof ApiError &&
  (cause.isNetwork || cause.code === 'reaction.alreadyExists' || cause.code === 'reaction.notFound')

export const usePhotoReactions = (slug: string, photoId: string): PhotoReactionsState => {
  const t = useTranslations()
  const api = useApi()
  const [state, setState] = useState<Loaded>({
    phase: 'loading',
    known: false,
    sent: [],
    asked: {},
    failure: null,
  })
  const [attempt, setAttempt] = useState(0)

  /**
   * The kinds with a request in the air, and whether a re-read is waiting for them.
   *
   * Refs because they are read by the handlers that settle a request, which have to see the
   * others' settling as it happens rather than as of the last render.
   *
   * **A re-read starts only when nothing is in the air.** One that started earlier could be
   * answered with a snapshot taken before a request still on its way had landed, and would
   * then take that tap off the screen while the server holds it.
   */
  const inFlight = useRef<Set<ReactionKind>>(new Set())
  const rereadWaiting = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    let current = true

    api.reactions(slug, photoId, controller.signal).then(
      (answer) => {
        if (!current) return
        setState((previous) => ({
          ...previous,
          phase: 'ready',
          known: true,
          sent: answer.mine,
        }))
      },
      (cause: unknown) => {
        if (!current || isAbortError(cause)) return
        // A re-read that fails after the row was already on screen changes nothing: the
        // guest keeps the buttons they have, and the next tap reconciles.
        setState((previous) =>
          previous.known
            ? { ...previous, phase: 'ready' }
            : { ...previous, phase: 'failed', failure: { kind: 'load' } },
        )
      },
    )

    return () => {
      current = false
      controller.abort()
    }
  }, [api, slug, photoId, attempt])

  const retry = useCallback(() => {
    setState((previous) => ({ ...previous, phase: 'loading', failure: null }))
    setAttempt((current) => current + 1)
  }, [])

  /** Reads the row again once nothing is in the air; the buttons rest until it has answered. */
  const settled = useCallback((kind: ReactionKind) => {
    inFlight.current.delete(kind)
    if (rereadWaiting.current && inFlight.current.size === 0) {
      rereadWaiting.current = false
      setAttempt((current) => current + 1)
    }
  }, [])

  const mine = useMemo<ReadonlySet<ReactionKind>>(() => {
    const shown = new Set(state.sent)
    for (const [kind, given] of Object.entries(state.asked)) {
      if (given) shown.add(kind as ReactionKind)
      else shown.delete(kind as ReactionKind)
    }
    return shown
  }, [state.sent, state.asked])

  const toggle = useCallback(
    (kind: ReactionKind) => {
      if (state.phase !== 'ready' || inFlight.current.has(kind)) return

      const given = !mine.has(kind)
      inFlight.current.add(kind)
      setState((previous) => ({
        ...previous,
        asked: { ...previous.asked, [kind]: given },
        failure: null,
      }))

      const request = given
        ? api.react(slug, photoId, kind)
        : api.withdrawReaction(slug, photoId, kind)

      request.then(
        () => {
          setState((previous) => {
            const { [kind]: _answered, ...asked } = previous.asked
            return { ...previous, sent: withReaction(previous.sent, kind, given), asked }
          })
          settled(kind)
        },
        (cause: unknown) => {
          const uncertain = leavesScreenUncertain(cause)
          setState((previous) => {
            const { [kind]: _answered, ...asked } = previous.asked
            return {
              ...previous,
              asked,
              failure: { kind: 'action', cause },
              // Resting until the row has been read, so no tap is made on a screen the
              // phone has just been told it cannot trust.
              phase: uncertain ? 'loading' : previous.phase,
            }
          })
          if (uncertain) rereadWaiting.current = true
          settled(kind)
        },
      )
    },
    [api, slug, photoId, state.phase, mine, settled],
  )

  const error = useMemo<string | null>(() => {
    if (state.failure === null) return null
    if (state.failure.kind === 'load') return t.upload.reactionsFailed
    return messageForError(state.failure.cause, t)
  }, [state.failure, t])

  return { phase: state.phase, mine, error, toggle, retry }
}
