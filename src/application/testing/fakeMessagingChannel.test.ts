import { describe, expect, it } from 'vitest'
import { FakeChannelSenderKeyer } from './fakeChannelSenderKeyer'
import { FakeMessagingChannel } from './fakeMessagingChannel'

const signal = new AbortController().signal

describe('FakeMessagingChannel', () => {
  it('hands over a file it holds, at most as many bytes as asked', async () => {
    const channel = new FakeMessagingChannel().hold('f', new Uint8Array(5))

    expect((await channel.download('f', 5, signal)).ok).toBe(true)
    expect(await channel.download('f', 4, signal)).toEqual({
      ok: false,
      error: { code: 'channel.mediaTooLarge', retryable: false },
    })
    expect(channel.downloads).toEqual([
      { fileRef: 'f', maxBytes: 5 },
      { fileRef: 'f', maxBytes: 4 },
    ])
  })

  it('says a file it does not hold is gone, and a download that was aborted is worth another try', async () => {
    const channel = new FakeMessagingChannel().hold('f', new Uint8Array(1))
    const aborted = new AbortController()
    aborted.abort()

    expect(await channel.download('nope', 5, signal)).toEqual({
      ok: false,
      error: { code: 'channel.fileGone', retryable: false },
    })
    expect(await channel.download('f', 5, aborted.signal)).toEqual({
      ok: false,
      error: { code: 'channel.downloadUnavailable', retryable: true },
    })
  })

  it('fails the downloads a test armed, one each, then behaves again', async () => {
    const channel = new FakeMessagingChannel()
      .hold('f', new Uint8Array(1))
      .failNextDownload({ code: 'channel.downloadUnavailable', retryable: true })

    expect((await channel.download('f', 5, signal)).ok).toBe(false)
    expect((await channel.download('f', 5, signal)).ok).toBe(true)
  })

  it('records what the bot said and acknowledged, and names itself', async () => {
    const channel = new FakeMessagingChannel('telegram', 'Bot')

    await channel.reply('-1', 'hello', 'm-1')
    await channel.reply('-1', 'again')
    await channel.acknowledge('-1', 'm-1')

    expect(channel.identity()).toEqual({ username: 'Bot' })
    expect(channel.said).toEqual([
      { conversationRef: '-1', text: 'hello', replyTo: 'm-1' },
      { conversationRef: '-1', text: 'again', replyTo: undefined },
    ])
    expect(channel.acknowledged).toEqual([{ conversationRef: '-1', messageRef: 'm-1' }])
  })
})

describe('FakeChannelSenderKeyer', () => {
  it('is deterministic and keeps two senders apart', () => {
    const keyer = new FakeChannelSenderKeyer()

    expect(keyer.keyOf('telegram:1')).toBe(keyer.keyOf('telegram:1'))
    expect(keyer.keyOf('telegram:1')).not.toBe(keyer.keyOf('telegram:2'))
  })
})
