import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from './useApi'
import type { EventSettingsPatch } from './api/client'
import type { EventDto, EventSettingsDto } from './api/dto'
import { ApiError } from './http'
import { applySettingsPatch, mergeSettingsPatch } from './settingsAutosave'

/** One request per burst of choices, after this much stillness; the last choice wins. */
export const SAVE_DEBOUNCE_MS = 400

export type SettingsSaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | {
      readonly kind: 'failed'
      readonly sessionExpired: boolean
      readonly code: string | undefined
      /** What the server or the network answered, for a screen that words it itself. */
      readonly cause: unknown
    }

export interface SettingsAutosave {
  /** The server's answer with what the host changed since laid over it. */
  readonly settings: EventSettingsDto
  /** Queues the changed fields only; they are sent after {@link SAVE_DEBOUNCE_MS} of stillness. */
  readonly save: (patch: EventSettingsPatch) => void
  readonly state: SettingsSaveState
}

const SESSION_EXPIRED_CODE = 'auth.required'

/**
 * The settings saved as the host changes them: the panel on the projected wall (spec 13, rules 4
 * and 5) and the settings page, which have no Save button.
 *
 * Each call to `save` names **only the changed fields**; they are collected for
 * {@link SAVE_DEBOUNCE_MS} (the host dragging through a list is one request, not five) and sent
 * as one `PATCH`, the last value of a field winning. The control shows the new value at once; a
 * refusal drops the values of that request only, so the control goes back to what the server holds,
 * and the state says why; a choice made while it was in flight is still shown and still sent.
 * What is still pending when the screen closes is sent, not lost.
 */
export const useSettingsAutosave = (
  slug: string,
  event: EventDto,
  replace: (event: EventDto) => void,
): SettingsAutosave => {
  const api = useApi()
  // What the host chose and the server has not answered yet, one entry per request, in the
  // order they were sent; `draft` is what is still being collected for the next one. The
  // answer to request N removes entry N and nothing else (BUG-23).
  const [inflight, setInflight] = useState<
    ReadonlyArray<{ id: number; patch: EventSettingsPatch }>
  >([])
  const [draft, setDraft] = useState<EventSettingsPatch>({})
  const [state, setState] = useState<SettingsSaveState>({ kind: 'idle' })
  const queued = useRef<EventSettingsPatch>({})
  const timer = useRef<number | undefined>(undefined)
  const counter = useRef(0)
  const outstanding = useRef(0)
  const refused = useRef(false)
  // The newest request whose answer was applied: an older answer arriving after it would put the
  // screen back to a state without the newer change.
  const applied = useRef(0)

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    const patch = queued.current
    queued.current = {}
    if (Object.keys(patch).length === 0) return
    counter.current += 1
    const id = counter.current
    if (outstanding.current === 0) refused.current = false
    outstanding.current += 1
    setInflight((current) => [...current, { id, patch }])
    setDraft({})
    setState({ kind: 'saving' })
    const settle = () => {
      outstanding.current -= 1
      setInflight((current) => current.filter((entry) => entry.id !== id))
    }
    api.updateSettings(slug, patch).then(
      (updated) => {
        if (id > applied.current) {
          applied.current = id
          replace(updated)
        }
        settle()
        // "Saved" only once nothing later is still on its way, and nothing was refused.
        if (
          outstanding.current === 0 &&
          !refused.current &&
          Object.keys(queued.current).length === 0
        )
          setState({ kind: 'saved' })
      },
      (cause: unknown) => {
        settle()
        refused.current = true
        setState({
          kind: 'failed',
          sessionExpired: cause instanceof ApiError && cause.code === SESSION_EXPIRED_CODE,
          code: cause instanceof ApiError ? cause.code : undefined,
          cause,
        })
      },
    )
  }, [api, slug, replace])

  const save = useCallback(
    (patch: EventSettingsPatch) => {
      queued.current = mergeSettingsPatch(queued.current, patch)
      setDraft((current) => mergeSettingsPatch(current, patch))
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
    },
    [flush],
  )

  // Leaving the screen must not eat a choice made a moment before.
  useEffect(() => flush, [flush])

  const pending = useMemo(
    () =>
      mergeSettingsPatch(
        inflight.reduce((all, entry) => mergeSettingsPatch(all, entry.patch), {}),
        draft,
      ),
    [inflight, draft],
  )
  const settings = useMemo(
    () => applySettingsPatch(event.settings, pending),
    [event.settings, pending],
  )

  return { settings, save, state }
}
