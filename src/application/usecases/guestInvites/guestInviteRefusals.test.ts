import { describe, expect, it } from 'vitest'
import { AT, aGuestInvite, anEvent } from '../../testing/builders'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import {
  OWNER,
  PARTY,
  WEDDING,
  guestInviteScene,
  type GuestInviteScene,
} from '../../testing/guestInviteScene'
import { asEventId } from '../../../domain/shared/ids'
import { makeDisableGuestInvite } from './disableGuestInvite'
import { makeEnableGuestInvite } from './enableGuestInvite'
import { makeRotateGuestInviteToken } from './rotateGuestInviteToken'
import { makeSaveGuestInvite } from './saveGuestInvite'

/**
 * The two refusals that no host's request can reach but a broken collaborator can, each held so a
 * failure is passed back and never swallowed:
 *
 * - **an entropy source that hands back the wrong number of bytes** makes no token, and no row
 *   is written with a link made of too little randomness;
 * - **an audit entry the log refuses** (an event id that is not an audit id) stops the act
 *   **before** the change: write-ahead, so an act is never made without its line.
 */

const shortBytes = (): SequentialIdGenerator =>
  Object.assign(new SequentialIdGenerator(), { bytes: () => new Uint8Array(3) })

/** An event whose id the audit log refuses (a space is not in an audit id), owned by the host. */
const UNAUDITABLE = asEventId('evt not auditable')

const withUnauditableEvent = async (scene: GuestInviteScene) => {
  scene.events.seed(
    anEvent({ id: UNAUDITABLE, ownerId: OWNER, slug: 'sans-audit', joinCode: 'K9M2NP' }),
  )
  await scene.memberships.grant({
    eventId: UNAUDITABLE,
    userId: OWNER,
    role: 'owner',
    grantedAt: AT,
  })
}

describe('guest invitation use cases pass a broken collaborator’s refusal back', () => {
  it.each([
    ['saveGuestInvite', makeSaveGuestInvite],
    ['enableGuestInvite', makeEnableGuestInvite],
  ] as const)('%s: a token that cannot be made writes nothing', async (_name, make) => {
    const scene = await guestInviteScene()
    const run = make({
      events: scene.events,
      memberships: scene.memberships,
      invites: scene.invites,
      audit: scene.audit,
      ids: shortBytes(),
      clock: scene.clock,
    })

    const outcome = await run({ eventId: WEDDING, actorId: OWNER, ...PARTY })

    expect(!outcome.ok && outcome.error.code).toBe('guestInvite.tokenInvalid')
    expect(await scene.invites.findByEvent(WEDDING)).toBeNull()
    expect((await scene.audit.list({ limit: 5 })).items).toEqual([])
  })

  it('rotateGuestInviteToken: a token that cannot be made leaves the link as it was', async () => {
    const scene = await guestInviteScene()
    await scene.save({ eventId: WEDDING, actorId: OWNER, ...PARTY })
    const before = (await scene.invites.findByEvent(WEDDING))?.token.value
    const rotate = makeRotateGuestInviteToken({
      events: scene.events,
      memberships: scene.memberships,
      invites: scene.invites,
      audit: scene.audit,
      ids: shortBytes(),
      clock: scene.clock,
    })

    const outcome = await rotate({ eventId: WEDDING, actorId: OWNER })

    expect(!outcome.ok && outcome.error.code).toBe('guestInvite.tokenInvalid')
    expect((await scene.invites.findByEvent(WEDDING))?.token.value).toBe(before)
  })

  it('an audit entry the log refuses stops each act before it changes anything', async () => {
    const scene = await guestInviteScene()
    await withUnauditableEvent(scene)
    const ids = new SequentialIdGenerator()
    const deps = {
      events: scene.events,
      memberships: scene.memberships,
      invites: scene.invites,
      audit: scene.audit,
      clock: scene.clock,
    }
    const acts = {
      save: await makeSaveGuestInvite({ ...deps, ids })({
        eventId: UNAUDITABLE,
        actorId: OWNER,
        ...PARTY,
      }),
      enable: await makeEnableGuestInvite({ ...deps, ids })({
        eventId: UNAUDITABLE,
        actorId: OWNER,
      }),
    }

    expect(acts.save.ok).toBe(false)
    expect(acts.enable.ok).toBe(false)
    expect(await scene.invites.findByEvent(UNAUDITABLE)).toBeNull()

    // A row that already exists is not changed by a disable or a rotation either.
    const seeded = await guestInviteScene()
    await withUnauditableEvent(seeded)
    seeded.invites.seed(
      aGuestInvite({
        eventId: UNAUDITABLE,
        enabled: true,
        tokenByte: 9,
        ...PARTY,
      }),
    )
    const seededDeps = {
      events: seeded.events,
      memberships: seeded.memberships,
      invites: seeded.invites,
      audit: seeded.audit,
      clock: seeded.clock,
    }
    const disabled = await makeDisableGuestInvite(seededDeps)({
      eventId: UNAUDITABLE,
      actorId: OWNER,
    })
    const rotated = await makeRotateGuestInviteToken({ ...seededDeps, ids })({
      eventId: UNAUDITABLE,
      actorId: OWNER,
    })

    // ...nor does switching on a dated invitation that is off.
    const off = await guestInviteScene()
    await withUnauditableEvent(off)
    off.invites.seed(aGuestInvite({ eventId: UNAUDITABLE, tokenByte: 9, ...PARTY }))
    const enabled = await makeEnableGuestInvite({
      events: off.events,
      memberships: off.memberships,
      invites: off.invites,
      audit: off.audit,
      clock: off.clock,
      ids,
    })({ eventId: UNAUDITABLE, actorId: OWNER })

    expect(enabled.ok).toBe(false)
    expect((await off.invites.findByEvent(UNAUDITABLE))?.enabled).toBe(false)
    expect(disabled.ok).toBe(false)
    expect(rotated.ok).toBe(false)
    const kept = await seeded.invites.findByEvent(UNAUDITABLE)
    expect(kept?.enabled).toBe(true)
    expect(kept?.token.value).toBe('9999999999999999')
  })
})
