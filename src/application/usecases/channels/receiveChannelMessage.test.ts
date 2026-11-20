import { describe, expect, it } from 'vitest'
import type { InboundMessage } from '../../../domain/channels/inboundMessage'
import { asEventId } from '../../../domain/shared/ids'
import { aGuest, anEvent } from '../../testing/builders'
import {
  aChannelScene,
  aCommand,
  aMedia,
  aSender,
  CONVERSATION,
  NOTICE_URL,
  OTHER_CONVERSATION,
} from '../../testing/channelScene'

const NBSP = String.fromCharCode(0xa0)
const EVENT = asEventId('event-1')

describe('receiveChannelMessage: /soiree', () => {
  it('connects the conversation and answers with the event, what happens next and the notice', async () => {
    const scene = aChannelScene({ settings: { moderation: 'manual', wallLanguage: 'en' } })

    const outcome = await scene.receive(aCommand('bind', 'H7K2QM'))

    expect(outcome).toBe('answered')
    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.eventId).toBe('event-1')
    expect(scene.telegram.said).toHaveLength(1)
    const said = scene.telegram.said[0]
    expect(said?.conversationRef).toBe(CONVERSATION)
    expect(said?.replyTo).toBe('m-1')
    expect(said?.text).toContain('"Camille & Sacha"')
    expect(said?.text).toContain('They go through the organiser before they appear.')
    expect(said?.text).toContain('/oublier')
    expect(said?.text).toContain(NOTICE_URL)
  })

  it('says the photographs appear at once on an event that publishes on arrival', async () => {
    const scene = aChannelScene({ settings: { moderation: 'auto' } })

    await scene.receive(aCommand('bind', 'H7K2QM'))

    expect(scene.telegram.said[0]?.text).toContain('directement sur le mur')
  })

  it('says the welcome again, and changes nothing, when the group asks twice', async () => {
    const scene = aChannelScene()
    await scene.receive(aCommand('bind', 'H7K2QM'))

    await scene.receive(aCommand('bind', 'H7K2QM', { messageRef: 'm-2' }))

    expect(scene.telegram.said).toHaveLength(2)
    expect(await scene.bindings.listActiveForEvent(EVENT)).toHaveLength(1)
  })

  it('asks for the code when there is none', async () => {
    const scene = aChannelScene()

    expect(await scene.receive(aCommand('bind', ''))).toBe('answered')

    expect(scene.telegram.said[0]?.text).toContain(`soirée${NBSP}:`)
    expect(await scene.bindings.findActive('telegram', CONVERSATION)).toBeNull()
  })

  it('answers an unknown code in French, since no event speaks yet', async () => {
    const scene = aChannelScene()

    await scene.receive(aCommand('bind', 'ZZZZZZ'))

    expect(scene.telegram.said[0]?.text).toBe(
      "Je ne connais pas ce code. Vérifiez-le auprès de l'organisateur.",
    )
  })

  it('answers a closed event in the language of that event', async () => {
    const scene = aChannelScene({ event: { status: 'closed' }, settings: { wallLanguage: 'de' } })

    await scene.receive(aCommand('bind', 'H7K2QM'))

    expect(scene.telegram.said[0]?.text).toBe('Diese Feier nimmt im Moment keine Fotos an.')
  })

  it('answers that a group busy with another live event is busy', async () => {
    const scene = aChannelScene({ settings: { wallLanguage: 'en' } })
    await scene.bindNow()
    scene.events.seed(
      anEvent({
        id: 'event-2',
        slug: 'gala',
        joinCode: 'GALA22',
        settings: { allowTelegram: true, wallLanguage: 'en' },
      }),
    )

    await scene.receive(aCommand('bind', 'GALA22'))

    expect(scene.telegram.said[0]?.text).toContain('already sends its photos to another event')
  })

  it('stays silent, and logs it, about a refusal that has no words', async () => {
    const scene = aChannelScene()

    const outcome = await scene.receive(aCommand('bind', 'H7K2QM', { conversationRef: '' }))

    expect(outcome).toBe('ignored')
    expect(scene.telegram.said).toEqual([])
    expect(scene.logger.lines.some((line) => line.message === 'channel.bindUnanswered')).toBe(true)
  })
})

