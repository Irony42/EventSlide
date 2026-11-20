import { describe, expect, it } from 'vitest'
import { createChannelPoller, MAX_BATCH_ATTEMPTS } from './channelPoller'
import type { ChannelInbox, InboundBatch } from '../application/ports/channelInbox'
import type { ChannelFailure } from '../application/ports/messagingChannel'
import { CapturingLogger } from '../application/testing/capturingLogger'
import { FakeChannelCursorStore } from '../application/testing/fakeChannelCursorStore'
import type { InboundMessage } from '../domain/channels/inboundMessage'
import { err, ok, type Result } from '../domain/shared/result'

/**
 * The loop around the inbox, driven from a test with a scripted inbox and a wait that records instead of sleeping.
 * `src/main` is out of the coverage gate, so what the loop adds is asserted here: the cursor is saved after the batch
 * and never before, the waits are the right ones, a poison batch is skipped, nothing stops the server.
 */

const MESSAGE: InboundMessage = { type: 'botRemoved', channel: 'telegram', conversationRef: '-1' }
const batch = (
  cursor: string | null,
  ...messages: InboundMessage[]
): Result<InboundBatch, ChannelFailure> => ok({ messages, cursor })

/** An inbox that answers from a script, then stops the loop (the last answer aborts the poller's signal). */
const harness = (
  script: readonly Result<InboundBatch, ChannelFailure>[],
  receive: (message: InboundMessage) => Promise<unknown> = async () => 'answered',
) => {
  const logger = new CapturingLogger()
  const cursors = new FakeChannelCursorStore()
  const waits: number[] = []
  const seenCursors: (string | null)[] = []
  const handled: InboundMessage[] = []
  const order: string[] = []
  let calls = 0
  let finished: () => void = () => undefined
  const done = new Promise<void>((resolve) => {
    finished = resolve
  })
  const originalSet = cursors.set.bind(cursors)
  cursors.set = async (channel, cursor) => {
    order.push(`save:${cursor}`)
    await originalSet(channel, cursor)
  }

  // eslint-disable-next-line prefer-const -- assigned just below, used by the inbox
  let poller: ReturnType<typeof createChannelPoller>
  const inbox: ChannelInbox = {
    kind: 'telegram',
    next: async (cursor) => {
      seenCursors.push(cursor)
      const answer = script[calls]
      calls += 1
      if (answer === undefined) {
        poller.stop()
        finished()
        return ok({ messages: [], cursor: null })
      }
      return answer
    },
  }
  poller = createChannelPoller({
    inbox,
    receive: async (message) => {
      order.push('receive')
      handled.push(message)
      return receive(message) as ReturnType<typeof receive> as never
    },
    cursors,
    logger,
    wait: async (ms) => {
      waits.push(ms)
    },
    idleDelayMs: 7,
  })
  return { poller, logger, cursors, waits, seenCursors, handled, order, done }
}

describe('channelPoller', () => {
  it('hands every message to the use case and saves the cursor after them, never before', async () => {
    const h = harness([batch('5', MESSAGE, MESSAGE)])

    h.poller.start()
    await h.done

    expect(h.order).toEqual(['receive', 'receive', 'save:5'])
    expect(await h.cursors.get('telegram')).toBe('5')
  })

  it('resumes from the saved cursor', async () => {
    const h = harness([batch('9', MESSAGE), batch(null)])
    await h.cursors.set('telegram', '4')

    h.poller.start()
    await h.done

    expect(h.seenCursors.slice(0, 2)).toEqual(['4', '9'])
  })

  it('pauses briefly after an empty batch, and keeps the cursor when the channel gave none', async () => {
    const h = harness([batch(null)])

    h.poller.start()
    await h.done

    expect(h.waits).toEqual([7])
    expect(await h.cursors.get('telegram')).toBeNull()
  })

  it('backs off exponentially on a network failure, and resets after a success', async () => {
    const blink = err({ code: 'telegram.unreachable', retryable: true })
    const h = harness([blink, blink, blink, batch('2', MESSAGE), blink])

    h.poller.start()
    await h.done

    // 1s, 2s, 4s, then the success resets (no wait after a non-empty batch), then 1s again.
    expect(h.waits.filter((ms) => ms >= 1_000)).toEqual([1_000, 2_000, 4_000, 1_000])
  })

  it('waits what Telegram asked on a 429', async () => {
    const h = harness([err({ code: 'telegram.rateLimited', retryable: true, waitMs: 3_000 })])

    h.poller.start()
    await h.done

    expect(h.waits[0]).toBe(3_000)
  })

  it('says a conflict in words, waits the longest and does not stop', async () => {
    const h = harness([err({ code: 'telegram.conflict', retryable: true }), batch('3', MESSAGE)])

    h.poller.start()
    await h.done

    expect(h.waits[0]).toBe(5 * 60_000)
    expect(h.logger.lines.some((line) => /one token is one instance/u.test(line.message))).toBe(
      true,
    )
    expect(h.handled).toHaveLength(1)
  })

  it('ends the loop with an error when the token is refused', async () => {
    const h = harness([
      err({ code: 'telegram.unauthorized', retryable: false }),
      batch('1', MESSAGE),
    ])

    h.poller.start()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(h.handled).toEqual([])
    expect(h.poller.running).toBe(false)
    expect(h.logger.lines.some((line) => line.level === 'error')).toBe(true)
  })

  it('keeps a batch unsaved while its handling throws, then skips it after the attempts', async () => {
    let calls = 0
    const h = harness(
      Array.from({ length: MAX_BATCH_ATTEMPTS }, () => batch('8', MESSAGE)),
      async () => {
        calls += 1
        throw new Error('database is locked')
      },
    )

    h.poller.start()
    await h.done

    expect(calls).toBe(MAX_BATCH_ATTEMPTS)
    // Saved once, after the last failure: the poison batch is skipped rather than held forever.
    expect(h.order.filter((step) => step.startsWith('save'))).toEqual(['save:8'])
    expect(h.logger.lines.filter((line) => line.level === 'error').length).toBeGreaterThan(
      MAX_BATCH_ATTEMPTS,
    )
  })

  it('does not log what a message carried', async () => {
    const secret: InboundMessage = {
      type: 'command',
      channel: 'telegram',
      conversationRef: '-1',
      conversationTitle: 'Titre secret',
      messageRef: '1',
      sender: { ref: '4242', displayName: 'Prénom secret', isBot: false, isAnonymous: false },
      command: 'forget',
      argument: '',
    }
    const h = harness([batch('2', secret)], async () => {
      throw new Error('boom')
    })

    h.poller.start()
    await h.done

    const logged = JSON.stringify(h.logger.lines)
    expect(logged).not.toContain('secret')
    expect(logged).not.toContain('4242')
  })

  it('is idempotent to start twice, and stops cleanly', async () => {
    const h = harness([batch(null)])

    h.poller.start()
    h.poller.start()
    await h.done
    h.poller.stop()

    expect(h.seenCursors.length).toBe(2)
  })
})
