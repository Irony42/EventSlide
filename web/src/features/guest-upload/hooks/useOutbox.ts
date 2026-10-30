import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { currentCsrfToken } from '../../../lib/http'
import { apiOutboxSender } from '../../../lib/offline/apiSender'
import { drainOutbox } from '../../../lib/offline/drainOutbox'
import { isOfflineQueueEnabled } from '../../../lib/offline/killSwitch'
import { openOutbox } from '../../../lib/offline/openOutbox'
import { acceptsFileType } from '../../../lib/offline/outboxPolicy'
import { announceHandOver, listenForHandOver } from '../../../lib/offline/outboxSignal'
import { requestBackgroundSync } from '../../../lib/offline/serviceWorker'
import type { DrainReport } from '../../../lib/offline/drainOutbox'
import type { OutboxHandOff, OutboxStore } from '../../../lib/offline/outbox'

/**
 * The guest's photos that are on the device but not yet on the server.
 *
 * View-state over a store, in the same spirit as `useUploadQueue`: what a photo weighs,
 * whether the event will take it and whether these bytes are already there are all the
 * server's answers. This hook owns two facts — how many photos are waiting, and whether
 * a drain is running — and the moments at which it is worth trying again.
 *
 * Those moments are deliberately not a timer. A poll would wake a phone in someone's
 * pocket every thirty seconds for a whole evening; `online` and a tab becoming visible
 * are the two events that actually correlate with a connection existing, and Background
 * Sync covers the case where there is no tab at all.
 */

/**
 * How long to wait after a drain that threw rather than reported.
 *
 * Only the store can throw here — the sender maps every network and server failure to
 * an outcome — so this is the "the database is unhappy" path. A minute is long enough
 * not to hammer it and short enough that a guest who backgrounds and returns finds the
 * queue moving again.
 */
const RETRY_AFTER_FAILURE_MS = 60_000

export interface UseOutboxOptions {
  readonly slug: string
  /**
   * Called after every drain that moved something, with the entry ids it moved.
   *
   * Ids, so the upload screen can settle the exact rows that arrived. A count would be
   * right only while the device holds nothing from an earlier visit, which is the one
   * case this feature exists for.
   */
  readonly onDrained?: (report: DrainReport) => void
  /**
   * Opens the store. Injected because jsdom has no IndexedDB, which is the only reason
   * this hook can be tested at all; the default is the real thing with its own
   * in-memory fallback.
   */
  readonly open?: () => Promise<OutboxStore>
  /** Epoch milliseconds. Injected so a test never depends on wall-clock ordering. */
  readonly now?: () => number
}

export interface Outbox {
  /** How many photos this device is still holding for this event. */
  readonly waiting: number
  readonly draining: boolean
  /** `false` when the kill switch is off, or before the store has opened. */
  readonly ready: boolean
  /**
   * Stores a photo for later. Resolves to the entry id, or `null` when the outbox could
   * not take it — in which case the caller must report the failure to the guest rather
   * than promise a delivery nobody is left to make.
   */
  readonly enqueue: (
    file: File,
    caption: string | null,
    missionId: string | null,
  ) => Promise<string | null>
  /**
   * Forgets a stored photo.
   *
   * The counterpart of a guest taking a row back: without it, removing a queued photo
   * from the screen would leave the bytes on the device and the upload would happen
   * anyway, minutes later, with nothing on screen to explain it.
   */
  readonly discard: (entryId: string) => Promise<void>
  /** Tries everything now. Safe to call when offline; it simply finds nothing to do. */
  readonly drain: () => void
  /**
   * Registers what the screen would still owe the server if the guest left it now (INV-1).
   *
   * Read once, at unmount, before the store is closed: those photos are written to the outbox
   * instead of being dropped with the screen, and Background Sync is asked to finish them where
   * the browser has it. `null` withdraws the registration. A callback registered here and not
   * an argument of `useOutbox`, because the queue that knows the photos needs this hook's
   * result to be built and a hook cannot be given what it produces.
   */
  readonly keepOnLeave: (provider: (() => readonly OutboxHandOff[]) | null) => void
}

