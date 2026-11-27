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
import { makeRevealEvent } from '../application/usecases/events/revealEvent'
import { makeUpdateEventSettings } from '../application/usecases/events/updateEventSettings'
import { makeGetEventLimits } from '../application/usecases/events/getEventLimits'
import { makeSweepPurgeNotices } from '../application/usecases/events/sweepPurgeNotices'
import { makeGetEventView } from '../application/usecases/events/getEventView'
import { makeViewGuestInvite } from '../application/usecases/guestInvites/viewGuestInvite'
import { makeGetGuestInviteLogoMedia } from '../application/usecases/guestInvites/getGuestInviteLogoMedia'
import { makeGetGuestInvite } from '../application/usecases/guestInvites/getGuestInvite'
import { makeSaveGuestInvite } from '../application/usecases/guestInvites/saveGuestInvite'
import { makeEnableGuestInvite } from '../application/usecases/guestInvites/enableGuestInvite'
import { makeDisableGuestInvite } from '../application/usecases/guestInvites/disableGuestInvite'
import { makeRotateGuestInviteToken } from '../application/usecases/guestInvites/rotateGuestInviteToken'
import { makeSubmitRsvp } from '../application/usecases/guestRsvps/submitRsvp'
import {
  makeDeleteOwnRsvp,
  makeGetOwnRsvp,
  makeUpdateOwnRsvp,
  type OwnRsvpDeps,
} from '../application/usecases/guestRsvps/ownRsvp'
import { makeAttachRsvpToHousehold } from '../application/usecases/guestRsvps/attachRsvpToHousehold'
import { makeDeleteHousehold } from '../application/usecases/guestRsvps/deleteHousehold'
import {
  makeMarkHouseholdReminded,
  makeRotateHouseholdToken,
} from '../application/usecases/guestRsvps/householdActs'
import { makeImportHouseholds } from '../application/usecases/guestRsvps/importHouseholds'
import { makeListHouseholds } from '../application/usecases/guestRsvps/listHouseholds'
import { makeSaveHousehold } from '../application/usecases/guestRsvps/saveHousehold'
import { makeViewHousehold } from '../application/usecases/guestRsvps/viewHousehold'
import { makePurgeExpiredRsvps } from '../application/usecases/guestRsvps/purgeExpiredRsvps'
import { makeGetRsvpForm } from '../application/usecases/guestRsvps/getRsvpForm'
import { makeSaveRsvpForm } from '../application/usecases/guestRsvps/saveRsvpForm'
import { makeCloseRsvps } from '../application/usecases/guestRsvps/closeRsvps'
import { makeReopenRsvps } from '../application/usecases/guestRsvps/closeRsvps'
import { makeSetRsvpDigest } from '../application/usecases/guestRsvps/setRsvpDigest'
import { makeListRsvps } from '../application/usecases/guestRsvps/listRsvps'
import { makeHostAddRsvp } from '../application/usecases/guestRsvps/hostAddRsvp'
import { makeHostUpdateRsvp } from '../application/usecases/guestRsvps/hostUpdateRsvp'
import { makeHostDeleteRsvp } from '../application/usecases/guestRsvps/hostDeleteRsvp'
import { makeExportRsvps } from '../application/usecases/guestRsvps/exportRsvps'
import { makePostAbsentNote } from '../application/usecases/guestRsvps/postAbsentNote'
import { makeCreateGuestbookEntry } from '../application/usecases/guestbook/createGuestbookEntry'
import { makeMarkRsvpsSeen } from '../application/usecases/guestRsvps/markRsvpsSeen'
import { makeCountUnseenRsvps } from '../application/usecases/guestRsvps/countUnseenRsvps'
import { archiveStateOf } from '../domain/exports/albumExport'
import {
  makeGetPushKey,
  makeSubscribePush,
  makeUnsubscribePush,
  makeUnsubscribePushEverywhere,
} from '../application/usecases/push/pushSubscriptions'
import type { Adapters, UseCasePolicy } from './usecases'
import type { SharedHooks } from './usecases.shared'

/** The three use cases of a guest's own reply read the same things. */
type NoteHooks = Pick<SharedHooks, 'invalidateBook' | 'invalidateExport'>