describe('receiveChannelMessage: /oublier and /confidentialite', () => {
  it('tells a conversation that is connected to nothing so', async () => {
    const scene = aChannelScene()

    for (const command of ['forget', 'privacy'] as const) {
      expect(await scene.receive(aCommand(command))).toBe('answered')
    }

    expect(scene.telegram.said.map((said) => said.text)).toEqual([
      "Ce groupe n'est relié à aucune soirée. Envoyez /soiree suivi du code de la soirée.",
      "Ce groupe n'est relié à aucune soirée. Envoyez /soiree suivi du code de la soirée.",
    ])
  })

  it('sends the notice into a connected group', async () => {
    const scene = aChannelScene({ settings: { wallLanguage: 'es' } })
    await scene.bindNow()

    await scene.receive(aCommand('privacy'))

    expect(scene.telegram.said[0]?.text).toBe(
      `Qué se guarda y durante cuánto tiempo: ${NOTICE_URL}`,
    )
  })

  it('has nothing to point at when the event is gone', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    await scene.events.delete(EVENT)

    expect(await scene.receive(aCommand('privacy'))).toBe('ignored')
    expect(scene.telegram.said).toEqual([])
  })

  it('erases what the sender sent, takes back what is on its way, and says it is done', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    await scene.receive(aMedia({ messageRef: 'm-9' }))
    await scene.guests.save(
      aGuest({
        id: 'guest-lea',
        eventId: 'event-1',
        channelIdentity: { channel: 'telegram', senderKey: 'key:telegram:event-1:42' },
      }),
    )

    const outcome = await scene.receive(aCommand('forget', '', { messageRef: 'm-10' }))

    expect(outcome).toBe('answered')
    expect(scene.erased).toEqual(['guest-lea'])
    expect(await scene.jobs.countPending(EVENT)).toBe(0)
    expect(scene.telegram.said[0]?.text).toBe("C'est fait, vos photos ont été retirées.")
  })

  it('says done even for a sender who sent nothing, and erases nobody', async () => {
    const scene = aChannelScene()
    await scene.bindNow()

    await scene.receive(aCommand('forget'))

    expect(scene.erased).toEqual([])
    expect(scene.telegram.said[0]?.text).toBe("C'est fait, vos photos ont été retirées.")
  })

  it('refuses a message sent in the name of the group: nobody is behind it to forget', async () => {
    const scene = aChannelScene()
    await scene.bindNow()

    await scene.receive(aCommand('forget', '', { sender: aSender({ isAnonymous: true }) }))

    expect(scene.erased).toEqual([])
    expect(scene.telegram.said[0]?.text).toContain('Écrivez depuis votre propre compte')
  })

  it('forgets the sender of this event only, not their guest at another event', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    await scene.guests.save(
      aGuest({
        id: 'guest-elsewhere',
        eventId: 'event-9',
        channelIdentity: { channel: 'telegram', senderKey: 'key:telegram:event-1:42' },
      }),
    )

    await scene.receive(aCommand('forget'))

    expect(scene.erased).toEqual([])
  })
})

