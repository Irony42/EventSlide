import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AT } from '../../../application/testing/builders'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import type { HttpConfig, SessionPayload } from '../types'
import {
  SECOND_FACTOR_REQUIRED_CODE,
  STEP_UP_REQUIRED_CODE,
  requireSecondFactor,
  requireStepUp,
} from './authz'

/**
 * Ring 4. The two gates in isolation, with the stamp a session carries set directly, so every
 * way a stamp can be wrong is a case — the routes suite (`secondFactorRoutes.test.ts`) proves
 * the stamps are written by the right acts; this proves what is done with them.
 */

const HOST = 'host-id'
const FIVE_MINUTES = 5 * 60 * 1000

const withFactor = (requiredForOperators: boolean): Partial<HttpConfig> => ({
  secondFactor: { available: true, requiredForOperators },
})

const subjectWith = (config: Partial<HttpConfig>): Harness =>
  buildHarness({
    config,
    routes: (app, deps) => {
      const stamp = (extra: Partial<SessionPayload> | Record<string, unknown>) =>
        signInAs({ userId: HOST, email: 'host@example.com', ...(extra as Partial<SessionPayload>) })

      app.post('/sign-in/plain', stamp({}))
      app.post('/sign-in/factor', stamp({ secondFactorAt: AT.getTime() }))
      app.post('/sign-in/factor-from-the-future', stamp({ secondFactorAt: AT.getTime() + 1 }))
      app.post('/sign-in/factor-as-text', stamp({ secondFactorAt: String(AT.getTime()) }))
      app.post('/sign-in/factor-as-nan', stamp({ secondFactorAt: Number.NaN }))
      app.post('/sign-in/step-up', stamp({ stepUpAt: AT.getTime() }))
      app.post('/sign-in/step-up-from-the-future', stamp({ stepUpAt: AT.getTime() + 1 }))
      app.post('/sign-in/step-up-as-text', stamp({ stepUpAt: String(AT.getTime()) }))

      app.get('/guarded', requireSecondFactor(deps), (_req, res) => {
        res.json({ reached: true })
      })
      app.get('/confirmed', requireStepUp(deps), (_req, res) => {
        res.json({ reached: true })
      })
    },
  })

const signedIn = async (subject: Harness, as: string) => {
  const agent = request.agent(subject.app)
  await agent.post(`/sign-in/${as}`).expect(204)
  return agent
}

describe('requireSecondFactor', () => {
  it('does nothing on a box that does not require one, whatever the session carries', async () => {
    const subject = subjectWith(withFactor(false))
    const agent = await signedIn(subject, 'plain')

    await agent.get('/guarded').expect(200)
  })

  it('does nothing on a box that does not require one, with no session at all', async () => {
    const subject = subjectWith(withFactor(false))

    await request(subject.app).get('/guarded').expect(200)
  })

  it('refuses a session that has not passed the second factor, with its own code', async () => {
    const subject = subjectWith(withFactor(true))
    const agent = await signedIn(subject, 'plain')

    const response = await agent.get('/guarded')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe(SECOND_FACTOR_REQUIRED_CODE)
    expect(SECOND_FACTOR_REQUIRED_CODE).toBe('auth.secondFactorRequired')
  })

  it('refuses a caller with no session at all', async () => {
    const subject = subjectWith(withFactor(true))

    const response = await request(subject.app).get('/guarded')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe(SECOND_FACTOR_REQUIRED_CODE)
  })

  it('lets through a session that passed it', async () => {
    const subject = subjectWith(withFactor(true))
    const agent = await signedIn(subject, 'factor')

    await agent.get('/guarded').expect(200)
  })

  it.each([
    ['a stamp in the future (a clock that stepped back)', 'factor-from-the-future'],
    ['a stamp that is text', 'factor-as-text'],
    ['a stamp that is not a number', 'factor-as-nan'],
  ])('refuses %s', async (_name, as) => {
    const subject = subjectWith(withFactor(true))
    const agent = await signedIn(subject, as)

    const response = await agent.get('/guarded')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe(SECOND_FACTOR_REQUIRED_CODE)
  })
})

describe('requireStepUp', () => {
  it('refuses a session that never confirmed, with its own code', async () => {
    const subject = subjectWith(withFactor(false))
    const agent = await signedIn(subject, 'plain')

    const response = await agent.get('/confirmed')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe(STEP_UP_REQUIRED_CODE)
    expect(STEP_UP_REQUIRED_CODE).toBe('auth.stepUpRequired')
  })

  it('lets through a confirmation made just now', async () => {
    const subject = subjectWith(withFactor(false))
    const agent = await signedIn(subject, 'step-up')

    await agent.get('/confirmed').expect(200)
  })

  it('lets a confirmation stand for exactly five minutes', async () => {
    const subject = subjectWith(withFactor(false))
    const agent = await signedIn(subject, 'step-up')

    subject.clock.advance(FIVE_MINUTES)
    await agent.get('/confirmed').expect(200)
  })

  it('refuses it from the millisecond after', async () => {
    const subject = subjectWith(withFactor(false))
    const agent = await signedIn(subject, 'step-up')

    subject.clock.advance(FIVE_MINUTES + 1)
    const response = await agent.get('/confirmed')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe(STEP_UP_REQUIRED_CODE)
  })

  it.each([
    ['a stamp in the future', 'step-up-from-the-future'],
    ['a stamp that is text', 'step-up-as-text'],
  ])('refuses %s', async (_name, as) => {
    const subject = subjectWith(withFactor(false))
    const agent = await signedIn(subject, as)

    const response = await agent.get('/confirmed')

    expect(response.status).toBe(403)
  })

  it('is not satisfied by having passed the second factor at sign-in', async () => {
    const subject = subjectWith(withFactor(true))
    const agent = await signedIn(subject, 'factor')

    const response = await agent.get('/confirmed')

    expect(response.body.error.code).toBe(STEP_UP_REQUIRED_CODE)
  })
})
