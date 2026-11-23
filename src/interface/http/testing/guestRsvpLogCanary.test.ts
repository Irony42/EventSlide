import request from './request'
import { describe, expect, it } from 'vitest'
import { AT, aGuestInvite, anEvent } from '../../../application/testing/builders'
import { FakeClock } from '../../../application/testing/fakeClock'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGuestInviteRepository } from '../../../application/testing/fakeGuestInviteRepository'
import { FakeGuestRsvpRepository } from '../../../application/testing/fakeGuestRsvpRepository'
import { FakeSecretTokens } from '../../../application/testing/fakeSecretTokens'
import { RecordingEventBus } from '../../../application/testing/recordingEventBus'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { makeViewGuestInvite } from '../../../application/usecases/guestInvites/viewGuestInvite'
import {
  makeDeleteOwnRsvp,
  makeGetOwnRsvp,
  makeUpdateOwnRsvp,
} from '../../../application/usecases/guestRsvps/ownRsvp'
import { makeSubmitRsvp } from '../../../application/usecases/guestRsvps/submitRsvp'
import { DEFAULT_RSVP_FORM } from '../../../domain/guestRsvps/rsvpForm'
import { asEventId } from '../../../domain/shared/ids'
import { createPinoLogger } from '../../../infrastructure/logging/pinoLogger'
import { CSRF_HEADER } from '../middleware/csrf'
import { captureAllOutputWhile } from './captureOutput'
import { buildServerHarness } from './serverHarness'
import { csrfTokenFrom } from './signIn'

/**
 * A guest's reply must write nothing of it into any log (spec 30, section 5; docs/SECURITY.md R-13).
 *
 * What a reply holds is a name, a health constraint and a few words, and what opens it is a token:
 * the access log writes a line per request, the error handler logs what it catches, the use cases
 * have a logger. This runs the whole journey (answer, read, change, refuse, delete, and a link that
 * never existed) against a **real** logger and a **real, enabled** access log, and reads every byte
 * the process wrote, on every channel it could have used.
 *
 * Planted values are distinctive enough that finding one anywhere in the output is conclusive: the
 * name, the diet, the word, the token (which travels in a header), and the invitation's own link
 * (the access log already masks its path; this holds that line).
 */

const INSTANCE = { service: 'eventslide', version: 'rsvp-canary', instance: 'rsvp-canary-box' }
const NAME = 'Canary Nom 4d1e7b9a'
const DIET = 'canary-allergie-4d1e7b9a'
const WORD = 'canary-un-mot-4d1e7b9a'
const BOGUS_TOKEN = 'canary-bogus-edit-token-4d1e7b9a'
const LIVE = asEventId('evt-live')
const INVITE = '1111111111111111'

const journey = async (): Promise<{ editToken: string }> => {
  const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE })
  const events = new FakeEventRepository().seed(
    anEvent({ id: LIVE, slug: 'vive', joinCode: 'H7K2QM', status: 'live' }),
  )
  const invites = new FakeGuestInviteRepository()
  invites.seed(
    aGuestInvite({
      eventId: LIVE,
      tokenByte: 1,
      enabled: true,
      title: 'Fête',
      startsAt: '2099-12-13T18:00:00Z',
      timeZone: 'Europe/Paris',
    }),
  )
  await invites.saveRsvpSettings(LIVE, {
    enabled: true,
    deadline: null,
    closedAt: null,
    form: DEFAULT_RSVP_FORM,
  })
  const rsvps = new FakeGuestRsvpRepository()
  const own = {
    events,
    invites,
    rsvps,
    secrets: new FakeSecretTokens(),
    bus: new RecordingEventBus(),
    clock: new FakeClock(AT),
  }
  const subject = buildServerHarness({
    logger,
    config: { accessLog: { enabled: true, level: 'trace', pretty: false, ...INSTANCE } },
    usecases: {
      viewGuestInvite: makeViewGuestInvite({ events, invites, rsvps, clock: own.clock }),
      submitRsvp: makeSubmitRsvp({ ...own, ids: new SequentialIdGenerator() }),
      getOwnRsvp: makeGetOwnRsvp(own),
      updateOwnRsvp: makeUpdateOwnRsvp(own),
      deleteOwnRsvp: makeDeleteOwnRsvp(own),
    },
  })

  const agent = request.agent(subject.app)
  const csrf = csrfTokenFrom((await agent.get(`/api/i/${INVITE}`)).headers)
  const url = `/api/i/${INVITE}/rsvp`
  const created = await agent
    .post(url)
    .set(CSRF_HEADER, csrf)
    .send({ name: NAME, answer: 'yes', adults: 2, kids: 0, diet: DIET, message: WORD })
  const editToken = created.body.editToken as string

  await agent.get(url).set('X-Rsvp-Token', editToken)
  await agent
    .put(url)
    .set(CSRF_HEADER, csrf)
    .set('X-Rsvp-Token', editToken)
    .send({ name: NAME, answer: 'maybe', adults: 1, diet: DIET, message: WORD })
  // Refusals: a reply the form refuses, a token that opens nothing, a stray key, a link that never was.
  await agent.post(url).set(CSRF_HEADER, csrf).send({ name: NAME, answer: DIET, message: WORD })
  await agent.get(url).set('X-Rsvp-Token', BOGUS_TOKEN)
  await agent
    .put(url)
    .set(CSRF_HEADER, csrf)
    .set('X-Rsvp-Token', BOGUS_TOKEN)
    .send({ name: NAME, answer: 'yes', source: WORD })
  await agent
    .post('/api/i/9999999999999999/rsvp')
    .set(CSRF_HEADER, csrf)
    .send({ name: NAME, answer: 'yes', diet: DIET })
  await agent.delete(url).set(CSRF_HEADER, csrf).set('X-Rsvp-Token', editToken)

  return { editToken }
}

describe('the log canary: a guest’s reply', () => {
  it('writes neither the name, the diet, the word, the token nor the invitation’s link, on any channel', async () => {
    let planted = { editToken: '' }
    const output = await captureAllOutputWhile(async () => {
      planted = await journey()
    })

    expect(planted.editToken).not.toBe('')
    expect(output.length).toBeGreaterThan(0)
    for (const secret of [NAME, DIET, WORD, BOGUS_TOKEN, planted.editToken, INVITE]) {
      expect(output).not.toContain(secret)
    }
  })
})
