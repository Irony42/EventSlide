import { makeGetClipJob } from '../application/usecases/clips/getClipJob'
import { makeReapStaleReservations } from '../application/usecases/clips/reapStaleReservations'
import { makeRecoverClipJobs } from '../application/usecases/clips/recoverClipJobs'
import { makeTranscodeNextClip } from '../application/usecases/clips/transcodeNextClip'
import { makeUploadClip } from '../application/usecases/clips/uploadClip'
import { makeReapStaleVoiceReservations } from '../application/usecases/guestbook/reapStaleVoiceReservations'
import { makeStageGuestbookVoice } from '../application/usecases/guestbook/stageGuestbookVoice'
import {
  MAX_QUEUED_VOICES,
  MAX_QUEUED_VOICES_PER_EVENT,
  VOICE_FAILED_RETENTION_MS,
} from '../domain/guestbook/guestbookVoiceLimits'
import type { Adapters, UseCasePolicy } from './usecases'

/** The clips slice of the use-case bag: composition only, built by `buildUseCases`. */
export const clipsUseCases = (adapters: Adapters, policy: UseCasePolicy) => ({
  // clips
  uploadClip: makeUploadClip({
    events: adapters.events,
    clients: adapters.clients,
    clips: adapters.clips,
    photos: adapters.photos,
    missions: adapters.missions,
    media: adapters.media,
    transcoder: adapters.videoTranscoder,
    hasher: adapters.contentHasher,
    bus: adapters.bus,
    clock: adapters.clock,
    ids: adapters.ids,
    logger: adapters.logger,
    limits: {
      maxQueuedClips: policy.clips.maxQueuedClips,
      maxQueuedClipsPerEvent: policy.clips.maxQueuedClipsPerEvent,
      maxDurationMs: policy.clips.maxDurationMs,
    },
  }),
  getClipJob: makeGetClipJob({ clips: adapters.clips }),

  // A guestbook voice message (spec 25) is staged and queued like a clip, so its use cases are
  // composed here with the rest of the transcoding slice. No route reaches them yet.
  stageGuestbookVoice: makeStageGuestbookVoice({
    events: adapters.events,
    clients: adapters.clients,
    guestbook: adapters.guestbook,
    voices: adapters.voices,
    media: adapters.media,
    transcoder: adapters.audioTranscoder,
    hasher: adapters.contentHasher,
    bus: adapters.bus,
    clock: adapters.clock,
    ids: adapters.ids,
    logger: adapters.logger,
    limits: {
      maxQueuedVoices: MAX_QUEUED_VOICES,
      maxQueuedVoicesPerEvent: MAX_QUEUED_VOICES_PER_EVENT,
    },
  }),
  /** A reservation a dead request left, and a failed voice after its day: the box's, no route's. */
  reapStaleVoiceReservations: makeReapStaleVoiceReservations({
    voices: adapters.voices,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: {
      reservationTimeoutMs: policy.clips.reservationTimeoutMs,
      failedRetentionMs: VOICE_FAILED_RETENTION_MS,
    },
  }),
  /**
   * The two the HTTP layer deliberately does not list.
   *
   * Both drain the queue across **every** event on the box, so a route in front of
   * either would be an endpoint with no tenant to scope it to. `src/main/clipWorker.ts`
   * is their only caller.
   */
  transcodeNextClip: makeTranscodeNextClip({
    events: adapters.events,
    clients: adapters.clients,
    clips: adapters.clips,
    photos: adapters.photos,
    missions: adapters.missions,
    media: adapters.media,
    transcoder: adapters.videoTranscoder,
    hasher: adapters.contentHasher,
    bus: adapters.bus,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: {
      maxHeight: policy.clips.maxHeight,
      maxDurationMs: policy.clips.maxDurationMs,
      maxOutputBytes: policy.clips.maxOutputBytes,
      posterMaxEdge: policy.clips.posterMaxEdge,
      maxPixels: policy.clips.maxPixels,
    },
  }),
  // **It takes no media store at all, and that is the design rather than an omission.**
  // It puts a `running` row back on the queue, or gives up on one that has spent its
  // attempts — and an abandoned job keeps its source: `failed` releases the digest from
  // the partial unique index, so an unlink after that commit races the guest's own
  // re-upload for bytes the new reservation now owns. Stale *reservations* are the
  // reaper's, which deletes the row and leaves the bytes for the same reason. Every
  // digest either of them leaves behind is `sweepOrphanedMedia`'s to collect, which is
  // the one caller that re-checks the database with nothing between it and the unlink.
  recoverClipJobs: makeRecoverClipJobs({
    clips: adapters.clips,
    clock: adapters.clock,
    logger: adapters.logger,
  }),

  /**
   * Reservations, on a short timer rather than only at boot — see the use case. It is
   * separate from `recoverClipJobs` because that one may run **only** at startup:
   * `recoverAbandoned` reads every `running` row as the wreckage of a dead process, which
   * is true then and false while the encoder is working.
   */
  reapStaleReservations: makeReapStaleReservations({
    clips: adapters.clips,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: { reservationTimeoutMs: policy.clips.reservationTimeoutMs },
  }),
})
