import { useCallback, useEffect, useRef, useState } from 'react'
import type { GuestRsvpInput } from '../../lib/api/client/invite'
import type { GuestOwnRsvpDto } from '../../lib/api/dto'
import { ApiError } from '../../lib/http'
import {
  forgetEditToken,
  readStoredEditToken,
  storeEditToken,
  discardEditTokenFragment,
  takeEditTokenFromFragment,
} from '../../lib/rsvp/rsvpDevice'
import { useApi } from '../../lib/useApi'

/**
 * A guest's own reply as view-state (spec 30). **No rule lives here**: whether the window is open,
 * what a reply may hold, which refusal means what, are the server's; this keeps the token the
 * device holds, reads the reply with it, and sends what the form built.
 *
 * On first mount: a token in the link's fragment (`#r=`) is taken and removed from the address bar,
 * and kept; otherwise the token the device already holds is used. A token the box refuses
 * (`404 rsvp.notFound`: the reply was deleted, the link changed) is forgotten, so the guest is asked
 * again and nothing stale is ever shown. The page works without any memory at all.
 */

export type RsvpPhase = 'reading' | 'ready'

/** A reply and the token it is reached by: always together, so nothing can hold one without the other. */
export interface OwnReply {
  readonly reply: GuestOwnRsvpDto
  readonly editToken: string
}

export interface GuestRsvpState {
  readonly phase: RsvpPhase
  /** The reply this device (or the link it was opened with) holds, once read. */
  readonly own: OwnReply | null
  /** A send is in flight: the buttons wait, and a second tap sends nothing. */
  readonly sending: boolean
  /** The last write's refusal, as the server's code, or `network` / `busy`; `null` when none. */
  readonly failure: string | null
  /** The device's token was refused and dropped: the page may say so once. */
  readonly forgotten: boolean
  readonly submit: (input: GuestRsvpInput, website: string) => Promise<boolean>
  readonly update: (own: OwnReply, input: GuestRsvpInput) => Promise<boolean>
  readonly remove: (own: OwnReply) => Promise<boolean>
  readonly clearFailure: () => void
}

const failureOf = (cause: unknown): string => {
  if (cause instanceof ApiError) return cause.status === 429 ? 'busy' : cause.code
  return 'network'
}

export const useGuestRsvp = (token: string, interactive: boolean): GuestRsvpState => {
  const api = useApi()
  // The token the device holds, decided once: the fragment first (a link opened on a new device is
  // the way in, read once and gone from the bar), else the memory. Lazy, so the first render already
  // knows whether there is a reply to wait for and no effect has to set state to say so.
  const [held] = useState<string | null>(() => {
    if (!interactive) {
      discardEditTokenFragment()
      return null
    }
    return takeEditTokenFromFragment(token) ?? readStoredEditToken(token)
  })
  const [phase, setPhase] = useState<RsvpPhase>(held === null ? 'ready' : 'reading')
  const [own, setOwn] = useState<OwnReply | null>(null)
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [forgotten, setForgotten] = useState(false)
  const busy = useRef(false)

  useEffect(() => {
    if (held === null) return
    const stop = new AbortController()
    api.guestRsvp(token, held, stop.signal).then(
      ({ rsvp }) => {
        if (stop.signal.aborted) return
        setOwn({ reply: rsvp, editToken: held })
        setPhase('ready')
      },
      (cause: unknown) => {
        if (stop.signal.aborted) return
        // Only a refusal of the token itself makes the device forget it: a failed network read
        // leaves the memory alone, and the page asks again as if nothing were known.
        if (cause instanceof ApiError && cause.code === 'rsvp.notFound') {
          forgetEditToken(token)
          setForgotten(true)
        }
        setPhase('ready')
      },
    )
    return () => stop.abort()
  }, [api, token, held])

  /** One write at a time, and its refusal kept for the form to say. */
  const write = useCallback(
    async (run: () => Promise<void>): Promise<boolean> => {
      if (busy.current) return false
      busy.current = true
      setSending(true)
      setFailure(null)
      try {
        await run()
        return true
      } catch (cause) {
        // A reply that is gone, or a token refused, is not a stale form to retry: forget it.
        if (cause instanceof ApiError && cause.code === 'rsvp.notFound') {
          forgetEditToken(token)
          setOwn(null)
          setForgotten(true)
        }
        setFailure(failureOf(cause))
        return false
      } finally {
        busy.current = false
        setSending(false)
      }
    },
    [token],
  )

  const submit = useCallback(
    (input: GuestRsvpInput, website: string) =>
      write(async () => {
        const created = await api.guestRsvpCreate(token, { ...input, website })
        storeEditToken(token, created.editToken)
        setOwn({ reply: created.rsvp, editToken: created.editToken })
        setForgotten(false)
      }),
    [api, token, write],
  )

  const update = useCallback(
    (current: OwnReply, input: GuestRsvpInput) =>
      write(async () => {
        const changed = await api.guestRsvpUpdate(token, current.editToken, input)
        setOwn({ reply: changed.rsvp, editToken: current.editToken })
      }),
    [api, token, write],
  )

  const remove = useCallback(
    (current: OwnReply) =>
      write(async () => {
        await api.guestRsvpDelete(token, current.editToken)
        forgetEditToken(token)
        setOwn(null)
      }),
    [api, token, write],
  )

  const clearFailure = useCallback(() => setFailure(null), [])

  return {
    phase,
    own,
    sending,
    failure,
    forgotten,
    submit,
    update,
    remove,
    clearFailure,
  }
}
