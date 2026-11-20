import { setBackgroundTimeout } from '../infrastructure/time/backgroundTimers'
import type { ChannelCursorStore } from '../application/ports/channelCursorStore'
import type { ChannelInbox } from '../application/ports/channelInbox'
import type { Logger } from '../application/ports/logger'
import type { ReceiveChannelMessage } from '../application/usecases/channels/receiveChannelMessage'

/**
 * The loop that brings a channel's messages in (spec 27 §6): ask the inbox for the next batch (a long poll that stays
 * open on Telegram's side), hand each message to `receiveChannelMessage`, and **save the cursor after the batch was
 * handled**, never before. A crash replays the batch rather than loses it, and the unique job per message makes the
 * replay harmless.
 *
 * It decides how to wait, nothing else (the rest is the use case's): a failure of the network backs off exponentially,
 * a 429 waits what Telegram asked, a 409 (two instances polling one token, or a webhook set) is **said in words** and
 * backs off to the longest wait without stopping the server, and a refused token (401) ends the loop with an error: the
 * function is off until the operator fixes the token and restarts.
 *
 * A message whose handling throws (the database was busy) keeps the whole batch unacknowledged for a few tries, then is
 * skipped with an error line so one poisonous message cannot hold the channel forever. Nothing a message said is ever
 * logged, only a count and a code.
 */

export interface ChannelPollerDeps {
  readonly inbox: ChannelInbox
  readonly receive: ReceiveChannelMessage
  readonly cursors: ChannelCursorStore
  readonly logger: Logger
  /** Wait that ends early when the signal aborts. Injected so a test needs no timer. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>
  /** The pause after an empty batch, so a misbehaving service that answers at once cannot spin the loop. */
  readonly idleDelayMs?: number
}

export interface ChannelPoller {
  /** Idempotent. Starts the loop in the background. */
  start(): void
  /** Idempotent. Aborts the open long poll and ends the loop. */
  stop(): void
  readonly running: boolean
}

const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 5 * 60_000
/** How many times a batch whose handling throws is tried before it is skipped. */
export const MAX_BATCH_ATTEMPTS = 3

const realWait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setBackgroundTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })

export const createChannelPoller = ({
  inbox,
  receive,
  cursors,
  logger,
  wait = realWait,
  idleDelayMs = 250,
}: ChannelPollerDeps): ChannelPoller => {
  let abort: AbortController | null = null
  let loop: Promise<void> | null = null

  const run = async (signal: AbortSignal): Promise<void> => {
    let backoffMs = BACKOFF_START_MS
    let failedBatchAttempts = 0
    const nextBackoff = (): number => {
      const current = backoffMs
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
      return current
    }

    while (!signal.aborted) {
      let cursor: string | null
      try {
        cursor = await cursors.get(inbox.kind)
      } catch (error) {
        logger.error('channel cursor could not be read', {
          channel: inbox.kind,
          error: error instanceof Error ? error.message : String(error),
        })
        await wait(nextBackoff(), signal)
        continue
      }

      const result = await inbox.next(cursor, signal)
      if (signal.aborted) return

      if (!result.ok) {
        const { code, retryable, waitMs } = result.error
        if (code === 'telegram.unauthorized' || !retryable) {
          logger.error(
            'the messaging channel refused its credential: it is off until the token is fixed',
            {
              channel: inbox.kind,
              code,
            },
          )
          return
        }
        if (code === 'telegram.conflict') {
          // The longest wait at once: fighting another instance for the same updates helps nobody.
          backoffMs = BACKOFF_MAX_MS
          logger.error(
            'another instance is polling with this bot token (or a webhook is set): one token is one instance',
            { channel: inbox.kind, code, retryInMs: backoffMs },
          )
          await wait(backoffMs, signal)
          continue
        }
        const delay = waitMs ?? nextBackoff()
        logger.warn('the messaging channel could not be reached', {
          channel: inbox.kind,
          code,
          retryInMs: delay,
        })
        await wait(delay, signal)
        continue
      }

      backoffMs = BACKOFF_START_MS
      const { messages, cursor: next } = result.value

      let handled = true
      for (const message of messages) {
        try {
          await receive(message)
        } catch (error) {
          handled = false
          logger.error('a channel message could not be handled', {
            channel: inbox.kind,
            error: error instanceof Error ? error.message : String(error),
            attempt: failedBatchAttempts + 1,
          })
          break
        }
      }

      if (!handled) {
        failedBatchAttempts += 1
        if (failedBatchAttempts < MAX_BATCH_ATTEMPTS) {
          await wait(nextBackoff(), signal)
          continue
        }
        logger.error('a batch of channel messages is skipped after repeated failures', {
          channel: inbox.kind,
          count: messages.length,
        })
      }
      failedBatchAttempts = 0

      if (next !== null) {
        try {
          await cursors.set(inbox.kind, next)
        } catch (error) {
          logger.error('channel cursor could not be saved', {
            channel: inbox.kind,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (messages.length === 0) await wait(idleDelayMs, signal)
    }
  }

  return {
    get running(): boolean {
      return loop !== null
    },

    start: () => {
      if (loop !== null) return
      const controller = new AbortController()
      abort = controller
      logger.info('channel poller started', { channel: inbox.kind })
      loop = run(controller.signal)
        .catch((error: unknown) => {
          logger.error('channel poller stopped on an unexpected error', {
            channel: inbox.kind,
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          loop = null
        })
    },

    stop: () => {
      abort?.abort()
      abort = null
    },
  }
}
