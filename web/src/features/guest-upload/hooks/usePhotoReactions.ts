import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError, isAbortError } from '../../../lib/http'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { ReactionCounts, ReactionKind } from '../../../lib/api/dto'

/**
 * The reactions under one photo, as a guest's phone shows and changes them.
 *
 * View-state only. Whether a reaction is allowed is the server's decision — the host's
 * switch, the photo being on the wall, one of each kind per guest, the budget — and this
 * hook never re-derives any of it. It sends the tap, shows the answer, and when the answer
 * is a refusal it puts the screen back and says why.
 *
 * **Optimistic, and honest about it.** A tap changes the button before the server has
 * answered, because on venue Wi-Fi the answer is seconds away and a button that does not
 * move gets pressed again. The price of that is owed back: a refusal or a dropped
 * connection restores exactly what that tap changed, and the sentence under the row says
 * which. Nothing is left lit that the server does not hold.
 */

export type ReactionsPhase = 'loading' | 'ready' | 'failed'

export interface PhotoReactionsState {
  /**
   * `loading` until the server has said which reactions this phone already sent — a tap
   * before that could be answered with a refusal about something the guest was never
   * shown — and `failed` when that read did not arrive.
   */
  readonly phase: ReactionsPhase
  readonly counts: ReactionCounts
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
  readonly counts: ReactionCounts
  readonly mine: readonly ReactionKind[]
  readonly failure: Failure | null
}

const NOTHING: ReactionCounts = { love: 0, laugh: 0, wow: 0, cheers: 0, clap: 0 }

/**
 * Sets one reaction to `pressed` and moves its count by one, leaving every other kind
 * alone. Used for the optimistic step **and** for its rollback with the opposite value,
 * which is what makes a refused tap undo itself without undoing a tap made beside it.
 */
const withReaction = (state: Loaded, kind: ReactionKind, pressed: boolean): Loaded => ({
  ...state,
  counts: { ...state.counts, [kind]: Math.max(0, state.counts[kind] + (pressed ? 1 : -1)) },
  mine: pressed
    ? [...state.mine.filter((other) => other !== kind), kind]
    : state.mine.filter((other) => other !== kind),
})

/**
 * The two refusals that mean "your screen was out of date" rather than "no".
 *
 * `reaction.alreadyExists`: the server holds a reaction this phone did not know it had —
 * a reply lost on venue Wi-Fi, or a second tab. `reaction.notFound`: the one the phone
 * thought it could take back is already gone. Rolling back and stopping would leave the
 * button saying the opposite of the server, so both read the row again.
 */
const STALE_SCREEN = new Set(['reaction.alreadyExists', 'reaction.notFound'])

export const usePhotoReactions = (slug: string, photoId: string): PhotoReactionsState => {
  const t = useTranslations()
  const api = useApi()
  const [state, setState] = useState<Loaded>({
    phase: 'loading',
    counts: NOTHING,
    mine: [],
    failure: null,
  })
  const [attempt, setAttempt] = useState(0)

  /**
   * The kinds with a request in the air. A ref and not state: the guard has to see a tap
   * made in the same frame as the one before it, before any render has happened.
   */
  const inFlight = useRef<Set<ReactionKind>>(new Set())

  useEffect(() => {
    const controller = new AbortController()
    let current = true

    api.reactions(slug, photoId, controller.signal).then(
      (answer) => {
        if (!current) return
        setState((previous) => ({
          ...previous,
          phase: 'ready',
          counts: answer.counts,
          mine: answer.mine,
        }))
      },
      (cause: unknown) => {
        if (!current || isAbortError(cause)) return
        // A re-read that fails after the row was already on screen changes nothing: the
        // guest keeps the buttons they have, and the next tap reconciles.
        setState((previous) =>
          previous.phase === 'ready'
            ? previous
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

  const toggle = useCallback(
    (kind: ReactionKind) => {
      if (state.phase !== 'ready' || inFlight.current.has(kind)) return

      const wasMine = state.mine.includes(kind)
      inFlight.current.add(kind)
      setState((previous) => ({ ...withReaction(previous, kind, !wasMine), failure: null }))

      const request = wasMine
        ? api.withdrawReaction(slug, photoId, kind)
        : api.react(slug, photoId, kind)

      request.then(
        () => {
          inFlight.current.delete(kind)
        },
        (cause: unknown) => {
          inFlight.current.delete(kind)
          setState((previous) => ({
            ...withReaction(previous, kind, wasMine),
            failure: { kind: 'action', cause },
          }))
          if (cause instanceof ApiError && STALE_SCREEN.has(cause.code)) {
            setAttempt((current) => current + 1)
          }
        },
      )
    },
    [api, slug, photoId, state.phase, state.mine],
  )

  const mine = useMemo<ReadonlySet<ReactionKind>>(() => new Set(state.mine), [state.mine])

  const error = useMemo<string | null>(() => {
    if (state.failure === null) return null
    if (state.failure.kind === 'load') return t.upload.reactionsFailed
    return messageForError(state.failure.cause, t)
  }, [state.failure, t])

  return { phase: state.phase, counts: state.counts, mine, error, toggle, retry }
}