describe('receiveChannelMessage: media', () => {
  it('queues a media of a connected conversation without downloading it, and wakes the worker', async () => {
    const scene = aChannelScene()
    await scene.bindNow()

    const outcome = await scene.receive(aMedia())

    expect(outcome).toBe('queued')
    expect(scene.telegram.downloads).toEqual([])
    expect(scene.bus.published).toEqual([{ type: 'channel.mediaQueued', eventId: 'event-1' }])
    const job = await scene.jobs.claimNext(scene.clock.now())
    expect(job).toMatchObject({
      eventId: 'event-1',
      conversationRef: CONVERSATION,
      messageRef: 'm-1',
      senderKey: 'key:telegram:event-1:42',
      senderName: 'Léa Martin',
      kind: 'photo',
      fileRef: 'file-1',
      declaredName: 'photo.jpg',
    })
  })

  it('creates no guest yet: a sender becomes one when a media is accepted, not when it is queued', async () => {
    const scene = aChannelScene()
    await scene.bindNow()

    await scene.receive(aMedia())

    expect(await scene.guestOf()).toBeNull()
  })

  it('ignores the media of a conversation that is connected to nothing', async () => {
    const scene = aChannelScene()

    expect(await scene.receive(aMedia())).toBe('ignored')

    expect(await scene.jobs.countPending(EVENT)).toBe(0)
    expect(scene.telegram.said).toEqual([])
  })

  it('takes an update delivered twice once', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    await scene.receive(aMedia())
    scene.bus.clear()

    expect(await scene.receive(aMedia())).toBe('duplicate')

    expect(await scene.jobs.countPending(EVENT)).toBe(1)
    expect(scene.bus.published).toEqual([])
  })

  it('ignores the pictures of another bot', async () => {
    const scene = aChannelScene()
    await scene.bindNow()

    expect(await scene.receive(aMedia({ sender: aSender({ isBot: true }) }))).toBe('ignored')
    expect(
      await scene.receive(aCommand('bind', 'H7K2QM', { sender: aSender({ isBot: true }) })),
    ).toBe('ignored')

    expect(await scene.jobs.countPending(EVENT)).toBe(0)
    expect(scene.telegram.said).toEqual([])
  })

  it('ignores a message of a channel this box has no adapter for', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    const stray = { ...aMedia(), channel: 'whatsapp' } as unknown as InboundMessage

    expect(await scene.receive(stray)).toBe('ignored')
  })

  it('drops, without a word, the media of a guest the host revoked', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    await scene.guests.save(
      aGuest({
        id: 'guest-lea',
        eventId: 'event-1',
        channelIdentity: { channel: 'telegram', senderKey: 'key:telegram:event-1:42' },
      }).revoke(scene.clock.now()),
    )

    expect(await scene.receive(aMedia())).toBe('dropped')

    expect(await scene.jobs.countPending(EVENT)).toBe(0)
    expect(scene.telegram.said).toEqual([])
  })

  it('lets a known, active guest through', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    await scene.guests.save(
      aGuest({
        id: 'guest-lea',
        eventId: 'event-1',
        channelIdentity: { channel: 'telegram', senderKey: 'key:telegram:event-1:42' },
      }),
    )

    expect(await scene.receive(aMedia())).toBe('queued')
  })

  it('refuses a sender who goes faster than the rate, and tells them once an hour', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    for (const n of [1, 2, 3])
      expect(await scene.receive(aMedia({ messageRef: `m-${n}` }))).toBe('queued')

    expect(await scene.receive(aMedia({ messageRef: 'm-4' }))).toBe('dropped')
    expect(await scene.receive(aMedia({ messageRef: 'm-5' }))).toBe('dropped')

    expect(scene.telegram.said).toHaveLength(1)
    expect(scene.telegram.said[0]?.text).toContain('Doucement')
    expect(await scene.jobs.countPending(EVENT)).toBe(3)

    scene.clock.advance(61 * 60_000)
    expect(await scene.receive(aMedia({ messageRef: 'm-6' }))).toBe('queued')
  })

  it('counts the rate per sender and per conversation, not for the whole room', async () => {
    const scene = aChannelScene({ limits: { mediaPerMinute: 1 } })
    await scene.bindNow()
    await scene.bindNow(OTHER_CONVERSATION)

    expect(await scene.receive(aMedia({ messageRef: 'a' }))).toBe('queued')
    expect(await scene.receive(aMedia({ messageRef: 'b', sender: aSender({ ref: '43' }) }))).toBe(
      'queued',
    )
    expect(
      await scene.receive(aMedia({ messageRef: 'c', conversationRef: OTHER_CONVERSATION })),
    ).toBe('queued')
    expect(await scene.receive(aMedia({ messageRef: 'd' }))).toBe('dropped')
  })

  it('stops queueing when the event already has as many waiting as the ceiling allows', async () => {
    const scene = aChannelScene({ limits: { mediaPerMinute: 100, maxQueuedPerEvent: 2 } })
    await scene.bindNow()
    await scene.receive(aMedia({ messageRef: 'a' }))
    await scene.receive(aMedia({ messageRef: 'b' }))

    expect(await scene.receive(aMedia({ messageRef: 'c' }))).toBe('dropped')

    expect(await scene.jobs.countPending(EVENT)).toBe(2)
    expect(scene.telegram.said).toHaveLength(1)
  })

  it('keeps working after a flood of different senders, forgetting the ones it can no longer need', async () => {
    const scene = aChannelScene({ limits: { mediaPerMinute: 5, maxQueuedPerEvent: 100_000 } })
    await scene.bindNow()
    for (let n = 0; n < 1_100; n += 1) {
      await scene.receive(aMedia({ messageRef: `m-${n}`, sender: aSender({ ref: `s-${n}` }) }))
    }
    scene.clock.advance(2 * 60_000)

    expect(
      await scene.receive(aMedia({ messageRef: 'last', sender: aSender({ ref: 'late' }) })),
    ).toBe('queued')
  })

  it('forgets the refusals it already said once the hour is over, so the rationing stays small', async () => {
    const scene = aChannelScene({ limits: { mediaPerMinute: 1 } })
    await scene.bindNow()
    for (let n = 0; n < 1_100; n += 1) {
      const sender = aSender({ ref: `s-${n}` })
      await scene.receive(aMedia({ messageRef: `a-${n}`, sender }))
      await scene.receive(aMedia({ messageRef: `b-${n}`, sender }))
    }
    scene.clock.advance(2 * 60 * 60_000)
    scene.telegram.said.length = 0

    await scene.receive(aMedia({ messageRef: 'z-1', sender: aSender({ ref: 's-0' }) }))
    await scene.receive(aMedia({ messageRef: 'z-2', sender: aSender({ ref: 's-0' }) }))

    expect(scene.telegram.said).toHaveLength(1)
  })
})

