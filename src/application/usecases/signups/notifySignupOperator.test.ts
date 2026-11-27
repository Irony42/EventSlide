import { describe, expect, it } from 'vitest'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { AT } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClock } from '../../testing/fakeClock'
import { FakeMailer } from '../../testing/fakeMailer'
import { PUBLIC_URL } from '../../testing/signupScene'
import { err } from '../../../domain/shared/result'
import { mailFailure, type Mailer } from '../../ports/mailer'
import { makeNotifySignupOperator } from './notifySignupOperator'

const HOUR = 60 * 60 * 1000

const operator = (() => {
  const parsed = EmailAddress.create('pierre@example.test')
  if (!parsed.ok) throw new Error('fixture')
  return parsed.value
})()

const build = (overrides: { mailer?: Mailer; to?: EmailAddress | null } = {}) => {
  const clock = new FakeClock(AT)
  const mailer = new FakeMailer()
  const logger = new CapturingLogger()
  const notify = makeNotifySignupOperator({
    mailer: overrides.mailer ?? mailer,
    to: overrides.to === undefined ? operator : overrides.to,
    publicUrl: PUBLIC_URL,
    clock,
    logger,
  })
  return { clock, mailer, logger, notify }
}

describe('notifySignupOperator', () => {
  it('writes a mail with a count and the console link, and no address or name', async () => {
    const { mailer, notify } = build()

    await notify('waiting')

    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]?.to).toBe('pierre@example.test')
    expect(mailer.sent[0]?.text).toContain(`${PUBLIC_URL}/admin/site/signups`)
  })

  it('sends at most one mail an hour, and merges what happened in between into the next one', async () => {
    const { clock, mailer, notify } = build()

    await notify('waiting')
    clock.advance(HOUR - 1)
    await notify('waiting')
    await notify('waiting', 2)
    expect(mailer.sent).toHaveLength(1)

    clock.advance(1)
    await notify('waiting')
    expect(mailer.sent).toHaveLength(2)
    expect(mailer.sent[1]?.subject).toContain('4')
  })

  it('counts each kind apart', async () => {
    const { clock, mailer, notify } = build()
    await notify('opened')
    await notify('waiting')
    clock.advance(HOUR)
    await notify('waiting')

    expect(mailer.sent[0]?.subject).toContain('compte')
    expect(mailer.sent[1]?.subject).toContain('2')
  })

  it('does nothing without an address to write to', async () => {
    const { mailer, notify } = build({ to: null })
    await notify('waiting')
    expect(mailer.sent).toHaveLength(0)
  })

  it('does nothing on a box that cannot deliver mail', async () => {
    const nullMailer: Mailer = {
      canDeliver: false,
      send: async () => err(mailFailure('notConfigured')),
    }
    const { logger, notify } = build({ mailer: nullMailer })
    await notify('waiting')
    expect(logger.lines).toHaveLength(0)
  })

  it('keeps the count and the hour when the relay refuses, and tries again at the next notice', async () => {
    const { mailer, logger, notify } = build()
    mailer.failNextWith('transient')

    await notify('waiting')
    expect(logger.find('a signup notice was not sent')?.context).toEqual({ code: 'mail.transient' })

    await notify('waiting')
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]?.subject).toContain('2')
  })

  it('never rejects: a failure is logged', async () => {
    const throwing: Mailer = {
      canDeliver: true,
      send: async () => {
        throw new Error('socket closed')
      },
    }
    const { logger, notify } = build({ mailer: throwing })
    await expect(notify('waiting')).resolves.toBeUndefined()
    expect(logger.find('a signup notice failed')?.context).toEqual({ error: 'socket closed' })
  })

  it('logs a failure that is not an Error as text', async () => {
    const throwing: Mailer = {
      canDeliver: true,
      send: async () => {
        throw 'plain'
      },
    }
    const { logger, notify } = build({ mailer: throwing })
    await notify('waiting')
    expect(logger.find('a signup notice failed')?.context).toEqual({ error: 'plain' })
  })

  it('logs when the notice cannot be written (a count of zero)', async () => {
    const { logger, notify } = build()
    await notify('waiting', 0)
    expect(logger.find('a signup notice could not be written')).toBeDefined()
  })
})
