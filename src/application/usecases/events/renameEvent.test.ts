import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeRenameEvent, type RenameEvent } from './renameEvent'

const WEDDING = asEventId('evt-wedding')
const ARCHIVED = asEventId('evt-archived')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('renameEvent', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let renameEvent: RenameEvent

  beforeEach(() => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    renameEvent = makeRenameEvent({ events, memberships, bus })

    events.seed(
      anEvent({ id: WEDDING, ownerId: OWNER, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
      anEvent({
        id: ARCHIVED,
        ownerId: OWNER,
        slug: 'gala-annuel',
        joinCode: 'Z3N9PT',
        status: 'archived',
      }),
    )
    memberships.seed(
      { eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT },
      { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT },
      { eventId: ARCHIVED, userId: OWNER, role: 'owner', grantedAt: AT },
    )
  })

  it('renames the event for its owner', async () => {
    const result = await renameEvent({
      eventId: WEDDING,
      actorId: OWNER,
      name: 'Camille & Sacha — le mariage',
    })

    expect(result.ok).toBe(true)
    expect((await events.findById(WEDDING))?.name.value).toBe('Camille & Sacha — le mariage')
  })

  it('announces the change so the wall and the console refetch', async () => {
    await renameEvent({ eventId: WEDDING, actorId: OWNER, name: 'Un autre nom' })

    expect(bus.published).toEqual([{ type: 'event.settingsChanged', eventId: WEDDING }])
  })

  it('leaves the slug alone, because it is the projector page address', async () => {
    // A slug re-derived from the corrected name would change /e/:slug and every media
    // URL already in flight, mid-event.
    await renameEvent({ eventId: WEDDING, actorId: OWNER, name: 'Un autre nom' })

    expect((await events.findById(WEDDING))?.slug.value).toBe('camille-et-sacha')
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await renameEvent({
      eventId: asEventId('evt-absent'),
      actorId: OWNER,
      name: 'Un autre nom',
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers notFound, not forbidden, for a caller with no part in the event', async () => {
    // A distinguishable answer would confirm that this event exists.
    const result = await renameEvent({
      eventId: WEDDING,
      actorId: STRANGER,
      name: 'Un autre nom',
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a moderator: the name is on the cards and on the wall', async () => {
    const result = await renameEvent({
      eventId: WEDDING,
      actorId: MODERATOR,
      name: 'Un autre nom',
    })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
  })

  it('rejects a name the domain refuses', async () => {
    const result = await renameEvent({ eventId: WEDDING, actorId: OWNER, name: '   ' })

    expect(!result.ok && result.error.code).toBe('eventName.empty')
  })

  it('refuses to rename an archived event', async () => {
    const result = await renameEvent({ eventId: ARCHIVED, actorId: OWNER, name: 'Un autre nom' })

    expect(!result.ok && result.error.code).toBe('event.immutable')
  })

  it('announces nothing when the rename was refused', async () => {
    await renameEvent({ eventId: ARCHIVED, actorId: OWNER, name: 'Un autre nom' })

    expect(bus.published).toEqual([])
  })
})
