import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { useToast } from '../../../design-system/components/useToast'
import { ApiError, asError, isAbortError } from '../../../lib/http'
import { messageForCode, type UiText } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useEventStream, type StreamSignal } from '../../../lib/realtime/useEventStream'
import type { ModerationDecision, ModerationPhotoDto, PhotoStatus } from '../../../lib/api/dto'
import { expiredIds, NOTHING_TO_UNDO_MS } from '../lib/optimisticOverlay'
import { restoringDecision, TARGET_STATUS } from '../lib/restoringDecision'
import { useOptimisticDecisions } from './useOptimisticDecisions'

/**
 * The moderation queue as view-state: what is loaded, what a decision looks like
 * before the server confirms it, and what "annuler" puts back.
 *
 * The host is standing at a laptop during a party while photos keep arriving, so two
 * properties matter more than anything else here:
 *
 * - **A decision is visible immediately.** Waiting for a 204 before the tile changes
 *   makes the console feel broken on venue Wi-Fi, and a host who is not sure whether
 *   the keystroke registered presses it again. So the status changes locally first and
 *   is rolled back if the server refuses.
 * - **Nothing is ever only local.** The stream carries an invalidation signal, so
 *   every signal refetches. That is what reconciles this optimism with another
 *   moderator on a second laptop, and it is why no code here tries to read a payload.
 */

export type StatusFilter = PhotoStatus | 'all'

/**
 * A row as the boundary hands it over, trusted no further than the wire.
 *
 * `allowedDecisions` arrived with MOD-4. A console bundle that outlives a server rollback
 * (or the other way round) reads rows without it, and every place that offers a button
 * would then throw on `undefined`. An absent field means "the server has not said", which
 * is the same as no decision: the buttons wait for the next read instead of the tab
 * crashing.
 */
const withDecisions = (row: ModerationPhotoDto): ModerationPhotoDto =>
  (row.allowedDecisions as readonly ModerationDecision[] | undefined) === undefined
    ? { ...row, allowedDecisions: [] }
    : row

/**
 * What to say once a decision has landed, for a count of photos.
 *
 * The table is built per call from the copy it is handed rather than at module load,
 * because this is a plain function and the language is whatever the moderator reading
 * the console chose.
 */
const appliedMessage = (decision: ModerationDecision, count: number, text: UiText): string => {
  const phrase: Readonly<Record<ModerationDecision, (count: number) => string>> = {
    publish: text.moderation.published,
    reject: text.moderation.refused,
    hide: text.moderation.removed,
  }
  return phrase[decision](count)
}

interface UndoEntry {
  readonly id: string
  /** What the decision made of it, so a failed undo can roll forward again. */
  readonly currentStatus: PhotoStatus
  /**
   * The decision that takes this one back, resolved when the entry is recorded rather
   * than when "annuler" is pressed — the queue has moved on by then, and the previous
   * status is the one thing the server never recorded.
   */
  readonly restoreWith: ModerationDecision | null
  /** Whether that decision is a restoration or a second decision. See `Restore`. */
  readonly exact: boolean
}

interface QueueState {
  readonly items: readonly ModerationPhotoDto[]
  /**
   * The photos on the wall right now, newest first, when the surface asked for them
   * (`onScreenLimit`). A second, small read beside the filtered one: the phone console
   * has no filters, and "retirer de l'écran" is what a host needs first on a bad night.
   *
   * `null` until that read has answered, and for ever if it never does or was not asked for:
   * an empty list says "nothing is on the wall", which is a claim, and a strip whose read
   * failed must not make it.
   */
  readonly onScreen: readonly ModerationPhotoDto[] | null
  readonly pendingCount: number
  readonly loading: boolean
  /**
   * The failed load, as an `Error` the consoles branch on — one of them keeps the stale
   * queue on screen beside it. An `Error` carries no copy (`error.message` is the server's
   * code, `photo.notFound`), so the sentence is `messageForError(error, t)` at render.
   */
  readonly error: Error | null
}

