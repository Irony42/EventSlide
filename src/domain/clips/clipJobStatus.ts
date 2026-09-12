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
 *   queued ──claim──► running ──succeed──► done
 *      ▲                 │
 *      └──fail(transient)┤
 *      └──recover────────┘
 *                        └──fail(permanent, or attempts spent)──► failed
 * ```
 *
 * `done` and `failed` are terminal and the row **stays**. It is what makes a retried
 * upload on venue Wi-Fi answer "already here" instead of transcoding the same fifteen
 * seconds twice, and it is the only thing a guest's phone can poll to find out why their
 * clip never appeared. The rows go when the event does, by the same cascade as every
 * other event-scoped table.
 */

export const CLIP_JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const

export type ClipJobStatus = (typeof CLIP_JOB_STATUSES)[number]

const ALLOWED_TRANSITIONS: Readonly<Record<ClipJobStatus, readonly ClipJobStatus[]>> = {
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
 * removed when it was given up on.
 */
export const holdsStagedBytes = (status: ClipJobStatus): boolean =>
  status === 'queued' || status === 'running'
