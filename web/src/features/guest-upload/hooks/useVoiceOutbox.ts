import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../../../lib/useApi'
import { apiVoiceSender } from '../../../lib/offline/apiVoiceSender'
import { drainOutbox, type DrainReport } from '../../../lib/offline/drainOutbox'
import { openVoiceOutbox } from '../../../lib/offline/openVoiceOutbox'
import { VOICE_POLICY } from '../../../lib/offline/voicePolicy'
import { baseMimeType, voiceFileName } from '../voiceRecording'
import type { OutboxEntry, OutboxStore } from '../../../lib/offline/outbox'
import type { VoiceRecording } from './useVoiceRecorder'

/**
 * The guest's voice recordings that are on the phone and not yet on the server (spec 25, section 5).
 *
 * A recording is the one thing a guest cannot make again, so it is **written to the phone before any
 * attempt to send it**, in a database of its own (`eventslide-voice`, never the photo outbox) and
 * drained by the page alone: Safari on an iPhone has no Background Sync, and a send that worked only
 * on Android would not be one that survives a venue's Wi-Fi. This hook owns what is waiting, what is
 * **blocked** (kept, with the server's reason) and the moments at which it is worth trying again: the
 * page opening, the network coming back, the page becoming visible, a backoff timer, and the host
 * switching voices back on.
 *
 * It decides no rule of the product. What it holds is the local counter, which stops a guest from
 * putting a fourth recording in the queue when the server will refuse the fourth.
 */

export interface UseVoiceOutboxOptions {
  readonly slug: string
  /** The event has a guestbook at all: otherwise nothing is opened and nothing is asked. */
  readonly enabled: boolean
  /** The server would take a voice message now. Its rising edge sends again what was blocked. */
  readonly offered: boolean
  /** The guest's messages already on the server, `failed` recordings left out: they count against the three. */
  readonly heldOnServer: number
  /** A recording arrived: the list of the guest's messages is read again. */
  readonly onSent: () => void
  /** Opens the store. Injected for tests; the default is IndexedDB with its own memory fallback. */
  readonly open?: () => Promise<OutboxStore>
  /** Epoch milliseconds. Injected so a test never depends on a wall clock. */
  readonly now?: () => number
}

/** What became of a recording the guest sent, in the words the card needs. */
export type VoiceSendResult =
  /** The server has it (still being processed: the list says where). */
  | { readonly kind: 'sent' }
  /** Kept on the phone: no network, or a server that will be asked again. */
  | { readonly kind: 'waiting' }
  /** Kept on the phone and not retried: the event refused the moment (`code`). */
  | { readonly kind: 'blocked'; readonly code: string }
  /** The server refused the recording itself and it is gone (`code`). */
  | { readonly kind: 'rejected'; readonly code: string }
  /** The phone could not keep it, so nothing was promised. */
  | { readonly kind: 'failed' }

export interface VoiceOutbox {
  /** Everything held, oldest first, blocked ones included. */
  readonly entries: readonly OutboxEntry[]
  /** Held and being retried: the "attend un réseau" count. */
  readonly waiting: number
  readonly draining: boolean
  /**
   * Writes the recording to the phone, then tries to send it. Resolves once the first attempt has
   * been made, which is when the thanks (or the reason) can be said truthfully.
   */
  readonly send: (recording: VoiceRecording, caption: string | null) => Promise<VoiceSendResult>
  /** Forgets a recording the guest deleted. */
  readonly discard: (entryId: string) => Promise<void>
  /** Tries everything now. Safe offline: it simply finds nothing to do. */
  readonly drain: () => void
  /** The most a guest may have, texts and voices together, and how many they already have. */
  readonly atLimit: boolean
}

/** The server's ceiling per guest (`MAX_ENTRIES_PER_GUEST`), as the phone's local counter reads it. */
const RECORDINGS_PER_GUEST = VOICE_POLICY.maxEntriesPerEvent

/** After a drain that threw (only the store can): not hammering it, not leaving the queue frozen. */
const RETRY_AFTER_FAILURE_MS = 60_000

/** `Blob.arrayBuffer`, with the reader as a fallback for a runtime that does not have it. */
const bytesOf = (blob: Blob): Promise<ArrayBuffer> => {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('the recording could not be read'))
    reader.readAsArrayBuffer(blob)
  })
}