export interface ModerationQueueOptions {
  /**
   * Also load this many of the photos currently on the wall, newest first (MOD-2). The
   * phone console asks for six; the laptop has the "À l'écran" filter instead.
   */
  readonly onScreenLimit?: number
  /**
   * After a refusal that nothing takes back, put "Voir dans Refusées" on the notice.
   * Only a surface with a filter bar can honour it: on the phone it would empty the
   * screen, which shows nothing but pending photos.
   */
  readonly linkToRejected?: boolean
  /**
   * Whether to open the console's stream here. `false` when the page opens one itself and
   * hands every signal to `onSignal`, so that photos and messages share one connection
   * (spec 15). `connected` is then the page's to report.
   */
  readonly ownStream?: boolean
}

export interface ModerationQueue extends QueueState {
  /** Whether the console is still being told about new photos without a reload. */
  readonly connected: boolean
  readonly filter: StatusFilter
  /** A decision is in flight. Bulk actions show it; single tiles stay usable. */
  readonly busy: boolean
  readonly canUndo: boolean
  setFilter: (filter: StatusFilter) => void
  refresh: () => void
  /** The stream's signals, for a page that owns the connection (`ownStream: false`). */
  onSignal: (signal: StreamSignal) => void
  decide: (photoId: string, decision: ModerationDecision) => Promise<void>
  decideBulk: (photoIds: readonly string[], decision: ModerationDecision) => Promise<void>
  undo: () => Promise<void>
  /** Stars or unstars a published photo as a favourite (spec 08); optimistic, put back on failure. */
  toggleHighlight: (photoId: string) => Promise<void>
}

/**
 * The sentence to show for a failure.
 *
 * An `ApiError` carries the server's stable error code, and the copy for it is more
 * useful than a generic line — "cette action n'est pas possible sur cette photo" tells
 * the host what happened. The table is a parameter rather than something this reads for
 * itself: the moderation console renders in the moderator's own language like every
 * other surface (`web/src/lib/i18n/translations.ts`), and a plain function cannot ask
 * for it. Anything else is a bug in this build, and its message is an English internal
 * string that must not reach a host mid-event.
 */
const failureMessage = (cause: unknown, fallback: string, text: UiText): string =>
  cause instanceof ApiError ? messageForCode(cause.code, text) : fallback

