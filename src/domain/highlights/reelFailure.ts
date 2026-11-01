import { MAX_ATTEMPTS, retryDelayMs } from '../clips/clipFailure'

/**
 * Which failures of a montage are worth another try (spec 08).
 *
 * The same scales as a clip transcode (`clipFailure.ts`: three attempts, 2 s then 10 s), in a
 * table of their own, so the clip tests stay about clips. A code the table does not know is
 * transient, as there.
 */
export type ReelFailureKind = 'permanent' | 'transient'

const KIND_BY_CODE = new Map<string, ReelFailureKind>([
  // The selection: nothing a second pass changes.
  ['reel.notEnoughPhotos', 'permanent'],
  ['reel.tooManyPhotos', 'permanent'],
  // The event cannot be served any more (taken down, suspended, archived): nothing is made for it.
  ['reel.eventUnavailable', 'permanent'],
  ['reel.notAllowed', 'permanent'],
  ['event.notFound', 'permanent'],
  // Decided against committed state in the final write: an answer, not an accident.
  ['event.quotaExceeded', 'permanent'],
  ['client.storageFull', 'permanent'],

  // The machine.
  ['reel.transcoderUnavailable', 'transient'],
  ['reel.renderFailed', 'transient'],
  ['reel.storageFailed', 'transient'],
  ['reel.timedOut', 'transient'],
  ['reel.cancelled', 'transient'],
])

export const classifyReelFailure = (code: string): ReelFailureKind =>
  KIND_BY_CODE.get(code) ?? 'transient'

export { MAX_ATTEMPTS as MAX_REEL_ATTEMPTS, retryDelayMs as reelRetryDelayMs }

export const shouldRetryReel = (kind: ReelFailureKind, attempts: number): boolean =>
  kind === 'transient' && attempts < MAX_ATTEMPTS
