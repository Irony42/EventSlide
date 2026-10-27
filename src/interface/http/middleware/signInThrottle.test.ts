import { EventEmitter } from 'node:events'
import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { AT } from '../../../application/testing/builders'
import { silentLogger } from '../../../application/testing/capturingLogger'
import { FakeClock } from '../../../application/testing/fakeClock'
import { STUFFING_FAILURES_PER_HOUR } from '../../../domain/users/signInThrottle'
import { signInThrottle } from './signInThrottle'

/**
 * The one line of the throttle that the route tests cannot reach: a held attempt whose caller
 * has gone (HTTP-L-14, mutant I2). Once an account has taken a hundred failures in an hour the
 * attempt is held for a moment, never refused; if the caller gave up in the meantime the request
 * must not go on to a password comparison nobody is waiting for. The attempt stays counted.
 */

const fakeResponse = (): Response =>
  Object.assign(new EventEmitter(), { statusCode: 200, destroyed: false }) as unknown as Response

const requestFrom = (ip: string): Request => ({ body: {}, ip, headers: {} }) as unknown as Request

describe('signInThrottle: an attempt that is held', () => {
  const aThrottle = (hold: (ms: number) => Promise<void>) =>
    signInThrottle({
      addressOf: () => 'camille@example.test',
      counts: 'failures',
      alert: 'sign-in: an account is being stuffed',
      clock: new FakeClock(AT),
      logger: silentLogger(),
      secret: 'a-secret-long-enough-for-the-digest',
      hold,
    })

  /** A hundred wrong guesses on one account, each from its own network so none is waited out. */
  const stuff = async (throttle: ReturnType<typeof aThrottle>): Promise<void> => {
    for (let guess = 0; guess < STUFFING_FAILURES_PER_HOUR; guess += 1) {
      const res = fakeResponse()
      const next = vi.fn()
      throttle(
        requestFrom(`10.0.${Math.floor(guess / 250)}.${guess % 250}`),
        res,
        next as NextFunction,
      )
      await vi.waitFor(() => expect(next).toHaveBeenCalled())
      Object.assign(res, { statusCode: 401 })
      res.emit('finish')
    }
  }

  it('goes on to the sign-in after the hold when the caller is still there', async () => {
    const held: number[] = []
    const throttle = aThrottle(async (ms) => {
      held.push(ms)
    })
    await stuff(throttle)
    held.length = 0
    const next = vi.fn()

    throttle(requestFrom('192.0.2.1'), fakeResponse(), next as NextFunction)
    await vi.waitFor(() => expect(next).toHaveBeenCalled())

    expect(held).toHaveLength(1)
    expect(held[0]).toBeGreaterThan(0)
  })

  it('does not go on once the caller gave up while it was held', async () => {
    let giveUp = false
    const res = fakeResponse()
    const throttle = aThrottle(async () => {
      if (giveUp) Object.assign(res, { destroyed: true })
    })
    await stuff(throttle)
    giveUp = true
    const next = vi.fn()

    throttle(requestFrom('192.0.2.2'), res, next as NextFunction)
    await vi.waitFor(() => expect(res.destroyed).toBe(true))
    await new Promise((resolve) => setImmediate(resolve))

    expect(next).not.toHaveBeenCalled()
  })
})
