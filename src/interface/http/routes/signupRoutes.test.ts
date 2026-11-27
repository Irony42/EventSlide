import { describe, expect, it } from 'vitest'
import { aForm, buildSignupScene } from '../../../application/testing/signupScene'
import type { SignupMode } from '../../../domain/signups/signupMode'
import { CSRF_HEADER } from '../middleware/csrf'
import { anonymousCaller } from '../testing/signIn'
import { buildServerHarness } from '../testing/serverHarness'
import type { HttpConfig } from '../types'

/**
 * Self-service signup through the real server (spec 31): the 4 KB parser mounted ahead of the global
 * one, the CSRF gate, the per-hour limiter, the headers of the confirmation namespace and the switch.
 * The use cases are the real ones over the fakes, so what these defend is what the visitor can observe.
 */

const FORM = {
  email: 'lea@example.test',
  clientName: 'Mariage de Lea et Hugo',
  locale: 'fr',
  website: '',
}

const build = (
  mode: SignupMode = 'review',
  options: { readonly rateLimitPerHour?: number; readonly maxPerDay?: number } = {},
) => {
  const scene = buildSignupScene({
    mode,
    ...(options.maxPerDay === undefined ? {} : { maxPerDay: options.maxPerDay }),
  })
  const config: Partial<HttpConfig> = {
    signup: { mode, rateLimitPerHour: options.rateLimitPerHour ?? 100 },
  }
  const harness = buildServerHarness({
    config,
    clock: scene.clock,
    usecases: {
      requestSignup: scene.requestSignup,
      previewSignupConfirmation: scene.preview,
      confirmSignup: scene.confirm,
    },
  })
  return { scene, app: harness.app }
}

/** A visitor's browser: it has the CSRF cookie before it writes. */
const visitor = async (app: ReturnType<typeof build>['app']) => {
  const caller = await anonymousCaller(app)
  return {
    post: (path: string, body?: unknown) =>
      caller.agent
        .post(path)
        .set(CSRF_HEADER, caller.csrf)
        .send((body ?? {}) as object),
    get: (path: string) => caller.agent.get(path),
    csrf: caller.csrf,
    agent: caller.agent,
  }
}

