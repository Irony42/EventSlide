import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { useToast } from '../../../design-system/components/useToast'
import { ApiError, asError, isAbortError } from '../../../lib/http'
import { messageForCode, type UiText } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
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

/**
 * What "annuler" does to a photo that was still awaiting a decision when the host
 * published it: take it back off the wall. `hide` is the only safe answer, which is why
 * it is not a parameter, and it is the same on the laptop and on the phone.
 *
 * Until MOD-1 the desktop console left it out, on the argument that the tile stays on
 * screen with a "retirer" button on it. It does not: the server signals `photo.moderated`,
 * the console reloads "En attente", and the tile is gone within the second. A mis-pressed
 * P then left a photo on the wall that only a change of tab could take down.
 */
const UNDO_OF_PUBLISH: ModerationDecision = 'hide'

/**
 * Which decision takes this one back, given where the photo came from and where it
 * went. `null` when nothing safely does, and the console then offers no undo at all.
 *
 * The `pending` case is the whole reason this is a function rather than the map above.
 * Nothing puts a photo back to `pending`, so the answer is `null` — except for one
 * direction:
 *
 * - **A publish can be taken back with `hide`**, on both consoles. The photo comes off
 *   the wall, which is what the host meant, and it lands in `hidden` rather than back in
 *   the queue — `hidden` keeps it in the album and reachable from the "Retirées" filter,
 *   and it is the only status change here that cannot put something unapproved on a
 *   screen. A decided photo leaves the queue as soon as the server confirms it, so
 *   without this nothing on either console could take it back.
 * - **A refusal is never taken back from `pending`.** The only verb that would reverse
 *   it is `publish`, and the photo was awaiting a decision, so "put that back" would
 *   throw it onto the projector with no approval behind it — the one thing a host is
 *   promised cannot happen. `src/domain/moderation/moderationDecision.ts` says the same
 *   thing about `inverseOf('reject')`, and this agrees with it rather than working
 *   around it.
 */
interface Restore {
  /** What to send. `null` when nothing safely takes this decision back. */
  readonly decision: ModerationDecision | null
  /**
   * Whether that decision puts the photo back exactly where it was.
   *
   * `false` is not a detail of wording: an inexact restore is a *second decision*, and
   * a host told "décision annulée" would go looking for the photo in the queue it is
   * no longer in.
   */
  readonly exact: boolean
}

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

/** Forget a decision, unless a later one on the same photo has taken its place. */
const forgetDecision = (
  inFlight: Map<string, InFlightDecision>,
  id: string,
  decision: InFlightDecision,
): void => {
  if (inFlight.get(id) === decision) inFlight.delete(id)
}

const restoringDecision = (previousStatus: PhotoStatus, currentStatus: PhotoStatus): Restore => {
  /**
   * A refusal of a hidden photo cannot be taken back: the way back to `hidden` is `hide`,
   * and the status machine only lets a rejected photo return to `published`
   * (`src/domain/photos/photoStatus.ts`). Offering "Annuler" would be a button the server
   * skips without a word, under a notice that said the refusal could be taken back.
   * Every other previous status has a restoring decision the machine allows from where
   * the photo went, so this is the single case where the table above is not enough.
   */
  if (previousStatus === 'hidden' && currentStatus === 'rejected') {
    return { decision: null, exact: false }
  }
  const direct = RESTORING_DECISION[previousStatus]
  if (direct !== undefined) return { decision: direct, exact: true }
  return currentStatus === 'published'
    ? { decision: UNDO_OF_PUBLISH, exact: false }
    : { decision: null, exact: false }
}

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

/** A one-line answer, gone before the host has looked up from the projector. */
const NOTHING_TO_UNDO_MS = 2_500

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

