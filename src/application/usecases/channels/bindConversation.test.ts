import { describe, expect, it } from 'vitest'
import { JoinCode } from '../../../domain/shared/joinCode'
import { asEventId } from '../../../domain/shared/ids'
import { aChannelScene, CONVERSATION, OTHER_CONVERSATION } from '../../testing/channelScene'
import { anEvent } from '../../testing/builders'
import { aBinding } from '../../testing/contracts/channelBindingRepositoryContract'

const bind = (
  scene: ReturnType<typeof aChannelScene>,
  code: string,
  conversationRef = CONVERSATION,
) =>
  scene.bindConversation({
    channel: 'telegram',
    conversationRef,
    conversationTitle: 'Mariage Léa & Tom',
    code,
  })

describe('bindConversation', () => {
  it('connects a free conversation to the event the code names, however the code was typed', async () => {
    const scene = aChannelScene()

    const bound = await bind(scene, ' h7k2-qm ')

    expect(bound.ok && [bound.value.event.id, bound.value.changed]).toEqual(['event-1', true])
    const binding = await scene.bindings.findActive('telegram', CONVERSATION)
    expect(binding?.eventId).toBe('event-1')
    expect(binding?.conversationTitle).toBe('Mariage Léa & Tom')
    expect(binding?.boundAt).toEqual(scene.clock.now())
  })

  it('tells the host’s console that its list of groups changed', async () => {
    const scene = aChannelScene()

    await bind(scene, 'H7K2QM')

    expect(scene.bus.published).toEqual([{ type: 'channel.bindingChanged', eventId: 'event-1' }])
  })

  it.each(['', 'ABC', 'H7K2QMXXXXXX', 'U7K2QM', 'ZZZZZZ'])(
    'refuses %j as an unknown code, whether it is malformed or simply nobody’s',
    async (code) => {
      const scene = aChannelScene()

      const bound = await bind(scene, code)

      expect(!bound.ok && [bound.error.error.code, bound.error.language]).toEqual([
        'channel.unknownCode',
        null,
      ])
      expect(await scene.bindings.findActive('telegram', CONVERSATION)).toBeNull()
    },
  )

  it('refuses an event that is not accepting guests, in the language of that event', async () => {
    const scene = aChannelScene({
      event: { status: 'closed' },
      settings: { wallLanguage: 'de' },
    })

    const bound = await bind(scene, 'H7K2QM')

    expect(!bound.ok && [bound.error.error.code, bound.error.language]).toEqual([
      'channel.eventNotOpen',
      'de',
    ])
    expect(await scene.bindings.findActive('telegram', CONVERSATION)).toBeNull()
    expect(scene.bus.published).toEqual([])
  })

  it('refuses when the host did not switch Telegram on', async () => {
    const scene = aChannelScene({ settings: { allowTelegram: false } })

    const bound = await bind(scene, 'H7K2QM')

    expect(!bound.ok && bound.error.error.code).toBe('channel.notAllowed')
  })

  it('refuses when the client’s plan does not include messaging channels, whatever the host switched', async () => {
    const scene = aChannelScene({ clientAllowsChannels: false })

    const bound = await bind(scene, 'H7K2QM')

    expect(!bound.ok && bound.error.error.code).toBe('channel.notAllowed')
  })

  it('connects an event whose client’s plan includes the channel', async () => {
    const scene = aChannelScene({ clientAllowsChannels: true })

    expect((await bind(scene, 'H7K2QM')).ok).toBe(true)
  })

  it('leaves a conversation that sends to another live event where it was', async () => {
    const scene = aChannelScene()
    scene.events.seed(
      anEvent({
        id: 'event-2',
        slug: 'gala',
        joinCode: 'GALA22',
        settings: { allowTelegram: true },
      }),
    )
    await bind(scene, 'GALA22')
    scene.bus.clear()

    const refused = await bind(scene, 'H7K2QM')

    expect(!refused.ok && refused.error.error.code).toBe('channel.alreadyBound')
    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.eventId).toBe('event-2')
    expect(scene.bus.published).toEqual([])
  })

  it('moves a conversation whose event is over to the new event, keeping the old link as a record', async () => {
    const scene = aChannelScene()
    const gala = {
      id: 'event-2',
      slug: 'gala',
      joinCode: 'GALA22',
      settings: { allowTelegram: true },
    }
    scene.events.seed(anEvent(gala))
    await bind(scene, 'GALA22')
    // The conversation was bound while event-2 was live; it has closed since.
    scene.events.seed(anEvent({ ...gala, status: 'closed' }))
    scene.bus.clear()

    const bound = await bind(scene, 'H7K2QM')

    expect(bound.ok && bound.value.changed).toBe(true)
    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.eventId).toBe('event-1')
    expect(await scene.bindings.listActiveForEvent(asEventId('event-2'))).toEqual([])
    expect(scene.bus.published).toEqual([
      { type: 'channel.bindingChanged', eventId: 'event-2' },
      { type: 'channel.bindingChanged', eventId: 'event-1' },
    ])
  })

  it('treats a binding whose event no longer exists as one on an event that is over', async () => {
    const scene = aChannelScene()
    await scene.bindings.save(
      aBinding({ id: 'bnd-old', eventId: asEventId('event-gone'), conversationRef: CONVERSATION }),
    )

    const bound = await bind(scene, 'H7K2QM')

    expect(bound.ok && bound.value.changed).toBe(true)
    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.eventId).toBe('event-1')
  })

  it('changes nothing when the conversation already sends to this very event', async () => {
    const scene = aChannelScene()
    await bind(scene, 'H7K2QM')
    scene.bus.clear()

    const again = await bind(scene, 'H7K2QM')

    expect(again.ok && again.value.changed).toBe(false)
    expect(scene.bus.published).toEqual([])
    expect(await scene.bindings.listActiveForEvent(asEventId('event-1'))).toHaveLength(1)
  })

  it('keeps the link when the join code rotates, because it keeps the event and not the code', async () => {
    const scene = aChannelScene()
    await bind(scene, 'H7K2QM')

    const rotated = scene.event.rotateJoinCode(
      (() => {
        const code = JoinCode.create('NEWCOD')
        if (!code.ok) throw new Error('code')
        return code.value
      })(),
    )
    if (!rotated.ok) throw new Error('rotate')
    await scene.events.save(rotated.value)

    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.eventId).toBe('event-1')
    expect((await bind(scene, 'NEWCOD')).ok && true).toBe(true)
    expect((await bind(scene, 'H7K2QM')).ok).toBe(false)
  })

  it('binds two conversations to one event, each on its own', async () => {
    const scene = aChannelScene()

    await bind(scene, 'H7K2QM', CONVERSATION)
    await bind(scene, 'H7K2QM', OTHER_CONVERSATION)

    expect(await scene.bindings.listActiveForEvent(asEventId('event-1'))).toHaveLength(2)
  })

  it('refuses a conversation with no identifier rather than storing a link nothing can match', async () => {
    const scene = aChannelScene()

    const bound = await bind(scene, 'H7K2QM', '')

    expect(!bound.ok && bound.error.error.code).toBe('channel.conversationMissing')
  })
})
