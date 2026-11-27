import { describe, expect, it } from 'vitest'
import { asClientId, asEventId } from '../../../domain/shared/ids'
import type { AuditRecorder } from '../../ports/auditLog'
import type { SignupRepository } from '../../ports/signupRepository'
import { aClient } from '../../testing/builders'
import { aForm, buildSignupScene, DISK_PATH, PUBLIC_URL } from '../../testing/signupScene'
import { makeConfirmSignup } from './confirmSignup'
import { makeRequestSignup } from './requestSignup'

type Scene = ReturnType<typeof buildSignupScene>

const requestOver = (
  scene: Scene,
  signups: Pick<SignupRepository, 'admit' | 'issuedSince'>,
  extra: { audit?: AuditRecorder; maxPerDay?: number } = {},
) =>
  makeRequestSignup({
    mode: 'open',
    signups,
    secrets: scene.secrets,
    mailer: scene.mailer,
    ids: scene.ids,
    clock: scene.clock,
    logger: scene.logger,
    audit: extra.audit ?? scene.audit,
    publicUrl: PUBLIC_URL,
    maxPerDay: extra.maxPerDay ?? 50,
  })

describe('requestSignup: nothing that depends on the address is on the response path', () => {
  it('answers before the admission is done: admit is behind the completion', async () => {
    const scene = buildSignupScene()
    let admitCalled = false
    const never = new Promise<never>(() => undefined)
    const request = requestOver(scene, {
      issuedSince: async () => 0,
      admit: () => {
        admitCalled = true
        return never
      },
    })

    const result = await request(aForm())

    expect(result).toMatchObject({ ok: true, value: { status: 'sent' } })
    expect(admitCalled).toBe(true)
    expect(scene.mailer.sent).toHaveLength(0)
  })

  it('reads the same box-wide count for a honeypot, a stranger and a malformed address', async () => {
    const scene = buildSignupScene()
    let reads = 0
    const request = requestOver(scene, {
      issuedSince: async () => {
        reads += 1
        return 0
      },
      admit: scene.signups.admit.bind(scene.signups),
    })

    await request(aForm({ website: 'bot' }))
    await request(aForm())
    await request(aForm({ email: 'not an address' }))

    expect(reads).toBe(3)
  })

  it('answers busy from the pre-check alone, without admitting anything', async () => {
    const scene = buildSignupScene()
    let admitted = 0
    const request = requestOver(
      scene,
      {
        issuedSince: async () => 5,
        admit: async () => {
          admitted += 1
          return { outcome: 'created', issuedToday: 6 }
        },
      },
      { maxPerDay: 5 },
    )

    const result = await request(aForm())

    expect(result).toMatchObject({ ok: true, value: { status: 'busy' } })
    expect(admitted).toBe(0)
  })

  it('answers busy for a honeypot over the ceiling too: the answer is the same for everybody', async () => {
    const scene = buildSignupScene()
    const request = requestOver(
      scene,
      { issuedSince: async () => 9, admit: scene.signups.admit.bind(scene.signups) },
      { maxPerDay: 9 },
    )
    expect(await request(aForm({ website: 'bot' }))).toMatchObject({ value: { status: 'busy' } })
  })

  it('sends nothing, and writes the ceiling line, when the ceiling is reached between the pre-check and the admission', async () => {
    const scene = buildSignupScene({ maxPerDay: 1 })
    await scene.submit(aForm({ email: 'first@example.test' }))
    const sentBefore = scene.mailer.sent.length
    // The pre-check is stale (a race): it says there is room, the transaction says there is none.
    const request = requestOver(
      scene,
      { issuedSince: async () => 0, admit: scene.signups.admit.bind(scene.signups) },
      { maxPerDay: 1 },
    )

    const result = await request(aForm({ email: 'second@example.test' }))
    if (result.ok) await result.value.completion

    expect(result).toMatchObject({ ok: true, value: { status: 'sent' } })
    expect(scene.mailer.sent).toHaveLength(sentBefore)
    expect(scene.signups.all.map((row) => row.email.value)).not.toContain('second@example.test')
    // One line from the first request (its own instance saw the ceiling reached) and one from the race.
    expect(
      scene.audit.all().filter((row) => row.action === 'signup.dailyCeilingReached'),
    ).toHaveLength(2)
  })

  it('tries the ceiling line again when the log refused it: the day is marked only once it is written', async () => {
    const scene = buildSignupScene({ maxPerDay: 1 })
    let calls = 0
    const flaky: AuditRecorder = {
      record: async (entry) => {
        calls += 1
        if (calls === 1) throw new Error('log is locked')
        await scene.audit.record(entry)
      },
    }
    const request = requestOver(scene, scene.signups, { audit: flaky, maxPerDay: 1 })

    const first = await request(aForm({ email: 'a@example.test' }))
    if (first.ok) await first.value.completion
    const second = await request(aForm({ email: 'b@example.test' }))
    if (second.ok) await second.value.completion

    expect(calls).toBe(2)
    expect(scene.audit.all().map((row) => row.action)).toEqual(['signup.dailyCeilingReached'])
  })

  it('writes no address in the ceiling line', async () => {
    const scene = buildSignupScene({ maxPerDay: 1 })
    await scene.submit(aForm({ email: 'private@example.test' }))
    expect(JSON.stringify(scene.audit.all())).not.toContain('example.test')
    expect(JSON.stringify(scene.audit.all())).not.toContain('private')
  })
})

