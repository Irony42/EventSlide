import { makeGetModerationQueue } from '../application/usecases/moderation/getModerationQueue'
import { makeModeratePhoto } from '../application/usecases/moderation/moderatePhoto'
import { makeModeratePhotosBulk } from '../application/usecases/moderation/moderatePhotosBulk'
import { makeGetPhotoReactions } from '../application/usecases/reactions/getPhotoReactions'
import { makeGetTopPhotos } from '../application/usecases/reactions/getTopPhotos'
import { makeReactToPhoto } from '../application/usecases/reactions/reactToPhoto'
import { makeWithdrawReaction } from '../application/usecases/reactions/withdrawReaction'
import { makeGetWallPlaylist } from '../application/usecases/slideshow/getWallPlaylist'
import { makeCreateGuestbookEntry } from '../application/usecases/guestbook/createGuestbookEntry'
import { makeDeleteGuestbookEntry } from '../application/usecases/guestbook/deleteGuestbookEntry'
import { makeListGuestbookQueue } from '../application/usecases/guestbook/listGuestbookQueue'
import { makeListMyGuestbookEntries } from '../application/usecases/guestbook/listMyGuestbookEntries'
import { makeModerateGuestbookEntry } from '../application/usecases/guestbook/moderateGuestbookEntry'
import { makeGetChallenge } from '../application/usecases/challenges/getChallenge'
import { makeStartChallenge } from '../application/usecases/challenges/startChallenge'
import { makeStopChallenge } from '../application/usecases/challenges/stopChallenge'
import { makeCreateMission } from '../application/usecases/missions/createMission'
import { makeDeleteMission } from '../application/usecases/missions/deleteMission'
import { makeGetGuestChecklist } from '../application/usecases/missions/getGuestChecklist'
import { makeListMissions } from '../application/usecases/missions/listMissions'
import { makeUpdateMission } from '../application/usecases/missions/updateMission'
import type { Adapters, UseCasePolicy } from './usecases'
import { type SharedHooks } from './usecases.shared'

/** The wall slice of the use-case bag: composition only, built by `buildUseCases`. */
export const wallUseCases = (
  adapters: Adapters,
  policy: UseCasePolicy,
  { invalidateReel, invalidateBook }: SharedHooks,
) => ({
  // moderation
  getModerationQueue: makeGetModerationQueue({
    events: adapters.events,
    photos: adapters.photos,
    guests: adapters.guests,
    memberships: adapters.memberships,
  }),
  moderatePhoto: makeModeratePhoto({
    invalidateReel,
    invalidateBook,
    events: adapters.events,
    photos: adapters.photos,
    memberships: adapters.memberships,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  moderatePhotosBulk: makeModeratePhotosBulk({
    invalidateReel,
    invalidateBook,
    events: adapters.events,
    photos: adapters.photos,
    memberships: adapters.memberships,
    bus: adapters.bus,
    clock: adapters.clock,
  }),

  // slideshow
  getWallPlaylist: makeGetWallPlaylist({
    events: adapters.events,
    photos: adapters.photos,
    guests: adapters.guests,
    missions: adapters.missions,
    guestbook: adapters.guestbook,
    challenges: adapters.challenges,
    clock: adapters.clock,
  }),

  // guestbook
  createGuestbookEntry: makeCreateGuestbookEntry({
    events: adapters.events,
    guestbook: adapters.guestbook,
    ids: adapters.ids,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  listMyGuestbookEntries: makeListMyGuestbookEntries({
    events: adapters.events,
    guestbook: adapters.guestbook,
    clock: adapters.clock,
  }),
  deleteGuestbookEntry: makeDeleteGuestbookEntry({
    events: adapters.events,
    guestbook: adapters.guestbook,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  listGuestbookQueue: makeListGuestbookQueue({
    events: adapters.events,
    guestbook: adapters.guestbook,
    guests: adapters.guests,
    memberships: adapters.memberships,
  }),
  moderateGuestbookEntry: makeModerateGuestbookEntry({
    events: adapters.events,
    guestbook: adapters.guestbook,
    memberships: adapters.memberships,
    bus: adapters.bus,
    clock: adapters.clock,
  }),

  // missions
  listMissions: makeListMissions({
    events: adapters.events,
    missions: adapters.missions,
    memberships: adapters.memberships,
  }),
  createMission: makeCreateMission({
    events: adapters.events,
    missions: adapters.missions,
    memberships: adapters.memberships,
    ids: adapters.ids,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  updateMission: makeUpdateMission({
    events: adapters.events,
    missions: adapters.missions,
    memberships: adapters.memberships,
    bus: adapters.bus,
  }),
  deleteMission: makeDeleteMission({
    events: adapters.events,
    missions: adapters.missions,
    memberships: adapters.memberships,
    bus: adapters.bus,
  }),

  // challenges
  startChallenge: makeStartChallenge({
    events: adapters.events,
    missions: adapters.missions,
    challenges: adapters.challenges,
    memberships: adapters.memberships,
    ids: adapters.ids,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  getChallenge: makeGetChallenge({
    events: adapters.events,
    challenges: adapters.challenges,
    memberships: adapters.memberships,
    clock: adapters.clock,
  }),
  stopChallenge: makeStopChallenge({
    events: adapters.events,
    challenges: adapters.challenges,
    memberships: adapters.memberships,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  getGuestChecklist: makeGetGuestChecklist({
    events: adapters.events,
    missions: adapters.missions,
    challenges: adapters.challenges,
    clock: adapters.clock,
  }),

  // reactions
  reactToPhoto: makeReactToPhoto({
    events: adapters.events,
    photos: adapters.photos,
    reactions: adapters.reactions,
    bus: adapters.bus,
    clock: adapters.clock,
    ids: adapters.ids,
    budget: policy.reactionBudget,
  }),
  withdrawReaction: makeWithdrawReaction({ reactions: adapters.reactions }),
  getPhotoReactions: makeGetPhotoReactions({
    photos: adapters.photos,
    reactions: adapters.reactions,
  }),
  getTopPhotos: makeGetTopPhotos({
    events: adapters.events,
    photos: adapters.photos,
    reactions: adapters.reactions,
  }),
})
