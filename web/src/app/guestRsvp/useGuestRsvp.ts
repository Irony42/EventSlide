import { useCallback, useEffect, useRef, useState } from 'react'
import type { GuestRsvpInput } from '../../lib/api/client/invite'
import type { GuestOwnRsvpDto } from '../../lib/api/dto'
import { ApiError } from '../../lib/http'
import {
  discardEditTokenFragment,
  forgetEditToken,
  forgetHouseholdToken,
  householdFragmentWasIncomplete,
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
 * On first mount (and when the guest pastes another link into the same tab): a token in the link's
 * fragment is taken and removed from the address bar, and kept. `#r=` is a reply's own token; `#f=`
 * is a **household's personal link** (lot 3), which opens the household's name, places and **one**
 * reply and is shared by every device of the household. A fragment on the link wins over what the
 * device remembers: a `#r=` link makes the device forget its household, and a household link keeps
 * offering the older reply token the device also holds (to read it, and to erase it). A token the
 * box refuses (`404 rsvp.notFound`: the reply was deleted, the link changed) is forgotten, so the
 * guest is asked again and nothing stale is ever shown. The page works without any memory.
 *
 * A household's reply that is gone (erased on another phone) is **not** a dead link: the link still
 * opens the household, which is asked again. Only the read of the household itself, or an answer
 * with its link, being refused makes the device forget the link.
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
  /** The moments it is invited to (lot 4), among the form's. */
  readonly moments: readonly { readonly id: string; readonly label: string }[]
}

export interface GuestRsvpState {
  readonly phase: RsvpPhase
  /** The reply this device (or the link it was opened with) holds, once read. */
  readonly own: OwnReply | null
  /**
   * A reply of this device's own that is **older than the household link** just opened: kept visible
   * so it can be read and erased, never silently shadowed.
   */
  readonly older: OwnReply | null
  /** The household the link opened, once read: the form is then the household's. */
  readonly household: HouseholdView | null
  /** The household's link could not be read (a network failure, not a refusal): ask again. */
  readonly householdUnread: boolean
  /** The household's link was refused and dropped: the page may say so once. */
  readonly householdGone: boolean
  /** The link was cut off (a `#f=` with no token in it): it opens nothing. */
  readonly householdIncomplete: boolean
  readonly retryHousehold: () => void
  /** Reads the household again without leaving the form (its moments changed under a page left open). */
  readonly refreshHousehold: () => void
  /** "Ce n'est pas votre foyer ?": the device forgets the household and the reply token, and asks afresh. */
  readonly forgetDevice: () => void
  readonly removeOlder: () => Promise<boolean>
  /** A send is in flight: the buttons wait, and a second tap sends nothing. */
  readonly sending: boolean
  /** The last write's refusal, as the server's code, or `network` / `busy`; `null` when none. */
  readonly failure: string | null
  /** The device's token was refused and dropped: the page may say so once. */
  readonly forgotten: boolean
  readonly submit: (input: GuestRsvpInput, website: string) => Promise<boolean>
  readonly update: (own: OwnReply, input: GuestRsvpInput) => Promise<boolean>
  readonly remove: (own: OwnReply) => Promise<boolean>
  /** The word of a guest who said no, left in the guestbook (lot 4). */
  readonly leaveNote: (own: OwnReply, text: string, website: string) => Promise<boolean>
  readonly clearFailure: () => void
}

const failureOf = (cause: unknown): string => {
  if (cause instanceof ApiError) return cause.status === 429 ? 'busy' : cause.code
  return 'network'
}

const isNotFound = (cause: unknown): boolean =>
  cause instanceof ApiError && cause.code === 'rsvp.notFound'

/** The tokens the device holds, decided at the start and again when another link is pasted in. */
interface Held {
  readonly household: string | null
  readonly edit: string | null
  readonly incomplete: boolean
}

const NOTHING: Held = { household: null, edit: null, incomplete: false }