describe('confirmSignup: what can go wrong after the account exists', () => {
  const open = async (scene: Scene) => {
    await scene.submit()
    return scene.lastToken()
  }

  const confirmWith = (scene: Scene, signups: Partial<SignupRepository>) =>
    makeConfirmSignup({
      mode: 'open',
      signups: {
        peekConfirmation: scene.signups.peekConfirmation.bind(scene.signups),
        confirm: scene.signups.confirm.bind(scene.signups),
        release: scene.signups.release.bind(scene.signups),
        finalize: scene.signups.finalize.bind(scene.signups),
        ...signups,
      },
      secrets: scene.secrets,
      provisionClientOwner: scene.provisionClientOwner,
      clients: scene.clients,
      disk: scene.disk,
      diskPaths: [DISK_PATH],
      minFreeDiskBytes: 1_000_000_000,
      notify: scene.notify,
      clock: scene.clock,
      logger: scene.logger,
    })

  it('answers held, logs the client id and tells the operator when finalize says no', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    const token = await open(scene)

    const result = await confirmWith(scene, { finalize: async () => false })({ token })
    if (result.ok) await result.value.completion

    expect(result).toMatchObject({ ok: true, value: { next: 'held' } })
    expect(
      scene.logger.find('a signup account was opened but its request was not finalized')?.context,
    ).toEqual({
      clientId: 'client-1',
    })
    expect(scene.mailer.sent.at(-1)?.to).toBe('pierre@example.test')
    expect(scene.mailer.sent.at(-1)?.subject).toContain('à valider')
    expect(scene.logger.everything).not.toContain('lea@example.test')
  })

  it('answers held, logs the client id and the error, and tells the operator when finalize throws', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    const token = await open(scene)

    const result = await confirmWith(scene, {
      finalize: async () => {
        throw new Error('database is locked')
      },
    })({ token })
    if (result.ok) await result.value.completion

    expect(result).toMatchObject({ ok: true, value: { next: 'held' } })
    expect(
      scene.logger.find('a signup account was opened but its request could not be finalized')
        ?.context,
    ).toEqual({ clientId: 'client-1', error: 'database is locked' })
    expect(scene.mailer.sent.at(-1)?.subject).toContain('à valider')
  })

  it('still answers held when the claim cannot be given back, and says so', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    const token = await open(scene)
    scene.provisioning.next = 'throw'

    const result = await confirmWith(scene, {
      release: async () => {
        throw new Error('database is locked')
      },
    })({ token })
    if (result.ok) await result.value.completion

    expect(result).toMatchObject({ ok: true, value: { next: 'held' } })
    expect(scene.logger.find('a signup claim could not be given back')?.context).toEqual({
      error: 'database is locked',
    })
  })

  it('tells the operator when the invitation mail did not leave, and the answer stays held', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    const token = await open(scene)
    scene.provisioning.next = 'link'

    const result = await scene.confirm({ token })

    expect(result).toMatchObject({ ok: true, value: { next: 'held' } })
    expect(scene.mailer.sent.at(-1)?.to).toBe('pierre@example.test')
    expect(scene.mailer.sent.at(-1)?.subject).toContain('à valider')
    expect(
      scene.logger.find('a signup was opened but its invitation mail did not leave')?.context,
    ).toEqual({
      clientId: 'client-1',
    })
  })

  it('does not wait for the operator notice: the answer is there before the relay is done', async () => {
    const scene = buildSignupScene({ mode: 'review' })
    const token = await open(scene)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = Object.assign(
      async () => {
        await gate
      },
      { flush: async () => undefined },
    )
    const confirm = makeConfirmSignup({
      mode: 'review',
      signups: scene.signups,
      secrets: scene.secrets,
      provisionClientOwner: scene.provisionClientOwner,
      clients: scene.clients,
      disk: scene.disk,
      diskPaths: [DISK_PATH],
      minFreeDiskBytes: 0,
      notify: slow,
      clock: scene.clock,
      logger: scene.logger,
    })

    const result = await confirm({ token })

    expect(result).toMatchObject({ ok: true, value: { next: 'review' } })
    release()
    if (result.ok) await result.value.completion
  })
})

describe('confirmSignup: the disk guard counts the fresh accounts', () => {
  it('reserves 5 GB for a client created in the last 30 days that has no event yet', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    scene.clients.seed(aClient({ id: 'fresh', createdAt: scene.clock.now() }))
    // 1 GB + 5 GB x (1 fresh client + the newcomer) = 11 GB
    scene.disk.set(DISK_PATH, 10_999_999_999)
    await scene.submit()

    expect(await scene.confirm({ token: scene.lastToken() })).toMatchObject({
      value: { next: 'held' },
    })
  })

  it('does not count an old client with no event', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    scene.clients.seed(aClient({ id: 'old', createdAt: new Date('2020-01-01T00:00:00.000Z') }))
    scene.disk.set(DISK_PATH, 6_000_000_000)
    await scene.submit()

    expect(await scene.confirm({ token: scene.lastToken() })).toMatchObject({
      value: { next: 'mail' },
    })
  })

  it('counts a client with an event once even when it is also fresh', async () => {
    const scene = buildSignupScene({ mode: 'open' })
    scene.clients.seed(aClient({ id: 'both', createdAt: scene.clock.now() }))
    scene.clients.linkEvent(asEventId('e-1'), asClientId('both'))
    scene.disk.set(DISK_PATH, 11_000_000_000)
    await scene.submit()

    expect(await scene.confirm({ token: scene.lastToken() })).toMatchObject({
      value: { next: 'mail' },
    })
  })
})
