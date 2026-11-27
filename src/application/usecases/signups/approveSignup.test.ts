import { describe, expect, it } from 'vitest'
import { CapturingLogger } from '../../testing/capturingLogger'
import { aSignupScene, CLIENT, OPERATOR } from '../../testing/operatorSignupScene'
import { makeApproveSignup } from './approveSignup'

const setup = () => {
  const scene = aSignupScene()
  const logger = new CapturingLogger()
  const build = (signups: Parameters<typeof makeApproveSignup>[0]['signups'] = scene.signups) =>
    makeApproveSignup({
      signups,
      provisionClientOwner: scene.provisionClientOwner,
      audit: scene.audit,
      clock: scene.clock,
      logger,
    })
  return { scene, logger, approve: build(), build }
}

describe('approveSignup', () => {
  it('opens the client for the request, with the operator as its creator, and marks the request approved', async () => {
    const { scene, approve } = setup()
    const id = await scene.seed()

    const result = await approve({ id, operator: OPERATOR })

    expect(result.ok).toBe(true)
    expect(scene.provisioned).toEqual([
      {
        clientName: 'Mariage de Léa',
        ownerEmail: 'camille@example.test',
        locale: 'fr',
        createdBy: OPERATOR,
      },
    ])
    const stored = await scene.signups.findById(id)
    expect(stored).toMatchObject({
      status: 'approved',
      decidedBy: OPERATOR,
      clientId: CLIENT,
      invitationTokenId: 'invitation-1',
    })
  })

  it('hands the operator’s ceilings to the provisioning, and leaves the key out when there are none', async () => {
    const { scene, approve } = setup()
    const id = await scene.seed()

    await approve({ id, operator: OPERATOR, ceilings: { maxEvents: 3, maxTotalBytes: null } })

    expect(scene.provisioned[0]?.ceilings).toEqual({ maxEvents: 3, maxTotalBytes: null })
  })

  it('writes signup.approved about the request, by the operator, with nothing a stranger typed', async () => {
    const { scene, approve } = setup()
    const id = await scene.seed()

    await approve({ id, operator: OPERATOR })

    const lines = scene.audit.all()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'signup.approved',
      subject: { type: 'access_request', id },
      actor: { kind: 'operator', userId: OPERATOR },
      clientId: null,
      details: {},
    })
    expect(JSON.stringify(lines)).not.toContain('camille')
    expect(JSON.stringify(lines)).not.toContain('Mariage')
  })

  it('answers 404 signup.notFound for an id nobody holds, and provisions nothing', async () => {
    const { scene, approve } = setup()

    const result = await approve({ id: 'nobody', operator: OPERATOR })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('signup.notFound')
    expect(scene.provisioned).toEqual([])
  })

  it('answers 404 signup.notFound for a request whose address nobody proved', async () => {
    const { scene, approve } = setup()
    const id = await scene.seed({ confirmed: false })

    const result = await approve({ id, operator: OPERATOR })

    if (result.ok) throw new Error('expected a refusal')
    expect(result.error.code).toBe('signup.notFound')
    expect(scene.provisioned).toEqual([])
    expect((await scene.signups.findById(id))?.status).toBe('unconfirmed')
  })

  it('answers 409 signup.notPending to the second of two approvals, and provisions once', async () => {
    const { scene, approve } = setup()
    const id = await scene.seed()

    const first = await approve({ id, operator: OPERATOR })
    const second = await approve({ id, operator: OPERATOR })

    expect(first.ok).toBe(true)
    if (second.ok) throw new Error('expected a conflict')
    expect(second.error.code).toBe('signup.notPending')
    expect(second.error.kind).toBe('conflict')
    expect(scene.provisioned).toHaveLength(1)
    expect(scene.audit.all()).toHaveLength(1)
  })

  it('gives the claim back when the provisioning is refused, hands the error up, and writes no line', async () => {
    const { scene, approve } = setup()
    const id = await scene.seed()
    scene.failProvisioning()

    const result = await approve({ id, operator: OPERATOR })

    if (result.ok) throw new Error('expected the provisioning error')
    expect(result.error.code).toBe('invitation.tooManyForAddress')
    expect((await scene.signups.findById(id))?.status).toBe('pending')
    expect(scene.audit.all()).toEqual([])
  })

  it('gives the claim back when the provisioning throws, and lets the failure through', async () => {
    const { scene, approve } = setup()
    const id = await scene.seed()
    scene.throwInProvisioning()

    await expect(approve({ id, operator: OPERATOR })).rejects.toThrow('storage failed')

    expect((await scene.signups.findById(id))?.status).toBe('pending')
  })

  it('can be retried after a refused provisioning', async () => {
    const { scene, approve } = setup()
    const id = await scene.seed()
    scene.failProvisioning()
    await approve({ id, operator: OPERATOR })
    scene.provisioningWorksAgain()

    const retried = await approve({ id, operator: OPERATOR })

    expect(retried.ok).toBe(true)
    expect((await scene.signups.findById(id))?.status).toBe('approved')
  })

  it('refuses to report success when its line cannot be named (an id the log would not take), after the act', async () => {
    const { scene, approve } = setup()
    const id = await scene.seed({ id: 'an id with spaces' })

    const result = await approve({ id, operator: OPERATOR })

    if (result.ok) throw new Error('expected the log refusal')
    expect(result.error.code).toBe('audit.subjectIdInvalid')
    expect((await scene.signups.findById(id))?.status).toBe('approved')
  })

  it('answers 409 signup.notPending once the request is 30 days old: the retention window is closed', async () => {
    const { scene, approve } = setup()
    const id = await scene.seed()
    scene.clock.advance(31 * 86_400_000)

    const result = await approve({ id, operator: OPERATOR })

    if (result.ok) throw new Error('expected a conflict')
    expect(result.error.code).toBe('signup.notPending')
    expect((await scene.signups.findById(id))?.status).toBe('pending')
  })

  it('answers 409 signup.notPending, logs the orphan client without the address, and writes no line when the claim was lost before finalizing', async () => {
    const { scene, logger, build } = setup()
    const id = await scene.seed()
    const approve = build({
      findById: (key) => scene.signups.findById(key),
      claim: (key, at) => scene.signups.claim(key, at),
      release: (key, at) => scene.signups.release(key, at),
      finalize: async () => false,
    })

    const result = await approve({ id, operator: OPERATOR })

    if (result.ok) throw new Error('expected a conflict')
    expect(result.error.code).toBe('signup.notPending')
    expect(scene.audit.all()).toEqual([])
    const warning = logger.lines.find((line) => line.message.includes('orphan client'))
    expect(warning?.context).toEqual({ signupId: id, clientId: CLIENT })
    expect(JSON.stringify(logger.lines)).not.toContain('camille')
  })

  it('keeps the provisioning failure when giving the claim back throws', async () => {
    const { scene, logger, build } = setup()
    const id = await scene.seed()
    scene.failProvisioning()
    const approve = build({
      findById: (key) => scene.signups.findById(key),
      claim: (key, at) => scene.signups.claim(key, at),
      release: async () => {
        throw new Error('storage down')
      },
      finalize: (key, finalization) => scene.signups.finalize(key, finalization),
    })

    const result = await approve({ id, operator: OPERATOR })

    if (result.ok) throw new Error('expected the provisioning error')
    expect(result.error.code).toBe('invitation.tooManyForAddress')
    expect(logger.lines.some((line) => line.message.includes('could not be given back'))).toBe(true)
  })

  it('keeps the thrown failure, not the release’s, when both fail', async () => {
    const { scene, build } = setup()
    const id = await scene.seed()
    scene.throwInProvisioning()
    const approve = build({
      findById: (key) => scene.signups.findById(key),
      claim: (key, at) => scene.signups.claim(key, at),
      release: async () => {
        throw new Error('release failed')
      },
      finalize: (key, finalization) => scene.signups.finalize(key, finalization),
    })

    await expect(approve({ id, operator: OPERATOR })).rejects.toThrow('storage failed')
  })

  it('logs a release that finds the claim no longer ours, and still answers the provisioning error', async () => {
    const { scene, logger, build } = setup()
    const id = await scene.seed()
    scene.failProvisioning()
    const approve = build({
      findById: (key) => scene.signups.findById(key),
      claim: (key, at) => scene.signups.claim(key, at),
      release: async () => false,
      finalize: (key, finalization) => scene.signups.finalize(key, finalization),
    })

    const result = await approve({ id, operator: OPERATOR })

    if (result.ok) throw new Error('expected the provisioning error')
    expect(result.error.code).toBe('invitation.tooManyForAddress')
    expect(
      logger.lines.filter((line) => line.message.includes('could not be given back')),
    ).toHaveLength(1)
  })
})
