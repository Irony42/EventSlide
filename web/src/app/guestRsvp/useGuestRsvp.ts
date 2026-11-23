import { useCallback, useEffect, useRef, useState } from 'react'
import type { GuestRsvpInput } from '../../lib/api/client/invite'
import type { GuestOwnRsvpDto } from '../../lib/api/dto'
import { ApiError } from '../../lib/http'
import {
  discardEditTokenFragment,
  forgetEditToken,
  forgetHouseholdToken,
  readStoredEditToken,
  readStoredHouseholdToken,
  storeEditToken,
  takeEditTokenFromFragment,
  takeHouseholdTokenFromFragment,
} from '../../lib/rsvp/rsvpDevice'
import { useApi } from '../../lib/useApi'

/**
 * A guest's own reply as view-state (spec 30). **No rule lives here**: whether the window is open,
 * what a reply may hold, which refusal means what, are the server's; this keeps the token the
 * device holds, reads the reply with it, and sends what the form built.
 *
 * On first mount: a token in the link's fragment is taken and removed from the address bar, and kept.
 * `#r=` is a reply's own token; `#f=` is a **household's personal link** (lot 3), which opens the
 * household's name, places and **one** reply and is shared by every device of the household. A
 * fragment on the link wins over what the device remembers, and a household over a reply token. A
 * token the box refuses (`404 rsvp.notFound`: the reply was deleted, the link changed) is forgotten,
 * so the guest is asked again and nothing stale is ever shown. The page works without any memory.
 */

export type RsvpPhase = 'reading' | 'ready'

/**
 * A reply and the key it is reached by, always together: the reply's own token, or `null` for a
 * household's reply (its link is the key, kept by the hook).
 */
export interface OwnReply {
  readonly reply: GuestOwnRsvpDto
  readonly editToken: string | null
}

/** What a household's link says of itself. */
export interface HouseholdView {
  readonly name: string
  readonly places: number
}

