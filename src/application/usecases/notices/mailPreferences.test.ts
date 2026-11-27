import { describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { AT, aUser } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClock } from '../../testing/fakeClock'
import { FakeMailPreferenceRepository } from '../../testing/fakeMailPreferenceRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeGetMailPreferences, makeSetMailPreferences } from './mailPreferences'

const HOST = asUserId('user-1')
const OPERATOR = asUserId('user-op')
const GHOST = asUserId('nobody')

const aWorld = () => {
  const users = new FakeUserRepository().seed(
    aUser({ id: HOST, email: 'hote@example.test', siteRole: 'none' }),
    aUser({ id: OPERATOR, email: 'op@example.test', siteRole: 'operator' }),
  )
  const preferences = new FakeMailPreferenceRepository().withUsers(HOST, OPERATOR)
  const audit = new FakeAuditLog().withAccounts(HOST, OPERATOR)
  const clock = new FakeClock(AT)
  const set = makeSetMailPreferences({ users, preferences, audit, clock })
  const get = (over: { canDeliver?: boolean; hostMailNotices?: boolean } = {}) =>
    makeGetMailPreferences({
      users,
      preferences,
      mailer: { canDeliver: over.canDeliver ?? true },
      hostMailNotices: over.hostMailNotices ?? true,
    })
  return { users, preferences, audit, set, get }
}

describe('getMailPreferences', () => {
  it('answers both switches on for an account that never touched them', async () => {
    const world = aWorld()

    const result = await world.get()({ userId: HOST })

    expect(result).toEqual({ ok: true, value: { rsvp: true, event: true, available: true } })
  })

  it('answers what the account chose', async () => {
    const world = aWorld()
    await world.preferences.save(HOST, { rsvp: false, event: true })

    const result = await world.get()({ userId: HOST })

    expect(result).toEqual({ ok: true, value: { rsvp: false, event: true, available: true } })
  })

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    'is available only with a relay that delivers=%s and HOST_MAIL_NOTICES on=%s (%s)',
    async (canDeliver, hostMailNotices, available) => {
      const world = aWorld()

      const result = await world.get({ canDeliver, hostMailNotices })({ userId: HOST })

      expect(result.ok && result.value.available).toBe(available)
    },
  )

  it('is a 404 for an account that is gone', async () => {
    const result = await aWorld().get()({ userId: GHOST })

    expect(result).toMatchObject({ ok: false, error: { code: 'user.notFound' } })
  })
})

describe('setMailPreferences', () => {
  it('stores the switch it is given and leaves the other as it was', async () => {
    const world = aWorld()

    const result = await world.set({ userId: HOST, rsvp: false })

    expect(result.ok).toBe(true)
    expect(await world.preferences.forUser(HOST)).toEqual({ rsvp: false, event: true })

    await world.set({ userId: HOST, event: false })
    expect(await world.preferences.forUser(HOST)).toEqual({ rsvp: false, event: false })
  })

  it('does not undo a concurrent change of the other switch (the page saves each switch on its own)', async () => {
    const world = aWorld()

    await Promise.all([
      world.set({ userId: HOST, rsvp: false }),
      world.set({ userId: HOST, event: false }),
    ])

    expect(await world.preferences.forUser(HOST)).toEqual({ rsvp: false, event: false })
  })

  it('changes the account it is given and no other', async () => {
    const world = aWorld()

    await world.set({ userId: HOST, rsvp: false, event: false })

    expect(await world.preferences.forUser(OPERATOR)).toEqual({ rsvp: true, event: true })
  })

  it('records the change in the audit log, with the account and no content', async () => {
    const world = aWorld()

    await world.set({ userId: HOST, rsvp: false })

    expect(world.audit.all()).toHaveLength(1)
    expect(world.audit.all()[0]).toMatchObject({
      actor: { kind: 'member', userId: HOST },
      action: 'account.mailPreferencesChanged',
      subject: { type: 'account', id: HOST },
      clientId: null,
      details: {},
    })
  })

  it('names an operator an operator in the log', async () => {
    const world = aWorld()

    await world.set({ userId: OPERATOR, event: false })

    expect(world.audit.all()[0]?.actor).toMatchObject({ kind: 'operator', userId: OPERATOR })
  })

  it('writes nothing and records nothing when the request changes nothing', async () => {
    const world = aWorld()

    expect((await world.set({ userId: HOST, rsvp: true, event: true })).ok).toBe(true)
    expect((await world.set({ userId: HOST })).ok).toBe(true)

    expect(world.audit.all()).toEqual([])
  })

  it('stores nothing when the log refuses the entry: write-ahead', async () => {
    const world = aWorld()
    const refused = asUserId('not an id the log can hold!')
    await world.users.save(aUser({ id: refused, email: 'x@example.test' }))
    await world.preferences.withUsers(refused).save(refused, { rsvp: true, event: true })

    const result = await world.set({ userId: refused, rsvp: false })

    expect(result.ok).toBe(false)
    expect(await world.preferences.forUser(refused)).toEqual({ rsvp: true, event: true })
  })

  it('stores nothing when the log cannot be written: the entry comes first, so no change goes unrecorded', async () => {
    const world = aWorld()
    const failing = makeSetMailPreferences({
      users: world.users,
      preferences: world.preferences,
      audit: {
        record: async () => {
          throw new Error('the disk is full')
        },
      },
      clock: new FakeClock(AT),
    })

    await expect(failing({ userId: HOST, rsvp: false })).rejects.toThrow('the disk is full')

    expect(await world.preferences.forUser(HOST)).toEqual({ rsvp: true, event: true })
  })

  it('is a 404 for an account that is gone', async () => {
    const result = await aWorld().set({ userId: GHOST, rsvp: false })

    expect(result).toMatchObject({ ok: false, error: { code: 'user.notFound' } })
  })
})
