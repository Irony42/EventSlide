import { makeBindConversation } from '../application/usecases/channels/bindConversation'
import { makeChannelReplier } from '../application/usecases/channels/channelReplier'
import { makeEventLock } from '../application/usecases/channels/eventLock'
import { makeDrainChannelMedia } from '../application/usecases/channels/drainChannelMedia'
import { makeForgetChannelSender } from '../application/usecases/channels/forgetChannelSender'
import { makeListBindings } from '../application/usecases/channels/listBindings'
import { makeReceiveChannelMessage } from '../application/usecases/channels/receiveChannelMessage'
import { makeSweepChannelJobs } from '../application/usecases/channels/sweepChannelJobs'
import { makeUnbindConversation } from '../application/usecases/channels/unbindConversation'
import type { Event } from '../domain/events/event'
import type { Adapters, UseCases } from './usecases'

/**
 * The channels slice of the use-case bag (spec 27): what the host's panel reads and does. Composition only, built by
 * `buildUseCases`. Both take the box's channels from the adapters, so on a box with no bot `available` is `false`.
 */
export const channelsUseCases = (adapters: Adapters) => ({
  listChannelBindings: makeListBindings({
    events: adapters.events,
    clients: adapters.clients,
    memberships: adapters.memberships,
    bindings: adapters.channelBindings,
    channels: adapters.messagingChannels,
  }),
  unbindConversation: makeUnbindConversation({
    events: adapters.events,
    memberships: adapters.memberships,
    bindings: adapters.channelBindings,
    channels: adapters.messagingChannels,
    clock: adapters.clock,
    bus: adapters.bus,
  }),
})

export interface ChannelWorkerPolicy {
  /** `PUBLIC_URL`, without a trailing slash: the origin the notice's address points at. */
  readonly publicUrl: string
  /** `UPLOAD_RATE_LIMIT_PER_MINUTE`: media a sender may post per minute. */
  readonly mediaPerMinute: number
  /** `MAX_QUEUED_CHANNEL_MEDIA_PER_EVENT`. */
  readonly maxQueuedPerEvent: number
  /** What a photograph may weigh: the smaller of `MAX_UPLOAD_BYTES` and what the channel hands over. */
  readonly maxPhotoBytes: number
  /** What a clip may weigh: the smaller of `MAX_CLIP_BYTES` and what the channel hands over. */
  readonly maxVideoBytes: number
  /** `MAX_CLIP_SECONDS` in milliseconds. */
  readonly maxClipMs: number
}

/**
 * The receiving and the working halves of a channel, built **only on a box that has one**: with no bot token there is
 * nothing to receive, so nothing is composed. They sit apart from the bag above because they are the box's, not any
 * route's (the poller and the worker are their only callers) and because they need the photograph and clip pipelines
 * that `buildUseCases` has already built.
 */
export const channelWorkerUseCases = (
  adapters: Adapters,
  built: Pick<UseCases, 'uploadPhotos' | 'uploadClip' | 'eraseGuestContribution'>,
  policy: ChannelWorkerPolicy,
) => {
  // One instance for both halves, so a refusal reached at the door and again at the queue is told once an hour.
  const replier = makeChannelReplier(adapters.clock)
  // One lock for both halves: an erasure and the storing of that sender's media never interleave.
  const lock = makeEventLock()

  const bindConversation = makeBindConversation({
    events: adapters.events,
    clients: adapters.clients,
    bindings: adapters.channelBindings,
    ids: adapters.ids,
    clock: adapters.clock,
    bus: adapters.bus,
  })

  const forgetChannelSender = makeForgetChannelSender({
    guests: adapters.guests,
    jobs: adapters.channelJobs,
    keyer: adapters.channelSenderKeyer,
    eraseGuestContribution: built.eraseGuestContribution,
    lock,
  })

  return {
    receiveChannelMessage: makeReceiveChannelMessage({
      events: adapters.events,
      clients: adapters.clients,
      guests: adapters.guests,
      bindings: adapters.channelBindings,
      jobs: adapters.channelJobs,
      channels: adapters.messagingChannels,
      keyer: adapters.channelSenderKeyer,
      bindConversation,
      forgetChannelSender,
      replier,
      ids: adapters.ids,
      clock: adapters.clock,
      bus: adapters.bus,
      logger: adapters.logger,
      // The join page shows the privacy notice before anything is kept (spec 27 §7): it is the address of the notice.
      noticeUrlOf: (event: Event) =>
        `${policy.publicUrl}/join/${encodeURIComponent(event.joinCode.value)}`,
      limits: {
        mediaPerMinute: policy.mediaPerMinute,
        maxQueuedPerEvent: policy.maxQueuedPerEvent,
      },
    }),
    drainChannelMedia: makeDrainChannelMedia({
      events: adapters.events,
      clients: adapters.clients,
      guests: adapters.guests,
      bindings: adapters.channelBindings,
      jobs: adapters.channelJobs,
      channels: adapters.messagingChannels,
      uploadPhotos: built.uploadPhotos,
      uploadClip: built.uploadClip,
      replier,
      lock,
      ids: adapters.ids,
      clock: adapters.clock,
      logger: adapters.logger,
      limits: {
        maxPhotoBytes: policy.maxPhotoBytes,
        maxVideoBytes: policy.maxVideoBytes,
        maxClipMs: policy.maxClipMs,
      },
    }),
    sweepChannelJobs: makeSweepChannelJobs({ jobs: adapters.channelJobs, clock: adapters.clock }),
    recoverChannelJobs: () => adapters.channelJobs.recoverAbandoned(adapters.clock.now()),
  }
}
