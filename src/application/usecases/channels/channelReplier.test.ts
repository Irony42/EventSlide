import { describe, expect, it } from 'vitest'
import { REPLY_COOLDOWN_MS } from '../../../domain/channels/channelReplies'
import { FakeClock } from '../../testing/fakeClock'
import { FakeMessagingChannel } from '../../testing/fakeMessagingChannel'
import { makeChannelReplier, type ChannelReplier } from './channelReplier'

const say = (
  replier: ChannelReplier,
  channel: FakeMessagingChannel,
  reply: Parameters<ChannelReplier['say']>[3],
  senderRef = '1',
) => replier.say(channel, '-1', senderRef, reply, 'en', 'm-1')

describe('channelReplier', () => {
  it('answers every command, however often it is asked', async () => {
    const channel = new FakeMessagingChannel()
    const replier = makeChannelReplier(new FakeClock())

    await say(replier, channel, { reason: 'forgotten' })
    await say(replier, channel, { reason: 'forgotten' })

    expect(channel.said).toHaveLength(2)
  })

  it('tells a refusal once an hour per sender and reason, and again after the hour', async () => {
    const clock = new FakeClock()
    const channel = new FakeMessagingChannel()
    const replier = makeChannelReplier(clock)

    await say(replier, channel, { reason: 'quotaReached' })
    await say(replier, channel, { reason: 'quotaReached' })
    await say(replier, channel, { reason: 'quotaReached' }, '2')
    await say(replier, channel, { reason: 'tooFast' })
    expect(channel.said).toHaveLength(3)

    clock.advance(REPLY_COOLDOWN_MS)
    await say(replier, channel, { reason: 'quotaReached' })
    expect(channel.said).toHaveLength(4)
  })

  it('writes the reply to the message in the language it was given', async () => {
    const channel = new FakeMessagingChannel()

    await say(makeChannelReplier(new FakeClock()), channel, { reason: 'forgotten' })

    expect(channel.said).toEqual([
      { conversationRef: '-1', text: 'Done, your photos have been removed.', replyTo: 'm-1' },
    ])
  })

  it('forgets the refusals whose hour is over, once it remembers a great many', async () => {
    const clock = new FakeClock()
    const channel = new FakeMessagingChannel()
    const replier = makeChannelReplier(clock)
    for (let n = 0; n < 1_100; n += 1) await say(replier, channel, { reason: 'tooFast' }, `s-${n}`)
    clock.advance(REPLY_COOLDOWN_MS)

    await say(replier, channel, { reason: 'tooFast' }, 'fresh')
    await say(replier, channel, { reason: 'tooFast' }, 's-0')

    expect(channel.said).toHaveLength(1_100 + 2)
  })
})
