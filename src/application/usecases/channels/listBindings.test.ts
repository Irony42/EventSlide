import { describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT } from '../../testing/builders'
import { aChannelScene, OTHER_CONVERSATION } from '../../testing/channelScene'
import { makeListBindings } from './listBindings'

const EVENT = asEventId('event-1')
const OWNER = asUserId('user-owner')
const MODERATOR = asUserId('user-moderator')

const world = async (options: Parameters<typeof aChannelScene>[0] = {}) => {
  const scene = aChannelScene(options)
  await scene.memberships.grant({ eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT })
  await scene.memberships.grant({
    eventId: EVENT,
    userId: MODERATOR,
    role: 'moderator',
    grantedAt: AT,
  })
  const deps = {
    events: scene.events,
    clients: scene.clients,
    memberships: scene.memberships,
    bindings: scene.bindings,
    channels: scene.channels,
  }
  return { scene, deps, list: makeListBindings(deps) }
}

describe('listBindings', () => {
  it('says the bot name and lists the groups that send, oldest first', async () => {
    const { scene, list } = await world()
    await scene.bindNow()
    scene.clock.advance(1_000)
    await scene.bindNow(OTHER_CONVERSATION)

    const view = await list({ eventId: EVENT, actorId: OWNER })

    expect(view.ok && [view.value.available, view.value.botUsername, view.value.allowed]).toEqual([
      true,
      'EventSlideBot',
      true,
    ])
    expect(view.ok && view.value.bindings.map((binding) => binding.conversationRef)).toEqual([
      '-1001',
      OTHER_CONVERSATION,
    ])
  })

  it('may be read by a moderator, who helps with the evening', async () => {
    const { list } = await world()

    expect((await list({ eventId: EVENT, actorId: MODERATOR })).ok).toBe(true)
  })

  it('says there is no bot on a box without a token, and names none', async () => {
    const { deps } = await world()
    const list = makeListBindings({ ...deps, channels: new Map() })

    const view = await list({ eventId: EVENT, actorId: OWNER })

    expect(view.ok && [view.value.available, view.value.botUsername]).toEqual([false, null])
  })

  it('says the plan does not include the channel when the client ceiling forbids it', async () => {
    const { list } = await world({ clientAllowsChannels: false })

    const view = await list({ eventId: EVENT, actorId: OWNER })

    expect(view.ok && view.value.allowed).toBe(false)
  })

  it('says the plan includes it when the client allows it', async () => {
    const { list } = await world({ clientAllowsChannels: true })

    const view = await list({ eventId: EVENT, actorId: OWNER })

    expect(view.ok && view.value.allowed).toBe(true)
  })

  it('answers somebody with no part in the event as if it did not exist', async () => {
    const { list } = await world()

    const view = await list({ eventId: EVENT, actorId: asUserId('user-stranger') })

    expect(!view.ok && view.error.code).toBe('event.notFound')
  })

  it('reports an event that was deleted under it', async () => {
    const { scene, list } = await world()
    await scene.events.delete(EVENT)

    const view = await list({ eventId: EVENT, actorId: OWNER })

    expect(!view.ok && view.error.code).toBe('event.notFound')
  })
})
