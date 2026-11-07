import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { useToast } from '../../../design-system/components/useToast'
import { asError, isAbortError } from '../../../lib/http'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { NOTHING_TO_UNDO_MS } from '../lib/optimisticOverlay'
import { restoringDecision, TARGET_STATUS } from '../lib/restoringDecision'
import { useOptimisticDecisions } from './useOptimisticDecisions'
import type { StreamSignal } from '../../../lib/realtime/useEventStream'
import type { GuestbookQueueItemDto, ModerationDecision, PhotoStatus } from '../../../lib/api/dto'

/**
 * The guestbook as the moderation console reads it (spec 15): the messages of one status,
 * the badge, what a decision looks like before the server confirms it, and what "annuler"
 * puts back. The sibling of `useModerationQueue`, for text instead of photos.
 *
 * It opens no stream. The console calls `useEventStream` once and hands every signal to
 * `onSignal`, so one console holds one connection (`maxStreamsPerClient` is a ceiling per
 * client, and the photo queue already holds one).
 */

export type GuestbookFilter = PhotoStatus | 'all'

/** A burst of guests writing is one reading, not one per signal: the book is read whole. */
export const SIGNAL_DEBOUNCE_MS = 300

/** The book is bounded at 500 messages; the active tab reads all of them. */
const ACTIVE_LIMIT = 500

/** The badge alone needs the count, which the server computes from the whole book. */
const BADGE_LIMIT = 1

export interface GuestbookModerationOptions {
  /** The tab is showing: it reads the list. Otherwise only the badge is kept fresh. */
  readonly active: boolean
  /** The event has a guestbook (`allowGuestbook`). Off: no call at all. */
  readonly enabled?: boolean
  readonly debounceMs?: number
  /** The status shown first; `pending` unless a surface lists something else (the phone's wall strip). */
  readonly initialFilter?: GuestbookFilter
  /**
   * Automatic moderation: nothing is ever pending, so the badge counts what went to the wall
   * since this instant (ISO), while the tab is not the active one. `null` otherwise.
   */
  readonly watchPublishedSince?: string | null
}

export interface GuestbookModeration {
  readonly items: readonly GuestbookQueueItemDto[]
  /** The whole book's pending messages, whatever the filter. */
  readonly pendingCount: number
  /** Messages published since `watchPublishedSince`; 0 when it is not set. */
  readonly freshPublishedCount: number
  readonly loading: boolean
  /** The failed loud read; a failed silent read keeps the list on screen and sets nothing. */
  readonly error: Error | null
  readonly filter: GuestbookFilter
  readonly canUndo: boolean
  /** A decision is in flight: a surface that advances on its own waits. */
  readonly busy: boolean
  setFilter: (filter: GuestbookFilter) => void
  refresh: () => void
  decide: (entryId: string, decision: ModerationDecision) => Promise<void>
  undo: () => Promise<void>
  /** Hand it every signal of the console's stream; it acts on `guestbook.changed` only. */
  onSignal: (signal: StreamSignal) => void
}

interface UndoEntry {
  readonly id: string
  readonly restoreWith: ModerationDecision
}

const matches = (filter: GuestbookFilter, status: PhotoStatus): boolean =>
  filter === 'all' || filter === status

