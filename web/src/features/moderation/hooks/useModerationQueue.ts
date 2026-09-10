import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../../../app/ApiProvider'
import { useToast } from '../../../design-system/components/ToastProvider'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import { useEventStream, type StreamSignal } from '../../../lib/realtime/useEventStream'
import type { ModerationDecision, ModerationPhotoDto, PhotoStatus } from '../../../lib/api/dto'

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
 * The status a decision produces, mirrored from `docs/API.md`.
 *
 * A projection of the answer the server is about to give, not a rule: the endpoint
 * replies 204 with no body, so an optimistic tile has to know what it is showing. The
 * server stays the authority, and the refetch on the resulting signal corrects
 * anything this got wrong.
 */
const TARGET_STATUS: Readonly<Record<ModerationDecision, PhotoStatus>> = {
  publish: 'published',
  reject: 'rejected',
  hide: 'hidden',
}

/**
 * Which decision puts a photo back into a status it used to hold.
 *
 * `pending` is deliberately absent: no decision verb produces it, so a photo that was
 * awaiting a decision cannot be sent back there. `src/domain/moderation/
 * moderationDecision.ts` spells out why guessing is dangerous — "put that back" on a
 * photo the host mistakenly refused while it was still pending would throw it onto the
 * projector with no approval behind it, which is the one thing a host is promised
 * cannot happen. So undo is offered only where the previous status is reachable, and
 * the console keeps the previous status itself rather than asking the server to invert
 * a decision it never recorded a source for.
 */
const RESTORING_DECISION: Readonly<Partial<Record<PhotoStatus, ModerationDecision>>> = {
  published: 'publish',
  rejected: 'reject',
  hidden: 'hide',
}

const APPLIED_MESSAGE: Readonly<Record<ModerationDecision, (count: number) => string>> = {
  publish: fr.moderation.published,
  reject: fr.moderation.refused,
  hide: fr.moderation.removed,
}

interface UndoEntry {
  readonly id: string
  /** Where the photo was before the decision, and where undo puts it back. */
  readonly previousStatus: PhotoStatus
  /** What the decision made of it, so a failed undo can roll forward again. */
  readonly currentStatus: PhotoStatus
}

