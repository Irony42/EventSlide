/**
 * The life of one transcode.
 *
 * This is a **separate machine from `PhotoStatus` on purpose**, and the separation is
 * the point of the whole design. A clip that is still transcoding has no `photos` row at
 * all, so "a half-transcoded clip reached the projector" is not a case the wall filters
 * out — it is a state that cannot be written down. Adding a fifth member to
 * `PHOTO_STATUSES` would have done the opposite: it widens `QueueFilter`, `isPhotoStatus`
 * and `PhotoStatusCounts`, it forces a column into four exhaustive
 * `Record<PhotoStatus, ...>` tables, and it makes "transcoding" something a moderator can
 * select as a decision. A photo's statuses are the four decisions a host can make; this
 * is machinery, and machinery does not belong in a moderation vocabulary.
 *
 * ```
 *   reserved ──bytes landed──► queued ──claim──► running ──succeed──► done
 *      │                          ▲                  │
 *      │                          └──fail(transient)─┤
 *      │                          └──recover─────────┘
 *      │                                             └──fail(permanent)──► failed
 *      └──(never arrived: the row is deleted; the sweep takes the bytes)
 * ```
 *
 * **`reserved` is the row before the bytes**, and inverting that order is what keeps the
 * quota honest. The quota is computed from rows — `photos.byte_size` plus the staged
 * sources — so while the row came second, every refused upload had already written up to
 * `MAX_CLIP_BYTES` that nothing counted. A table of guests forwarding one video from the
 * group chat could therefore fill the disk while every individual check passed, and
 * ENOSPC takes photo ingest and the wall down with it. Reserving first means a refusal
 * costs zero bytes, the reservation is counted against the quota from the instant it
 * exists, and — because the unique index makes the row proof that this request owns that
 * digest — deleting the source becomes safe again.
 *
 * The worker is blind to it: `isDue` is `queued` only, so nothing can claim a job whose
 * bytes may not be there. A reservation whose bytes never arrive is **deleted** rather
 * than failed, by the reservation reaper on a short timer — rows only. Whatever landed
 * under the digest is left to `sweepOrphanedMedia`, because the delete is transactional
 * and any unlink after it would race a re-upload that had won the freed digest.
 *
 * `done` and `failed` are terminal and the row **stays**. It is what makes a retried
 * upload on venue Wi-Fi answer "already here" instead of transcoding the same fifteen
 * seconds twice, and it is the only thing a guest's phone can poll to find out why their
 * clip never appeared. The rows go when the event does, by the same cascade as every
 * other event-scoped table.
 */

export const CLIP_JOB_STATUSES = ['reserved', 'queued', 'running', 'done', 'failed'] as const

export type ClipJobStatus = (typeof CLIP_JOB_STATUSES)[number]

const ALLOWED_TRANSITIONS: Readonly<Record<ClipJobStatus, readonly ClipJobStatus[]>> = {
  // The bytes landed. The only move a reservation can make: it is deleted rather than
  // failed if they never do, because a row whose source was never written is not a clip
  // anybody can be told about.
  reserved: ['queued'],
  // Claimed by the worker, or recovered back here after the process that held it died.
  queued: ['running'],
  // Finished, given up on, or handed back for another attempt.
  running: ['queued', 'done', 'failed'],
  done: [],
  failed: [],
}

export const isClipJobStatus = (value: unknown): value is ClipJobStatus =>
  typeof value === 'string' && (CLIP_JOB_STATUSES as readonly string[]).includes(value)

/**
 * Unlike `PhotoStatus`, a no-op transition is **refused**.
 *
 * A double-clicked "publish" is a host changing their mind twice and is harmless; a
 * second claim of a job that is already running is two workers holding the same ffmpeg
 * output path, which is a corrupted file rather than an idempotent no-op.
 */
export const canTransition = (from: ClipJobStatus, to: ClipJobStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to)

/** Nothing more will happen to this job on its own. */
export const isTerminal = (status: ClipJobStatus): boolean =>
  status === 'done' || status === 'failed'

/**
 * Charged to the event's byte quota, because the staged source is still on the disk the
 * quota exists to protect. A `done` job's bytes are gone and a `failed` job's were
 * removed when it was given up on — except where `recoverClipJobs` abandoned it, which
 * leaves them for `sweepOrphanedMedia` rather than deleting something the box, not the
 * clip, is at fault for.
 */
export const holdsStagedBytes = (status: ClipJobStatus): boolean =>
  status === 'reserved' || status === 'queued' || status === 'running'

/**
 * Does a job in this state stop the same bytes being uploaded again?
 *
 * The dedupe's rule, and the partial unique index on `(event_id, source_hash)` is the
 * same sentence in SQL. A `failed` row must not block: `event.quotaExceeded` and
 * `event.photoLimitReached` are permanent verdicts about the **album**, not about the
 * bytes, and an album empties — the host deletes fifty photographs and the clip that was
 * refused now fits. While a failed row blocked, that guest could never send it again,
 * because no route retries or deletes a clip job.
 */
export const blocksReupload = (status: ClipJobStatus): boolean => status !== 'failed'
