import { useCallback, useRef, useState } from 'react'
import type { SaveRefusal } from './usePhotoSave'
import type { PhotoFeedState } from './usePhotoFeed'

/**
 * Whether the feed offers "Enregistrer" at all, and the one thing to say when it does not
 * (spec 24, sections 3.1 and 3.1 bis).
 *
 * **The route is the door, the buttons are a courtesy.** The feed has no live channel (guests do
 * not hold a stream: that is what the server's limits assume), so the host's switch is read with
 * the wall and a feed left open keeps what it read. A switch thrown meanwhile is found the way the
 * server tells it, `403 save.disabled`, and that is not an exception but the ordinary course of a
 * cut: every button goes, once, with one sentence, instead of eleven refusals one tap at a time.
 * The same holds for a withdrawn or expired access.
 *
 * **Why the order of the reasons matters.** An expired access is the one a guest can do something
 * about, and what they can do depends on the evening: while it is open the code or the link opens
 * it again, and once it is over the door is closed (a guest can only join a live evening), so
 * the sentence sends them to the album's link instead. A withdrawn access outranks a closed
 * switch for no reason of rules, only of kindness: the guest should not be told the host turned
 * saving off when it is them the host turned off.
 *
 * Nothing here reads or writes the server. It sorts what the feed already knows (the wall's
 * switch, the answer about the guest's own list) and what a tap just learned.
 */

export type SaveAccess = 'expired' | 'revoked' | 'disabled'

export interface SaveGate {
  /** Draw a button under each photograph that is somebody else's. */
  readonly offered: boolean
  /** The guest's access has lapsed: the device must stop resuming an evening the server no longer knows it for. */
  readonly expired: boolean
  /** Why not, when the guest should be told. `null`: either all is well or there is nothing to say. */
  readonly why: SaveAccess | null
  /** A photograph vanished under a tap: said once, until the feed is read again. */
  readonly goneNotice: boolean
  /** What a button reports. */
  readonly onRefused: (reason: SaveRefusal) => void
  /** Reads the feed again, and forgets what the last taps learned. */
  readonly refresh: () => void
  /** `true` once per device, for the help line shown before the first share sheet. */
  readonly claimHelp: () => boolean
}

/** The device remembers that the help was shown. The page must work with this refused. */
const HELP_KEY = 'eventslide.saveHelpShown'

const helpWasShown = (): boolean => {
  try {
    return localStorage.getItem(HELP_KEY) !== null
  } catch {
    return false
  }
}

const rememberHelpShown = (): void => {
  try {
    localStorage.setItem(HELP_KEY, '1')
  } catch {
    // Storage refused (a private window, blocked site data): the help is then said once per visit.
  }
}

export const useSaveGate = (feed: PhotoFeedState): SaveGate => {
  const [refused, setRefused] = useState<SaveAccess | null>(null)
  const [goneNotice, setGoneNotice] = useState(false)
  /** Said during this visit, which is what holds when the device cannot remember. */
  const helped = useRef(false)

  const { refresh: readAgain } = feed

  const onRefused = useCallback(
    (reason: SaveRefusal): void => {
      if (reason === 'gone') {
        // The card goes with the next read; the sentence stays, because it would go with it.
        setGoneNotice(true)
        readAgain()
        return
      }
      if (reason === 'unavailable') {
        // The wall answers for the evening: its own "no longer shown" says it, once.
        readAgain()
        return
      }
      setRefused(reason)
    },
    [readAgain],
  )

  const refresh = useCallback((): void => {
    setRefused(null)
    setGoneNotice(false)
    readAgain()
  }, [readAgain])

  const claimHelp = useCallback((): boolean => {
    if (helped.current) return false
    helped.current = true
    if (helpWasShown()) return false
    rememberHelpShown()
    return true
  }, [])

  const why: SaveAccess | null =
    feed.signedOut || refused === 'expired'
      ? 'expired'
      : feed.revoked || refused === 'revoked'
        ? 'revoked'
        : refused === 'disabled'
          ? 'disabled'
          : null

  return {
    // Not before the feed has settled: a button that appears and goes when the guest's own list
    // arrives is the flash `ReactionBar` already avoids for the same reason.
    offered: feed.guestSaveEnabled && why === null && !feed.settling,
    // Said only for an evening where saving is on: a guest whose access lapsed on an evening that
    // never offered saving has nothing to be told about it.
    why: why === null || (why !== 'disabled' && !feed.guestSaveEnabled) ? null : why,
    expired: why === 'expired',
    goneNotice,
    onRefused,
    refresh,
    claimHelp,
  }
}