export const useModerationQueue = (
  slug: string | undefined,
  { onScreenLimit, linkToRejected = false, ownStream = true }: ModerationQueueOptions = {},
): ModerationQueue => {
  const text = useTranslations()
  const api = useApi()
  const toast = useToast()

  const [filter, setFilterState] = useState<StatusFilter>('pending')
  const [attempt, setAttempt] = useState(0)
  // Decisions sent and not yet answered, and the written-over rows they cause (WEB-HOST-05).
  const {
    busy,
    startRead,
    readsStarted,
    send: sendDecisions,
    answer: answerDecisions,
    fail: failDecisions,
    overlay,
    beginBusy,
    endBusy,
  } = useOptimisticDecisions()
  const [state, setState] = useState<QueueState>({
    items: [],
    onScreen: null,
    pendingCount: 0,
    // A route with no slug never fetches, so it must not sit on a spinner for ever.
    loading: slug !== undefined,
    error: null,
  })

  /** Read by the decision handlers, so their identity does not change per photo. */
  const itemsRef = useRef<readonly ModerationPhotoDto[]>(state.items)
  useEffect(() => {
    // The wall strip too: a photo taken off the screen is decided like any other.
    itemsRef.current = [...state.items, ...(state.onScreen ?? [])]
  }, [state.items, state.onScreen])

  /**
   * What the server last said about each photo on screen: its status, and the decisions
   * it allows from there.
   *
   * Kept beside the optimistic state so that a local change never invents the second
   * half. `allowedDecisions` is the server's reading of its status machine and this
   * console holds no copy of it: while a decision is only local the photo shows no
   * decision at all, and a rollback or an exact undo gets the server's own answer back.
   *
   * A decision that landed gets it by a silent refetch once the server has answered
   * (`revalidate`), not by waiting for a stream signal: the stream is the thing a venue's
   * network takes away, and a photo just published with no buttons cannot be taken back
   * off the wall from its tile.
   */
  const serverRef = useRef<
    ReadonlyMap<string, { status: PhotoStatus; allowedDecisions: readonly ModerationDecision[] }>
  >(new Map())

  /** Highlight toggles sent and not yet answered, written over reads that predate their answer. */
  const highlightsRef = useRef(
    new Map<string, { value: boolean; settledAfterRead: number | null }>(),
  )
  /** An explicit refresh asked for the next read, which is allowed to show its failure. */
  const loudRef = useRef(false)
  /** The queue (event and tab) whose first read has landed, so a later failure has something to keep. */
  const loadedRef = useRef<string | null>(null)

  const undoRef = useRef<readonly UndoEntry[] | null>(null)
  const undoToastRef = useRef<string | null>(null)
  const [canUndo, setCanUndo] = useState(false)

  useEffect(() => {
    if (slug === undefined) return

    const controller = new AbortController()
    let live = true

    const remember = (rows: readonly ModerationPhotoDto[]) => {
      const next = new Map(serverRef.current)
      for (const row of rows) {
        next.set(row.id, { status: row.status, allowedDecisions: row.allowedDecisions })
      }
      serverRef.current = next
    }

    const startedAt = startRead()
    const queueKey = `${slug}/${filter}`
    // Only the first read of a queue, a tab change and an explicit retry may show a
    // failure. Any other read was nobody's request (a decision landed, a signal came), and
    // the last good rows are still right.
    const quiet = !loudRef.current && loadedRef.current === queueKey
    loudRef.current = false

    /**
     * The rows as the host should see them: the server's answer, with what is still being
     * decided written over it. Those rows show no decisions until a read that started
     * after their decision was answered, which is the server's account of them.
     */
    const readRows = (
      rows: readonly ModerationPhotoDto[],
    ): { readonly rows: readonly ModerationPhotoDto[]; readonly pendingDelta: number } => {
      for (const id of expiredIds(highlightsRef.current, startedAt))
        highlightsRef.current.delete(id)

      const safe = rows.map(withDecisions).map((row) => {
        const toggle = highlightsRef.current.get(row.id)
        return toggle === undefined ? row : { ...row, highlighted: toggle.value }
      })
      remember(safe)

      const { rows: shown, pendingDelta } = overlay(safe, startedAt)
      return { rows: shown, pendingDelta }
    }

    if (onScreenLimit !== undefined) {
      api
        .moderationQueue(slug, { status: 'published', limit: onScreenLimit }, controller.signal)
        .then(
          (response) => {
            if (!live) return
            const { rows: onScreen } = readRows(response.items)
            setState((previous) => ({ ...previous, onScreen }))
          },
          // A convenience beside the queue: a failed read keeps the last strip and says
          // nothing, because the queue's own failure is the one worth a sentence.
          () => undefined,
        )
    }

    api.moderationQueue(slug, { status: filter }, controller.signal).then(
      (response) => {
        if (!live) return
        const { rows: items, pendingDelta } = readRows(response.items)
        loadedRef.current = queueKey
        setState((previous) => ({
          ...previous,
          items,
          pendingCount: Math.max(0, response.pendingCount + pendingDelta),
          loading: false,
          error: null,
        }))
      },
      (cause: unknown) => {
        if (!live) return
        // The abort is this effect's own cleanup — StrictMode mounts twice — and is
        // not a failure to put in front of the host.
        if (isAbortError(cause)) return
        // Nobody asked for this read, and the rows on screen are the last good ones: a
        // line saying the queue is stale, or worse an error page over an emptied phone
        // queue that was "all done", would be a failure the host cannot act on. The next
        // decision or signal reads again. A refused session or access is not a blip: it
        // will refuse every read after it, so it is said even then.
        const refused = cause instanceof ApiError && (cause.status === 401 || cause.status === 403)
        if (quiet && !refused) {
          // A refresh the host pressed may have been superseded by this read (a signal bumped
          // `attempt` first), so its spinner is still up and no other read will clear it.
          setState((previous) => (previous.loading ? { ...previous, loading: false } : previous))
          return
        }
        // The items already on screen are kept: a refetch that failed while the host
        // was working through a screenful must not empty the grid under them.
        setState((previous) => ({ ...previous, loading: false, error: asError(cause) }))
      },
    )

    return () => {
      live = false
      controller.abort()
    }
  }, [api, slug, filter, attempt, onScreenLimit, startRead, overlay])

  /** A host asked for fresh data and should see that something is happening. */
  const refresh = useCallback(() => {
    loudRef.current = true
    setState((previous) => ({ ...previous, loading: true, error: null }))
    setAttempt((current) => current + 1)
  }, [])

  /**
   * A refetch nobody asked for. No spinner: blanking the grid every time a guest
   * uploads would make the console unusable at the exact moment it matters.
   */
  const revalidate = useCallback(() => {
    setAttempt((current) => current + 1)
  }, [])

  const setFilter = useCallback((next: StatusFilter) => {
    setFilterState(next)
    // The grid is emptied below, so there are no last good rows to keep: the next read
    // of any tab is a first read again, and its failure must be shown, not swallowed
    // under a spinner.
    loadedRef.current = null
    // The previous tab's photos are dropped rather than left on screen under the new
    // label: showing published photos under "en attente" for a frame is how a host
    // publishes something twice.
    setState((previous) => ({ ...previous, items: [], loading: true, error: null }))
  }, [])

  /**
   * Move a set of photos to new statuses locally.
   *
   * The one place the optimistic apply, the rollback and the undo all go through, so
   * the three can never disagree about how `pendingCount` moves. The count comes from
   * the server and covers photos beyond the loaded page, so it is adjusted by the
   * change rather than recomputed from what is on screen.
   */
  const setStatuses = useCallback((next: ReadonlyMap<string, PhotoStatus>) => {
    const withStatus = (item: ModerationPhotoDto, status: PhotoStatus): ModerationPhotoDto => {
      const known = serverRef.current.get(item.id)
      return {
        ...item,
        status,
        allowedDecisions: known?.status === status ? known.allowedDecisions : [],
      }
    }
    setState((previous) => {
      let delta = 0
      const items = previous.items.map((item) => {
        const status = next.get(item.id)
        if (status === undefined || status === item.status) return item
        if (item.status === 'pending') delta -= 1
        if (status === 'pending') delta += 1
        return withStatus(item, status)
      })
      const onScreen =
        previous.onScreen?.map((item) => {
          const status = next.get(item.id)
          return status === undefined || status === item.status ? item : withStatus(item, status)
        }) ?? null
      return {
        ...previous,
        items,
        onScreen,
        pendingCount: Math.max(0, previous.pendingCount + delta),
      }
    })
  }, [])

  /**
   * Drop the offer, and take it off the screen with it.
   *
   * The dismissal is the load-bearing half. `ToastProvider` stacks notices and holds one
   * carrying an action for nine seconds, so an offer left on screen after the state
   * behind it is gone is a button that lies: it either acts on a *later* decision than
   * the one it is sitting next to, or — once `undoRef` is null — does nothing at all
   * while the host believes their mistake has been taken back. Neither is visible to
   * anyone; both are one press away at a party.
   */
  const forgetUndo = useCallback(() => {
    undoRef.current = null
    setCanUndo(false)

    const open = undoToastRef.current
    if (open === null) return
    undoToastRef.current = null
    toast.dismiss(open)
  }, [toast])

  const undo = useCallback(async () => {
    const entries = undoRef.current
    if (slug === undefined) return
    if (entries === null || entries.length === 0) {
      // Said rather than ignored (MOD-1): the toolbar promises "Z pour annuler", and a
      // key that answers nothing reads as a keyboard that stopped working.
      toast.show(text.moderation.nothingToUndo, {
        tone: 'neutral',
        durationMs: NOTHING_TO_UNDO_MS,
      })
      return
    }
    // Takes the offer off the screen too: leaving it up invites a second press that
    // would undo the undo.
    forgetUndo()

    /**
     * Grouped by the decision that restores each photo, because one bulk action can
     * span statuses: publishing a refused photo and a hidden one in the same batch is
     * undone by `reject` for the first and `hide` for the second.
     *
     * The optimistic status is taken from that decision rather than from where the
     * photo came from. The two are the same for everything the desktop console offers,
     * and they differ for exactly one case — a publish taken back with `hide` — where
     * showing the photo as "en attente" for a beat would be a status the server is
     * never going to confirm.
     */
    const groups = new Map<ModerationDecision, string[]>()
    const restored = new Map<string, PhotoStatus>()
    for (const entry of entries) {
      const decision = entry.restoreWith
      if (decision === null) continue
      restored.set(entry.id, TARGET_STATUS[decision])
      const group = groups.get(decision)
      if (group === undefined) groups.set(decision, [entry.id])
      else group.push(entry.id)
    }

    const sent = sendDecisions(restored)
    setStatuses(restored)
    beginBusy()
    try {
      const skipped: string[] = []
      const applied = new Set<string>()
      for (const [decision, ids] of groups) {
        // The bulk endpoint for a single photo too: one code path, and it is the one
        // that reports what it could not do instead of failing the lot.
        const response = await api.moderateBulk(slug, ids, decision)
        skipped.push(...response.skipped)
        for (const id of response.applied) applied.add(id)
      }
      answerDecisions(sent, skipped)

      /**
       * What the server refused, put back where the decision left it.
       *
       * A skip is not an error and does not throw: a second moderator who rejected the
       * photo on the laptop in between makes `rejected -> hidden` illegal, and the
       * server says so by skipping rather than failing. Without this the grid would keep
       * showing the restored status the server never stored, under a green line saying
       * the decision was taken back.
       */
      if (skipped.length > 0) {
        const refused = new Set(skipped)
        setStatuses(
          new Map(
            entries.flatMap<[string, PhotoStatus]>((entry) =>
              refused.has(entry.id) ? [[entry.id, entry.currentStatus]] : [],
            ),
          ),
        )
      }

      /**
       * Counted from what the server says it did, not from what was asked minus what it
       * skipped. A photo its guest erased in between is in neither list, and a green
       * "décision annulée" over a photo that no longer exists tells the host something
       * was put back when nothing was.
       */
      const appliedCount = entries.filter((entry) => applied.has(entry.id)).length
      if (appliedCount > 0) {
        /**
         * "Décision annulée" only when it was one.
         *
         * An inexact restore is a second decision, and the only one this app can
         * produce is a publication taken back off the wall with `hide` — so the photo
         * is now `hidden`, not waiting in the queue, and saying "annulée" would send
         * the host looking for it where it is not. Adding another inexact restore means
         * revisiting this line.
         */
        const restoredExactly = entries.every((entry) => entry.exact)
        toast.show(
          restoredExactly ? text.moderation.undone : text.moderation.removed(appliedCount),
          {
            tone: 'success',
          },
        )
      }
      if (skipped.length > 0) {
        toast.show(text.moderation.bulkSkipped(skipped.length), { tone: 'warning' })
      }
      // The restored photos hold no decisions until the server says what they allow.
      revalidate()
    } catch (cause) {
      failDecisions(sent)
      setStatuses(new Map(entries.map((entry) => [entry.id, entry.currentStatus])))
      toast.show(failureMessage(cause, text.moderation.undoFailed, text), { tone: 'danger' })
    } finally {
      endBusy()
    }
  }, [
    api,
    slug,
    text,
    toast,
    setStatuses,
    forgetUndo,
    revalidate,
    sendDecisions,
    answerDecisions,
    failDecisions,
    beginBusy,
    endBusy,
  ])

  /**
   * Report the outcome, and offer to take it back.
   *
   * The undo is offered only when every photo in the batch has a decision that takes it
   * back. A partial undo would be worse than none: the host would believe the whole
   * accident was reversed.
   */
  const announce = useCallback(
    (decision: ModerationDecision, entries: readonly UndoEntry[]) => {
      const message = appliedMessage(decision, entries.length, text)
      const reversible = entries.length > 0 && entries.every((entry) => entry.restoreWith !== null)

      /**
       * Whatever was on offer belongs to a decision the host has now moved past.
       *
       * Unconditional, and before anything new is shown. Two identical "1 photo publiée
       * — Annuler" toasts stacked three seconds apart are indistinguishable, and the
       * older one acts on the newer decision; an offer left over from a publish beside
       * a refusal that cannot be undone is a button that does nothing at all. Both are
       * one press away on a surface that produces an offer per photo.
       */
      forgetUndo()

      if (!reversible) {
        /**
         * A refusal of a photo that was waiting is the one decision nothing takes back,
         * so the notice says where it went instead (MOD-1): "Refusées" is where the host
         * finds it, and a published photo it was mistaken for is not.
         *
         * Held as `undoToastRef` too, so the next decision takes it off the screen like
         * any other offer that no longer describes the latest decision.
         */
        if (decision === 'reject' && linkToRejected && entries.length > 0) {
          const id = toast.show(message, {
            tone: 'success',
            action: {
              label: text.moderation.seeRejected,
              onAction: () => {
                setFilter('rejected')
                forgetUndo()
              },
            },
          })
          undoToastRef.current = id
          return
        }
        toast.show(message, { tone: 'success' })
        return
      }

      undoRef.current = entries
      setCanUndo(true)
      // No duration: `ToastProvider` holds a toast carrying an action for its undo
      // window, which is longer than a notice. A host looks up at the projector to
      // check the decision and looks back — an undo that expired in between is worse
      // than no undo at all, because they believed it was reversible.
      undoToastRef.current = toast.show(message, {
        tone: 'success',
        action: {
          // "Retirer" when the offer is a publication taken back off the wall: that is
          // what pressing it does, and "Annuler" would promise the photo goes back to the
          // queue it is no longer in.
          label: entries.every((entry) => entry.exact)
            ? text.moderation.undo
            : text.moderation.undoPublish,
          onAction: () => {
            void undo()
          },
        },
      })
    },
    [text, toast, undo, forgetUndo, linkToRejected, setFilter],
  )

  const decide = useCallback(
    async (photoId: string, decision: ModerationDecision) => {
      if (slug === undefined) return
      const photo = itemsRef.current.find((item) => item.id === photoId)
      if (photo === undefined) return

      const target = TARGET_STATUS[decision]
      const restore = restoringDecision(photo.status, target)
      const entries: readonly UndoEntry[] = [
        { id: photoId, currentStatus: target, restoreWith: restore.decision, exact: restore.exact },
      ]

      const sent = sendDecisions(new Map([[photoId, target]]))
      setStatuses(new Map([[photoId, target]]))
      beginBusy()
      try {
        await api.moderate(slug, photoId, decision)
        answerDecisions(sent)
        announce(decision, entries)
        revalidate()
      } catch (cause) {
        failDecisions(sent)
        setStatuses(new Map([[photoId, photo.status]]))
        forgetUndo()
        toast.show(failureMessage(cause, text.moderation.decisionFailed, text), { tone: 'danger' })
      } finally {
        endBusy()
      }
    },
    [
      api,
      slug,
      text,
      toast,
      setStatuses,
      announce,
      forgetUndo,
      revalidate,
      sendDecisions,
      answerDecisions,
      failDecisions,
      beginBusy,
      endBusy,
    ],
  )

  const decideBulk = useCallback(
    async (photoIds: readonly string[], decision: ModerationDecision) => {
      if (slug === undefined || photoIds.length === 0) return

      const target = TARGET_STATUS[decision]
      const before = new Map(itemsRef.current.map((item) => [item.id, item.status]))
      const chosen = photoIds.filter((id) => before.has(id))
      if (chosen.length === 0) return

      const sent = sendDecisions(new Map(chosen.map((id) => [id, target])))
      setStatuses(new Map(chosen.map((id) => [id, target])))
      beginBusy()
      try {
        const response = await api.moderateBulk(slug, chosen, decision)
        answerDecisions(sent, response.skipped)

        // The batch skips what it cannot legally do rather than failing wholesale, so
        // the optimism was wrong for exactly those: put them back where they were.
        if (response.skipped.length > 0) {
          const reverted = new Map<string, PhotoStatus>()
          for (const id of response.skipped) {
            const status = before.get(id)
            if (status !== undefined) reverted.set(id, status)
          }
          setStatuses(reverted)
          // Said out loud, with a count. A host who is not told believes forty photos
          // were handled when thirty-eight were.
          toast.show(text.moderation.bulkSkipped(response.skipped.length), { tone: 'warning' })
        }

        const entries = response.applied.flatMap<UndoEntry>((id) => {
          const previousStatus = before.get(id)
          if (previousStatus === undefined) return []
          const restore = restoringDecision(previousStatus, target)
          return [
            { id, currentStatus: target, restoreWith: restore.decision, exact: restore.exact },
          ]
        })
        announce(decision, entries)
        revalidate()
      } catch (cause) {
        failDecisions(sent)
        setStatuses(
          new Map(
            chosen.flatMap<[string, PhotoStatus]>((id) => {
              const status = before.get(id)
              return status === undefined ? [] : [[id, status]]
            }),
          ),
        )
        forgetUndo()
        toast.show(failureMessage(cause, text.moderation.decisionFailed, text), { tone: 'danger' })
      } finally {
        endBusy()
      }
    },
    [
      api,
      slug,
      text,
      toast,
      setStatuses,
      announce,
      forgetUndo,
      revalidate,
      sendDecisions,
      answerDecisions,
      failDecisions,
      beginBusy,
      endBusy,
    ],
  )

  const toggleHighlight = useCallback(
    async (photoId: string) => {
      if (slug === undefined) return
      const photo = itemsRef.current.find((item) => item.id === photoId)
      // Only a published photograph can be a favourite: the tile offers nothing else, and
      // the server would answer `highlight.notPublished`.
      if (photo === undefined || photo.status !== 'published') return

      // One toggle per photo at a time: a double click would send highlight and
      // unhighlight with no order between them.
      if (highlightsRef.current.get(photoId)?.settledAfterRead === null) return

      const next = photo.highlighted !== true
      const apply = (value: boolean): void => {
        const mark = (item: ModerationPhotoDto): ModerationPhotoDto =>
          item.id === photoId ? { ...item, highlighted: value } : item
        setState((current) => ({
          ...current,
          items: current.items.map(mark),
          onScreen: current.onScreen === null ? null : current.onScreen.map(mark),
        }))
      }

      const toggle = { value: next, settledAfterRead: null as number | null }
      highlightsRef.current.set(photoId, toggle)
      apply(next)
      try {
        await (next ? api.highlightPhoto(slug, photoId) : api.unhighlightPhoto(slug, photoId))
        toggle.settledAfterRead = readsStarted()
      } catch (cause) {
        highlightsRef.current.delete(photoId)
        apply(!next)
        toast.show(failureMessage(cause, text.moderation.decisionFailed, text), { tone: 'danger' })
      }
    },
    [api, slug, text, toast, readsStarted],
  )

  const onSignal = useCallback(
    (signal: StreamSignal) => {
      // Only photo activity can change this queue. A room full of guests tapping
      // reactions would otherwise refetch the console once per tap, on the laptop that
      // has the least time to spare.
      if (!signal.type.startsWith('photo.')) return
      revalidate()
    },
    [revalidate],
  )

  /**
   * The console's own channel, not the wall's.
   *
   * `streamUrl` is the public one a projector opens; it carries the same frames today,
   * which is why subscribing to it here broke nothing visible for as long as it did. But
   * this screen decides what reaches the room, and it should not be holding an
   * unauthenticated connection to do it — the authorised twin exists for that, and the
   * two stop being interchangeable the day moderation needs to see rejected photos.
   */
  const streamUrl = useMemo(
    () => (slug === undefined || !ownStream ? null : api.moderationStreamUrl(slug)),
    [api, slug, ownStream],
  )
  const { connected } = useEventStream({ url: streamUrl, onSignal })

  return {
    ...state,
    connected,
    filter,
    busy,
    canUndo,
    setFilter,
    refresh,
    onSignal,
    decide,
    decideBulk,
    undo,
    toggleHighlight,
  }
}
