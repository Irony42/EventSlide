import type { EventId } from '../../../domain/shared/ids'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'
import { holdsStagedBytes } from '../../../domain/clips/clipJobStatus'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { MediaStore, StoredObject } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'

/**
 * The media reconciliation sweep: delete stored objects that nothing names any more.
 *
 * **This is the collector several other paths now rely on, and until it existed they were
 * relying on a phrase.** `fsMediaStore.put` and the `MediaStore` port both said a leaked
 * file was "swept by the media reconciliation job"; no such job was ever written, so
 * every one of those leaks was permanent. Specifically, it is what makes these safe:
 *
 * 1. **The clip upload deletes only what its own reservation proves it owns.** It removes
 *    a staged source on the two exits where that row still exists — the reservation is
 *    committed and the partial unique index covers the digest, so no other request can be
 *    holding it — and deletes nothing on the exit taken *because* the row is gone. There
 *    the proof has evaporated and the guest may already have re-uploaded onto a fresh
 *    reservation holding those very bytes; a leaked identical file is strictly better than
 *    a destroyed one, so that path leaks and this collects.
 * 2. **An unlink the disk refuses is best effort everywhere.** A read-only mount is
 *    exactly what produces the failure that leads to the unlink, and letting the exception
 *    escape stranded a `running` row for the life of the process. The bytes are left here
 *    instead.
 * 3. **`recoverClipJobs` keeps the source of a job it abandons**, and the reservation
 *    reaper keeps the source of a row it deletes — in both cases because the row that
 *    proved ownership is being released or removed in the same breath, so an unlink after
 *    it would race a re-upload that won the digest.
 *
 * ## The two rules that keep it safe to run during an event
 *
 * **Nothing recent is ever collected.** Every write path in the product is bytes first,
 * row second — deliberately, because a row naming bytes that do not exist is the failure
 * 1.0 shipped — so there is always a window in which an object is on the disk and nothing
 * names it yet. A collector without a minimum age would eat the file out from under the
 * insert about to reference it, which is far worse than the leak it exists to fix.
 *
 * **A source a live job names is never collected**, whatever its age. A clip can sit
 * `queued` behind twenty others for minutes, and its source is the only copy of it.
 *
 * Both are decided twice: once in bulk against the per-event sets read at the top of an
 * event, and again per digest immediately before the unlink (`stillCollectable`). The
 * second is not belt and braces — the sets are a snapshot, and a guest re-uploading an
 * abandoned clip in that window would otherwise have their new source deleted out from
 * under a `queued` job, which `clip.sourceMissing` makes permanent.
 *
 * It is a use case rather than a script because all of that is rules, and a rule an
 * operator discovers was wrong after an album is short a photograph belongs where it can
 * be tested.
 */

export interface SweepOrphanedMediaPolicy {
  /**
   * The most digests one pass will consider, across every event.
   *
   * A pass walks the disk and holds the database connection that is also serving uploads
   * and the projector. On an installation with far more events than an interval can get
   * through, an unbounded pass would simply never stop; this cuts it off and the next one
   * carries on. The events it did not reach are reported, so a box that never finishes is
   * visible rather than merely slow.
   */
  readonly maxDigestsPerPass: number

  /**
   * How recently written an object must be to be left alone.
   *
   * Bounds the window described above. It has to comfortably exceed the longest
   * bytes-to-row gap in the product, which is a clip upload: the source is written, then
   * the queue row is inserted. That is milliseconds — but a box swapping under a
   * transcode while twelve uploads are in flight is not, so this is minutes and not
   * seconds. The cost of being generous is only that a leak survives one more sweep.
   */
  readonly minimumAgeMs: number
}

export interface SweepOrphanedMediaDeps {
  readonly photos: PhotoRepository
  readonly clips: ClipJobRepository
  readonly media: MediaStore
  readonly clock: Clock
  readonly logger: Logger
  readonly policy: SweepOrphanedMediaPolicy
}