export const useGuestRsvp = (token: string, interactive: boolean): GuestRsvpState => {
  const api = useApi()
  // Both fragments are taken (and removed from the bar) before any is chosen: a fragment on the link
  // is the way in and beats the memory.
  const decide = useCallback((): Held => {
    const fromHouseholdLink = takeHouseholdTokenFromFragment(token)
    const fromReplyLink = takeEditTokenFromFragment(token)
    const incomplete = householdFragmentWasIncomplete(token)
    if (fromHouseholdLink !== null) {
      return { household: fromHouseholdLink, edit: readStoredEditToken(token), incomplete: false }
    }
    if (fromReplyLink !== null) {
      // The link in hand is a reply's: the device is not the household's any more.
      forgetHouseholdToken(token)
      return { household: null, edit: fromReplyLink, incomplete: false }
    }
    return {
      household: readStoredHouseholdToken(token),
      edit: readStoredEditToken(token),
      incomplete,
    }
  }, [token])

  // Decided once and lazily, so the first render already knows whether there is something to wait for
  // and no effect has to set state to say so.
  const [initial, setInitial] = useState<Held>(() => {
    if (!interactive) {
      discardEditTokenFragment()
      return NOTHING
    }
    return decide()
  })
  const [householdToken, setHouseholdToken] = useState<string | null>(initial.household)
  const [phase, setPhase] = useState<RsvpPhase>(
    initial.household === null && initial.edit === null ? 'ready' : 'reading',
  )
  const [own, setOwn] = useState<OwnReply | null>(null)
  const [older, setOlder] = useState<OwnReply | null>(null)
  const [household, setHousehold] = useState<HouseholdView | null>(null)
  const [householdUnread, setHouseholdUnread] = useState(false)
  const [householdGone, setHouseholdGone] = useState(false)
  const [incomplete, setIncomplete] = useState(initial.incomplete)
  const [attempt, setAttempt] = useState(0)
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [forgotten, setForgotten] = useState(false)
  const busy = useRef(false)

  const held = initial.edit
  const withHouseholdLink = initial.household !== null

  useEffect(() => {
    if (held === null) return
    const stop = new AbortController()
    api.guestRsvp(token, held, stop.signal).then(
      ({ rsvp }) => {
        if (stop.signal.aborted) return
        const found = { reply: rsvp, editToken: held }
        // With a household link in hand the device's own reply is the older one: shown aside.
        if (withHouseholdLink) setOlder(found)
        else {
          setOwn(found)
          setPhase('ready')
        }
      },
      (cause: unknown) => {
        if (stop.signal.aborted) return
        // Only a refusal of the token itself makes the device forget it: a failed network read
        // leaves the memory alone, and the page asks again as if nothing were known.
        if (isNotFound(cause)) {
          forgetEditToken(token)
          if (!withHouseholdLink) setForgotten(true)
        }
        if (!withHouseholdLink) setPhase('ready')
      },
    )
    return () => stop.abort()
  }, [api, token, held, withHouseholdLink, attempt])

  // The household's link: its name and places, and its reply if it gave one.
  useEffect(() => {
    if (householdToken === null) return
    const stop = new AbortController()
    api.guestHousehold(token, householdToken, stop.signal).then(
      ({ household: opened }) => {
        if (stop.signal.aborted) return
        setHousehold({ name: opened.name, places: opened.places, moments: opened.moments })
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

  // A link pasted into the tab that is already open changes only its hash: nothing would remount, so
  // it is taken (and removed from the bar) here with the same rules as at the start.
  useEffect(() => {
    if (!interactive) return
    const onHashChange = () => {
      if (!/^#[rf]=/.test(window.location.hash)) return
      const next = decide()
      setInitial(next)
      setHouseholdToken(next.household)
      setIncomplete(next.incomplete)
      setOwn(null)
      setOlder(null)
      setHousehold(null)
      setHouseholdGone(false)
      setHouseholdUnread(false)
      setForgotten(false)
      setPhase(next.household === null && next.edit === null ? 'ready' : 'reading')
      setAttempt((count) => count + 1)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [interactive, decide])

  const retryHousehold = useCallback(() => {
    setHouseholdUnread(false)
    setPhase('reading')
    setAttempt((count) => count + 1)
  }, [])

  const refreshHousehold = useCallback(() => setAttempt((count) => count + 1), [])

  const forgetDevice = useCallback(() => {
    forgetHouseholdToken(token)
    forgetEditToken(token)
    setInitial(NOTHING)
    setHouseholdToken(null)
    setOwn(null)
    setOlder(null)
    setHousehold(null)
    setHouseholdGone(false)
    setHouseholdUnread(false)
    setIncomplete(false)
    setForgotten(false)
    setFailure(null)
    setPhase('ready')
  }, [token])

  /**
   * One write at a time, and its refusal kept for the form to say. `ofReply` says the write is about
   * a household's **reply** (a change), whose absence is not the link's: the reply was erased on
   * another phone, and the household is asked again with its link kept.
   */
  const write = useCallback(
    async (run: () => Promise<void>, ofReply = false): Promise<boolean> => {
      if (busy.current) return false
      busy.current = true
      setSending(true)
      setFailure(null)
      try {
        await run()
        return true
      } catch (cause) {
        if (isNotFound(cause)) {
          setOwn(null)
          if (householdToken !== null && ofReply) return false
          // A reply that is gone, or a token refused, is not a stale form to retry: forget it.
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
      }, current.editToken === null),
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
      }, current.editToken === null),
    [api, token, write, householdToken],
  )

  const leaveNote = useCallback(
    (current: OwnReply, text: string, website: string) =>
      write(async () => {
        const key =
          current.editToken === null
            ? { household: householdToken ?? '' }
            : { editToken: current.editToken }
        await api.guestAbsentNote(token, key, { text, website })
        // One word per reply: the page stops offering it, without asking the server again.
        setOwn({ reply: { ...current.reply, absentNoteSent: true }, editToken: current.editToken })
      }, current.editToken === null),
    [api, token, write, householdToken],
  )

  const removeOlder = useCallback(
    () =>
      write(async () => {
        if (older === null || older.editToken === null) return
        try {
          await api.guestRsvpDelete(token, older.editToken)
        } catch (cause) {
          // Already gone: the wish to erase it is done.
          if (!isNotFound(cause)) throw cause
        }
        forgetEditToken(token)
        setOlder(null)
      }),
    [api, token, write, older],
  )

  const clearFailure = useCallback(() => setFailure(null), [])

  return {
    phase,
    own,
    older,
    household,
    householdUnread,
    householdGone,
    householdIncomplete: incomplete,
    retryHousehold,
    refreshHousehold,
    forgetDevice,
    removeOlder,
    sending,
    failure,
    forgotten,
    submit,
    update,
    remove,
    leaveNote,
    clearFailure,
  }
}
