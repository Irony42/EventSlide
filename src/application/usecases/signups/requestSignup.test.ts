import { describe, expect, it } from 'vitest'
import { ACCOUNT_TOKEN_LIFETIME_MS } from '../../../domain/users/accountToken'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Mailer } from '../../ports/mailer'
import { FakeMailer } from '../../testing/fakeMailer'
import { ADDRESS, aForm, buildSignupScene, PUBLIC_URL } from '../../testing/signupScene'
import { makeRequestSignup } from './requestSignup'

type Scene = ReturnType<typeof buildSignupScene>

/** The use case over a scene's fakes, with the mailer and the log swapped for what a test needs. */
const rebuild = (scene: Scene, mailer: Mailer, audit: AuditRecorder, maxPerDay: number) =>
  makeRequestSignup({
    mode: 'open',
    signups: scene.signups,
    secrets: scene.secrets,
    mailer,
    ids: scene.ids,
    clock: scene.clock,
    logger: scene.logger,
    audit,
    publicUrl: PUBLIC_URL,
    maxPerDay,
  })

describe('requestSignup', () => {
  it('stores an unconfirmed request and mails one confirmation link, in the language of the page', async () => {
    const scene = buildSignupScene({ mode: 'review' })

    const result = await scene.submit(aForm({ locale: 'en' }))

    expect(result).toMatchObject({ ok: true, value: { status: 'sent' } })
    expect(scene.signups.all).toHaveLength(1)
    expect(scene.signups.all[0]).toMatchObject({ status: 'unconfirmed', locale: 'en' })
    expect(scene.mailer.sent).toHaveLength(1)
    expect(scene.mailer.sent[0]?.to).toBe(ADDRESS)
    expect(scene.mailer.sent[0]?.text).toContain(`${PUBLIC_URL}/signup/confirm/`)
    expect(scene.mailer.sent[0]?.subject).toContain('Confirm')
  })

  it('issues a confirmation token with no account that lives 24 hours', async () => {
    const scene = buildSignupScene()
    await scene.submit()

    const [token] = scene.tokens.all
    expect(token).toMatchObject({ purpose: 'emailVerification', userId: null, delivery: 'mail' })
    expect(token?.expiresAt.getTime()).toBe(
      scene.clock.now().getTime() + ACCOUNT_TOKEN_LIFETIME_MS.emailVerification,
    )
  })

  it('answers 404 feature.unavailable while SIGNUP is off, and writes nothing', async () => {
    const scene = buildSignupScene({ mode: 'off' })

    const result = await scene.submit()

    expect(result).toMatchObject({ ok: false, error: { code: 'feature.unavailable' } })
    expect(scene.signups.all).toHaveLength(0)
    expect(scene.mailer.sent).toHaveLength(0)
  })

  it('answers sent and writes nothing when the honeypot is filled', async () => {
    const scene = buildSignupScene()

    const result = await scene.submit(aForm({ website: 'http://spam.example' }))

    expect(result).toMatchObject({ ok: true, value: { status: 'sent' } })
    expect(scene.signups.all).toHaveLength(0)
    expect(scene.mailer.sent).toHaveLength(0)
  })

  it('refuses a malformed address, and writes nothing', async () => {
    const scene = buildSignupScene()
    const result = await scene.submit(aForm({ email: 'not an address' }))
    expect(result.ok).toBe(false)
    expect(scene.signups.all).toHaveLength(0)
  })

  it('refuses a bad field, and mails nothing', async () => {
    const scene = buildSignupScene()
    const result = await scene.submit(aForm({ clientName: '   ' }))
    expect(result.ok).toBe(false)
    expect(scene.mailer.sent).toHaveLength(0)
  })

  it('answers the same for an address that already has a request waiting, and mails nothing more', async () => {
    const scene = buildSignupScene()
    await scene.submit()
    const second = await scene.submit()

    expect(second).toMatchObject({ ok: true, value: { status: 'sent' } })
    expect(scene.mailer.sent).toHaveLength(1)
    expect(scene.signups.all).toHaveLength(1)
  })

  it('sends a new link after an hour when the first was never confirmed', async () => {
    const scene = buildSignupScene()
    await scene.submit()
    scene.clock.advance(61 * 60 * 1000)

    await scene.submit(aForm({ clientName: 'Autre nom' }))

    expect(scene.mailer.sent).toHaveLength(2)
    expect(scene.signups.all).toHaveLength(1)
    expect(scene.signups.all[0]?.clientName.value).toBe('Autre nom')
  })

  it('answers busy, not sent, once the day ceiling is reached, and records the ceiling once a day', async () => {
    const scene = buildSignupScene({ maxPerDay: 1 })
    await scene.submit(aForm({ email: 'a@example.test' }))

    const busy = await scene.submit(aForm({ email: 'b@example.test' }))
    const busyAgain = await scene.submit(aForm({ email: 'c@example.test' }))

    expect(busy).toMatchObject({ ok: true, value: { status: 'busy' } })
    expect(busyAgain).toMatchObject({ ok: true, value: { status: 'busy' } })
    expect(scene.mailer.sent).toHaveLength(1)
    const lines = scene.audit.all().filter((row) => row.action === 'signup.dailyCeilingReached')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      subject: { type: 'access_request', id: '2026-06-20' },
      actor: { kind: 'system' },
    })
  })

  it('writes the ceiling line again the next day', async () => {
    const scene = buildSignupScene({ maxPerDay: 1 })
    await scene.submit(aForm({ email: 'a@example.test' }))
    await scene.submit(aForm({ email: 'b@example.test' }))
    scene.clock.advance(25 * 60 * 60 * 1000)
    await scene.submit(aForm({ email: 'c@example.test' }))
    await scene.submit(aForm({ email: 'd@example.test' }))

    const days = scene.audit
      .all()
      .filter((row) => row.action === 'signup.dailyCeilingReached')
      .map((row) => row.subject.id)
    expect(days).toEqual(['2026-06-20', '2026-06-21'])
  })

  it('records the ceiling when the request that fills it is accepted', async () => {
    const scene = buildSignupScene({ maxPerDay: 1 })
    await scene.submit()
    expect(scene.audit.all().map((row) => row.action)).toEqual(['signup.dailyCeilingReached'])
  })

  it('does not wait for the mail: the answer is there before the relay is done', async () => {
    const scene = buildSignupScene()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = new FakeMailer()
    const original = slow.send.bind(slow)
    slow.send = async (mail) => {
      await gate
      return original(mail)
    }

    const result = await rebuild(scene, slow, scene.audit, 50)(aForm())

    expect(slow.sent).toHaveLength(0)
    release()
    if (result.ok) await result.value.completion
    expect(slow.sent).toHaveLength(1)
  })

  it('swallows a relay that refuses, logs only a code, and still answers sent', async () => {
    const scene = buildSignupScene()
    scene.mailer.failNextWith('transient')

    const result = await scene.submit()

    expect(result).toMatchObject({ ok: true, value: { status: 'sent' } })
    expect(scene.logger.find('a signup confirmation mail was not sent')?.context).toEqual({
      code: 'mail.transient',
    })
  })

  it('never logs the address, the token or the link', async () => {
    const scene = buildSignupScene()
    scene.mailer.failNextWith('rejected')
    await scene.submit()
    scene.mailer.failNextWith('rejected')
    await scene.submit(aForm({ email: 'second@example.test' }))

    expect(scene.logger.everything).not.toContain('example.test')
    expect(scene.logger.everything).not.toContain('secret-')
  })

  it('logs and swallows a failure inside the completion', async () => {
    const scene = buildSignupScene()
    const failing: AuditRecorder = {
      record: async () => {
        throw new Error('log is locked')
      },
    }

    const result = await rebuild(scene, scene.mailer, failing, 1)(aForm())
    if (result.ok) await result.value.completion

    expect(result.ok).toBe(true)
    expect(scene.logger.find('a signup request failed')?.context).toEqual({
      error: 'log is locked',
    })
  })

  it('logs a failure that is not an Error as text', async () => {
    const scene = buildSignupScene()
    const failing: AuditRecorder = {
      record: async () => {
        throw 'plain text'
      },
    }

    const result = await rebuild(scene, scene.mailer, failing, 1)(aForm())
    if (result.ok) await result.value.completion

    expect(scene.logger.find('a signup request failed')?.context).toEqual({ error: 'plain text' })
  })

  it('logs, and still answers busy, when the day cannot be named in the log', async () => {
    const scene = buildSignupScene({ maxPerDay: 1 })
    // A year with a sign in its ISO form is no id a log line may carry.
    scene.clock.set(new Date('+012000-01-01T10:00:00.000Z'))
    await scene.submit(aForm({ email: 'a@example.test' }))

    const busy = await scene.submit(aForm({ email: 'b@example.test' }))

    expect(busy).toMatchObject({ ok: true, value: { status: 'busy' } })
    expect(scene.logger.find('the daily ceiling could not be recorded')).toBeDefined()
  })

  it('refuses to mail when the token cannot be issued', async () => {
    const scene = buildSignupScene()
    const badSecrets = {
      ...scene.secrets,
      mint: () => ({ token: 't', digest: 'not-a-digest' }),
      digestOf: scene.secrets.digestOf.bind(scene.secrets),
      verify: scene.secrets.verify.bind(scene.secrets),
    }
    const result = await makeRequestSignup({
      mode: 'open',
      signups: scene.signups,
      secrets: badSecrets,
      mailer: scene.mailer,
      ids: scene.ids,
      clock: scene.clock,
      logger: scene.logger,
      audit: scene.audit,
      publicUrl: PUBLIC_URL,
      maxPerDay: 50,
    })(aForm())

    expect(result).toMatchObject({ ok: false, error: { code: 'accountToken.digestInvalid' } })
    expect(scene.signups.all).toHaveLength(0)
  })

  it('logs a code, mails nothing and still answers sent when the mail cannot be written', async () => {
    const scene = buildSignupScene()
    const requestSignup = makeRequestSignup({
      mode: 'open',
      signups: scene.signups,
      secrets: scene.secrets,
      mailer: scene.mailer,
      ids: scene.ids,
      clock: scene.clock,
      logger: scene.logger,
      audit: scene.audit,
      publicUrl: PUBLIC_URL,
      maxPerDay: 50,
      lifetimeHours: 0,
    })

    const result = await requestSignup(aForm())
    if (result.ok) await result.value.completion

    expect(result).toMatchObject({ ok: true, value: { status: 'sent' } })
    expect(scene.mailer.sent).toHaveLength(0)
    expect(scene.logger.find('a signup confirmation mail could not be written')?.context).toEqual({
      code: 'signup.confirmation.lifetimeInvalid',
    })
  })
})
