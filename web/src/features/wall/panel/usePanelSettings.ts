import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../../../lib/useApi'
import type { EventSettingsPatch } from '../../../lib/api/client'
import type { EventDto, EventSettingsDto } from '../../../lib/api/dto'
import { ApiError } from '../../../lib/http'

/** One request per field the host touched, after this much stillness; the last choice wins. */
export const SAVE_DEBOUNCE_MS = 400

export type PanelSaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly sessionExpired: boolean; readonly code: string | undefined }

export interface PanelSettings {
  /** The server's answer with what the host changed since laid over it. */
  readonly settings: EventSettingsDto
  readonly save: (patch: EventSettingsPatch) => void
  readonly state: PanelSaveState
}

const mergePatch = (base: EventSettingsPatch, patch: EventSettingsPatch): EventSettingsPatch => ({
  ...base,
  ...patch,
  ...(patch.wall === undefined ? {} : { wall: { ...base.wall, ...patch.wall } }),
})

const SESSION_EXPIRED_CODE = 'auth.required'

/**
 * The panel's own writes (spec 13, rules 4 and 5).
 *
 * Each call to `save` names **only the changed fields**; they are collected for
 * {@link SAVE_DEBOUNCE_MS} (the host dragging through a list is one request, not five) and sent
 * as one `PATCH`, the last value of a field winning. The control shows the new value at once; a
 * refusal drops the values of that request only, so the control goes back to what the server holds,
 * and the state says why; a choice made while it was in flight is still shown and still sent.
 * What is still pending when the panel closes is sent, not lost.
 */
export const usePanelSettings = (
  slug: string,
  event: EventDto,
  replace: (event: EventDto) => void,
): PanelSettings => {
  const api = useApi()
  // What the host chose and the server has not answered yet, one entry per request, in the
  // order they were sent; `draft` is what is still being collected for the next one. The
  // answer to request N removes entry N and nothing else (BUG-23).
  const [inflight, setInflight] = useState<
    ReadonlyArray<{ id: number; patch: EventSettingsPatch }>
  >([])
  const [draft, setDraft] = useState<EventSettingsPatch>({})
  const [state, setState] = useState<PanelSaveState>({ kind: 'idle' })
  const queued = useRef<EventSettingsPatch>({})
  const timer = useRef<number | undefined>(undefined)
  const counter = useRef(0)
  const outstanding = useRef(0)
  const refused = useRef(false)

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
        replace(updated)
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
        })
      },
    )
  }, [api, slug, replace])

  const save = useCallback(
    (patch: EventSettingsPatch) => {
      // The wall group is merged key by key, here as on the server: two quick choices are one request.
      queued.current = mergePatch(queued.current, patch)
      setDraft((current) => mergePatch(current, patch))
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
    },
    [flush],
  )

  // Closing the panel must not eat a choice made a moment before.
  useEffect(() => flush, [flush])

  const pending = useMemo(
    () =>
      mergePatch(
        inflight.reduce((all, entry) => mergePatch(all, entry.patch), {} as EventSettingsPatch),
        draft,
      ),
    [inflight, draft],
  )
  const settings = useMemo<EventSettingsDto>(
    () => ({
      ...event.settings,
      ...(pending.wallLanguage === undefined ? {} : { wallLanguage: pending.wallLanguage }),
      ...(pending.guestbookOnWall === undefined
        ? {}
        : { guestbookOnWall: pending.guestbookOnWall }),
      ...(pending.wall === undefined ? {} : { wall: { ...event.settings.wall, ...pending.wall } }),
      ...(pending.theme === undefined
        ? {}
        : { theme: { ...event.settings.theme, ...pending.theme } }),
    }),
    [event.settings, pending],
  )

  return { settings, save, state }
}
