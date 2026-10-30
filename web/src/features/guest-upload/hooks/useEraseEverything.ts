import { useCallback, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { forgetGuestSession } from '../../../lib/guestSession'
import { openOutbox } from '../../../lib/offline/openOutbox'

/**
 * "Delete everything I sent" (roadmap §5.2): the one request, and what the device forgets after it.
 *
 * `failed` is a fact, not a sentence: the screen composes the words in the guest's language.
 * On success the device drops the event's session, because the guest it described no longer
 * exists on the server, and the photographs still waiting in the offline outbox for this event,
 * because they would only be sent in the name of a guest who asked for everything to go. The
 * outbox part is best effort: a browser with no IndexedDB has nothing to clear.
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
    } catch {
      setBusy(false)
      setFailed(true)
      return
    }
    try {
      const outbox = await openOutbox()
      try {
        await outbox.clear(slug)
      } finally {
        outbox.close()
      }
    } catch {
      // Nothing to clear, or nowhere to clear it from: the server's answer is what matters.
    }
    forgetGuestSession(slug)
    setBusy(false)
    setDone(true)
  }, [api, slug])

  const dismissFailure = useCallback(() => setFailed(false), [])

  return { busy, failed, done, erase, dismissFailure }
}