interface QueueState {
  readonly items: readonly ModerationPhotoDto[]
  readonly pendingCount: number
  readonly loading: boolean
  readonly error: Error | null
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
  decide: (photoId: string, decision: ModerationDecision) => Promise<void>
  decideBulk: (photoIds: readonly string[], decision: ModerationDecision) => Promise<void>
  undo: () => Promise<void>
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

/**
 * The sentence to show for a failure.
 *
 * An `ApiError` carries French copy chosen locally from the server's error code, which
 * is more useful than a generic line — "cette action n'est pas possible sur cette
 * photo" tells the host what happened. Anything else is a bug in this build, and its
 * message is an English internal string that must not reach a host mid-event.
 */
const failureMessage = (cause: unknown, fallback: string): string =>
  cause instanceof ApiError ? cause.message : fallback

export const useModerationQueue = (slug: string | undefined): ModerationQueue => {
  const api = useApi()
  const toast = useToast()

  const [filter, setFilterState] = useState<StatusFilter>('pending')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<QueueState>({
    items: [],
    pendingCount: 0,
    // A route with no slug never fetches, so it must not sit on a spinner for ever.
    loading: slug !== undefined,
    error: null,
  })

  /** Read by the decision handlers, so their identity does not change per photo. */
  const itemsRef = useRef(state.items)
  useEffect(() => {
    itemsRef.current = state.items
  }, [state.items])

  const undoRef = useRef<readonly UndoEntry[] | null>(null)
  const undoToastRef = useRef<string | null>(null)
  const [canUndo, setCanUndo] = useState(false)

  useEffect(() => {
    if (slug === undefined) return

    const controller = new AbortController()
    let live = true

    api.moderationQueue(slug, { status: filter }, controller.signal).then(
      (response) => {
        if (!live) return
        setState({
          items: response.items,
          pendingCount: response.pendingCount,
          loading: false,
          error: null,
        })
      },
      (cause: unknown) => {
        if (!live) return
        // The abort is this effect's own cleanup — StrictMode mounts twice — and is
        // not a failure to put in front of the host.
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        // The items already on screen are kept: a refetch that failed while the host
        // was working through a screenful must not empty the grid under them.
        setState((previous) => ({ ...previous, loading: false, error: asError(cause) }))
      },
    )

    return () => {
      live = false
      controller.abort()
    }
  }, [api, slug, filter, attempt])

  /** A host asked for fresh data and should see that something is happening. */
  const refresh = useCallback(() => {
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
    setState((previous) => {
      let delta = 0
      const items = previous.items.map((item) => {
        const status = next.get(item.id)
        if (status === undefined || status === item.status) return item
        if (item.status === 'pending') delta -= 1
        if (status === 'pending') delta += 1
        return { ...item, status }
      })
      return { ...previous, items, pendingCount: Math.max(0, previous.pendingCount + delta) }
    })
  }, [])

  const forgetUndo = useCallback(() => {
    undoRef.current = null
    setCanUndo(false)
  }, [])

  const undo = useCallback(async () => {
    const entries = undoRef.current
    if (slug === undefined || entries === null || entries.length === 0) return
    forgetUndo()

    const openToast = undoToastRef.current
    if (openToast !== null) {
      // The offer has been taken; leaving it on screen invites a second press that
      // would undo the undo.
      toast.dismiss(openToast)
      undoToastRef.current = null
    }

    /**
     * Grouped by the decision that restores each photo, because one bulk action can
     * span statuses: rejecting a published photo and a hidden one in the same batch is
     * undone by `publish` for the first and `hide` for the second.
     */
    const groups = new Map<ModerationDecision, string[]>()
    for (const entry of entries) {
      const decision = RESTORING_DECISION[entry.previousStatus]
      if (decision === undefined) continue
      const group = groups.get(decision)
      if (group === undefined) groups.set(decision, [entry.id])
      else group.push(entry.id)
    }

    setStatuses(new Map(entries.map((entry) => [entry.id, entry.previousStatus])))
    setBusy(true)
    try {
      const skipped: string[] = []
      for (const [decision, ids] of groups) {
        // The bulk endpoint for a single photo too: one code path, and it is the one
        // that reports what it could not do instead of failing the lot.
        const response = await api.moderateBulk(slug, ids, decision)
        skipped.push(...response.skipped)
      }
      toast.show(fr.moderation.undone, { tone: 'success' })
      if (skipped.length > 0) {
        toast.show(fr.moderation.bulkSkipped(skipped.length), { tone: 'warning' })
      }
    } catch (cause) {
      setStatuses(new Map(entries.map((entry) => [entry.id, entry.currentStatus])))
      toast.show(failureMessage(cause, fr.moderation.undoFailed), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }, [api, slug, toast, setStatuses, forgetUndo])

  /**
   * Report the outcome, and offer to take it back.
   *
   * The undo is offered only when every photo in the batch can be put back exactly
   * where it was. A partial undo would be worse than none: the host would believe the
   * whole accident was reversed.
   */
  const announce = useCallback(
    (decision: ModerationDecision, entries: readonly UndoEntry[]) => {
      const message = APPLIED_MESSAGE[decision](entries.length)
      const reversible =
        entries.length > 0 &&
        entries.every((entry) => RESTORING_DECISION[entry.previousStatus] !== undefined)

      if (!reversible) {
        forgetUndo()
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
          label: fr.moderation.undo,
          onAction: () => {
            void undo()
          },
        },
      })
    },
    [toast, undo, forgetUndo],
  )

  const decide = useCallback(
    async (photoId: string, decision: ModerationDecision) => {
      if (slug === undefined) return
      const photo = itemsRef.current.find((item) => item.id === photoId)
      if (photo === undefined) return

      const target = TARGET_STATUS[decision]
      const entries: readonly UndoEntry[] = [
        { id: photoId, previousStatus: photo.status, currentStatus: target },
      ]

      setStatuses(new Map([[photoId, target]]))
      setBusy(true)
      try {
        await api.moderate(slug, photoId, decision)
        announce(decision, entries)
      } catch (cause) {
        setStatuses(new Map([[photoId, photo.status]]))
        forgetUndo()
        toast.show(failureMessage(cause, fr.moderation.decisionFailed), { tone: 'danger' })
      } finally {
        setBusy(false)
      }
    },
    [api, slug, toast, setStatuses, announce, forgetUndo],
  )

  const decideBulk = useCallback(
    async (photoIds: readonly string[], decision: ModerationDecision) => {
      if (slug === undefined || photoIds.length === 0) return

      const target = TARGET_STATUS[decision]
      const before = new Map(itemsRef.current.map((item) => [item.id, item.status]))
      const chosen = photoIds.filter((id) => before.has(id))
      if (chosen.length === 0) return

      setStatuses(new Map(chosen.map((id) => [id, target])))
      setBusy(true)
      try {
        const response = await api.moderateBulk(slug, chosen, decision)

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
          toast.show(fr.moderation.bulkSkipped(response.skipped.length), { tone: 'warning' })
        }

        const entries = response.applied.flatMap<UndoEntry>((id) => {
          const previousStatus = before.get(id)
          return previousStatus === undefined ? [] : [{ id, previousStatus, currentStatus: target }]
        })
        announce(decision, entries)
      } catch (cause) {
        setStatuses(
          new Map(
            chosen.flatMap<[string, PhotoStatus]>((id) => {
              const status = before.get(id)
              return status === undefined ? [] : [[id, status]]
            }),
          ),
        )
        forgetUndo()
        toast.show(failureMessage(cause, fr.moderation.decisionFailed), { tone: 'danger' })
      } finally {
        setBusy(false)
      }
    },
    [api, slug, toast, setStatuses, announce, forgetUndo],
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

  const streamUrl = useMemo(() => (slug === undefined ? null : api.streamUrl(slug)), [api, slug])
  const { connected } = useEventStream({ url: streamUrl, onSignal })

  return {
    ...state,
    connected,
    filter,
    busy,
    canUndo,
    setFilter,
    refresh,
    decide,
    decideBulk,
    undo,
  }
}
