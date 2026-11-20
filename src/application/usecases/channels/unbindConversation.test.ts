import { describe, expect, it } from 'vitest'
import { DomainError } from '../../../domain/shared/errors'
import { asChannelBindingId, asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent } from '../../testing/builders'
import { aChannelScene, CONVERSATION } from '../../testing/channelScene'
import { makeUnbindConversation } from './unbindConversation'

const EVENT = asEventId('event-1')
const OWNER = asUserId('user-owner')
const MODERATOR = asUserId('user-moderator')
const STRANGER = asUserId('user-stranger')

const world = async () => {
  const scene = aChannelScene({ settings: { wallLanguage: 'en' } })
  await scene.memberships.grant({ eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT })
  await scene.memberships.grant({
    eventId: EVENT,
    userId: MODERATOR,
    role: 'moderator',
    grantedAt: AT,
  })
  await scene.bindNow()
  const unbind = makeUnbindConversation({
    events: scene.events,
    memberships: scene.memberships,
    bindings: scene.bindings,
    channels: scene.channels,
    clock: scene.clock,
    bus: scene.bus,
  })
  const binding = await scene.bindings.findActive('telegram', CONVERSATION)
  if (binding === null) throw new Error('binding')
  return { scene, unbind, binding }
}

describe('unbindConversation', () => {
  it('stops the group from sending, tells the console, and says so in the group, which the bot stays in', async () => {
    const { scene, unbind, binding } = await world()

    const result = await unbind({ eventId: EVENT, actorId: OWNER, bindingId: binding.id })

    expect(result.ok).toBe(true)
    expect(await scene.bindings.findActive('telegram', CONVERSATION)).toBeNull()
    expect((await scene.bindings.findById(EVENT, binding.id))?.unboundAt).toEqual(scene.clock.now())
    expect(scene.bus.published).toEqual([{ type: 'channel.bindingChanged', eventId: 'event-1' }])
    expect(scene.telegram.said).toEqual([
      {
        conversationRef: CONVERSATION,
        text: 'This group no longer sends photos to "Camille & Sacha".',
        replyTo: undefined,
      },
    ])
  })

  it('is the owner alone: a moderator is refused, and nothing changes', async () => {
    const { scene, unbind, binding } = await world()

    const result = await unbind({ eventId: EVENT, actorId: MODERATOR, bindingId: binding.id })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.id).toBe(binding.id)
    expect(scene.telegram.said).toEqual([])
  })

  it('answers somebody with no part in the event as if it did not exist', async () => {
    const { unbind, binding } = await world()

    const result = await unbind({ eventId: EVENT, actorId: STRANGER, bindingId: binding.id })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers an unknown binding, and another event binding, the same', async () => {
    const { scene, unbind, binding } = await world()
    await scene.memberships.grant({
      eventId: asEventId('event-2'),
      userId: OWNER,
      role: 'owner',
      grantedAt: AT,
    })
    await scene.events.seed(
      anEvent({
        id: 'event-2',
        slug: 'gala',
        joinCode: 'GALA22',
      }),
    )

    const unknown = await unbind({
      eventId: EVENT,
      actorId: OWNER,
      bindingId: asChannelBindingId('nope'),
    })
    const foreign = await unbind({
      eventId: asEventId('event-2'),
      actorId: OWNER,
      bindingId: binding.id,
    })

    expect([unknown, foreign].map((r) => !r.ok && r.error.code)).toEqual([
      'channel.bindingNotFound',
      'channel.bindingNotFound',
    ])
  })

  it('answers a binding that already ended as an unknown one', async () => {
    const { unbind, binding } = await world()
    await unbind({ eventId: EVENT, actorId: OWNER, bindingId: binding.id })

    const again = await unbind({ eventId: EVENT, actorId: OWNER, bindingId: binding.id })

    expect(!again.ok && again.error).toEqual(DomainError.notFound('channel.bindingNotFound'))
  })

  it('unlinks even when this box has no adapter for the channel, saying nothing', async () => {
    const { scene, binding } = await world()
    const unbind = makeUnbindConversation({
      events: scene.events,
      memberships: scene.memberships,
      bindings: scene.bindings,
      channels: new Map(),
      clock: scene.clock,
      bus: scene.bus,
    })

    expect((await unbind({ eventId: EVENT, actorId: OWNER, bindingId: binding.id })).ok).toBe(true)
    expect(scene.telegram.said).toEqual([])
  })

  it('reports an event that was deleted under it', async () => {
    const { scene, unbind, binding } = await world()
    await scene.events.delete(EVENT)

    const result = await unbind({ eventId: EVENT, actorId: OWNER, bindingId: binding.id })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
