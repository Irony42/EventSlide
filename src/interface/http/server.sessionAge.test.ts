import { describe, expect, it } from 'vitest'
import { AT, aUser } from '../../application/testing/builders'
import { FakeClock } from '../../application/testing/fakeClock'
import { buildServerHarness } from './testing/serverHarness'
import { signedInAs, signInByAddress } from './testing/signIn'

/**
 * The seven-day cap on a session, through the assembled server (HTTP-L-14, mutant S3).
 *
 * `authz.test.ts` mounts `enforceSessionAge` itself, so it proves the middleware and not that
 * `buildServer` mounts it: removing the mount from `server.ts` was caught only by four
 * second-factor cases about the credentials epoch. Here the clock is the harness's and the
 * session is a real one, signed in through the real route.
 */

const OWNER = '11111111-1111-4111-8111-111111111111'

const aSignedInHost = async () => {
  const clock = new FakeClock(AT)
  const subject = buildServerHarness({
    clock,
    usecases: { authenticateUser: signInByAddress({ 'host@example.test': OWNER }) },
  })
  subject.users.seed(aUser({ id: OWNER, email: 'host@example.test' }))
  const { agent } = await signedInAs(subject.app, 'host@example.test')
  return { clock, agent }
}

describe('the absolute session cap, through buildServer', () => {
  it('lets a session that is almost a week old read who it is', async () => {
    const { clock, agent } = await aSignedInHost()

    // A literal week, not the constant: a cap shortened by mistake must not move the test with it.
    clock.advance(7 * 24 * 60 * 60 * 1000 - 1_000)

    expect((await agent.get('/api/auth/me')).body).toMatchObject({ authenticated: true })
  })

  it('ends a session a week after it was issued, however recently it was used', async () => {
    const { clock, agent } = await aSignedInHost()
    clock.advance(3 * 24 * 60 * 60 * 1000)
    expect((await agent.get('/api/auth/me')).body).toMatchObject({ authenticated: true })

    clock.advance(4 * 24 * 60 * 60 * 1000)

    expect((await agent.get('/api/auth/me')).body).toEqual({ authenticated: false })
  })
})
