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
 * is sent, not lost.
 *
 * **"Fermer" and "Rouvrir" are acts and come after everything chosen**: they wait for the queue to
 * drain (the request on its way included, and what was chosen while it flew), do nothing and keep
 * the refusal's sentence if a choice was refused, and only then send. Every answer is stamped by
 * the order its request was **sent**; an older answer landing after a newer one is dropped, so a
 * save that left before the closing cannot put the pre-closing state back on screen.
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
  /** `now`: sent at once, not after the pause (a field being unmounted cannot wait for it). */
  readonly change: (input: RsvpFormInput, now?: boolean) => void
  readonly saveState: RsvpSaveState
  /** The sentence of the last refusal, or `null`. */
  readonly problem: string | null
  readonly acting: boolean
  /** How many replies (yes and maybe) hold a moment, or `null` when the count could not be read. */
  readonly momentReplies: (momentId: string) => Promise<number | null>
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
 *   invitation was saved, so "enregistrez d'abord l'invitation" is no longer true, or its start or
 *   its zone moved, so the date the window closes did.
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
  /** The drain in progress: everyone who wants the queue empty waits for this one. */
  const draining = useRef<Promise<boolean> | null>(null)
  const timer = useRef<number | undefined>(undefined)
  /** Requests are numbered as they are sent; the newest answer applied wins. */
  const issued = useRef(0)
  const applied = useRef(0)
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

  const adopt = useCallback(
    (seq: number, rsvpForm: RsvpSettingsDto) => {
      if (seq <= applied.current) return
      applied.current = seq
      replace({ rsvpForm })
    },
    [replace],
  )

  /** Sends what is queued, and what is queued meanwhile, until nothing waits; `false` if one was refused. */
  const drain = useCallback((): Promise<boolean> => {
    window.clearTimeout(timer.current)
    if (draining.current !== null) return draining.current
    const run = async (): Promise<boolean> => {
      let ok = true
      while (Object.keys(latest.current.queued).length > 0) {
        const input = latest.current.queued
        set({ sent: input, queued: {} })
        issued.current += 1
        const seq = issued.current
        setSaveState('saving')
        try {
          adopt(seq, (await api.saveRsvpForm(slug, input)).rsvpForm)
          setProblem(null)
        } catch (cause) {
          ok = false
          setProblem(messageForError(cause, words.current))
          setSaveState('failed')
        } finally {
          // Answered or refused, the request is over: the screen is the server's word plus what waits.
          set({ sent: {}, queued: latest.current.queued })
        }
        if (!ok) break
      }
      if (ok) setSaveState('saved')
      return ok
    }
    const started = run().finally(() => {
      draining.current = null
    })
    draining.current = started
    return started
  }, [api, slug, adopt, set])

  const change = useCallback(
    (input: RsvpFormInput, now = false) => {
      set({ sent: latest.current.sent, queued: mergeInputs(latest.current.queued, input) })
      setProblem(null)
      setSaveState('pending')
      window.clearTimeout(timer.current)
      if (now) void drain()
      else timer.current = window.setTimeout(() => void drain(), SAVE_DEBOUNCE_MS)
    },
    [drain, set],
  )

  // Leaving the page must not eat what was chosen a moment before.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (Object.keys(latest.current.queued).length > 0) void drain()
    },
    [drain],
  )

  const act = useCallback(
    async (run: () => Promise<{ readonly rsvpForm: RsvpSettingsDto }>): Promise<void> => {
      // Everything chosen goes first; a choice that was refused stops the act and keeps its sentence.
      if (!(await drain())) return
      setActing(true)
      setProblem(null)
      issued.current += 1
      const seq = issued.current
      try {
        adopt(seq, (await run()).rsvpForm)
      } catch (cause) {
        setProblem(messageForError(cause, words.current))
      } finally {
        setActing(false)
      }
    },
    [drain, adopt],
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
    momentReplies: async (momentId: string) => {
      try {
        const { stats } = await api.rsvps(slug)
        const held = stats.moments.find((moment) => moment.id === momentId)
        return held === undefined ? 0 : held.yes.responses + held.maybe.responses
      } catch {
        return null
      }
    },
    close: () => void act(() => api.closeRsvps(slug)),
    reopen: () => void act(() => api.reopenRsvps(slug)),
  }
}
