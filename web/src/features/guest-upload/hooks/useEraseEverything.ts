import { useCallback, useState } from 'react'
import { useApi } from '../../../lib/useApi'
import { forgetGuestSession } from '../../../lib/guestSession'
import { ApiError } from '../../../lib/http'
import { clearOutboxFor } from '../../../lib/offline/clearOutbox'

/**
 * "Delete everything I sent" (roadmap §5.2): the one request, and what the device forgets after it.
 *
 * `failed` is a fact, not a sentence: the screen composes the words in the guest's language.
 * On success the device drops the event's session, because the guest it described no longer
 * exists on the server, and the photographs still waiting in the offline outbox for this event,
 * because they would only be sent in the name of a guest who asked for everything to go. The
 * outbox part is best effort: a browser with no IndexedDB has nothing to clear. The voice recordings
 * still on the phone go with the photographs (spec 25).
 */
export interface EraseEverythingState {
  readonly busy: boolean
  readonly failed: boolean
  readonly done: boolean
  readonly erase: () => Promise<void>
  readonly dismissFailure: () => void
}

export function useEraseEverything(slug: string): EraseEverythingState {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState(false)

  const erase = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    try {
      await api.eraseMyContribution(slug)
    } catch (cause) {
      // A 401 means the guest is already gone: an earlier press erased everything and its answer
      // was lost on the way back. Finishing the cleanup is the honest answer, and harmless for a
      // guest who simply lost the token (there is nothing of theirs left to protect on this phone).
      if (!(cause instanceof ApiError && cause.status === 401)) {
        setBusy(false)
        setFailed(true)
        return
      }
    }
    // Both queues, the photos and the voice recordings (spec 25): one that survived would bring back
    // a message its author asked to erase. Never rejects: a store that will not open has nothing to clear.
    await clearOutboxFor(slug)
    forgetGuestSession(slug)
    setBusy(false)
    setDone(true)
  }, [api, slug])

  const dismissFailure = useCallback(() => setFailed(false), [])

  return { busy, failed, done, erase, dismissFailure }
}
