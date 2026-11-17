import { beforeEach, describe, expect, it } from 'vitest'
import { isRevealed } from '../../../domain/events/eventRevealSettings'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, anEvent } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClock } from '../../testing/fakeClock'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeRevealEvent, type RevealEvent } from './revealEvent'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')
const minutes = (n: number): Date => new Date(AT.getTime() + n * 60_000)

describe('revealEvent (spec 23)', () => {
  let clients: FakeClientRepository
  let events: FakeEventRepository
  let audit: FakeAuditLog
  let bus: RecordingEventBus
  let clock: FakeClock
  let reveal: RevealEvent

  const seed = (input: Parameters<typeof anEvent>[0] = {}) =>
    events.seed(anEvent({ id: WEDDING, ownerId: OWNER, ...input }))
  const lines = async () => (await audit.list({ limit: 10 })).items

  beforeEach(async () => {
    clients = new FakeClientRepository()
    events = new FakeEventRepository({ clients })
    audit = new FakeAuditLog().withAccounts(OWNER, MODERATOR, STRANGER)
    bus = new RecordingEventBus()
    clock = new FakeClock()
    const memberships = new FakeMembershipRepository()
    await memberships.grant({ eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT })
    await memberships.grant({
      eventId: WEDDING,
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })
    await memberships.grant({ eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT })
    events.seed(anEvent({ id: GALA, ownerId: STRANGER, slug: 'gala', joinCode: 'Z3N9PT' }))
    reveal = makeRevealEvent({ events, memberships, audit, bus, clock })
  })

  it('writes the hour as now, and the evening is revealed from that instant', async () => {
    seed({ settings: { reveal: { enabled: true, at: minutes(180), film: true } } })

    const result = await reveal({ eventId: WEDDING, actorId: MODERATOR })

    expect(result.ok).toBe(true)
    const stored = await events.findById(WEDDING)
    expect(stored?.settings.reveal.at).toEqual(AT)
    expect(stored?.settings.reveal.film).toBe(true)
    expect(stored !== null && isRevealed(stored.settings.reveal, AT)).toBe(true)
  })

  it('reveals an evening that was waiting for the button (no hour)', async () => {
    seed({ settings: { reveal: { enabled: true } } })

    await reveal({ eventId: WEDDING, actorId: OWNER })

    expect((await events.findById(WEDDING))?.settings.reveal.at).toEqual(AT)
  })

  it('is idempotent: a second press writes nothing and keeps the hour the room was shown', async () => {
    seed({ settings: { reveal: { enabled: true } } })
    await reveal({ eventId: WEDDING, actorId: OWNER })
    clock.advance(60_000)

    const again = await reveal({ eventId: WEDDING, actorId: MODERATOR })

    expect(again.ok).toBe(true)
    expect((await events.findById(WEDDING))?.settings.reveal.at).toEqual(AT)
    expect(await lines()).toHaveLength(1)
    expect(bus.published.filter((e) => e.type === 'event.settingsChanged')).toHaveLength(1)
  })

  it('answers success and writes nothing for an event whose mode is off', async () => {
    seed({})

    const result = await reveal({ eventId: WEDDING, actorId: OWNER })

    expect(result.ok).toBe(true)
    expect((await events.findById(WEDDING))?.settings.reveal.at).toBeNull()
    expect(await lines()).toEqual([])
    expect(bus.published).toEqual([])
  })

  it('records who revealed, once, with the event and its client, and announces it', async () => {
    clients.seed(aClient({ id: 'client-1' }))
    seed({ clientId: 'client-1', settings: { reveal: { enabled: true } } })

    await reveal({ eventId: WEDDING, actorId: MODERATOR })

    const written = await lines()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      action: 'event.revealed',
      actor: { kind: 'member', userId: MODERATOR },
      subject: { type: 'event', id: WEDDING },
      clientId: asClientId('client-1'),
      details: {},
    })
    expect(bus.published).toEqual([{ type: 'event.settingsChanged', eventId: WEDDING }])
  })

  it('refuses a stranger as an event that does not exist, and changes nothing', async () => {
    seed({ settings: { reveal: { enabled: true } } })

    const result = await reveal({ eventId: WEDDING, actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect((await events.findById(WEDDING))?.settings.reveal.at).toBeNull()
    expect(await lines()).toEqual([])
  })

  it('answers not found for an unknown event', async () => {
    const result = await reveal({ eventId: asEventId('nope'), actorId: OWNER })
    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses an archived event, which is a record', async () => {
    seed({ status: 'archived', settings: { reveal: { enabled: true } } })

    const result = await reveal({ eventId: WEDDING, actorId: OWNER })

    expect(!result.ok && result.error.code).toBe('event.immutable')
  })

  it('can reveal a closed evening: the photographs were never shown', async () => {
    seed({ status: 'closed', settings: { reveal: { enabled: true } } })

    const result = await reveal({ eventId: WEDDING, actorId: OWNER })

    expect(result.ok).toBe(true)
  })

  it('leaves a frozen client’s event alone: the sweep in suspendedClientWrites asks it too', async () => {
    clients.seed(aClient({ id: 'client-1', suspendedAt: AT }))
    seed({ clientId: 'client-1', settings: { reveal: { enabled: true } } })

    const result = await reveal({ eventId: WEDDING, actorId: OWNER })

    expect(!result.ok && result.error.code).toBe('client.suspended')
    expect(await lines()).toEqual([])
  })
})