export const useGuestbookModeration = (
  slug: string | undefined,
  {
    active,
    enabled = true,
    debounceMs = SIGNAL_DEBOUNCE_MS,
    watchPublishedSince = null,
    initialFilter = 'pending',
  }: GuestbookModerationOptions,
): GuestbookModeration => {
  const api = useApi()
  const toast = useToast()
  const text = useTranslations()
  const live = enabled && slug !== undefined

  const [filter, setFilterState] = useState<GuestbookFilter>(initialFilter)
  const [items, setItems] = useState<readonly GuestbookQueueItemDto[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [freshPublishedCount, setFreshPublishedCount] = useState(0)
  const [loading, setLoading] = useState(live)
  const [error, setError] = useState<Error | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const {
    busy,
    startRead,
    send: sendDecisions,
    answer: answerDecisions,
    fail: failDecisions,
    overlay,
    beginBusy,
    endBusy,
  } = useOptimisticDecisions()

  const loadedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const undoRef = useRef<UndoEntry | null>(null)
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  /** One read. `loud` lets its failure show; a signal's never does. */
  const read = useCallback(
    (loud: boolean) => {
      if (!live || slug === undefined) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const index = startRead()
      const watching = !active && watchPublishedSince !== null
      const query = active
        ? { status: filter, limit: ACTIVE_LIMIT }
        : watching
          ? { status: 'published' as const, limit: ACTIVE_LIMIT }
          : { limit: BADGE_LIMIT }
      api
        .guestbookQueue(slug, controller.signal, query)
        .then((answer) => {
          if (controller.signal.aborted) return
          // A read that started before a decision answers about the message as it was.
          const { rows, pendingDelta } = overlay(answer.items, index)
          const pending = answer.pendingCount + pendingDelta
          loadedRef.current = true
          setPendingCount(Math.max(0, pending))
          if (active) setItems(rows.filter((row) => matches(filter, row.status)))
          setFreshPublishedCount(
            watching
              ? rows.filter(
                  (row) => row.status === 'published' && row.createdAt > watchPublishedSince,
                ).length
              : 0,
          )
          setError(null)
          setLoading(false)
        })
        .catch((cause: unknown) => {
          if (isAbortError(cause) || controller.signal.aborted) return
          setLoading(false)
          if (loud || !loadedRef.current) setError(asError(cause))
        })
    },
    [api, slug, live, active, filter, watchPublishedSince, startRead, overlay],
  )

  // The first read, and the one after a change of tab or of status: those may show a failure.
  useEffect(() => {
    if (!live) return undefined
    read(true)
    return () => abortRef.current?.abort()
  }, [live, read])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )
  const readRef = useRef(read)
  useEffect(() => {
    readRef.current = read
  }, [read])

  const onSignal = useCallback(
    (signal: StreamSignal) => {
      if (signal.type !== 'guestbook.changed' || !live) return
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        readRef.current(false)
      }, debounceMs)
    },
    [live, debounceMs],
  )

  const send = useCallback(
    async (entryId: string, decision: ModerationDecision): Promise<PhotoStatus | null> => {
      if (slug === undefined) return null
      const target = TARGET_STATUS[decision]
      const before = itemsRef.current.find((row) => row.id === entryId)
      const sent = sendDecisions(new Map([[entryId, target]]))
      // Visible at once; the server's answer and the next read correct it.
      setItems((rows) =>
        rows
          .map((row) =>
            row.id === entryId ? { ...row, status: target, allowedDecisions: [] } : row,
          )
          .filter((row) => matches(filter, row.status)),
      )
      if (before?.status === 'pending') setPendingCount((n) => Math.max(0, n - 1))
      beginBusy()
      try {
        await api.decideGuestbookEntry(slug, entryId, decision)
        answerDecisions(sent)
        readRef.current(false)
        return before?.status ?? null
      } catch (cause) {
        failDecisions(sent)
        toast.show(messageForError(cause, text), { tone: 'danger' })
        readRef.current(false)
        return null
      } finally {
        endBusy()
      }
    },
    [
      api,
      slug,
      filter,
      toast,
      text,
      sendDecisions,
      answerDecisions,
      failDecisions,
      beginBusy,
      endBusy,
    ],
  )

  const decide = useCallback(
    async (entryId: string, decision: ModerationDecision) => {
      const before = itemsRef.current.find((row) => row.id === entryId)
      const previous = await send(entryId, decision)
      if (previous === null || before === undefined) return
      const restore = restoringDecision(previous, TARGET_STATUS[decision])
      undoRef.current =
        restore.decision === null ? null : { id: entryId, restoreWith: restore.decision }
      setCanUndo(undoRef.current !== null)
    },
    [send],
  )

  const undo = useCallback(async () => {
    const entry = undoRef.current
    if (entry === null) {
      toast.show(text.moderation.nothingToUndo, { tone: 'neutral', durationMs: NOTHING_TO_UNDO_MS })
      return
    }
    undoRef.current = null
    setCanUndo(false)
    await send(entry.id, entry.restoreWith)
  }, [send, toast, text])

  const setFilter = useCallback((next: GuestbookFilter) => {
    undoRef.current = null
    setCanUndo(false)
    setLoading(true)
    setFilterState(next)
  }, [])

  const refresh = useCallback(() => {
    setLoading(true)
    read(true)
  }, [read])

  return useMemo(
    () => ({
      items,
      pendingCount,
      freshPublishedCount,
      loading: loading && live,
      error,
      filter,
      canUndo,
      busy,
      setFilter,
      refresh,
      decide,
      undo,
      onSignal,
    }),
    [
      items,
      pendingCount,
      freshPublishedCount,
      loading,
      live,
      error,
      filter,
      canUndo,
      busy,
      setFilter,
      refresh,
      decide,
      undo,
      onSignal,
    ],
  )
}
