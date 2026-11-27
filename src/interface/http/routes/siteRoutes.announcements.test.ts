import { describe, expect, it } from 'vitest'
import { CSRF_HEADER } from '../middleware/csrf'
import { ID, aBox } from '../testing/siteBox'
import type { SiteHarnessOptions } from '../testing/siteHarness'

/**
 * Ring 4. The operator's announcements to the hosts (spec 32, lot 2, A8) through `/api/site/announcements`: what the wire
 * accepts, what it answers, what the audit log says of it, and what a box that cannot mail refuses. The use cases are held at
 * ring 2 (`sendHostAnnouncement.test.ts`), the sending by the sweep (`sweepHostAnnouncements.test.ts`).
 */

const BODY = { subject: 'Nouvelles conditions', text: 'Elles changent le 1er janvier.' }

const operator = async (options: SiteHarnessOptions = {}) => {
  const { site } = await aBox(options)
  const caller = await site.signInAsOperator()
  const write = (body: object) =>
    caller.agent.post('/api/site/announcements').set(CSRF_HEADER, caller.csrf).send(body)
  const list = () => caller.agent.get('/api/site/announcements')
  const audit = async () =>
    (await caller.agent.get('/api/site/audit')).body.items as readonly {
      readonly action: string
      readonly details: Record<string, unknown>
    }[]
  return { site, write, list, audit }
}

describe('POST and GET /api/site/announcements', () => {
  it('writes the announcement, answers its id and how many accounts it is owed to, and lists it with nobody reached yet', async () => {
    const { write, list } = await operator()

    const written = await write({ ...BODY, link: 'https://eventslide.fr/legal/cgu' })

    expect(written.status).toBe(202)
    expect(written.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), recipients: 3 })
    const listed = await list()
    expect(listed.status).toBe(200)
    expect(listed.headers['cache-control']).toBe('no-store')
    expect(listed.body.recipients).toBe(3)
    expect(listed.body.items).toEqual([
      {
        id: written.body.id,
        subject: 'Nouvelles conditions',
        text: 'Elles changent le 1er janvier.',
        link: 'https://eventslide.fr/legal/cgu',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        finishedAt: null,
        delivered: 0,
        owed: 3,
      },
    ])
  })

  it('leaves one audit line with the number of accounts and neither the text nor an address', async () => {
    const { write, audit } = await operator()

    await write(BODY)

    const lines = (await audit()).filter((line) => line.action === 'account.hostAnnouncementSent')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.details).toEqual({ recipients: 3 })
    expect(JSON.stringify(await audit())).not.toContain('Nouvelles conditions')
  })

  it.each([
    ['a subject that is blank', { subject: '  ' }, 'hostAnnouncement.subjectInvalid'],
    [
      'a subject over 150 characters',
      { subject: 'a'.repeat(151) },
      'hostAnnouncement.subjectInvalid',
    ],
    ['a text that is blank', { text: '\n' }, 'hostAnnouncement.textInvalid'],
    ['a link that is not https', { link: 'http://eventslide.fr' }, 'hostAnnouncement.linkInvalid'],
  ])('answers 400 for %s, and writes nothing', async (_label, patch, code) => {
    const { write, list, audit } = await operator()

    const response = await write({ ...BODY, ...patch })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe(code)
    expect((await list()).body.items).toEqual([])
    expect(
      (await audit()).filter((line) => line.action === 'account.hostAnnouncementSent'),
    ).toEqual([])
  })

  it.each([
    ['a key the contract does not know', { ...BODY, extra: 1 }],
    ['no text', { subject: 'Sujet' }],
    ['a subject that is not text', { ...BODY, subject: 5 }],
    ['a text beyond what a request may carry', { ...BODY, text: 'a'.repeat(20_001) }],
  ])('answers 400 request.invalid for %s', async (_label, body) => {
    const { write } = await operator()

    const response = await write(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 409 hostAnnouncement.duplicate to the same words sent twice, and writes one announcement and one audit line', async () => {
    const { write, list, audit } = await operator()

    const first = await write(BODY)
    const second = await write(BODY)

    expect(first.status).toBe(202)
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('hostAnnouncement.duplicate')
    expect((await list()).body.items).toHaveLength(1)
    expect(
      (await audit()).filter((line) => line.action === 'account.hostAnnouncementSent'),
    ).toHaveLength(1)
  })

  it('asks for a fresh step-up before reading the body, while the listing still answers', async () => {
    const { site, write, list } = await operator()
    await site.stamp(ID.operator, { stepUpAt: 0 })

    const response = await write({ nonsense: true })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('auth.stepUpRequired')
    expect((await list()).status).toBe(200)
    expect((await list()).body.items).toEqual([])
  })

  it('answers 409 hostAnnouncement.mailerRequired on a box that cannot mail, and writes nothing', async () => {
    const { write, list } = await operator({ mail: 'none' })

    const response = await write(BODY)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('hostAnnouncement.mailerRequired')
    expect((await list()).body.items).toEqual([])
  })
})