describe('POST /api/signup', () => {
  it('answers 202 sent, mails one link, and stores an unconfirmed request', async () => {
    const { app, scene } = build()
    const { post } = await visitor(app)

    const response = await post('/api/signup', FORM)
    await Promise.resolve()

    expect(response.status).toBe(202)
    expect(response.body).toEqual({ status: 'sent' })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(scene.signups.all).toHaveLength(1)
  })

  it('answers exactly the same for a new address, a known one, and one already waiting', async () => {
    const { app, scene } = build()
    const { post } = await visitor(app)

    const first = await post('/api/signup', FORM)
    const waiting = await post('/api/signup', FORM)
    const stranger = await post('/api/signup', { ...FORM, email: 'other@example.test' })

    for (const response of [waiting, stranger]) {
      expect(response.status).toBe(first.status)
      expect(response.body).toEqual(first.body)
      expect(response.headers['cache-control']).toBe(first.headers['cache-control'])
    }
    expect(scene.signups.all).toHaveLength(2)
  })

  it('answers 202 sent and stores nothing when the honeypot is filled', async () => {
    const { app, scene } = build()
    const { post } = await visitor(app)

    const response = await post('/api/signup', { ...FORM, website: 'http://spam.example' })

    expect(response.status).toBe(202)
    expect(response.body).toEqual({ status: 'sent' })
    expect(scene.signups.all).toHaveLength(0)
  })

  it('answers busy at the day ceiling, and only then', async () => {
    const { app } = build('review', { maxPerDay: 1 })
    const { post } = await visitor(app)

    const first = await post('/api/signup', FORM)
    const second = await post('/api/signup', { ...FORM, email: 'other@example.test' })

    expect(first.body).toEqual({ status: 'sent' })
    expect(second.status).toBe(202)
    expect(second.body).toEqual({ status: 'busy' })
  })

  it('does not wait for the mail: the answer does not depend on the completion', async () => {
    const scene = buildSignupScene({ mode: 'review' })
    const harness = buildServerHarness({
      config: { signup: { mode: 'review', rateLimitPerHour: 100 } },
      usecases: {
        // A completion that never resolves: a response that waited for it would hang.
        requestSignup: async () => ({
          ok: true,
          value: { status: 'sent', completion: new Promise<void>(() => undefined) },
        }),
      },
    })
    const { post } = await visitor(harness.app)

    const response = await post('/api/signup', FORM)

    expect(response.status).toBe(202)
    expect(scene.mailer.sent).toHaveLength(0)
  })

  it('answers 400 with the domain code for an address that is not one', async () => {
    const { app } = build()
    const { post } = await visitor(app)

    const response = await post('/api/signup', { ...FORM, email: 'not an address' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('email.containsWhitespace')
  })

  it('answers 400 request.invalid for a stray field and for a missing honeypot', async () => {
    const { app } = build()
    const { post } = await visitor(app)

    const stray = await post('/api/signup', { ...FORM, admin: true })
    const missing = await post('/api/signup', { email: FORM.email, clientName: 'x', locale: 'fr' })

    expect(stray.status).toBe(400)
    expect(stray.body.error.code).toBe('request.invalid')
    expect(missing.status).toBe(400)
    expect(missing.body.error.code).toBe('request.invalid')
  })

  it('answers 413 for a body over 4 KB, not 64', async () => {
    const { app } = build()
    const { post } = await visitor(app)

    const response = await post('/api/signup', { ...FORM, note: 'x'.repeat(5000) })

    expect(response.status).toBe(413)
  })

  it('refuses a write without the CSRF token', async () => {
    const { app } = build()
    const { agent } = await visitor(app)

    const response = await agent.post('/api/signup').send(FORM)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('request.csrfMissing')
  })

  it('answers 429 once an address has made its hourly allowance, whatever the answers were', async () => {
    const { app } = build('review', { rateLimitPerHour: 2 })
    const { post } = await visitor(app)

    const first = await post('/api/signup', FORM)
    const second = await post('/api/signup', { ...FORM, website: 'bot' })
    const third = await post('/api/signup', FORM)

    expect([first.status, second.status, third.status]).toEqual([202, 202, 429])
    expect(third.body.error.code).toBe('rate.limited')
  })

  it('answers 404 feature.unavailable while SIGNUP is off, whatever the body, and spends no allowance', async () => {
    const { app, scene } = build('off', { rateLimitPerHour: 1 })
    const { post } = await visitor(app)

    const first = await post('/api/signup', FORM)
    const second = await post('/api/signup', { nonsense: true })

    for (const response of [first, second]) {
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('feature.unavailable')
    }
    expect(scene.signups.all).toHaveLength(0)
  })
})

describe('GET /api/signup/confirm/:token', () => {
  const link = async (mode: SignupMode = 'review') => {
    const world = build(mode)
    await world.scene.submit(aForm())
    return { ...world, token: world.scene.lastToken() }
  }

  it('shows the state of the link and the masked address, and spends nothing', async () => {
    const { app, scene, token } = await link()
    const { get } = await visitor(app)

    const first = await get(`/api/signup/confirm/${token}`)
    const second = await get(`/api/signup/confirm/${token}`)

    expect(first.status).toBe(200)
    expect(first.body).toEqual({ state: 'usable', maskedEmail: 'l•••@example.test' })
    expect(second.body).toEqual(first.body)
    expect(scene.signups.all[0]?.status).toBe('unconfirmed')
  })

  it('keeps the token out of every cache and out of every referrer, and out of the index', async () => {
    const { app, token } = await link()
    const { get } = await visitor(app)

    const response = await get(`/api/signup/confirm/${token}`)

    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
  })

  it('answers the same 404 for an unknown token and for one that is not a link at all', async () => {
    const { app } = await link()
    const { get } = await visitor(app)

    const unknown = await get('/api/signup/confirm/nothing')
    const malformed = await get('/api/signup/confirm/%')
    const huge = await get(`/api/signup/confirm/${'a'.repeat(400)}`)

    for (const response of [unknown, malformed, huge]) {
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('signup.confirmationNotFound')
      expect(response.headers['cache-control']).toBe('no-store')
    }
  })

  it('answers 404 feature.unavailable while SIGNUP is off', async () => {
    const { app } = build('off')
    const { get } = await visitor(app)

    const response = await get('/api/signup/confirm/anything')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('feature.unavailable')
  })
})

describe('POST /api/signup/confirm/:token', () => {
  const link = async (mode: SignupMode) => {
    const world = build(mode)
    await world.scene.submit(aForm())
    return { ...world, token: world.scene.lastToken() }
  }

  it('confirms the address and answers next review, with no link in the answer', async () => {
    const { app, scene, token } = await link('review')
    const { post } = await visitor(app)

    const response = await post(`/api/signup/confirm/${token}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ next: 'review' })
    expect(scene.signups.all[0]?.status).toBe('pending')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('opens the account in mode open and answers next mail', async () => {
    const { app, scene, token } = await link('open')
    const { post } = await visitor(app)

    const response = await post(`/api/signup/confirm/${token}`)

    expect(response.body).toEqual({ next: 'mail' })
    expect(scene.signups.all[0]?.status).toBe('approved')
    expect(JSON.stringify(response.body)).not.toContain('http')
  })

  it('answers held when the disk guard keeps the request back', async () => {
    const { app, scene, token } = await link('open')
    scene.disk.set('/data', 0)
    const { post } = await visitor(app)

    const response = await post(`/api/signup/confirm/${token}`)

    expect(response.body).toEqual({ next: 'held' })
  })

  it('answers 404 for a link already spent, and opens no second account', async () => {
    const { app, scene, token } = await link('open')
    const { post } = await visitor(app)

    await post(`/api/signup/confirm/${token}`)
    const again = await post(`/api/signup/confirm/${token}`)

    expect(again.status).toBe(404)
    expect(again.body.error.code).toBe('signup.confirmationNotFound')
    expect(scene.provisioned).toHaveLength(1)
  })

  it('refuses a write without the CSRF token', async () => {
    const { app, token } = await link('review')
    const { agent } = await visitor(app)

    const response = await agent.post(`/api/signup/confirm/${token}`)

    expect(response.status).toBe(403)
  })

  it('answers 404 for a path that is not a link', async () => {
    const { app } = await link('review')
    const { post } = await visitor(app)

    const response = await post('/api/signup/confirm/%')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('signup.confirmationNotFound')
  })

  it('answers 404 feature.unavailable while SIGNUP is off', async () => {
    const { app } = build('off')
    const { post } = await visitor(app)

    const response = await post('/api/signup/confirm/anything')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('feature.unavailable')
  })
})
