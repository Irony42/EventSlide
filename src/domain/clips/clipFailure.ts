/**
 * Whether a failed transcode is worth trying again, and how long to wait.
 *
 * This lives in the domain and not in the worker for the reason `src/main/**` is excluded
 * from coverage: a retry ladder is a decision, and a decision nothing can test is a
 * decision nobody can change safely. `src/main` gets the timer and the drain loop; which
 * failures come back, and how often, is decided here, at 100% branches.
 *
 * The split is not about severity, it is about **whether a second attempt could possibly
 * answer differently**:
 *
 * - *permanent* — the bytes are the problem. A file with no video stream has no video
 *   stream the second time either, and a 40-second recording is still 40 seconds.
 *   Retrying burns a core on a self-hosted box in the middle of an event and ends in the
 *   same refusal, three attempts later than it had to.
 * - *transient* — the machine was the problem. ffmpeg was missing when the process
 *   booted, the disk was momentarily full, the box was thrashing under forty simultaneous
 *   uploads. These clear on their own, and the guest never has to know one happened.
 *
 * An unknown code is treated as transient. That is the safe default here and it is
 * bounded: the worst case is {@link MAX_ATTEMPTS} attempts and then a refusal, whereas
 * defaulting to permanent would throw away a guest's clip the first time an adapter grew
 * a code this table has not been taught.
 */

export type ClipFailureKind = 'permanent' | 'transient'

/**
 * Every code the transcode path can answer with, and what it says about a retry.
 *
 * A `Map` rather than an object literal, because the key is a `DomainError.code` that
 * arrives from an adapter: a bare lookup on an object resolves `constructor` and
 * `toString` to inherited members, and this table must answer about codes it holds or not
 * at all.
 */
const KIND_BY_CODE = new Map<string, ClipFailureKind>([
  // The file.
  ['clip.unsupportedFormat', 'permanent'],
  ['clip.corrupt', 'permanent'],
  ['clip.noVideoStream', 'permanent'],
  ['clip.durationUnknown', 'permanent'],
  ['clip.tooShort', 'permanent'],
  ['clip.tooLong', 'permanent'],
  // A frame too large to decode safely. The pixel budget is read from the header, so the
  // answer is the same every time and a retry only spends the budget again.
  ['clip.pixelBudgetExceeded', 'permanent'],
  // The staged bytes are gone. Nothing on the next pass will bring them back.
  ['clip.sourceMissing', 'permanent'],
  // Decided against committed state inside the write transaction, so it is an answer
  // rather than an accident.
  ['event.quotaExceeded', 'permanent'],
  ['event.photoLimitReached', 'permanent'],
  // The event was purged while the clip was in the queue. There is nothing left to
  // attach the result to, and no number of retries will bring the album back.
  ['event.notFound', 'permanent'],

  // The machine.
  ['clip.transcoderUnavailable', 'transient'],
  ['clip.transcodeFailed', 'transient'],
  ['clip.storageFailed', 'transient'],
  /**
   * **A timeout is a machine condition, and it was the only one classified permanent.**
   *
   * The argument for permanence was that a clip which cannot be encoded inside its budget
   * will not become encodable inside the same budget. That is true of a pathological
   * file and false of everything else that trips the same wire: a venue mini-PC also
   * running the wall, four guests filming the first dance at once, a 4K source on a box
   * that is briefly swapping. Those clear, and a permanent verdict there deletes a
   * guest's only copy of the first dance on the first attempt.
   *
   * The cost of being wrong the other way is bounded and small: `MAX_ATTEMPTS` is three,
   * and the **stall** bound — not the wall clock — is what actually catches a decoder
   * spinning in a demuxer loop, in seconds rather than minutes.
   */
  ['clip.transcodeTimedOut', 'transient'],
  /**
   * Shutdown asked the encoder to stop. Nothing about the clip is wrong, and the next
   * boot must take it again — which is exactly what `queued` means.
   */
  ['clip.transcodeCancelled', 'transient'],
  /**
   * ffprobe exited zero and we could not read what it said: a budget too small, or a
   * build printing a shape this schema has not been taught. The file is fine; the fault
   * is ours. Classified permanent, this destroyed ordinary iPhone clips.
   */
  ['clip.probeUnreadable', 'transient'],
])

export const classifyClipFailure = (code: string): ClipFailureKind =>
  KIND_BY_CODE.get(code) ?? 'transient'

/**
 * Three, and the third is the one that matters.
 *
 * Two attempts cover the overwhelmingly common transient case — a restart, a momentary
 * disk. A fourth would mostly mean a job that will never succeed occupying the single
 * worker for another half-minute while a room full of guests is uploading.
 */
export const MAX_ATTEMPTS = 3

/**
 * Backoff before the next attempt, from how many attempts have already been made.
 *
 * Short, and deliberately so: the guest is standing in the room refreshing "mes photos".
 * A minute of exponential backoff is correct for a background job and wrong for a person
 * waiting for one.
 */
const FIRST_RETRY_MS = 2_000
const LATER_RETRY_MS = 10_000

export const retryDelayMs = (attempts: number): number =>
  attempts <= 1 ? FIRST_RETRY_MS : LATER_RETRY_MS

/** A transient failure with attempts left comes back; everything else is final. */
export const shouldRetry = (kind: ClipFailureKind, attempts: number): boolean =>
  kind === 'transient' && attempts < MAX_ATTEMPTS
