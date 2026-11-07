import { makeApplyEventSchedules } from '../application/usecases/events/applyEventSchedules'
import { makeChangeEventStatus } from '../application/usecases/events/changeEventStatus'
import { makeCreateEvent } from '../application/usecases/events/createEvent'
import { makeGetEventBySlug } from '../application/usecases/events/getEventBySlug'
import { makeListEventsForHost } from '../application/usecases/events/listEventsForHost'
import { makeListModerators } from '../application/usecases/events/listModerators'
import { makePurgeEvent } from '../application/usecases/events/purgeEvent'
import { makeRenameEvent } from '../application/usecases/events/renameEvent'
import { makeRevokeModerator } from '../application/usecases/events/revokeModerator'
import { makePurgeExpiredEvents } from '../application/usecases/events/purgeExpiredEvents'
import { makeGetEventLogoMedia } from '../application/usecases/brand/getEventLogoMedia'
import { makeRemoveEventLogo } from '../application/usecases/brand/removeEventLogo'
import { makeSetEventLogo } from '../application/usecases/brand/setEventLogo'
import { makeGetVenuePhotoMedia } from '../application/usecases/venue/getVenuePhotoMedia'
import { makeRemoveVenuePhoto } from '../application/usecases/venue/removeVenuePhoto'
import { makeSetVenuePhoto } from '../application/usecases/venue/setVenuePhoto'
import { makeSweepOrphanedMedia } from '../application/usecases/media/sweepOrphanedMedia'
import { makeResolveJoinCode } from '../application/usecases/events/resolveJoinCode'
import { makeRotateJoinCode } from '../application/usecases/events/rotateJoinCode'
import { makeScheduleEvent } from '../application/usecases/events/scheduleEvent'
import { makeUpdateEventSettings } from '../application/usecases/events/updateEventSettings'
import { makeGetEventLimits } from '../application/usecases/events/getEventLimits'
import { makeGetEventView } from '../application/usecases/events/getEventView'
import type { Adapters, UseCasePolicy } from './usecases'

/** The events slice of the use-case bag: composition only, built by `buildUseCases`. */
export const eventsUseCases = (adapters: Adapters, policy: UseCasePolicy) => ({
  // events
  createEvent: makeCreateEvent({
    events: adapters.events,
    clients: adapters.clients,
    users: adapters.users,
    eventCreation: policy.events.creation,
    ids: adapters.ids,
    clock: adapters.clock,
    defaultQuotaBytes: policy.defaultEventQuotaBytes,
    maxQuotaBytes: policy.maxEventQuotaBytes,
    slugSuffix: policy.events.slugSuffix,
    allowCustomSlugs: policy.events.allowCustomSlugs,
    joinCodeLength: policy.events.joinCodeLength,
  }),
  getEventBySlug: makeGetEventBySlug({ events: adapters.events }),
  getEventView: makeGetEventView({
    events: adapters.events,
    getEventLimits: makeGetEventLimits({ clients: adapters.clients }),
  }),
  listEventsForHost: makeListEventsForHost({
    events: adapters.events,
    memberships: adapters.memberships,
  }),
  resolveJoinCode: makeResolveJoinCode({ events: adapters.events }),
  updateEventSettings: makeUpdateEventSettings({
    clock: adapters.clock,
    events: adapters.events,
    clients: adapters.clients,
    memberships: adapters.memberships,
    bus: adapters.bus,
  }),
  rotateJoinCode: makeRotateJoinCode({
    events: adapters.events,
    memberships: adapters.memberships,
    ids: adapters.ids,
    bus: adapters.bus,
    joinCodeLength: policy.events.joinCodeLength,
  }),
  changeEventStatus: makeChangeEventStatus({
    events: adapters.events,
    clients: adapters.clients,
    memberships: adapters.memberships,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  purgeEvent: makePurgeEvent({
    events: adapters.events,
    memberships: adapters.memberships,
    media: adapters.media,
    bookFiles: adapters.bookFiles,
  }),
  // Built here, with the others, since the route module composed them from `deps` until now
  // (HTTP-M-05): a logger, an audit line or a clock added to the rest reaches these three too, and a
  // test can hand the router a stub.
  renameEvent: makeRenameEvent({
    events: adapters.events,
    memberships: adapters.memberships,
    bus: adapters.bus,
  }),
  listModerators: makeListModerators({ memberships: adapters.memberships }),
  revokeModerator: makeRevokeModerator({
    events: adapters.events,
    memberships: adapters.memberships,
  }),
  purgeExpiredEvents: makePurgeExpiredEvents({
    events: adapters.events,
    media: adapters.media,
    bookFiles: adapters.bookFiles,
    clock: adapters.clock,
    capNoticeDays: policy.retention.capNoticeDays,
  }),
  /**
   * The collector the clip upload, the losing staging attempt and `recoverClipJobs` all
   * rely on. None of those deletes media itself any more, because deleting by digest can
   * destroy a byte-identical file somebody else owns.
   */
  // The host's own venue photograph (ADR 0010, decision 8).
  setVenuePhoto: makeSetVenuePhoto({
    events: adapters.events,
    memberships: adapters.memberships,
    media: adapters.media,
    imageProcessor: adapters.imageProcessor,
    hasher: adapters.contentHasher,
    bus: adapters.bus,
    logger: adapters.logger,
    limits: { maxPixels: policy.maxImagePixels },
  }),
  removeVenuePhoto: makeRemoveVenuePhoto({
    events: adapters.events,
    memberships: adapters.memberships,
    media: adapters.media,
    bus: adapters.bus,
    logger: adapters.logger,
  }),
  getVenuePhotoMedia: makeGetVenuePhotoMedia({ media: adapters.media }),
  // The host's logo (spec 03), beside the venue photograph and by the same pipeline.
  setEventLogo: makeSetEventLogo({
    events: adapters.events,
    memberships: adapters.memberships,
    media: adapters.media,
    imageProcessor: adapters.imageProcessor,
    hasher: adapters.contentHasher,
    bus: adapters.bus,
    logger: adapters.logger,
    limits: { maxPixels: policy.maxImagePixels },
  }),
  removeEventLogo: makeRemoveEventLogo({
    events: adapters.events,
    memberships: adapters.memberships,
    media: adapters.media,
    bus: adapters.bus,
    logger: adapters.logger,
  }),
  getEventLogoMedia: makeGetEventLogoMedia({ media: adapters.media }),
  sweepOrphanedMedia: makeSweepOrphanedMedia({
    events: adapters.events,
    photos: adapters.photos,
    clips: adapters.clips,
    reels: adapters.reels,
    media: adapters.media,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: {
      minimumAgeMs: policy.mediaSweepMinimumAgeMs,
      maxDigestsPerPass: policy.mediaSweepMaxDigestsPerPass,
    },
  }),
  scheduleEvent: makeScheduleEvent({
    events: adapters.events,
    memberships: adapters.memberships,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  /** The sweep behind the two scheduled instants. No actor: `src/main` drives it. */
  applyEventSchedules: makeApplyEventSchedules({
    events: adapters.events,
    clients: adapters.clients,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
})