describe('receiveChannelMessage: a conversation that changes', () => {
  it('follows a group that became a supergroup, under its new identifier', async () => {
    const scene = aChannelScene()
    await scene.bindNow()

    const outcome = await scene.receive({
      type: 'conversationMoved',
      channel: 'telegram',
      fromRef: CONVERSATION,
      toRef: '-100999',
    })

    expect(outcome).toBe('moved')
    expect(await scene.bindings.findActive('telegram', CONVERSATION)).toBeNull()
    expect((await scene.bindings.findActive('telegram', '-100999'))?.eventId).toBe('event-1')
    expect(scene.bus.published).toEqual([{ type: 'channel.bindingChanged', eventId: 'event-1' }])
  })

  it('ignores the move of a conversation that was never connected', async () => {
    const scene = aChannelScene()

    expect(
      await scene.receive({
        type: 'conversationMoved',
        channel: 'telegram',
        fromRef: '-5',
        toRef: '-6',
      }),
    ).toBe('ignored')
  })

  it('does not choose between two events when the new identifier is already connected', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    await scene.bindNow(OTHER_CONVERSATION)

    const outcome = await scene.receive({
      type: 'conversationMoved',
      channel: 'telegram',
      fromRef: CONVERSATION,
      toRef: OTHER_CONVERSATION,
    })

    expect(outcome).toBe('ignored')
    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.eventId).toBe('event-1')
    expect(scene.logger.lines.some((line) => line.message === 'channel.moveRefused')).toBe(true)
  })

  it('ignores a move to no identifier', async () => {
    const scene = aChannelScene()
    await scene.bindNow()

    expect(
      await scene.receive({
        type: 'conversationMoved',
        channel: 'telegram',
        fromRef: CONVERSATION,
        toRef: '',
      }),
    ).toBe('ignored')
    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.eventId).toBe('event-1')
  })

  it('unlinks a conversation the bot was removed from, and tells the console', async () => {
    const scene = aChannelScene()
    await scene.bindNow()

    const outcome = await scene.receive({
      type: 'botRemoved',
      channel: 'telegram',
      conversationRef: CONVERSATION,
    })

    expect(outcome).toBe('unbound')
    expect(await scene.bindings.findActive('telegram', CONVERSATION)).toBeNull()
    expect(scene.bus.published).toEqual([{ type: 'channel.bindingChanged', eventId: 'event-1' }])
    expect(scene.telegram.said).toEqual([])
  })

  it('ignores the removal from a conversation that was never connected, and what it does not know', async () => {
    const scene = aChannelScene()

    expect(
      await scene.receive({ type: 'botRemoved', channel: 'telegram', conversationRef: '-5' }),
    ).toBe('ignored')
    expect(await scene.receive({ type: 'ignored' })).toBe('ignored')
  })
})
