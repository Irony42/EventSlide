import { describe, expect, it } from 'vitest'
import { SIGNUP_PENDING_EXPIRES_AFTER_DAYS } from '../../../domain/signups/signupRetention'
import type { AuditRecorder } from '../../ports/auditLog'
import { buildSignupScene } from '../../testing/signupScene'
import { makeSweepSignups } from './sweepSignups'

const DAY = 24 * 60 * 60 * 1000

const sweeperOf = (
  scene: ReturnType<typeof buildSignupScene>,
  audit: AuditRecorder = scene.audit,
) =>
  makeSweepSignups({
    signups: scene.signups,
    audit,
    notify: scene.notify,
    clock: scene.clock,
    logger: scene.logger,
  })

const pendingScene = async () => {
  const scene = buildSignupScene({ mode: 'review' })
  await scene.submit()
  await scene.confirm({ token: scene.lastToken() })
  return scene
}

describe('sweepSignups', () => {
  it('erases an unconfirmed request after 48 hours, with no audit line', async () => {
    const scene = buildSignupScene()
    await scene.submit()
    scene.clock.advance(49 * 60 * 60 * 1000)

    const report = await sweeperOf(scene)()

    expect(report).toEqual({ expired: 0, released: 0, erased: 1 })
    expect(scene.signups.all).toHaveLength(0)
    expect(scene.audit.all()).toHaveLength(0)
  })

  it('writes signup.expired with the request id, never the address, for a pending request nobody decided on', async () => {
    const scene = await pendingScene()
    const id = scene.signups.all[0]?.id ?? ''
    scene.clock.advance((SIGNUP_PENDING_EXPIRES_AFTER_DAYS + 1) * DAY)

    const report = await sweeperOf(scene)()

    expect(report).toEqual({ expired: 1, released: 0, erased: 1 })
    expect(scene.audit.all()).toHaveLength(1)
    expect(scene.audit.all()[0]).toMatchObject({
      action: 'signup.expired',
      subject: { type: 'access_request', id },
      actor: { kind: 'system' },
    })
    expect(JSON.stringify(scene.audit.all())).not.toContain('example.test')
  })

  it('keeps a pending request that is still in time', async () => {
    const scene = await pendingScene()
    scene.clock.advance(DAY)

    expect(await sweeperOf(scene)()).toEqual({ expired: 0, released: 0, erased: 0 })
    expect(scene.signups.all).toHaveLength(1)
  })

  it('gives a stale claim back and tells the operator once', async () => {
    const scene = await pendingScene()
    const id = scene.signups.all[0]?.id ?? ''
    await scene.signups.claim(id, scene.clock.now())
    const sentBefore = scene.mailer.sent.length
    scene.clock.advance(2 * 60 * 60 * 1000)

    const report = await sweeperOf(scene)()

    expect(report).toEqual({ expired: 0, released: 1, erased: 0 })
    expect(scene.signups.all[0]?.status).toBe('pending')
    expect(scene.mailer.sent.length).toBe(sentBefore + 1)
  })

  it('goes on with the other expiries when the log refuses one, and says so', async () => {
    const scene = await pendingScene()
    const failing: AuditRecorder = {
      record: async () => {
        throw new Error('log is locked')
      },
    }
    scene.clock.advance((SIGNUP_PENDING_EXPIRES_AFTER_DAYS + 1) * DAY)

    const report = await sweeperOf(scene, failing)()

    expect(report.expired).toBe(1)
    expect(scene.logger.find('a signup expiry could not be recorded')?.context).toEqual({
      error: 'log is locked',
    })
  })

  it('logs a refusal that is not an Error as text', async () => {
    const scene = await pendingScene()
    const failing: AuditRecorder = {
      record: async () => {
        throw 'plain'
      },
    }
    scene.clock.advance((SIGNUP_PENDING_EXPIRES_AFTER_DAYS + 1) * DAY)
    await sweeperOf(scene, failing)()
    expect(scene.logger.find('a signup expiry could not be recorded')?.context).toEqual({
      error: 'plain',
    })
  })

  it('logs an entry the domain refuses (an id that is not an id) and continues', async () => {
    const scene = await pendingScene()
    scene.clock.advance((SIGNUP_PENDING_EXPIRES_AFTER_DAYS + 1) * DAY)
    scene.signups.sweep = async () => ({ expiredIds: ['not an id!'], releasedIds: [], erased: 1 })

    await sweeperOf(scene)()

    expect(scene.logger.find('a signup expiry could not be recorded')?.context).toEqual({
      code: 'audit.subjectIdInvalid',
    })
  })
})
