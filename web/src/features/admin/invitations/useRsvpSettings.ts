import { useCallback, useEffect, useRef, useState } from 'react'
import type { RsvpFormInput } from '../../../lib/api/client/invite'
import type { RsvpSettingsDto } from '../../../lib/api/dto'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { applyInput, mergeInputs } from '../../../lib/rsvp/rsvpSettings'
import { SAVE_DEBOUNCE_MS } from '../../../lib/useSettingsAutosave'
import { useApi } from '../../../lib/useApi'
import { useLoader } from '../../../lib/useLoader'

/**
 * The replies' settings as the host changes them (spec 30): **no Save button**. The screen shows a
 * choice at once; the choices of a burst are one request, {@link SAVE_DEBOUNCE_MS} after the last
 * (an absent field is left as it was on the server, so only what changed is sent); one request at a
 * time, and what is chosen while one is on its way goes next. A refusal puts the screen back to
 * what the server holds, with the sentence of its code; what is still waiting when the page closes
 * is sent, not lost. "Fermer" and "Rouvrir" are acts, sent at once.
 *
 * **No rule lives here**: the state of the window, the date it closes and the date the replies
 * are erased are the server's, read back with every answer.
 */

export type RsvpSaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'failed'

export interface RsvpSettingsState {
  /** The server's word with the host's unanswered choices laid over it; `null` until the first answer. */
  readonly settings: RsvpSettingsDto | null
  readonly loadFailure: string | null
  readonly retryLoad: () => void
  /** Lays a choice over the screen and queues it. */
  readonly change: (input: RsvpFormInput) => void
  readonly saveState: RsvpSaveState
  /** The sentence of the last refusal, or `null`. */
  readonly problem: string | null
  readonly acting: boolean
  readonly close: () => void
  readonly reopen: () => void
}

/** What the host chose and the server has not settled: the request on its way, and what waits. */
interface Choices {
  readonly sent: RsvpFormInput
  readonly queued: RsvpFormInput
}

const NONE: Choices = { sent: {}, queued: {} }

/**
 * @param reloadWhen changes when the answer may differ without the host having typed anything: the
 *   invitation was saved, so "enregistrez d'abord l'invitation" is no longer true.
 */
export const useRsvpSettings = (slug: string, reloadWhen: unknown): RsvpSettingsState => {
  const api = useApi()
  const t = useTranslations()
  const words = useRef(t)
  const load = useCallback(
    (signal: AbortSignal) => {
      void reloadWhen
      return api.rsvpForm(slug, signal)
    },
    [api, slug, reloadWhen],
  )
  const { data, error, reload, replace } = useLoader(load)

  const [choices, setChoices] = useState<Choices>(NONE)
  /** The same, for the code that must read it now and not at the next render. */
  const latest = useRef<Choices>(NONE)
  const inflight = useRef(false)
  /** The next flush, for the one that follows a request: a callback cannot name itself. */
  const next = useRef<() => void>(() => undefined)
  const timer = useRef<number | undefined>(undefined)
  const [saveState, setSaveState] = useState<RsvpSaveState>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  useEffect(() => {
    words.current = t
  })

  const set = useCallback((next: Choices) => {
    latest.current = next
    setChoices(next)
  }, [])

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    if (inflight.current) return
    const input = latest.current.queued
    if (Object.keys(input).length === 0) return
    set({ sent: input, queued: {} })
    inflight.current = true
    setSaveState('saving')
    let failed = false
    try {
      const answer = await api.saveRsvpForm(slug, input)
      replace({ rsvpForm: answer.rsvpForm })
    } catch (cause) {
      failed = true
      setProblem(messageForError(cause, words.current))
      setSaveState('failed')
    } finally {
      inflight.current = false
      // Answered or refused, the request is over: the screen is the server's word plus what waits.
      set({ sent: {}, queued: latest.current.queued })
    }
    if (Object.keys(latest.current.queued).length > 0) next.current()
    else if (!failed) setSaveState('saved')
  }, [api, slug, replace, set])

  useEffect(() => {
    next.current = () => void flush()
  }, [flush])

  const change = useCallback(
    (input: RsvpFormInput) => {
      set({ sent: latest.current.sent, queued: mergeInputs(latest.current.queued, input) })
      setProblem(null)
      setSaveState('pending')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
    },
    [flush, set],
  )

  // Leaving the page must not eat what was chosen a moment before.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (Object.keys(latest.current.queued).length > 0) void flush()
    },
    [flush],
  )

  const act = useCallback(
    async (run: () => Promise<{ readonly rsvpForm: RsvpSettingsDto }>): Promise<void> => {
      // What was chosen goes first, so the act answers a settings page that is up to date.
      await flush()
      setActing(true)
      setProblem(null)
      try {
        replace(await run().then((answer) => ({ rsvpForm: answer.rsvpForm })))
      } catch (cause) {
        setProblem(messageForError(cause, words.current))
      } finally {
        setActing(false)
      }
    },
    [flush, replace],
  )

  const settings =
    data === null ? null : applyInput(applyInput(data.rsvpForm, choices.sent), choices.queued)

  return {
    settings,
    loadFailure: settings === null ? error : null,
    retryLoad: reload,
    change,
    saveState,
    problem,
    acting,
    close: () => void act(() => api.closeRsvps(slug)),
    reopen: () => void act(() => api.reopenRsvps(slug)),
  }
}
