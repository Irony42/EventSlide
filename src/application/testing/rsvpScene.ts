import { makeCloseRsvps, makeReopenRsvps } from '../usecases/guestRsvps/closeRsvps'
import { makeCountUnseenRsvps } from '../usecases/guestRsvps/countUnseenRsvps'
import { makeExportRsvps } from '../usecases/guestRsvps/exportRsvps'
import { makeGetRsvpForm } from '../usecases/guestRsvps/getRsvpForm'
import { makeHostAddRsvp } from '../usecases/guestRsvps/hostAddRsvp'
import { makeHostDeleteRsvp } from '../usecases/guestRsvps/hostDeleteRsvp'
import { makeHostUpdateRsvp } from '../usecases/guestRsvps/hostUpdateRsvp'
import { makeListRsvps } from '../usecases/guestRsvps/listRsvps'
import { makeMarkRsvpsSeen } from '../usecases/guestRsvps/markRsvpsSeen'
import { makePurgeExpiredRsvps } from '../usecases/guestRsvps/purgeExpiredRsvps'
import { makeSaveRsvpForm } from '../usecases/guestRsvps/saveRsvpForm'
import { FakeGuestRsvpRepository } from './fakeGuestRsvpRepository'
import { guestInviteScene, OWNER, PARTY, WEDDING, type GuestInviteScene } from './guestInviteScene'
import { RecordingEventBus } from './recordingEventBus'
import { SequentialIdGenerator } from './sequentialIdGenerator'

/**
 * The guest invitation scene (spec 29) with the replies use cases of the host over it (spec 30):
 * the same live wedding, draft, closed, archived and frozen events, an owner who is also a member
 * (so the badge has someone to count for), a moderator, a stranger.
 */

export {
  ARCHIVED,
  CLOSED,
  DRAFT,
  FROZEN,
  GALA,
  MODERATOR,
  OWNER,
  STRANGER,
  WEDDING,
} from './guestInviteScene'
export { PARTY }

export interface RsvpScene extends GuestInviteScene {
  readonly rsvps: FakeGuestRsvpRepository
  readonly bus: RecordingEventBus
  readonly ids: SequentialIdGenerator
  readonly getForm: ReturnType<typeof makeGetRsvpForm>
  readonly saveForm: ReturnType<typeof makeSaveRsvpForm>
  readonly close: ReturnType<typeof makeCloseRsvps>
  readonly reopen: ReturnType<typeof makeReopenRsvps>
  readonly list: ReturnType<typeof makeListRsvps>
  readonly hostAdd: ReturnType<typeof makeHostAddRsvp>
  readonly hostUpdate: ReturnType<typeof makeHostUpdateRsvp>
  readonly hostDelete: ReturnType<typeof makeHostDeleteRsvp>
  readonly exportCsv: ReturnType<typeof makeExportRsvps>
  readonly markSeen: ReturnType<typeof makeMarkRsvpsSeen>
  readonly countUnseen: ReturnType<typeof makeCountUnseenRsvps>
  readonly purge: ReturnType<typeof makePurgeExpiredRsvps>
}

/** The scene, and the wedding's invitation saved with a date (replies hang on it). */
export const rsvpScene = async (options: { invited?: boolean } = {}): Promise<RsvpScene> => {
  const base = await guestInviteScene()
  const rsvps = new FakeGuestRsvpRepository()
  const bus = new RecordingEventBus()
  const ids = new SequentialIdGenerator()
  const { events, memberships, invites, audit, clock } = base
  const access = { events, memberships, invites }

  // Every event of the scene holds its owner as a member of the replies badge too.
  rsvps.addMember(WEDDING, OWNER)
  if (options.invited ?? true) {
    const saved = await base.save({ eventId: WEDDING, actorId: OWNER, title: 'Fête', ...PARTY })
    if (!saved.ok) throw new Error('the scene could not save its invitation')
  }

  return {
    ...base,
    rsvps,
    bus,
    ids,
    getForm: makeGetRsvpForm({ ...access, rsvps, clock }),
    saveForm: makeSaveRsvpForm({ ...access, rsvps, audit, bus, clock }),
    close: makeCloseRsvps({ ...access, rsvps, audit, bus, clock }),
    reopen: makeReopenRsvps({ ...access, rsvps, audit, bus, clock }),
    list: makeListRsvps({ ...access, rsvps, clock }),
    hostAdd: makeHostAddRsvp({ ...access, rsvps, audit, bus, ids, clock }),
    hostUpdate: makeHostUpdateRsvp({ ...access, rsvps, audit, bus, clock }),
    hostDelete: makeHostDeleteRsvp({ ...access, rsvps, audit, bus, clock }),
    exportCsv: makeExportRsvps({ ...access, rsvps, audit, clock }),
    markSeen: makeMarkRsvpsSeen({ ...access, rsvps, clock }),
    countUnseen: makeCountUnseenRsvps({ rsvps }),
    purge: makePurgeExpiredRsvps({ rsvps, clock }),
  }
}
