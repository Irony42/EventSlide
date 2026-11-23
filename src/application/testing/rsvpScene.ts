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
import { makeAttachRsvpToHousehold } from '../usecases/guestRsvps/attachRsvpToHousehold'
import { makeDeleteHousehold } from '../usecases/guestRsvps/deleteHousehold'
import {
  makeMarkHouseholdReminded,
  makeRotateHouseholdToken,
} from '../usecases/guestRsvps/householdActs'
import { makeImportHouseholds } from '../usecases/guestRsvps/importHouseholds'
import { makeListHouseholds } from '../usecases/guestRsvps/listHouseholds'
import { makeSaveHousehold } from '../usecases/guestRsvps/saveHousehold'
import { makeViewHousehold } from '../usecases/guestRsvps/viewHousehold'
import { makeViewGuestInvite } from '../usecases/guestInvites/viewGuestInvite'
import {
  makeDeleteOwnRsvp,
  makeGetOwnRsvp,
  makeUpdateOwnRsvp,
} from '../usecases/guestRsvps/ownRsvp'
import { makeSubmitRsvp } from '../usecases/guestRsvps/submitRsvp'
import { FakeSecretTokens } from './fakeSecretTokens'
import { makeSaveRsvpForm } from '../usecases/guestRsvps/saveRsvpForm'
import { FakeGuestHouseholdRepository } from './fakeGuestHouseholdRepository'
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

/**
 * The scene's entropy. `SequentialIdGenerator.bytes` is a fixed ramp that, read mod 32, repeats a
 * 16-byte token every second call: fine for one join code, not for a list of households that must
 * each have a link of their own. A 16-byte request gets a counter in its first three bytes instead.
 */
class SceneIds extends SequentialIdGenerator {
  private tokens = 0

  override bytes(count: number): Uint8Array {
    if (count !== 16) return super.bytes(count)
    this.tokens += 1
    const n = this.tokens
    return Uint8Array.from({ length: 16 }, (_, i) => (i < 3 ? (n >> (5 * i)) % 32 : i))
  }
}

export interface RsvpScene extends GuestInviteScene {
  readonly rsvps: FakeGuestRsvpRepository
  readonly households: FakeGuestHouseholdRepository
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
  readonly listHouseholds: ReturnType<typeof makeListHouseholds>
  readonly saveHousehold: ReturnType<typeof makeSaveHousehold>
  readonly importHouseholds: ReturnType<typeof makeImportHouseholds>
  readonly deleteHousehold: ReturnType<typeof makeDeleteHousehold>
  readonly rotateHouseholdToken: ReturnType<typeof makeRotateHouseholdToken>
  readonly markHouseholdReminded: ReturnType<typeof makeMarkHouseholdReminded>
  readonly attachRsvp: ReturnType<typeof makeAttachRsvpToHousehold>
  readonly viewHousehold: ReturnType<typeof makeViewHousehold>
  readonly secrets: FakeSecretTokens
  readonly submit: ReturnType<typeof makeSubmitRsvp>
  readonly getOwn: ReturnType<typeof makeGetOwnRsvp>
  readonly updateOwn: ReturnType<typeof makeUpdateOwnRsvp>
  readonly deleteOwn: ReturnType<typeof makeDeleteOwnRsvp>
  /** The wedding's invitation link, as a guest has it. */
  readonly token: () => Promise<string>
}

/** The scene, and the wedding's invitation saved with a date (replies hang on it). */
export const rsvpScene = async (options: { invited?: boolean } = {}): Promise<RsvpScene> => {
  const base = await guestInviteScene()
  const rsvps = new FakeGuestRsvpRepository()
  const households = new FakeGuestHouseholdRepository(rsvps)
  const bus = new RecordingEventBus()
  const ids = new SceneIds()
  const { events, memberships, invites, audit, clock } = base
  const access = { events, memberships, invites }
  const publicAccess = { events, invites }
  const secrets = new FakeSecretTokens()

  // Every event of the scene holds its owner as a member of the replies badge too.
  rsvps.addMember(WEDDING, OWNER)
  if (options.invited ?? true) {
    const saved = await base.save({ eventId: WEDDING, actorId: OWNER, title: 'Fête', ...PARTY })
    if (!saved.ok) throw new Error('the scene could not save its invitation')
  }

  return {
    ...base,
    rsvps,
    households,
    bus,
    ids,
    getForm: makeGetRsvpForm({ ...access, rsvps, clock }),
    saveForm: makeSaveRsvpForm({ ...access, rsvps, audit, bus, clock, ids }),
    close: makeCloseRsvps({ ...access, rsvps, audit, bus, clock }),
    reopen: makeReopenRsvps({ ...access, rsvps, audit, bus, clock }),
    list: makeListRsvps({ ...access, rsvps, households, clock }),
    hostAdd: makeHostAddRsvp({ ...access, rsvps, audit, bus, ids, clock }),
    hostUpdate: makeHostUpdateRsvp({ ...access, rsvps, households, audit, bus, clock }),
    hostDelete: makeHostDeleteRsvp({ ...access, rsvps, audit, bus, clock }),
    exportCsv: makeExportRsvps({ ...access, rsvps, audit, clock }),
    markSeen: makeMarkRsvpsSeen({ ...access, rsvps, clock }),
    countUnseen: makeCountUnseenRsvps({ rsvps }),
    purge: makePurgeExpiredRsvps({ rsvps, households, clock }),
    listHouseholds: makeListHouseholds({ ...access, rsvps, households }),
    saveHousehold: makeSaveHousehold({ ...access, rsvps, households, bus, ids, clock }),
    importHouseholds: makeImportHouseholds({ ...access, households, audit, bus, ids, clock }),
    deleteHousehold: makeDeleteHousehold({ ...access, households, audit, bus, clock }),
    rotateHouseholdToken: makeRotateHouseholdToken({
      ...access,
      rsvps,
      households,
      audit,
      bus,
      ids,
      clock,
    }),
    markHouseholdReminded: makeMarkHouseholdReminded({
      ...access,
      rsvps,
      households,
      audit,
      bus,
      ids,
      clock,
    }),
    attachRsvp: makeAttachRsvpToHousehold({ ...access, rsvps, households, bus }),
    viewHousehold: makeViewHousehold({ ...publicAccess, rsvps, households }),
    secrets,
    submit: makeSubmitRsvp({ ...publicAccess, rsvps, households, secrets, ids, bus, clock }),
    getOwn: makeGetOwnRsvp({ ...publicAccess, rsvps, households, secrets, bus, clock }),
    updateOwn: makeUpdateOwnRsvp({ ...publicAccess, rsvps, households, secrets, bus, clock }),
    deleteOwn: makeDeleteOwnRsvp({ ...publicAccess, rsvps, households, secrets, bus, clock }),
    view: makeViewGuestInvite({ events, invites, rsvps, clock }),
    token: async () => (await invites.findByEvent(WEDDING))?.token.value ?? 'absent',
  }
}
