import type { Express } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { guestbookRoutes } from './guestbookRoutes'
import { GUEST_COOKIE } from '../middleware/authz'
import { buildHarness, testHttpConfig, type Harness } from '../testing/middlewareHarness'
import { asEventId } from '../../../domain/shared/ids'
import { AT, aGuest, aGuestbookEntry, anEvent } from '../../../application/testing/builders'
import { FakeGuestbookRepository } from '../../../application/testing/fakeGuestbookRepository'
import { makeCreateGuestbookEntry } from '../../../application/usecases/guestbook/createGuestbookEntry'
import { makeDeleteGuestbookEntry } from '../../../application/usecases/guestbook/deleteGuestbookEntry'
import { makeListMyGuestbookEntries } from '../../../application/usecases/guestbook/listMyGuestbookEntries'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'

/**
 * The guest's side of the guestbook, driven through a real Express app, the real use cases and
 * the in-memory fakes: what the routes must respect (the author is the token, another event's
 * message does not exist, the ceilings and the limiters) is decided by the domain here exactly as
 * in production.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const GUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_GUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ENTRY = '11111111-1111-4111-8111-111111111111'
const OTHERS_ENTRY = '22222222-2222-4222-8222-222222222222'
const GALA_ENTRY = '33333333-3333-4333-8333-333333333333'
const BASE = '/api/events/mariage'

const cookie = (token: string): string => `${GUEST_COOKIE}=${token}`

interface Subject {
  readonly harness: Harness
  readonly app: Express
  readonly guestbook: FakeGuestbookRepository
  readonly token: string
  readonly otherToken: string
  readonly galaToken: string
}

interface SubjectOptions {
  readonly settings?: EventSettingsPatch
  readonly writesPerGuestPerMinute?: number
  readonly guestWritePerMinute?: number
  readonly revoked?: boolean
}

const buildSubject = (options: SubjectOptions = {}): Subject => {
  const guestbook = new FakeGuestbookRepository()
  const ids = new SequentialIdGenerator()

  const harness = buildHarness({
    ...(options.guestWritePerMinute === undefined
      ? {}
      : {
          config: {
            rateLimits: {
              ...testHttpConfig().rateLimits,
              guestWritePerMinute: options.guestWritePerMinute,
            },
          },
        }),
    routes: (app, deps) => {
      app.use(
        '/api',
        guestbookRoutes({
          deps,
          ...(options.writesPerGuestPerMinute === undefined
            ? {}
            : { writesPerGuestPerMinute: options.writesPerGuestPerMinute }),
          usecases: {
            createGuestbookEntry: makeCreateGuestbookEntry({
              events: deps.events,
              guestbook,
              ids,
              bus: deps.bus,
              clock: deps.clock,
            }),
            listMyGuestbookEntries: makeListMyGuestbookEntries({
              events: deps.events,
              guestbook,
              clock: deps.clock,
            }),
            deleteGuestbookEntry: makeDeleteGuestbookEntry({
              events: deps.events,
              guestbook,
              bus: deps.bus,
              clock: deps.clock,
            }),
          },
        }),
      )
    },
  })

  harness.events.seed(
    anEvent({
      id: WEDDING,
      slug: 'mariage',
      joinCode: 'H7K2QM',
      settings: { allowGuestbook: true, ...options.settings },
    }),
    anEvent({
      id: GALA,
      slug: 'gala',
      joinCode: 'B4N9PT',
      settings: { allowGuestbook: true },
    }),
  )
  harness.guests.seed(
    aGuest({
      id: GUEST,
      eventId: WEDDING,
      displayName: 'Léa',
      ...(options.revoked === true ? { revokedAt: AT } : {}),
    }),
    aGuest({ id: OTHER_GUEST, eventId: WEDDING, displayName: 'Sacha' }),
  )

  return {
    harness,
    app: harness.app,
    guestbook,
    token: harness.issueGuestToken(WEDDING, GUEST),
    otherToken: harness.issueGuestToken(WEDDING, OTHER_GUEST),
    galaToken: harness.issueGuestToken(GALA, GUEST),
  }
}

const post = (subject: Subject, body: unknown, token = subject.token) =>
  request(subject.app)
    .post(`${BASE}/guestbook`)
    .set('Cookie', cookie(token))
    .send(body as object)

describe('POST /api/events/:eventSlug/guestbook', () => {
  it('answers 201 with the stored message, held for the host on a moderated event', async () => {
    const subject = buildSubject()

    const response = await post(subject, { text: 'Merci pour cette soirée' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      id: expect.any(String),
      text: 'Merci pour cette soirée',
      status: 'pending',
      createdAt: AT.toISOString(),
      duplicate: false,
    })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(subject.harness.bus.published).toEqual([
      { type: 'guestbook.changed', eventId: asEventId(WEDDING) },
    ])
  })

  it('answers published on an event that publishes on arrival', async () => {
    const subject = buildSubject({ settings: { moderation: 'auto' } })

    const response = await post(subject, { text: 'Bravo' })

    expect(response.body.status).toBe('published')
  })

  it('signs the message with the token guest, never with anything the body names', async () => {
    const subject = buildSubject()

    const response = await post(subject, { text: 'Bravo' })

    expect(response.status).toBe(201)
    const stored = subject.guestbook.all(asEventId(WEDDING))
    expect(stored.map((row) => row.guestId)).toEqual([GUEST])
  })

  it('answers the same message twice in a minute with the first one and duplicate: true', async () => {
    const subject = buildSubject()
    const first = await post(subject, { text: 'Merci' })

    const again = await post(subject, { text: 'Merci' })

    expect(again.status).toBe(201)
    expect(again.body.duplicate).toBe(true)
    expect(again.body.id).toBe(first.body.id)
    expect(subject.guestbook.all(asEventId(WEDDING))).toHaveLength(1)
  })

  it('refuses a body with a key it does not know, as 400 request.invalid', async () => {
    const subject = buildSubject()

    const response = await post(subject, { text: 'Bravo', guestId: OTHER_GUEST })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('refuses a body with no text, as 400 request.invalid', async () => {
    expect((await post(buildSubject(), {})).body.error.code).toBe('request.invalid')
  })

  it('answers the domain codes for text it refuses', async () => {
    const subject = buildSubject()

    const empty = await post(subject, { text: '   ' })
    const long = await post(subject, { text: 'x'.repeat(501) })
    const lines = await post(subject, { text: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj' })

    expect([empty.status, empty.body.error.code]).toEqual([400, 'guestbook.empty'])
    expect([long.status, long.body.error.code]).toEqual([400, 'guestbook.tooLong'])
    expect(long.body.error.details).toEqual({ max: 500 })
    expect([lines.status, lines.body.error.code]).toEqual([400, 'guestbook.tooManyLines'])
  })

  it('answers 409 guestbook.disabled when the host has not switched it on', async () => {
    const subject = buildSubject({ settings: { allowGuestbook: false } })

    const response = await post(subject, { text: 'Bravo' })

    expect([response.status, response.body.error.code]).toEqual([409, 'guestbook.disabled'])
  })

  it.each(['draft', 'archived'] as const)(
    'answers 409 event.notAcceptingUploads on a %s event',
    async (status) => {
      const subject = buildSubject()
      subject.harness.events.seed(
        anEvent({ id: WEDDING, slug: 'mariage', status, settings: { allowGuestbook: true } }),
      )
      // `draft` and `archived` events do not hold guests that can authenticate in production; the
      // token is still valid in the harness, which is what asks the use case.
      const response = await post(subject, { text: 'Bravo' })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('event.notAcceptingUploads')
    },
  )

  it('answers 409 guestbook.limitReached on the fourth message, and guestbook.eventFull on the 501st', async () => {
    const subject = buildSubject()
    for (const text of ['un', 'deux', 'trois']) await post(subject, { text })

    const fourth = await post(subject, { text: 'quatre' })

    expect([fourth.status, fourth.body.error.code]).toEqual([409, 'guestbook.limitReached'])
    expect(fourth.body.error.details).toEqual({ max: 3 })

    for (let n = 0; n < 497; n += 1) {
      subject.guestbook.seed(
        aGuestbookEntry({
          id: `fill-${n}`,
          eventId: WEDDING,
          guestId: `filler-${n}`,
          text: `fill-${n}`,
        }),
      )
    }
    const full = await post(subject, { text: 'dernier' }, subject.otherToken)
    expect([full.status, full.body.error.code]).toEqual([409, 'guestbook.eventFull'])
  })

  it('answers 401 with no device token', async () => {
    const subject = buildSubject()

    expect((await request(subject.app).post(`${BASE}/guestbook`).send({ text: 'x' })).status).toBe(
      401,
    )
  })

  it('refuses a token issued for another event as an event that is not there', async () => {
    const subject = buildSubject()

    const response = await post(subject, { text: 'Bravo' }, subject.galaToken)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
    expect(subject.guestbook.all(asEventId(GALA))).toEqual([])
  })

  it('refuses a revoked guest', async () => {
    const subject = buildSubject({ revoked: true })

    expect((await post(subject, { text: 'Bravo' })).status).toBe(403)
  })

  it('answers 404 event.notFound when the operator took the event down, to a holder of a valid token', async () => {
    const subject = buildSubject()
    await subject.harness.events.setTakenDown(asEventId(WEDDING), new Date(0))

    const response = await post(subject, { text: 'Bravo' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('answers 429 rate.limited with Retry-After past the per-guest budget, and writes and removals share it', async () => {
    const subject = buildSubject({ writesPerGuestPerMinute: 2 })
    subject.guestbook.seed(aGuestbookEntry({ id: ENTRY, eventId: WEDDING, guestId: GUEST }))
    await post(subject, { text: 'un' })
    const removal = await request(subject.app)
      .delete(`${BASE}/guestbook/${ENTRY}`)
      .set('Cookie', cookie(subject.token))
    expect(removal.status).toBe(204)

    const third = await post(subject, { text: 'deux' })

    expect(third.status).toBe(429)
    expect(third.body.error.code).toBe('rate.limited')
    expect(third.headers['retry-after']).toBeDefined()
  })

  it('does not let one guest spend another guest budget', async () => {
    const subject = buildSubject({ writesPerGuestPerMinute: 1 })
    await post(subject, { text: 'un' })

    const other = await post(subject, { text: 'deux' }, subject.otherToken)

    expect(other.status).toBe(201)
  })

  it('answers 429 rate.limited from the per-address stage as well', async () => {
    const subject = buildSubject({ guestWritePerMinute: 1 })
    await post(subject, { text: 'un' })

    const second = await post(subject, { text: 'deux' })

    expect(second.status).toBe(429)
  })
})

describe('GET /api/events/:eventSlug/guestbook/mine', () => {
  it('lists the guest own messages with the server verdict, and says a new one would be taken', async () => {
    const subject = buildSubject()
    await post(subject, { text: 'Bravo' })

    const response = await request(subject.app)
      .get(`${BASE}/guestbook/mine`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      items: [
        {
          id: expect.any(String),
          text: 'Bravo',
          status: 'pending',
          createdAt: AT.toISOString(),
          canDelete: true,
        },
      ],
      accepting: true,
      onWall: true,
    })
  })

  it('never lists another guest message, another event message or the author of anything', async () => {
    const subject = buildSubject()
    subject.guestbook.seed(
      aGuestbookEntry({ id: OTHERS_ENTRY, eventId: WEDDING, guestId: OTHER_GUEST }),
      aGuestbookEntry({ id: GALA_ENTRY, eventId: GALA, guestId: GUEST }),
    )

    const response = await request(subject.app)
      .get(`${BASE}/guestbook/mine`)
      .set('Cookie', cookie(subject.token))

    expect(response.body.items).toEqual([])
  })

  it('says accepting: false when the host switched the guestbook off', async () => {
    const subject = buildSubject({ settings: { allowGuestbook: false } })

    const response = await request(subject.app)
      .get(`${BASE}/guestbook/mine`)
      .set('Cookie', cookie(subject.token))

    expect(response.body.accepting).toBe(false)
  })

  it('answers 401 with no token, and 404 for a token of another event', async () => {
    const subject = buildSubject()

    expect((await request(subject.app).get(`${BASE}/guestbook/mine`)).status).toBe(401)
    expect(
      (
        await request(subject.app)
          .get(`${BASE}/guestbook/mine`)
          .set('Cookie', cookie(subject.galaToken))
      ).status,
    ).toBe(404)
  })

  it('answers 404 once the operator took the event down', async () => {
    const subject = buildSubject()
    await subject.harness.events.setTakenDown(asEventId(WEDDING), new Date(0))

    const response = await request(subject.app)
      .get(`${BASE}/guestbook/mine`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(404)
  })
})

describe('DELETE /api/events/:eventSlug/guestbook/:entryId', () => {
  const seeded = (options: SubjectOptions = {}): Subject => {
    const subject = buildSubject(options)
    subject.guestbook.seed(
      aGuestbookEntry({ id: ENTRY, eventId: WEDDING, guestId: GUEST }),
      aGuestbookEntry({ id: OTHERS_ENTRY, eventId: WEDDING, guestId: OTHER_GUEST }),
      aGuestbookEntry({ id: GALA_ENTRY, eventId: GALA, guestId: GUEST }),
    )
    return subject
  }

  const remove = (subject: Subject, entryId: string, token = subject.token) =>
    request(subject.app).delete(`${BASE}/guestbook/${entryId}`).set('Cookie', cookie(token))

  it('answers 204 and removes the guest own pending message', async () => {
    const subject = seeded()

    const response = await remove(subject, ENTRY)

    expect(response.status).toBe(204)
    expect(subject.guestbook.all(asEventId(WEDDING)).map((row) => row.id)).toEqual([OTHERS_ENTRY])
  })

  it("answers 404 guestbook.notFound for another guest's message, and leaves it", async () => {
    const subject = seeded()

    const response = await remove(subject, OTHERS_ENTRY)

    expect([response.status, response.body.error.code]).toEqual([404, 'guestbook.notFound'])
    expect(subject.guestbook.all(asEventId(WEDDING))).toHaveLength(2)
  })

  it('answers 404 guestbook.notFound for another event message and for an unknown id', async () => {
    const subject = seeded()

    expect((await remove(subject, GALA_ENTRY)).body.error.code).toBe('guestbook.notFound')
    expect((await remove(subject, '44444444-4444-4444-8444-444444444444')).body.error.code).toBe(
      'guestbook.notFound',
    )
  })

  it('answers 400 for an id that is not an id', async () => {
    const response = await remove(seeded(), 'not-an-id')

    expect(response.status).toBe(400)
  })

  it('answers 403 event.guestSelfDeleteDisabled when the host switched self-delete off', async () => {
    const subject = seeded({ settings: { allowGuestSelfDelete: false } })

    const response = await remove(subject, ENTRY)

    expect([response.status, response.body.error.code]).toEqual([
      403,
      'event.guestSelfDeleteDisabled',
    ])
  })

  it('answers 403 guestbook.deleteForbidden for a message already on the wall', async () => {
    const subject = seeded()
    subject.guestbook.seed(
      aGuestbookEntry({ id: ENTRY, eventId: WEDDING, guestId: GUEST, moderation: 'auto' }),
    )

    const response = await remove(subject, ENTRY)

    expect([response.status, response.body.error.code]).toEqual([403, 'guestbook.deleteForbidden'])
  })

  it('answers 500 guestbook.deleteFailed on a purge-held event, and 404 for an unknown id there', async () => {
    const subject = seeded()
    await subject.harness.events.setPurgeHeld(asEventId(WEDDING), new Date(0))

    expect((await remove(subject, ENTRY)).body.error.code).toBe('guestbook.deleteFailed')
    expect((await remove(subject, '44444444-4444-4444-8444-444444444444')).status).toBe(404)
  })

  it('answers 401 with no token, and 404 for a token of another event', async () => {
    const subject = seeded()

    expect((await request(subject.app).delete(`${BASE}/guestbook/${ENTRY}`)).status).toBe(401)
    expect((await remove(subject, ENTRY, subject.galaToken)).status).toBe(404)
  })

  it('refuses a revoked guest, who keeps only erase-everything', async () => {
    const subject = seeded({ revoked: true })

    expect((await remove(subject, ENTRY)).status).toBe(403)
  })
})
