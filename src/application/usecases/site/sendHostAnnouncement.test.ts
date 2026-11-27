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

  const build = (options: { canDeliver?: boolean; kick?: () => void; at?: Date } = {}) =>
    makeSendHostAnnouncement({
      announcements,
      audit,
      ids: new SequentialIdGenerator(),
      clock: new FakeClock(options.at ?? NOW),
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

  it('writes one audit line once the announcement exists: the number of accounts, never the text nor an address', async () => {
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

  it('refuses the same words twice: a double click, a retry or a second tab writes one announcement, and one audit line', async () => {
    const first = await send(BODY)
    const second = await send(BODY)

    expect(first.ok).toBe(true)
    expect(!second.ok && second.error.code).toBe('hostAnnouncement.duplicate')
    expect(await announcements.listRecent(5)).toHaveLength(1)
    expect(audit.all()).toHaveLength(1)
    expect(kicked).toBe(1)
  })

  it('takes the same words for a new announcement once ten minutes have gone and the first one finished, and not before', async () => {
    await send(BODY)
    const [row] = await announcements.listRecent(1)
    await announcements.finish(row?.announcement.id ?? '', NOW)

    const nineMinutes = await build({ at: new Date(NOW.getTime() + 9 * 60_000) })(BODY)
    const elevenMinutes = await build({ at: new Date(NOW.getTime() + 11 * 60_000) })(BODY)

    expect(!nineMinutes.ok && nineMinutes.error.code).toBe('hostAnnouncement.duplicate')
    expect(elevenMinutes.ok).toBe(true)
  })

  it('refuses the same words for as long as the first one is still going out, however old', async () => {
    await send(BODY)

    const later = await build({ at: new Date(NOW.getTime() + 3 * 86_400_000) })(BODY)

    expect(!later.ok && later.error.code).toBe('hostAnnouncement.duplicate')
  })

  it('does not take other words for the same announcement', async () => {
    await send(BODY)

    expect((await send({ ...BODY, subject: 'Autre sujet' })).ok).toBe(true)
    expect((await send({ ...BODY, text: 'Autre texte.' })).ok).toBe(true)
    expect((await send({ ...BODY, link: 'https://eventslide.fr/legal/cgu' })).ok).toBe(true)
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
