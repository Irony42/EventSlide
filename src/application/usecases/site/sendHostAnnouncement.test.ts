import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClock } from '../../testing/fakeClock'
import { FakeHostAnnouncementRepository } from '../../testing/fakeHostAnnouncementRepository'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { atPlus } from '../../testing/builders'
import { makeSendHostAnnouncement, type SendHostAnnouncement } from './sendHostAnnouncement'

/**
 * Writing an announcement to the hosts (spec 32, lot 2, A8): what it records, what it answers, and what it refuses.
 */

const OPERATOR = asUserId('user-operator')
const NOW = atPlus(86_400_000)
const BODY = {
  subject: 'Nouvelles conditions',
  text: 'Elles changent le 1er janvier.',
  operatorId: OPERATOR,
}

describe('sendHostAnnouncement', () => {
  let announcements: FakeHostAnnouncementRepository
  let audit: FakeAuditLog
  let kicked: number
  let send: SendHostAnnouncement

  const build = (options: { canDeliver?: boolean; kick?: () => void } = {}) =>
    makeSendHostAnnouncement({
      announcements,
      audit,
      ids: new SequentialIdGenerator(),
      clock: new FakeClock(NOW),
      mailer: { canDeliver: options.canDeliver ?? true },
      kick:
        options.kick ??
        (() => {
          kicked += 1
        }),
    })

  beforeEach(() => {
    kicked = 0
    announcements = new FakeHostAnnouncementRepository()
      .withOwner('user-a', 'a@example.test')
      .withOwner('user-b', 'b@example.test')
    audit = new FakeAuditLog().withAccounts(OPERATOR)
    send = build()
  })

  it('writes the announcement as the operator typed it, answers its id and how many accounts it is owed to, and starts the first batch', async () => {
    const result = await send({ ...BODY, link: 'https://eventslide.fr/legal/cgu' })

    expect(result).toEqual({ ok: true, value: { id: 'host-announcement-1', recipients: 2 } })
    const [row] = await announcements.listRecent(5)
    expect(row?.announcement).toEqual({
      id: 'host-announcement-1',
      subject: 'Nouvelles conditions',
      text: 'Elles changent le 1er janvier.',
      link: 'https://eventslide.fr/legal/cgu',
      createdBy: OPERATOR,
      createdAt: NOW,
      finishedAt: null,
    })
    expect(kicked).toBe(1)
  })

  it('writes one audit line before the announcement exists: the number of accounts, never the text nor an address', async () => {
    await send(BODY)

    expect(audit.all()).toEqual([
      {
        seq: 1,
        at: NOW,
        actor: { kind: 'operator', userId: OPERATOR, label: null },
        action: 'account.hostAnnouncementSent',
        subject: { type: 'account', id: OPERATOR },
        clientId: null,
        details: { recipients: 2 },
      },
    ])
    expect(JSON.stringify(audit.all())).not.toContain('Nouvelles conditions')
    expect(JSON.stringify(audit.all())).not.toContain('example.test')
  })

  it('refuses a subject, a text or a link the rules refuse, before anything is read or written', async () => {
    for (const [patch, code] of [
      [{ subject: ' ' }, 'hostAnnouncement.subjectInvalid'],
      [{ text: '' }, 'hostAnnouncement.textInvalid'],
      [{ link: 'http://eventslide.fr' }, 'hostAnnouncement.linkInvalid'],
    ] as const) {
      const result = await send({ ...BODY, ...patch })
      expect(!result.ok && result.error.code).toBe(code)
    }

    expect(audit.all()).toEqual([])
    expect(await announcements.listRecent(5)).toEqual([])
    expect(kicked).toBe(0)
  })

  it('refuses on a box that cannot mail: an announcement nobody could receive would wait for ever', async () => {
    const result = await build({ canDeliver: false })(BODY)

    expect(!result.ok && result.error.code).toBe('hostAnnouncement.mailerRequired')
    expect(await announcements.listRecent(5)).toEqual([])
    expect(audit.all()).toEqual([])
  })

  it('refuses when nobody would receive it', async () => {
    announcements = new FakeHostAnnouncementRepository()

    const result = await build()(BODY)

    expect(!result.ok && result.error.code).toBe('hostAnnouncement.noRecipients')
    expect(audit.all()).toEqual([])
  })

  it('does not count an account that was switched off', async () => {
    announcements.switchOff('user-a')

    const result = await send(BODY)

    expect(result).toMatchObject({ ok: true, value: { recipients: 1 } })
  })

  it('succeeds when starting the first batch fails: the next pass of the sweep starts it', async () => {
    const result = await build({
      kick: () => {
        throw new Error('boom')
      },
    })(BODY)

    expect(result.ok).toBe(true)
  })

  it('writes nothing when the audit line cannot be formed', async () => {
    const result = await send({ ...BODY, operatorId: asUserId('') })

    expect(result.ok).toBe(false)
    expect(await announcements.listRecent(5)).toEqual([])
  })

  it('works with nobody to start it early', async () => {
    const result = await makeSendHostAnnouncement({
      announcements,
      audit,
      ids: new SequentialIdGenerator(),
      clock: new FakeClock(NOW),
      mailer: { canDeliver: true },
    })(BODY)

    expect(result.ok).toBe(true)
  })
})