export const useVoiceOutbox = (options: UseVoiceOutboxOptions): VoiceOutbox => {
  const { slug, enabled, offered } = options
  const api = useApi()
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  const [entries, setEntries] = useState<readonly OutboxEntry[]>([])
  const [draining, setDraining] = useState(false)

  const store = useRef<OutboxStore | null>(null)
  const running = useRef(false)
  /** A drain was asked for while one ran: one more follows it, so an entry added meanwhile is not forgotten. */
  const again = useRef(false)
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generation = useRef(0)
  const drainRef = useRef<(reclaim?: boolean) => Promise<DrainReport | null>>(async () => null)

  const now = useCallback((): number => latest.current.now?.() ?? Date.now(), [])

  const refresh = useCallback(async () => {
    const opened = store.current
    if (opened === null) return
    const held = await opened.list(slug)
    if (store.current === opened) setEntries(held)
  }, [slug])

  const schedule = useCallback((afterMs: number | null) => {
    if (retry.current !== null) {
      clearTimeout(retry.current)
      retry.current = null
    }
    if (afterMs === null || store.current === null) return
    retry.current = setTimeout(() => {
      retry.current = null
      void drainRef.current()
    }, afterMs)
  }, [])

  const drainNow = useCallback(
    async (reclaim = false): Promise<DrainReport | null> => {
      const opened = store.current
      if (opened === null) return null
      if (running.current) {
        again.current = true
        return null
      }
      // Attempts are only spent where there is something to spend them on, as for a photo.
      if (!navigator.onLine) return null
      running.current = true
      let report: DrainReport | null = null
      try {
        const held = await opened.list(slug)
        if (store.current !== opened) return null
        if (held.some((entry) => entry.blockedCode == null)) setDraining(true)
        report = await drainOutbox({
          store: opened,
          slug,
          send: apiVoiceSender(api),
          now,
          policy: VOICE_POLICY,
          reclaim,
        })
        if (store.current !== opened) return report
        await refresh()
        if (report.sent.length > 0) latest.current.onSent()
        schedule(report.retryAfterMs)
      } catch (cause) {
        console.warn('the voice queue could not be drained; it will be retried', cause)
        if (store.current === opened) schedule(RETRY_AFTER_FAILURE_MS)
      } finally {
        running.current = false
        setDraining(false)
      }
      if (again.current) {
        again.current = false
        void drainRef.current()
      }
      return report
    },
    [api, now, refresh, schedule, slug],
  )

  useEffect(() => {
    drainRef.current = drainNow
  }, [drainNow])

  /** Lets what a refusal of the moment stopped be sent again, then tries. */
  const resume = useCallback(
    async (reclaim: boolean) => {
      const opened = store.current
      if (opened === null) return
      await opened.unblock(slug)
      await refresh()
      await drainNow(reclaim)
    },
    [drainNow, refresh, slug],
  )
  const resumeRef = useRef(resume)
  useEffect(() => {
    resumeRef.current = resume
  }, [resume])

  useEffect(() => {
    if (!enabled) return
    generation.current += 1
    const mine = generation.current
    void (async () => {
      let opened: OutboxStore
      try {
        opened = await (latest.current.open ?? openVoiceOutbox)()
      } catch (cause) {
        console.warn('the voice queue could not be opened', cause)
        return
      }
      if (generation.current !== mine) {
        opened.close()
        return
      }
      store.current = opened
      try {
        const held = await opened.list(slug)
        if (store.current !== opened) return
        setEntries(held)
        // A guest arriving with a recording from an earlier visit is the point of the queue; the page
        // opening is also what lets a blocked one try again. Reclaiming, because a claim found now
        // belongs to a page that is gone.
        if (held.length > 0) await resumeRef.current(true)
      } catch (cause) {
        console.warn('the voice queue could not be read on arrival; it will be retried', cause)
        schedule(RETRY_AFTER_FAILURE_MS)
      }
    })()

    return () => {
      generation.current += 1
      if (retry.current !== null) clearTimeout(retry.current)
      retry.current = null
      const closing = store.current
      store.current = null
      closing?.close()
    }
  }, [enabled, schedule, slug])

  // The host switched voices back on (or the box got an encoder): what was blocked is sent again.
  const wasOffered = useRef(offered)
  useEffect(() => {
    const before = wasOffered.current
    wasOffered.current = offered
    if (offered && !before) void resumeRef.current(false)
  }, [offered])

  useEffect(() => {
    if (!enabled) return
    const trigger = () => {
      if (!navigator.onLine) return
      void drainNow()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') trigger()
    }
    window.addEventListener('online', trigger)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', trigger)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, drainNow])

  const send = useCallback(
    async (recording: VoiceRecording, caption: string | null): Promise<VoiceSendResult> => {
      const opened = store.current
      if (opened === null) return { kind: 'failed' }
      // The local counter: the server will refuse the fourth, so the phone does not keep it.
      if (latest.current.heldOnServer + entries.length >= RECORDINGS_PER_GUEST) {
        return { kind: 'blocked', code: 'guestbook.limitReached' }
      }
      let held: OutboxEntry
      try {
        const bytes = await bytesOf(recording.blob)
        // Written before any attempt: the network failing a moment later must not take it.
        held = (
          await opened.add(
            {
              slug,
              bytes,
              fileName: voiceFileName(recording.mimeType),
              fileType: baseMimeType(recording.mimeType),
              caption,
              missionId: null,
            },
            now(),
          )
        ).entry
      } catch (cause) {
        console.warn('the recording could not be kept on the phone', cause)
        return { kind: 'failed' }
      }
      await refresh()
      const report = await drainNow()
      if (report === null) return { kind: 'waiting' }
      if (report.sent.includes(held.id)) return { kind: 'sent' }
      const refusal = report.refusals.find((candidate) => candidate.id === held.id)
      if (refusal !== undefined) return { kind: refusal.kind, code: refusal.code }
      return { kind: 'waiting' }
    },
    [drainNow, entries.length, now, refresh, slug],
  )

  const discard = useCallback(
    async (entryId: string) => {
      const opened = store.current
      if (opened === null) return
      await opened.remove(entryId)
      await refresh()
    },
    [refresh],
  )

  const drain = useCallback(() => void drainNow(), [drainNow])

  return {
    entries,
    waiting: entries.filter((entry) => entry.blockedCode == null).length,
    draining,
    send,
    discard,
    drain,
    atLimit: options.heldOnServer + entries.length >= RECORDINGS_PER_GUEST,
  }
}
