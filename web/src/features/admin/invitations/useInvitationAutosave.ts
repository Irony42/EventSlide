import { useCallback, useEffect, useRef, useState } from 'react'
import type { GuestInviteDto } from '../../../lib/api/dto'
import { ApiError } from '../../../lib/http'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { browserTimeZone } from '../../../lib/invite/timeZones'
import { SAVE_DEBOUNCE_MS } from '../../../lib/useSettingsAutosave'
import { useApi } from '../../../lib/useApi'
import {
  fieldOfCode,
  formFromInvite,
  inputFromForm,
  type FormField,
  type InvitationForm,
} from './invitationFormModel'

/** What the line above the form says: nothing yet, a change on its way, the answer, a refusal. */
export type InvitationSaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'failed' | 'invalid'

/** What went wrong, and under which field it is shown (`null`: it is about none). */
export interface InvitationProblem {
  readonly field: FormField | null
  readonly message: string
}

export interface InvitationAutosave {
  readonly form: InvitationForm
  readonly change: (patch: Partial<InvitationForm>) => void
  readonly state: InvitationSaveState
  readonly problem: InvitationProblem | null
  /** Sends what is typed now, without waiting for the host to stop. */
  readonly saveNow: () => void
}

interface Options {
  readonly slug: string
  readonly invite: GuestInviteDto
  /** The language the host is reading, for an invitation that has none yet. */
  readonly readerLanguage: string
  readonly onSaved: (invite: GuestInviteDto) => void
}

/**
 * The invitation's text, saved as the host types it (spec 29): the form is the host's own once
 * mounted, and a request goes out {@link SAVE_DEBOUNCE_MS} after the last key, the whole form
 * each time (an invitation is one document). One request at a time: a change made while one is on
 * its way is sent when it answers. Nothing invalid leaves the browser: the sentence shows under its
 * field, and the last valid text stays on the previews. What is still waiting when the page closes
 * is sent, not lost; a refusal stays on screen with a way to retry.
 *
 * It follows `useSettingsAutosave` (the settings page's queue and its words) but for one
 * document saved by `PUT`, which cannot be written as a patch of fields.
 */
export const useInvitationAutosave = ({
  slug,
  invite,
  readerLanguage,
  onSaved,
}: Options): InvitationAutosave => {
  const t = useTranslations()
  const api = useApi()
  const [form, setForm] = useState<InvitationForm>(() =>
    formFromInvite(invite, browserTimeZone(), readerLanguage),
  )
  const [state, setState] = useState<InvitationSaveState>('idle')
  const [problem, setProblem] = useState<InvitationProblem | null>(null)
  const latest = useRef(form)
  const timer = useRef<number | undefined>(undefined)
  const inflight = useRef(false)
  const waiting = useRef(false)
  const adopt = useRef(onSaved)
  const words = useRef(t)
  // The save that follows one that was on its way: `run` calls itself through here.
  const again = useRef(false)
  const runAgain = useRef<() => void>(() => undefined)
  useEffect(() => {
    adopt.current = onSaved
    words.current = t
  })

  const run = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    waiting.current = false
    // Enter, a blur and the timer can all ask at once: one request, then one more if typed since.
    if (inflight.current) {
      again.current = true
      return
    }
    const built = inputFromForm(latest.current)
    if (!built.ok) {
      const text = words.current
      const message =
        built.reason === 'nonexistentHour'
          ? text.guestInvite.host.nonexistentHour
          : built.reason === 'tooManyLines'
            ? built.field === 'address'
              ? text.errors['guestInvite.addressTooManyLines']
              : text.errors['guestInvite.messageTooManyLines']
            : built.field === 'end'
              ? text.errors['guestInvite.endsAtInvalid']
              : text.errors['guestInvite.startsAtInvalid']
      setProblem({ field: built.field, message })
      setState('invalid')
      return
    }
    inflight.current = true
    setState('saving')
    setProblem(null)
    let failed = false
    try {
      const answer = await api.saveGuestInvite(slug, built.input)
      adopt.current(answer.guestInvite)
    } catch (cause) {
      failed = true
      setProblem({
        field: cause instanceof ApiError ? fieldOfCode(cause.code) : null,
        message: messageForError(cause, words.current),
      })
      setState('failed')
    } finally {
      inflight.current = false
    }
    if (again.current) {
      again.current = false
      runAgain.current()
    } else if (!failed) {
      setState('saved')
    }
  }, [api, slug])

  useEffect(() => {
    runAgain.current = () => void run()
  }, [run])

  const change = useCallback(
    (patch: Partial<InvitationForm>) => {
      latest.current = { ...latest.current, ...patch }
      setForm(latest.current)
      setProblem(null)
      setState('pending')
      waiting.current = true
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void run(), SAVE_DEBOUNCE_MS)
    },
    [run],
  )

  // Leaving the page must not eat what was typed a moment before.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (waiting.current) void run()
    },
    [run],
  )

  return { form, change, state, problem, saveNow: () => void run() }
}
