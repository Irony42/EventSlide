import { describe, expect, it } from 'vitest'
import { DomainError } from '../../../domain/shared/errors'
import { err } from '../../../domain/shared/result'
import { asClientId, asEventId } from '../../../domain/shared/ids'
import { aClient } from '../../testing/builders'
import { buildSignupScene, DISK_PATH } from '../../testing/signupScene'

const confirmed = async (scene: ReturnType<typeof buildSignupScene>) => {
  await scene.submit()
  return scene.confirm({ token: scene.lastToken() })
}

describe('confirmSignup, mode review', () => {
  it('moves the request to pending, tells the operator, and answers review', async () => {
    const scene = buildSignupScene({ mode: 'review' })

    const result = await confirmed(scene)

    expect(result).toEqual({ ok: true, value: { next: 'review' } })
    expect(scene.signups.all[0]).toMatchObject({ status: 'pending' })
    expect(scene.provisioned).toHaveLength(0)
    expect(scene.mailer.sent.map((mail) => mail.to)).toEqual([
      'lea@example.test',
      'pierre@example.test',
    ])
    expect(scene.mailer.sent[1]?.subject).toContain('1')
  })

  it('does not look at the disk', async () => {
    const scene = buildSignupScene({ mode: 'review' })
    scene.disk.set(DISK_PATH, 0)
    expect(await confirmed(scene)).toEqual({ ok: true, value: { next: 'review' } })
  })
})

describe('confirmSignup, mode open', () => {
  it('opens the account for the system, finalizes the request and answers mail', async () => {
    const scene = buildSignupScene({ mode: 'open' })

    const result = await confirmed(scene)

    expect(result).toEqual({ ok: true, value: { next: 'mail' } })
    expect(scene.provisioned).toEqual([
      {
        clientName: 'Mariage de Lea et Hugo',
        ownerEmail: 'lea@example.test',
        locale: 'fr',
        createdBy: null,
      },
    ])
    expect(scene.signups.all[0]).toMatchObject({
      status: 'approved',
      decidedBy: null,
      clientId: 'client-1',
    })
    expect(scene.mailer.sent.at(-1)?.subject).toContain('nouveau compte')
  })

  it('never puts a link in the answer', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    const result = await confirmed(scene)
    expect(JSON.stringify(result)).not.toContain('http')
  })

  it('holds the request when the free space is under the threshold, and tells the operator', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    // minimum 1 GB + 5 GB for the newcomer
    scene.disk.set(DISK_PATH, 5_999_999_999)

    const result = await confirmed(scene)

    expect(result).toEqual({ ok: true, value: { next: 'held' } })
    expect(scene.signups.all[0]?.status).toBe('pending')
    expect(scene.provisioned).toHaveLength(0)
    expect(scene.mailer.sent.at(-1)?.subject).toContain('à valider')
  })

  it('opens the account at exactly the threshold', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    scene.disk.set(DISK_PATH, 6_000_000_000)
    expect(await confirmed(scene)).toEqual({ ok: true, value: { next: 'mail' } })
  })

  it('adds 5 GB for each client that has an event not yet purged', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    scene.clients.seed(aClient({ id: 'c-1' }), aClient({ id: 'c-2' }))
    scene.clients.linkEvent(asEventId('e-1'), asClientId('c-1'))
    scene.clients.linkEvent(asEventId('e-2'), asClientId('c-2'))
    // 1 GB + 5 GB x (2 clients + the newcomer) = 16 GB
    scene.disk.set(DISK_PATH, 15_999_999_999)

    expect(await confirmed(scene)).toEqual({ ok: true, value: { next: 'held' } })
  })

  it('holds the request when the free space cannot be read', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    scene.disk.set(DISK_PATH, null)

    expect(await confirmed(scene)).toEqual({ ok: true, value: { next: 'held' } })
    expect(scene.signups.all[0]?.status).toBe('pending')
  })

  it('gives the claim back and holds the request when provisioning fails', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    scene.provisioning.next = err(DomainError.conflict('invitation.rateLimited'))

    const result = await confirmed(scene)

    expect(result).toEqual({ ok: true, value: { next: 'held' } })
    expect(scene.signups.all[0]).toMatchObject({ status: 'pending', claimedAt: null })
    expect(scene.logger.find('a signup could not be opened')?.context).toEqual({
      code: 'invitation.rateLimited',
    })
    expect(scene.mailer.sent.at(-1)?.subject).toContain('à valider')
  })

  it('gives the claim back when provisioning throws', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    scene.provisioning.next = 'throw'

    expect(await confirmed(scene)).toEqual({ ok: true, value: { next: 'held' } })
    expect(scene.signups.all[0]?.status).toBe('pending')
    expect(scene.logger.find('a signup could not be opened')?.context).toEqual({
      error: 'storage failed',
    })
  })

  it('logs a thrown value that is not an Error as text', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    scene.provisioning.next = 'throw-text'

    expect(await confirmed(scene)).toEqual({ ok: true, value: { next: 'held' } })
    expect(scene.logger.find('a signup could not be opened')?.context).toEqual({
      error: 'plain text',
    })
  })

  it('finalizes, never exposes the link, and answers held when the invitation mail did not leave', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    scene.provisioning.next = 'link'

    const result = await confirmed(scene)

    expect(result).toEqual({ ok: true, value: { next: 'held' } })
    expect(JSON.stringify(result)).not.toContain('http')
    expect(scene.signups.all[0]?.status).toBe('approved')
    expect(
      scene.logger.find('a signup was opened but its invitation mail did not leave'),
    ).toBeDefined()
  })
})

describe('confirmSignup, every mode', () => {
  it('answers 404 feature.unavailable while SIGNUP is off', async () => {
    const scene = buildSignupScene({ mode: 'off' })
    expect(await scene.confirm({ token: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'feature.unavailable' },
    })
  })

  it('answers 404 for an unknown token', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    expect(await scene.confirm({ token: 'nothing' })).toMatchObject({
      ok: false,
      error: { code: 'signup.confirmationNotFound' },
    })
  })

  it('answers 404 for a link already spent: a second press opens no second account', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    await scene.submit()
    const token = scene.lastToken()
    await scene.confirm({ token })

    expect(await scene.confirm({ token })).toMatchObject({
      ok: false,
      error: { code: 'signup.confirmationNotFound' },
    })
    expect(scene.provisioned).toHaveLength(1)
  })

  it('answers 404 for an expired link', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    await scene.submit()
    const token = scene.lastToken()
    scene.clock.advance(25 * 60 * 60 * 1000)

    expect(await scene.confirm({ token })).toMatchObject({ ok: false })
    expect(scene.provisioned).toHaveLength(0)
  })

  it('answers 404 when the repository finds nothing left to confirm', async () => {
    const scene = buildSignupScene({ mode: 'review' })
    await scene.submit()
    const token = scene.lastToken()
    const real = scene.signups.confirm.bind(scene.signups)
    scene.signups.confirm = async (input) => {
      await real(input)
      return { kind: 'invalid' }
    }
    expect(await scene.confirm({ token })).toMatchObject({
      ok: false,
      error: { code: 'signup.confirmationNotFound' },
    })
  })
})
