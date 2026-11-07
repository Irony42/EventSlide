import { makeAcknowledgePrivacyNotice } from '../application/usecases/guests/acknowledgePrivacyNotice'
import { makeAuthenticateGuest } from '../application/usecases/guests/authenticateGuest'
import { makeGetPrivacyNotice } from '../application/usecases/guests/getPrivacyNotice'
import { makeJoinEvent } from '../application/usecases/guests/joinEvent'
import { makeGetEventStats } from '../application/usecases/stats/getEventStats'
import { makeListGuests } from '../application/usecases/guests/listGuests'
import { makeEraseGuestContribution } from '../application/usecases/guests/eraseGuestContribution'
import { makeRenameGuest } from '../application/usecases/guests/renameGuest'
import { makeRevokeGuest } from '../application/usecases/guests/revokeGuest'
import type { Adapters, UseCasePolicy } from './usecases'
import { type SharedHooks } from './usecases.shared'

/** The guests slice of the use-case bag: composition only, built by `buildUseCases`. */
export const guestsUseCases = (
  adapters: Adapters,
  policy: UseCasePolicy,
  { invalidateReel, invalidateBook }: SharedHooks,
) => ({
  // guests
  joinEvent: makeJoinEvent({
    events: adapters.events,
    clients: adapters.clients,
    guests: adapters.guests,
    tokens: adapters.guestTokens,
    ids: adapters.ids,
    clock: adapters.clock,
    bus: adapters.bus,
    operatorName: policy.operatorName,
  }),
  authenticateGuest: makeAuthenticateGuest({
    events: adapters.events,
    guests: adapters.guests,
    tokens: adapters.guestTokens,
    clock: adapters.clock,
    logger: adapters.logger,
  }),
  renameGuest: makeRenameGuest({ guests: adapters.guests, events: adapters.events }),
  eraseGuestContribution: makeEraseGuestContribution({
    invalidateReel,
    invalidateBook,
    events: adapters.events,
    guests: adapters.guests,
    photos: adapters.photos,
    reactions: adapters.reactions,
    clips: adapters.clips,
    guestbook: adapters.guestbook,
    media: adapters.media,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  revokeGuest: makeRevokeGuest({
    events: adapters.events,
    guests: adapters.guests,
    memberships: adapters.memberships,
    clock: adapters.clock,
  }),
  listGuests: makeListGuests({
    guests: adapters.guests,
    memberships: adapters.memberships,
    clock: adapters.clock,
  }),
  getEventStats: makeGetEventStats({
    events: adapters.events,
    memberships: adapters.memberships,
    guests: adapters.guests,
    stats: adapters.eventStats,
    clock: adapters.clock,
  }),
  getPrivacyNotice: makeGetPrivacyNotice({
    events: adapters.events,
    clients: adapters.clients,
    guests: adapters.guests,
    operatorName: policy.operatorName,
  }),
  acknowledgePrivacyNotice: makeAcknowledgePrivacyNotice({
    events: adapters.events,
    clients: adapters.clients,
    guests: adapters.guests,
    clock: adapters.clock,
    operatorName: policy.operatorName,
  }),
})