/**
 * A decision whose request has not come back, as far as a read response is concerned.
 *
 * A read can be on the wire while the host decides: it was asked before the decision
 * existed, so its answer describes the photo as it was. The optimistic status lives in
 * state, and a response that replaced the rows wholesale would put the old status back
 * under the host's thumb, with the old buttons - and a second press on a photo that was
 * already decided. So the console remembers what it is still waiting to hear about and
 * writes it over every response (`readRows`).
 *
 * Over a response that starts after the decision was sent, and not only before, because
 * the server may answer that read first: two requests in flight are in no order.
 */
interface InFlightDecision {
  readonly status: PhotoStatus
  /**
   * `null` while the request is out. Once it has answered, the number of reads that had
   * started by then: a read that started later asked after the decision landed, so its
   * answer is the server's own and replaces the optimistic row. Earlier ones are still
   * stale, even when they arrive after the request did (a response can overtake the
   * render that would have aborted its read).
   */
  settledAfterRead: number | null
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
  { onScreenLimit, linkToRejected = false }: ModerationQueueOptions = {},
): ModerationQueue => {
  const text = useTranslations()
  const api = useApi()
  const toast = useToast()

  const [filter, setFilterState] = useState<StatusFilter>('pending')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
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

  /** Decisions sent and not yet answered, by photo. See `InFlightDecision`. */
  const inFlightRef = useRef(new Map<string, InFlightDecision>())
  /** How many queue reads have started, to tell a read that predates an answer from one that follows it. */
  const readsStartedRef = useRef(0)
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

    const startedAt = readsStartedRef.current + 1
    readsStartedRef.current = startedAt
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
      const safe = rows.map(withDecisions)
      remember(safe)

      for (const [id, decision] of inFlightRef.current) {
        if (decision.settledAfterRead !== null && startedAt > decision.settledAfterRead) {
          inFlightRef.current.delete(id)
        }
      }

      let pendingDelta = 0
      const shown = safe.map((row) => {
        const decision = inFlightRef.current.get(row.id)
        if (decision === undefined) return row
        if (row.status === 'pending' && decision.status !== 'pending') pendingDelta -= 1
        if (row.status !== 'pending' && decision.status === 'pending') pendingDelta += 1
        return { ...row, status: decision.status, allowedDecisions: [] }
      })
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
        // decision or signal reads again.
        if (quiet) return
        // The items already on screen are kept: a refetch that failed while the host
        // was working through a screenful must not empty the grid under them.
        setState((previous) => ({ ...previous, loading: false, error: asError(cause) }))
      },
    )

    return () => {
      live = false
      controller.abort()
    }
  }, [api, slug, filter, attempt, onScreenLimit])

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

  /** Start remembering decisions that are about to be sent. */
  const sendDecisions = useCallback((statuses: ReadonlyMap<string, PhotoStatus>) => {
    const sent = new Map<string, InFlightDecision>()
    for (const [id, status] of statuses) {
      const decision: InFlightDecision = { status, settledAfterRead: null }
      inFlightRef.current.set(id, decision)
      sent.set(id, decision)
    }
    return sent
  }, [])

  /**
   * The server answered. The decision stays written over the reads that started before
   * this point, and the photo gets its decisions back from the one that follows (every
   * caller revalidates). `refused` photos were put back by hand and are forgotten now.
   */
  const answerDecisions = useCallback(
    (sent: ReadonlyMap<string, InFlightDecision>, refused: readonly string[] = []) => {
      for (const [id, decision] of sent) {
        if (refused.includes(id)) forgetDecision(inFlightRef.current, id, decision)
        else decision.settledAfterRead = readsStartedRef.current
      }
    },
    [],
  )

  /** The request failed and the photos went back to where they were: nothing to write over. */
  const failDecisions = useCallback((sent: ReadonlyMap<string, InFlightDecision>) => {
    for (const [id, decision] of sent) forgetDecision(inFlightRef.current, id, decision)
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
    setBusy(true)
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
      setBusy(false)
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
      setBusy(true)
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
        setBusy(false)
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
      setBusy(true)
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
        setBusy(false)
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
    ],
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
    () => (slug === undefined ? null : api.moderationStreamUrl(slug)),
    [api, slug],
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
    decide,
    decideBulk,
    undo,
  }
}