export interface GuestRsvpState {
  readonly phase: RsvpPhase
  /** The reply this device (or the link it was opened with) holds, once read. */
  readonly own: OwnReply | null
  /** The household the link opened, once read: the form is then the household's. */
  readonly household: HouseholdView | null
  /** The household's link could not be read (a network failure, not a refusal): ask again. */
  readonly householdUnread: boolean
  /** The household's link was refused and dropped: the page may say so once. */
  readonly householdGone: boolean
  readonly retryHousehold: () => void
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

const isNotFound = (cause: unknown): boolean =>
  cause instanceof ApiError && cause.code === 'rsvp.notFound'

/** The tokens the device holds, decided once; see {@link useGuestRsvp}. */
interface Held {
  readonly household: string | null
  readonly edit: string | null
}

export const useGuestRsvp = (token: string, interactive: boolean): GuestRsvpState => {
  const api = useApi()
  // Decided once and lazily, so the first render already knows whether there is something to wait for
  // and no effect has to set state to say so. Both fragments are taken (and removed from the bar)
  // before any is chosen: a fragment on the link is the way in and beats the memory.
  const [initial] = useState<Held>(() => {
    if (!interactive) {
      discardEditTokenFragment()
      return { household: null, edit: null }
    }
    const fromHouseholdLink = takeHouseholdTokenFromFragment(token)
    const fromReplyLink = takeEditTokenFromFragment(token)
    if (fromHouseholdLink !== null) return { household: fromHouseholdLink, edit: null }
    if (fromReplyLink !== null) return { household: null, edit: fromReplyLink }
    const remembered = readStoredHouseholdToken(token)
    if (remembered !== null) return { household: remembered, edit: null }
    return { household: null, edit: readStoredEditToken(token) }
  })
  const held = initial.edit
  const [householdToken, setHouseholdToken] = useState<string | null>(initial.household)
  const [phase, setPhase] = useState<RsvpPhase>(
    held === null && initial.household === null ? 'ready' : 'reading',
  )
  const [own, setOwn] = useState<OwnReply | null>(null)
  const [household, setHousehold] = useState<HouseholdView | null>(null)
  const [householdUnread, setHouseholdUnread] = useState(false)
  const [householdGone, setHouseholdGone] = useState(false)
  const [attempt, setAttempt] = useState(0)
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
        if (isNotFound(cause)) {
          forgetEditToken(token)
          setForgotten(true)
        }
        setPhase('ready')
      },
    )
    return () => stop.abort()
  }, [api, token, held])

  // The household's link: its name and places, and its reply if it gave one.
  useEffect(() => {
    if (householdToken === null) return
    const stop = new AbortController()
    api.guestHousehold(token, householdToken, stop.signal).then(
      ({ household: opened }) => {
        if (stop.signal.aborted) return
        setHousehold({ name: opened.name, places: opened.places })
        setOwn(opened.rsvp === undefined ? null : { reply: opened.rsvp, editToken: null })
        setHouseholdUnread(false)
        setPhase('ready')
      },
      (cause: unknown) => {
        if (stop.signal.aborted) return
        if (isNotFound(cause)) {
          // The link was changed or the household deleted: it opens nothing, so it is forgotten.
          forgetHouseholdToken(token)
          setHouseholdToken(null)
          setHouseholdGone(true)
        } else {
          setHouseholdUnread(true)
        }
        setPhase('ready')
      },
    )
    return () => stop.abort()
  }, [api, token, householdToken, attempt])

  const retryHousehold = useCallback(() => {
    setHouseholdUnread(false)
    setPhase('reading')
    setAttempt((count) => count + 1)
  }, [])

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
        if (isNotFound(cause)) {
          setOwn(null)
          if (householdToken !== null) {
            forgetHouseholdToken(token)
            setHouseholdToken(null)
            setHousehold(null)
            setHouseholdGone(true)
          } else {
            forgetEditToken(token)
            setForgotten(true)
          }
        }
        setFailure(failureOf(cause))
        return false
      } finally {
        busy.current = false
        setSending(false)
      }
    },
    [token, householdToken],
  )

  const submit = useCallback(
    (input: GuestRsvpInput, website: string) =>
      write(async () => {
        if (householdToken !== null) {
          // A household has one reply: a second answer changes it, and no reply token comes back.
          const sent = await api.guestHouseholdRsvpCreate(token, householdToken, {
            ...input,
            website,
          })
          setOwn({ reply: sent.rsvp, editToken: null })
          return
        }
        const created = await api.guestRsvpCreate(token, { ...input, website })
        storeEditToken(token, created.editToken)
        setOwn({ reply: created.rsvp, editToken: created.editToken })
        setForgotten(false)
      }),
    [api, token, write, householdToken],
  )

  const update = useCallback(
    (current: OwnReply, input: GuestRsvpInput) =>
      write(async () => {
        if (current.editToken === null) {
          const changed = await api.guestHouseholdRsvpUpdate(token, householdToken ?? '', input)
          setOwn({ reply: changed.rsvp, editToken: null })
          return
        }
        const changed = await api.guestRsvpUpdate(token, current.editToken, input)
        setOwn({ reply: changed.rsvp, editToken: current.editToken })
      }),
    [api, token, write, householdToken],
  )

  const remove = useCallback(
    (current: OwnReply) =>
      write(async () => {
        if (current.editToken === null) {
          // The household keeps its link: it may answer again.
          await api.guestHouseholdRsvpDelete(token, householdToken ?? '')
          setOwn(null)
          return
        }
        await api.guestRsvpDelete(token, current.editToken)
        forgetEditToken(token)
        setOwn(null)
      }),
    [api, token, write, householdToken],
  )

  const clearFailure = useCallback(() => setFailure(null), [])

  return {
    phase,
    own,
    household,
    householdUnread,
    householdGone,
    retryHousehold,
    sending,
    failure,
    forgotten,
    submit,
    update,
    remove,
    clearFailure,
  }
}