const ownRsvpDeps = (adapters: Adapters, hooks: NoteHooks): OwnRsvpDeps => ({
  // What prints the guestbook hears of an erased reply that held a note (lot 4).
  invalidateBook: hooks.invalidateBook,
  invalidateExport: hooks.invalidateExport,
  events: adapters.events,
  invites: adapters.guestInvites,
  rsvps: adapters.guestRsvps,
  households: adapters.guestHouseholds,
  secrets: adapters.secretTokens,
  bus: adapters.bus,
  clock: adapters.clock,
})

/** The events slice of the use-case bag: composition only, built by `buildUseCases`. */
export const eventsUseCases = (
  adapters: Adapters,
  policy: UseCasePolicy,
  { invalidateBook, invalidateExport }: SharedHooks,
) => ({
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
    photos: adapters.photos,
    clock: adapters.clock,
    clients: adapters.clients,
    notices: adapters.purgeNotices,
    guestbook: adapters.guestbook,
    getEventLimits: makeGetEventLimits({ clients: adapters.clients }),
    capNoticeDays: policy.retention.capNoticeDays,
  }),
  /**
   * The warning to the owners of albums about to be deleted (spec 22), run by the retention
   * follow-up and by nothing else: no route reaches it.
   */
  sweepPurgeNotices: makeSweepPurgeNotices({
    events: adapters.events,
    clients: adapters.clients,
    memberships: adapters.memberships,
    notices: adapters.purgeNotices,
    mailer: adapters.mailer,
    clock: adapters.clock,
    logger: adapters.logger,
    capNoticeDays: policy.retention.capNoticeDays,
    publicUrl: policy.publicUrl,
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
  // "Révéler maintenant" (spec 23): an audited act of any moderator.
  revealEvent: makeRevealEvent({
    events: adapters.events,
    memberships: adapters.memberships,
    audit: adapters.audit,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  // The guest invitation, the owner's side (spec 29): audited acts, no content in the log.
  // The guests' side (spec 29): public, one refusal, the event read by id after the invitation.
  viewGuestInvite: makeViewGuestInvite({
    events: adapters.events,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    clock: adapters.clock,
  }),
  // The guests' replies, the guests' side (spec 30): public, one refusal, the token bound to the event.
  submitRsvp: makeSubmitRsvp({
    events: adapters.events,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    secrets: adapters.secretTokens,
    ids: adapters.ids,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  getOwnRsvp: makeGetOwnRsvp(ownRsvpDeps(adapters, { invalidateBook, invalidateExport })),
  updateOwnRsvp: makeUpdateOwnRsvp(ownRsvpDeps(adapters, { invalidateBook, invalidateExport })),
  deleteOwnRsvp: makeDeleteOwnRsvp(ownRsvpDeps(adapters, { invalidateBook, invalidateExport })),
  // The word of a guest who cannot come: the guestbook's own door, with an author made for it.
  postAbsentNote: makePostAbsentNote({
    events: adapters.events,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    secrets: adapters.secretTokens,
    guests: adapters.guests,
    createEntry: makeCreateGuestbookEntry({
      events: adapters.events,
      guestbook: adapters.guestbook,
      ids: adapters.ids,
      bus: adapters.bus,
      clock: adapters.clock,
    }),
    ids: adapters.ids,
    clock: adapters.clock,
  }),
  getGuestInviteLogoMedia: makeGetGuestInviteLogoMedia({
    events: adapters.events,
    invites: adapters.guestInvites,
    media: adapters.media,
  }),
  getGuestInvite: makeGetGuestInvite({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
  }),
  saveGuestInvite: makeSaveGuestInvite({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    audit: adapters.audit,
    ids: adapters.ids,
    clock: adapters.clock,
  }),
  enableGuestInvite: makeEnableGuestInvite({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  disableGuestInvite: makeDisableGuestInvite({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  rotateGuestInviteToken: makeRotateGuestInviteToken({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    audit: adapters.audit,
    ids: adapters.ids,
    clock: adapters.clock,
  }),
  // The guests' replies, the owner's side (spec 30): audited acts, no content in the log.
  getRsvpForm: makeGetRsvpForm({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    clock: adapters.clock,
  }),
  saveRsvpForm: makeSaveRsvpForm({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    audit: adapters.audit,
    bus: adapters.bus,
    clock: adapters.clock,
    ids: adapters.ids,
  }),
  closeRsvps: makeCloseRsvps({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    audit: adapters.audit,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  reopenRsvps: makeReopenRsvps({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    audit: adapters.audit,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  listRsvps: makeListRsvps({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    preferences: adapters.mailPreferences,
    clock: adapters.clock,
  }),
  setRsvpDigest: makeSetRsvpDigest({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    preferences: adapters.mailPreferences,
  }),
  hostAddRsvp: makeHostAddRsvp({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    audit: adapters.audit,
    bus: adapters.bus,
    ids: adapters.ids,
    clock: adapters.clock,
  }),
  hostUpdateRsvp: makeHostUpdateRsvp({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    audit: adapters.audit,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  hostDeleteRsvp: makeHostDeleteRsvp({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    audit: adapters.audit,
    bus: adapters.bus,
    clock: adapters.clock,
    invalidateBook,
    invalidateExport,
  }),
  // Browser notifications for the host (spec 30, lot 4). Off while the box has no VAPID keys.
  getPushKey: makeGetPushKey(policy.push),
  subscribePush: makeSubscribePush({
    events: adapters.events,
    memberships: adapters.memberships,
    subscriptions: adapters.pushSubscriptions,
    ids: adapters.ids,
    clock: adapters.clock,
    push: policy.push,
  }),
  unsubscribePushEverywhere: makeUnsubscribePushEverywhere({
    subscriptions: adapters.pushSubscriptions,
    push: policy.push,
  }),
  unsubscribePush: makeUnsubscribePush({
    subscriptions: adapters.pushSubscriptions,
    push: policy.push,
  }),
  exportRsvps: makeExportRsvps({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  markRsvpsSeen: makeMarkRsvpsSeen({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    clock: adapters.clock,
  }),
  countUnseenRsvps: makeCountUnseenRsvps({ rsvps: adapters.guestRsvps }),
  // The replies whose time has come (spec 30): from the retention sweeper only, no route.
  purgeExpiredRsvps: makePurgeExpiredRsvps({
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    clock: adapters.clock,
    bus: adapters.bus,
    invalidateBook,
    invalidateExport,
  }),
  // The guest list (spec 30, lot 3): the owner's, and the household's own link on the public side.
  listHouseholds: makeListHouseholds({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
  }),
  saveHousehold: makeSaveHousehold({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    bus: adapters.bus,
    ids: adapters.ids,
    clock: adapters.clock,
  }),
  importHouseholds: makeImportHouseholds({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    households: adapters.guestHouseholds,
    audit: adapters.audit,
    bus: adapters.bus,
    ids: adapters.ids,
    clock: adapters.clock,
  }),
  deleteHousehold: makeDeleteHousehold({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    households: adapters.guestHouseholds,
    audit: adapters.audit,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  rotateHouseholdToken: makeRotateHouseholdToken({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    audit: adapters.audit,
    bus: adapters.bus,
    ids: adapters.ids,
    clock: adapters.clock,
  }),
  markHouseholdReminded: makeMarkHouseholdReminded({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    audit: adapters.audit,
    bus: adapters.bus,
    ids: adapters.ids,
    clock: adapters.clock,
  }),
  attachRsvpToHousehold: makeAttachRsvpToHousehold({
    events: adapters.events,
    memberships: adapters.memberships,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
    bus: adapters.bus,
  }),
  viewHousehold: makeViewHousehold({
    events: adapters.events,
    invites: adapters.guestInvites,
    rsvps: adapters.guestRsvps,
    households: adapters.guestHouseholds,
  }),
  rotateJoinCode: makeRotateJoinCode({
    events: adapters.events,
    memberships: adapters.memberships,
    ids: adapters.ids,
    bus: adapters.bus,
    joinCodeLength: policy.events.joinCodeLength,
  }),
  changeEventStatus: makeChangeEventStatus({
    invalidateExport,
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
    exportFiles: adapters.exportFiles,
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
    pushSubscriptions: adapters.pushSubscriptions,
  }),
  purgeExpiredEvents: makePurgeExpiredEvents({
    events: adapters.events,
    media: adapters.media,
    bookFiles: adapters.bookFiles,
    exportFiles: adapters.exportFiles,
    // What the box held, for the log line only: read before the row goes, never consulted to decide.
    archiveStateOf: async (eventId) => archiveStateOf(await adapters.exports.find(eventId)),
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
    voices: adapters.voices,
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
    invalidateExport,
    events: adapters.events,
    clients: adapters.clients,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
})
