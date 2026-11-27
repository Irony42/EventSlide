import { describe, expect, it } from 'vitest'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { CapturingLogger } from '../../testing/capturingLogger'
import { aSignupScene, OPERATOR } from '../../testing/signupScene'
import { makeRefuseSignup } from './refuseSignup'

const CONTACT = (() => {
  const parsed = EmailAddress.create('contact@example.test')
  if (!parsed.ok) throw new Error('fixture rejected')
  return parsed.value
})()

const setup = (replyTo: EmailAddress | null = CONTACT) => {
  const scene = aSignupScene()
  const logger = new CapturingLogger()
  const refuse = makeRefuseSignup({
    signups: scene.signups,
    mailer: scene.mailer,
    audit: scene.audit,
    clock: scene.clock,
    logger,
    selfHostLink: 'https://docs.example.test/self-host',
    replyTo,
  })
  return { scene, logger, refuse }
}

describe('refuseSignup', () => {
  it('refuses a pending request, by the operator, and keeps no reason', async () => {
    const { scene, refuse } = setup()
    const id = await scene.seed()

    const result = await refuse({ id, operator: OPERATOR, notify: false })

    expect(result.ok).toBe(true)
    expect(await scene.signups.findById(id)).toMatchObject({
      status: 'refused',
      decidedBy: OPERATOR,
    })
  })

  it('writes signup.refused with the notify flag, about the request and never the address', async () => {
    const { scene, refuse } = setup()
    const id = await scene.seed()

    await refuse({ id, operator: OPERATOR, notify: true })

    const lines = scene.audit.all()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'signup.refused',
      subject: { type: 'access_request', id },
      actor: { kind: 'operator', userId: OPERATOR },
      clientId: null,
      details: { notified: true },
    })
    expect(JSON.stringify(lines)).not.toContain('camille')
  })

  it('sends the neutral mail in the request’s language, with the guide and the contact as Reply-To, when asked', async () => {
    const { scene, refuse } = setup()
    const id = await scene.seed({ locale: 'en' })

    await refuse({ id, operator: OPERATOR, notify: true })

    expect(scene.mailer.sent).toHaveLength(1)
    const mail = scene.mailer.sent[0]
    expect(mail?.to).toBe('camille@example.test')
    expect(mail?.subject).toBe('Your EventSlide account request')
    expect(mail?.text).toContain('https://docs.example.test/self-host')
    expect(mail?.replyTo).toBe('contact@example.test')
  })

  it('sends no mail when the operator did not ask for one', async () => {
    const { scene, refuse } = setup()
    const id = await scene.seed()

    await refuse({ id, operator: OPERATOR, notify: false })

    expect(scene.mailer.sent).toEqual([])
  })

  it('leaves the mail without a Reply-To when the box names no contact', async () => {
    const { scene, refuse } = setup(null)
    const id = await scene.seed()

    await refuse({ id, operator: OPERATOR, notify: true })

    expect(scene.mailer.sent).toHaveLength(1)
    expect(scene.mailer.sent[0]?.replyTo).toBeNull()
  })

  it('keeps the refusal when the mail does not go, and logs the failure without the address', async () => {
    const { scene, logger, refuse } = setup()
    const id = await scene.seed()
    scene.mailer.failNextWith('transient')

    const result = await refuse({ id, operator: OPERATOR, notify: true })

    expect(result.ok).toBe(true)
    expect((await scene.signups.findById(id))?.status).toBe('refused')
    expect(logger.lines.some((line) => line.message.includes('refusal mail'))).toBe(true)
    expect(JSON.stringify(logger.lines)).not.toContain('camille')
  })

  it('answers 404 signup.notFound for an id nobody holds and for an unproven address, and sends nothing', async () => {
    const { scene, refuse } = setup()
    const unproven = await scene.seed({ confirmed: false })

    for (const id of ['nobody', unproven]) {
      const result = await refuse({ id, operator: OPERATOR, notify: true })
      if (result.ok) throw new Error('expected a refusal')
      expect(result.error.code).toBe('signup.notFound')
    }
    expect(scene.mailer.sent).toEqual([])
    expect(scene.audit.all()).toEqual([])
  })

  it('answers 409 signup.notPending for a request already refused, and mails and logs once', async () => {
    const { scene, refuse } = setup()
    const id = await scene.seed()

    await refuse({ id, operator: OPERATOR, notify: true })
    const again = await refuse({ id, operator: OPERATOR, notify: true })

    if (again.ok) throw new Error('expected a conflict')
    expect(again.error.code).toBe('signup.notPending')
    expect(scene.mailer.sent).toHaveLength(1)
    expect(scene.audit.all()).toHaveLength(1)
  })
})
