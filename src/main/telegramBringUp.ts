import type { ChannelInbox } from '../application/ports/channelInbox'
import type { Logger } from '../application/ports/logger'
import type { MessagingChannel } from '../application/ports/messagingChannel'
import type { ChannelKind } from '../domain/channels/channelKind'
import {
  describeFailure,
  type TelegramBotApi,
} from '../infrastructure/channels/telegram/telegramBotApi'
import {
  TelegramInbox,
  TelegramMessagingChannel,
} from '../infrastructure/channels/telegram/telegramChannel'
import { setBackgroundTimeout } from '../infrastructure/time/backgroundTimers'
import { BOT_COMMAND_MENUS } from '../infrastructure/channels/telegram/botCommands'
import type { ChannelPoller } from './channelPoller'

/**
 * How Telegram comes up, **in the background**, so that the server never waits for it (spec 27 §6).
 *
 * The bot is asked who it is (`getMe`) before anything else: its handle is what commands are addressed to and what the
 * host is told to add. Until it has answered, nothing is registered, polled or worked on, and the use cases see no
 * Telegram channel (`available: false`, and a queued media waits rather than failing as "no adapter").
 *
 * - **Accepted**: the channel is registered, then the worker and the poller start (the worker first, so a crash's
 *   `running` jobs are back on the queue before the first message arrives).
 * - **Rejected** (Telegram answered no: a wrong or revoked token): off, with an error line, until the operator fixes
 *   the token and restarts. Retrying would only repeat the refusal.
 * - **Unreachable** (a network blink at boot, Telegram down, a 429 or a 5xx): tried again with a growing wait, up to
 *   five minutes, for as long as the process lives. A restart is not needed to recover from a bad minute.
 *
 * The token is in every URL: what is logged about a failure is `describeFailure`, a code and numbers.
 */

export interface TelegramBringUpDeps {
  readonly api: TelegramBotApi
  /** The bot's number: the part of the token before the colon, which is not a secret. */
  readonly botId: string
  /** The box's channels, registered here once the bot is known (the use cases read it at every call). */
  readonly channels: Map<ChannelKind, MessagingChannel>
  readonly createPoller: (inbox: ChannelInbox) => ChannelPoller
  readonly startWorker: () => void
  readonly stopWorker: () => void
  readonly logger: Logger
  /** Wait that ends early when the signal aborts. Injected so a test needs no timer. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>
}

export type TelegramState = 'idle' | 'identifying' | 'ready' | 'refused' | 'stopped'

export interface TelegramBringUp {
  /** Idempotent. Returns at once; the work is in the background. */
  start(): void
  /** Idempotent. Stops the attempts, the poller and the worker. */
  stop(): void
  readonly state: TelegramState
}

const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 5 * 60_000

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

export const createTelegramBringUp = ({
  api,
  botId,
  channels,
  createPoller,
  startWorker,
  stopWorker,
  logger,
  wait = realWait,
}: TelegramBringUpDeps): TelegramBringUp => {
  let state: TelegramState = 'idle'
  let abort: AbortController | null = null
  let poller: ChannelPoller | null = null

  /**
   * The command menu, in the five languages. A failure is a warning with a code and numbers (never the token), and
   * never disables the channel: the commands work without a menu, the menu only helps people find them.
   */
  const registerMenus = async (signal: AbortSignal): Promise<void> => {
    for (const menu of BOT_COMMAND_MENUS) {
      const done = await api.setMyCommands(menu.commands, menu.languageCode, signal)
      if (!done.ok && !signal.aborted) {
        logger.warn('telegram command menu could not be registered', {
          ...describeFailure(done.error),
          language: menu.languageCode ?? 'default',
        })
      }
    }
  }

  const identify = async (signal: AbortSignal): Promise<void> => {
    let backoffMs = BACKOFF_START_MS
    while (!signal.aborted) {
      const me = await api.getMe(signal)
      if (signal.aborted) return
      if (me.ok) {
        channels.set(
          'telegram',
          new TelegramMessagingChannel({
            api,
            username: me.value.username,
            logger,
            botId: me.value.id,
            readsAll: me.value.canReadAllGroupMessages,
          }),
        )
        poller = createPoller(new TelegramInbox({ api, username: me.value.username, botId }))
        startWorker()
        poller.start()
        state = 'ready'
        // Not awaited by anything that matters: the poller is already running while the menu is registered.
        void registerMenus(signal)
        logger.info('telegram channel ready', {
          bot: me.value.username,
          readsAllGroupMessages: me.value.canReadAllGroupMessages,
        })
        return
      }

      const { error } = me
      const transient =
        error.code === 'telegram.unreachable' ||
        error.errorCode === 429 ||
        (error.status !== null && error.status >= 500)
      if (!transient) {
        state = 'refused'
        logger.error('telegram channel disabled: Telegram refused the bot', {
          ...describeFailure(error),
          detail: 'check TELEGRAM_BOT_TOKEN and TELEGRAM_API_BASE_URL, then restart',
        })
        return
      }
      logger.warn('telegram could not be reached to identify the bot: trying again', {
        ...describeFailure(error),
        retryInMs: backoffMs,
      })
      await wait(backoffMs, signal)
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
    }
  }

  return {
    get state(): TelegramState {
      return state
    },

    start: () => {
      if (state !== 'idle') return
      state = 'identifying'
      const controller = new AbortController()
      abort = controller
      void identify(controller.signal)
    },

    stop: () => {
      abort?.abort()
      abort = null
      poller?.stop()
      stopWorker()
      if (state !== 'refused') state = 'stopped'
    },
  }
}