export const useOutbox = (options: UseOutboxOptions): Outbox => {
  const { slug } = options
  const api = useApi()

  const [waiting, setWaiting] = useState(0)
  const [draining, setDraining] = useState(false)
  const [ready, setReady] = useState(false)

  /**
   * The callbacks, held in refs rather than in dependency arrays.
   *
   * Every one of them is naturally written as an inline arrow at the call site, so
   * depending on their identity would reopen the database on every render — which is
   * not a theoretical tidiness point: it emptied the store between a guest pressing
   * "Envoyer" and the queue reading it back.
   */
  const latest = useRef(options)

  /** Captured once. A screen does not change which store it is using mid-evening. */
  const open = useRef(options.open ?? openOutbox)

  /**
   * Declared before every other effect in this hook, so the callbacks are current by
   * the time the one that opens the store runs. Writing a ref during render is what
   * `react-hooks/refs` forbids, and for a good reason: a render React throws away
   * would otherwise leave the ref pointing at work that never happened.
   */
  useEffect(() => {
    latest.current = options
  })

  const store = useRef<OutboxStore | null>(null)
  /** One drain at a time. Two overlapping ones would fight over the same claims. */
  const running = useRef(false)
  /** What to write to the store when the screen unmounts, if the queue registered anything. */
  const leaving = useRef<(() => readonly OutboxHandOff[]) | null>(null)
  /**
   * The hand-over in progress, which the store's closing waits for.
   *
   * Reading a photo's bytes and writing them are asynchronous, and the cleanup that closes the
   * store runs in the same commit as the one that starts them: closing at once would refuse
   * every write and lose exactly the photos this exists to keep.
   */
  const handingOver = useRef<Promise<void> | null>(null)
  /**
   * The writes `enqueue` has begun and not finished, which the store's closing waits for as well.
   *
   * A guest who leaves while a photo is being written to the outbox (offline, the network refusing)
   * would otherwise see the store closed under that write, and the photo — which the queue no longer
   * hands over, because this write is already keeping it — would be lost.
   */
  const writes = useRef(new Set<Promise<unknown>>())
  /** `handOver`, read through a ref for the reason `drainRef` is: the cleanup that calls it is declared first. */
  const handOverRef = useRef<
    (opened: OutboxStore, photos: readonly OutboxHandOff[]) => Promise<void>
  >(async () => {})
  /**
   * Which run of the opening effect is the live one.
   *
   * A boolean cannot say this, and a boolean is what was here. The effect set it to
   * `false` on entry and its cleanup set it to `true`; React runs cleanup *then* the
   * next effect, so a previous run's `await open()` resumed to find the flag reset,
   * assigned its database over the live one and leaked the handle. StrictMode makes
   * that every mount in development, and a held-open connection is not merely untidy:
   * `deleteDatabase` blocks on it, and `deleteOutboxDb` resolves on `blocked` — so the
   * kill switch reported success while the photos stayed on the device.
   *
   * A counter makes "am I still the current run?" answerable, which is the actual
   * question.
   */
  const generation = useRef(0)
  /**
   * The one pending follow-up drain.
   *
   * A single handle, replaced on every drain, so a screen open for an evening arms one
   * timer rather than accumulating one per attempt.
   */
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)

  const now = useCallback((): number => latest.current.now?.() ?? Date.now(), [])

  /**
   * Arms the single follow-up drain, or disarms it when nothing is left.
   *
   * `drainNow` is read from a ref rather than taken as an argument because the two
   * refer to each other; a `useCallback` pair would be a dependency cycle React cannot
   * resolve.
   */
  const drainRef = useRef<(reclaim?: boolean) => Promise<void>>(async () => {})
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

  const count = useCallback(async () => {
    const opened = store.current
    if (opened === null) return
    const held = await opened.list(slug)
    // Guarded on the store rather than on a flag: the cleanup nulls it, so a promise
    // resolving into an unmounted screen has nothing to write about.
    if (store.current === opened) setWaiting(held.length)
  }, [slug])

  const drainNow = useCallback(
    async (reclaim = false) => {
      const opened = store.current
      if (opened === null || running.current) return
      // Attempts are only spent where there is something to spend them on. Draining into
      // a browser that already knows it is offline would burn an entry's budget on
      // discovering what `navigator.onLine` had just said, and a guest standing in a dead
      // zone for an evening would lose photos to the attempt ceiling rather than to the
      // network.
      if (!navigator.onLine) return
      running.current = true
      setDraining(true)
      try {
        const report = await drainOutbox({
          store: opened,
          slug,
          send: apiOutboxSender(api),
          now,
          reclaim,
        })
        if (store.current !== opened) return
        setWaiting(report.remaining)
        // Only when something actually moved: refreshing "Vos envois" after a drain that
        // sent nothing would put a spinner on the screen every time a guest walks past a
        // dead access point.
        if (report.sent.length > 0 || report.discarded.length > 0)
          latest.current.onDrained?.(report)
        schedule(report.retryAfterMs)
      } catch (cause) {
        // Nothing in the drain is expected to throw — the sender maps every failure to
        // an outcome — so reaching here means the store itself failed, most likely a
        // transaction against a database that has since been closed. Without this the
        // timer was never re-armed and the queue froze for the rest of the visit, which
        // is a far worse answer than trying again in a minute.
        console.warn('the outbox drain failed; it will be retried', cause)
        if (store.current === opened) schedule(RETRY_AFTER_FAILURE_MS)
      } finally {
        running.current = false
        setDraining(false)
      }
    },
    [api, now, schedule, slug],
  )

  useEffect(() => {
    drainRef.current = drainNow
  }, [drainNow])

  /**
   * On unmount only, and **declared before the effect that opens the store**: React runs
   * cleanups in declaration order, so this one reads the registered photos and starts writing
   * them while the store is still open, and the next cleanup closes it only once they are done.
   * An empty dependency list is the point. A dependency that changed would run this cleanup as
   * if the guest had left, and write photos they are still sending.
   */
  useEffect(() => {
    return () => {
      const opened = store.current
      const photos = leaving.current?.() ?? []
      if (opened === null || photos.length === 0) return
      handingOver.current = handOverRef.current(opened, photos)
    }
  }, [])

  useEffect(() => {
    generation.current += 1
    const mine = generation.current

    if (!isOfflineQueueEnabled()) {
      // The switch is off. No store is opened, so `enqueue` refuses and the upload
      // screen reports failures exactly as it did before this feature existed.
      return
    }

    void (async () => {
      let opened: OutboxStore
      try {
        opened = await open.current()
      } catch (cause) {
        // `openOutbox` has its own fallback and does not reject, so this is a caller
        // that injected something stricter. Without the catch the rejection escaped the
        // effect entirely and the screen was left with no store and no explanation.
        console.warn('the outbox could not be opened', cause)
        return
      }

      // Superseded while the database was opening — a StrictMode remount, or a slug
      // change. Closing it here is what keeps `deleteDatabase` from blocking on a
      // handle nobody is left holding.
      if (generation.current !== mine) {
        opened.close()
        return
      }
      store.current = opened
      setReady(true)

      try {
        await count()
        // A guest arriving with photos from a previous visit is the whole point: they
        // closed the tab in the car park and the photos go up when they walk back in.
        //
        // Reclaiming, because a claim found at this moment was left by a service worker
        // the browser killed, or by a tab that is gone. See `DrainOptions.reclaim`.
        await drainNow(true)
      } catch (cause) {
        // A database that answered the open and then failed the first read. Arming the
        // retry rather than giving up is what stops one bad moment at mount from
        // freezing the queue for the whole visit.
        console.warn('the outbox could not be read on arrival; it will be retried', cause)
        schedule(RETRY_AFTER_FAILURE_MS)
      }
    })()

    return () => {
      generation.current += 1
      if (retry.current !== null) clearTimeout(retry.current)
      retry.current = null
      const closing = store.current
      store.current = null
      // Behind a hand-over or a write that is still going: see `handingOver` and `writes`.
      const pending: Promise<unknown>[] = [...writes.current]
      if (handingOver.current !== null) pending.push(handingOver.current)
      handingOver.current = null
      if (pending.length === 0) closing?.close()
      else void Promise.allSettled(pending).then(() => closing?.close())
    }
  }, [count, drainNow, schedule])

  useEffect(() => {
    const retry = () => {
      if (!navigator.onLine) return
      void drainNow()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') retry()
    }

    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [drainNow])

  useEffect(() => {
    // Another screen of this event has just written photos here (see `outboxSignal`): a fast Back
    // and return finds the first look at the store done before the hand-over's writes had landed.
    return listenForHandOver(slug, () => {
      void count().then(() => drainNow())
    })
  }, [count, drainNow, slug])

  /**
   * Writes one photo to a store that is already open.
   *
   * The store is a parameter and is not read from `store.current`, because the hand-over at
   * unmount keeps writing after that ref has been emptied. Resolves to the entry id, or
   * `null` when the store could not take it.
   */
  const storeIn = useCallback(
    async (
      opened: OutboxStore,
      file: File,
      caption: string | null,
      missionId: string | null,
    ): Promise<string | null> => {
      if (!acceptsFileType(file.type)) {
        // Refused before a byte is read, and said out loud rather than swallowed. The
        // drain sends to the photo route, which would refuse a clip for ever — and
        // entries drain oldest first, so eighty unsendable megabytes sit in front of
        // every photograph behind them. `outboxPolicy.acceptsFileType` holds the
        // reasoning.
        //
        // The caller sees the same `null` every other refusal produces, and reports it
        // the same generic way — `useUploadQueue.storeForLater` has no vocabulary for
        // *why* the store said no. That is acceptable only because nothing routes a
        // video here: the guest surface sends clips through `useClipUpload`, which says
        // `fr.upload.clipNotQueued` in its own words. This is the backstop for a caller
        // that has not been written yet, and it is a log line rather than a sentence.
        console.warn('the outbox does not keep video for later; it is sent now or not at all')
        return null
      }
      let id: string
      try {
        // Read here rather than in the store, so the one place that touches a `File` is
        // the one place that has one: the store's contract is bytes.
        const bytes = await file.arrayBuffer()
        const added = await opened.add(
          {
            slug,
            bytes,
            fileName: file.name,
            fileType: file.type,
            caption,
            missionId,
            // Captured now, because the worker that may send this has no
            // `document.cookie`. See `OutboxEntry.csrfToken`.
            csrfToken: currentCsrfToken(),
          },
          now(),
        )
        id = added.entry.id
        if (added.evicted.length > 0) {
          // The per-event cap just dropped the oldest photos to make room. Reported
          // through the same channel a drain uses, because the screen's response is the
          // same one: those rows have to stop claiming they are waiting for the network
          // when the bytes behind them are gone.
          latest.current.onDrained?.({
            sent: [],
            discarded: added.evicted,
            remaining: 0,
            retryAfterMs: null,
          })
        }
      } catch (cause) {
        // A storage quota refusal, most likely. The caller reports the failure, and a
        // photo the guest can still see and retry beats one the app claims it kept.
        console.warn('the photo could not be stored for later', cause)
        return null
      }
      return id
    },
    [now, slug],
  )

  const enqueue = useCallback(
    async (
      file: File,
      caption: string | null,
      missionId: string | null,
    ): Promise<string | null> => {
      const opened = store.current
      if (opened === null) return null
      const write = (async (): Promise<string | null> => {
        const id = await storeIn(opened, file, caption, missionId)
        if (id === null) return null
        await count()
        // Best effort, and never awaited for its answer: the foreground drain is what
        // every guest gets, and this only adds the case where there is no tab left.
        void requestBackgroundSync()
        return id
      })()
      writes.current.add(write)
      try {
        return await write
      } finally {
        writes.current.delete(write)
      }
    },
    [count, storeIn],
  )

  /**
   * The photos a guest was still sending when they left the screen (INV-1), written to the
   * store they would otherwise have been dropped from.
   *
   * One at a time and in order, because the drain sends oldest first and the order of a batch is
   * the order the guest chose. A photo that cannot be read or stored is skipped, and the rest
   * still go: this runs once, with nobody left on screen to be told, so stopping at the first
   * failure would only lose more.
   */
  const handOver = useCallback(
    async (opened: OutboxStore, photos: readonly OutboxHandOff[]): Promise<void> => {
      let stored = 0
      for (const photo of photos) {
        try {
          const file = await photo.file()
          if ((await storeIn(opened, file, photo.caption, photo.missionId)) !== null) stored += 1
        } catch (cause) {
          console.warn('a photo could not be handed to the outbox on leaving', cause)
        }
      }
      // Once, after the last write: one sync registration covers every entry.
      if (stored > 0) {
        void requestBackgroundSync()
        // And one word to a screen the guest may have reopened in the meantime: see `outboxSignal`.
        announceHandOver(slug)
      }
    },
    [slug, storeIn],
  )
  useEffect(() => {
    handOverRef.current = handOver
  }, [handOver])

  const keepOnLeave = useCallback((provider: (() => readonly OutboxHandOff[]) | null) => {
    leaving.current = provider
  }, [])

  const discard = useCallback(
    async (entryId: string): Promise<void> => {
      const opened = store.current
      if (opened === null) return
      await opened.remove(entryId)
      await count()
    },
    [count],
  )

  const drain = useCallback(() => {
    void drainNow()
  }, [drainNow])

  return { waiting, draining, ready, enqueue, discard, drain, keepOnLeave }
}