export interface SweepOrphanedMediaReport {
  /** Distinct digests considered, across every event the store holds bytes for. */
  readonly scanned: number
  /** Digests removed. */
  readonly collected: number
  /** Bytes those digests occupied. The number an operator actually wants. */
  readonly bytes: number
  /** Events this pass ran out of budget before reaching. Zero on a healthy box. */
  readonly skippedEvents: number
  /**
   * Events whose sweep threw and were left for the next run.
   *
   * A failure on one event is data, not the job's outcome — the same shape as
   * `purgeExpiredEvents`. One unreadable directory must not stop the other forty.
   */
  readonly failed: readonly EventId[]
}

export type SweepOrphanedMedia = () => Promise<SweepOrphanedMediaReport>

export const makeSweepOrphanedMedia = ({
  photos,
  clips,
  media,
  clock,
  logger,
  policy,
}: SweepOrphanedMediaDeps): SweepOrphanedMedia => {
  /**
   * Every digest this event's rows still name, as one pair of queries.
   *
   * Asked **per event, not per object**. The earlier shape ran one synchronous
   * better-sqlite3 seek per digest, on the connection that is also serving uploads and
   * the projector's range requests: forty events of six thousand files is eighty thousand
   * of them an hour, to re-confirm objects that were referenced last pass and the pass
   * before. Two queries and a `Set` is the same answer for two round trips.
   *
   * Both halves of the quota go into one set, deliberately without branching on the
   * variant. A `source` belongs to a clip job and a `video` to a photo row — but the store
   * is content-addressed, so the honest question is "does *any* row name this digest", and
   * answering it without a branch means there is no variant this sweep can get wrong.
   */
  const referencedDigests = async (eventId: EventId): Promise<ReadonlySet<string>> => {
    const named = new Set(await photos.listReferencedDigests(eventId))
    // Only jobs that are still holding their bytes: a `done` job gave its source back
    // when the transcode finished, and a `failed` one is not coming back for it.
    for (const job of await clips.listStagedSources(eventId)) named.add(job)
    return named
  }

  /**
   * Both safety rules, asked again with nothing between them and the unlink.
   *
   * The listing and the name set are a **snapshot**, and the pass acts on them some
   * milliseconds later — during which a guest whose clip was abandoned can re-upload it:
   * `stage` inserts a reservation naming this digest, and `media.put` rewrites the same
   * content-addressed path with a fresh timestamp. Against the snapshot both rules still
   * said "collect", and the new job went `queued` pointing at nothing —
   * `clip.sourceMissing` is permanent, so the guest was told to send it a third time.
   *
   * Asked per digest **only for the ones this pass is about to delete**, which on a
   * healthy installation is none: the batched sets above still do the bulk of the work,
   * and this is the confirmation that makes the two sentences in the module header true
   * rather than nearly true.
   */
  const stillCollectable = async (
    eventId: EventId,
    hash: ContentHash,
    objects: readonly StoredObject[],
    collectableBefore: number,
  ): Promise<boolean> => {
    for (const object of objects) {
      const current = await media.stat(eventId, hash, object.variant)
      // Gone already — another pass, or a purge. Nothing to collect and nothing to say.
      if (current === null) return false
      // Rewritten since the listing: these are somebody's new bytes, not the old orphan.
      if (current.modifiedAt.getTime() > collectableBefore) return false
    }

    if ((await photos.findIdsReferencing(eventId, hash)).length > 0) return false

    const job = await clips.findBySourceHash(eventId, hash)
    return job === null || !holdsStagedBytes(job.status)
  }

  /**
   * Where the next pass begins: the last event this one **finished**.
   *
   * A pass is bounded, so on a store larger than one budget it stops part-way — and
   * without a cursor every pass restarted at element zero of `listEvents`. On the box the
   * documentation cites, forty events of six thousand files, that meant the tail was
   * reconciled *never*: the same prefix was walked over and over while every leak the
   * design deliberately creates further along accumulated until the event was purged.
   *
   * Kept as an id rather than an index because the list changes between passes — events
   * are created and purged — and an index into a list that has shifted resumes somewhere
   * arbitrary. The list is sorted so "the first id after this one" is a stable question;
   * `null` means start at the beginning, which is also what a pass that got all the way
   * through leaves behind, so the cursor rotates rather than running off the end.
   */
  let resumeAfter: EventId | null = null

  return async () => {
    const now = clock.now()
    const collectableBefore = now.getTime() - policy.minimumAgeMs

    let scanned = 0
    let collected = 0
    let bytes = 0
    let skippedEvents = 0
    const failed: EventId[] = []

    const events = [...(await media.listEvents())].sort()
    const after = resumeAfter
    const from = after === null ? 0 : Math.max(0, events.findIndex((id) => id > after))
    const ordered = [...events.slice(from), ...events.slice(0, from)]

    /** True once the budget is spent: everything after this is counted, not walked. */
    let exhausted = false

    // Sequentially, on purpose, exactly as the retention purge is: this runs on the same
    // box that may be projecting a live event, and forty concurrent directory walks would
    // take the disk away from the party in progress.
    for (const eventId of ordered) {
      if (exhausted) {
        skippedEvents += 1
        continue
      }

      try {
        const byHash = new Map<string, { hash: ContentHash; objects: StoredObject[] }>()
        for (const object of await media.list(eventId)) {
          const held = byHash.get(object.hash.value)
          if (held === undefined) {
            byHash.set(object.hash.value, { hash: object.hash, objects: [object] })
          } else held.objects.push(object)
        }
        if (byHash.size === 0) {
          resumeAfter = eventId
          continue
        }

        const named = await referencedDigests(eventId)

        for (const [digest, { hash, objects }] of byHash) {
          // **Checked here and not only between events.** The policy says "the most
          // digests one pass will consider", and while this was tested at the top of the
          // event loop alone, a single event with two hundred thousand digests was walked
          // in full and that sentence was false.
          if (scanned >= policy.maxDigestsPerPass) {
            exhausted = true
            break
          }
          scanned += 1

          if (named.has(digest)) continue

          // The freshness guard, applied to the **newest** rendition under the digest: a
          // clip's poster and video are written moments apart, and judging them apart
          // would let the sweep take one and leave the other.
          const newest = Math.max(...objects.map((object) => object.modifiedAt.getTime()))
          if (newest > collectableBefore) continue

          // And both rules again, against the disk and the database as they are now.
          if (!(await stillCollectable(eventId, hash, objects, collectableBefore))) continue

          await media.delete(eventId, hash)
          collected += 1
          bytes += objects.reduce((total, object) => total + object.byteSize, 0)
        }

        // Only a *finished* event moves the cursor. One cut off part-way is counted as
        // skipped and walked again next time: the deletions are idempotent, so repeating
        // it costs a listing rather than correctness.
        //
        // The corollary is a constraint on the budget rather than on this code: an event
        // whose digests alone meet it is never finished, so the cursor never passes it
        // and everything behind it starves. `MEDIA_SWEEP_MAX_DIGESTS` says why the
        // default cannot reach that and what an operator must do if they raise the quota.
        if (exhausted) skippedEvents += 1
        else resumeAfter = eventId
      } catch (cause) {
        failed.push(eventId)
        logger.warn('could not reconcile an event’s media; leaving it for the next sweep', {
          eventId,
          cause: String(cause),
        })
      }
    }

    // A pass that reached the end starts again at the front, so a leak appearing in the
    // first event is not waiting for a wrap that never comes.
    if (!exhausted) resumeAfter = null

    if (collected > 0 || failed.length > 0 || skippedEvents > 0) {
      // Worth a line: a healthy installation collects nothing most of the time, so a
      // figure here is either a crash that left work behind or a bug that leaks — and a
      // pass that ran out of budget is a box an operator needs to know about.
      logger.info('reconciled stored media against the database', {
        scanned,
        collected,
        bytes,
        failed: failed.length,
        skippedEvents,
      })
    }

    return { scanned, collected, bytes, failed, skippedEvents }
  }
}
