import { describe, expect, it } from 'vitest'
import { aUser } from '../../testing/builders'
import { aSignupScene, OPERATOR } from '../../testing/signupScene'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeApproveSignup } from './approveSignup'
import { makeListSignupsForOperator } from './listSignupsForOperator'
import { makeRefuseSignup } from './refuseSignup'
import { CapturingLogger } from '../../testing/capturingLogger'

const DAY = 86_400_000

const setup = (existing: readonly string[] = []) => {
  const scene = aSignupScene()
  const users = new FakeUserRepository().seed(
    ...existing.map((email) => aUser({ id: email, email })),
  )
  const list = makeListSignupsForOperator({ signups: scene.signups, users, clock: scene.clock })
  const approve = makeApproveSignup({
    signups: scene.signups,
    provisionClientOwner: scene.provisionClientOwner,
    audit: scene.audit,
    clock: scene.clock,
  })
  const refuse = makeRefuseSignup({
    signups: scene.signups,
    mailer: scene.mailer,
    audit: scene.audit,
    clock: scene.clock,
    logger: new CapturingLogger(),
    selfHostLink: 'https://docs.example.test/self-host',
    replyTo: null,
  })
  return { scene, list, approve, refuse }
}

const idsOf = (page: { items: readonly { request: { id: string } }[] }): string[] =>
  page.items.map((item) => item.request.id)

describe('listSignupsForOperator', () => {
  it('lists the pending requests newest first, with the badge count', async () => {
    const { scene, list } = setup()
    await scene.seed({
      id: 'a',
      email: 'a@example.test',
      at: new Date(scene.clock.now().getTime() - 2000),
    })
    await scene.seed({
      id: 'b',
      email: 'b@example.test',
      at: new Date(scene.clock.now().getTime() - 1000),
    })

    const result = await list({ status: 'pending' })

    if (!result.ok) throw new Error('expected a page')
    expect(idsOf(result.value)).toEqual(['b', 'a'])
    expect(result.value.pendingCount).toBe(2)
    expect(result.value.next).toBeNull()
  })

  it('never lists an unconfirmed request, nor counts it', async () => {
    const { scene, list } = setup()
    await scene.seed({ id: 'unproven', confirmed: false })

    const result = await list({ status: 'pending' })

    if (!result.ok) throw new Error('expected a page')
    expect(result.value.items).toEqual([])
    expect(result.value.pendingCount).toBe(0)
  })

  it('says whether the address already has an account, read at the moment of listing', async () => {
    const { scene, list } = setup(['known@example.test'])
    await scene.seed({ id: 'a', email: 'known@example.test' })
    await scene.seed({ id: 'b', email: 'new@example.test' })

    const result = await list({ status: 'pending' })

    if (!result.ok) throw new Error('expected a page')
    const byId = Object.fromEntries(
      result.value.items.map((i) => [i.request.id, i.existingAccount]),
    )
    expect(byId).toEqual({ a: true, b: false })
  })

  it('pages with a cursor: limit items, then the next page starts after the last one', async () => {
    const { scene, list } = setup()
    const base = scene.clock.now().getTime()
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
      await scene.seed({ id, email: `${id}@example.test`, at: new Date(base - (3 - i) * 1000) })
    }

    const first = await list({ status: 'pending', limit: 2 })
    if (!first.ok) throw new Error('expected a page')
    expect(idsOf(first.value)).toEqual(['c', 'b'])
    expect(first.value.next).not.toBeNull()
    if (first.value.next === null) return

    const second = await list({ status: 'pending', limit: 2, before: first.value.next })
    if (!second.ok) throw new Error('expected a page')
    expect(idsOf(second.value)).toEqual(['a'])
    expect(second.value.next).toBeNull()
  })

  it('answers no cursor when the page ends exactly at the limit', async () => {
    const { scene, list } = setup()
    await scene.seed({ id: 'a', email: 'a@example.test' })
    await scene.seed({ id: 'b', email: 'b@example.test' })

    const result = await list({ status: 'pending', limit: 2 })

    if (!result.ok) throw new Error('expected a page')
    expect(result.value.items).toHaveLength(2)
    expect(result.value.next).toBeNull()
  })

  it('lists approved and refused requests of the last 30 days, and not older ones', async () => {
    const { scene, list, approve, refuse } = setup()
    await scene.seed({ id: 'ok', email: 'ok@example.test' })
    await scene.seed({ id: 'no', email: 'no@example.test' })
    await approve({ id: 'ok', operator: OPERATOR })
    await refuse({ id: 'no', operator: OPERATOR, notify: false })

    const approved = await list({ status: 'approved' })
    const refused = await list({ status: 'refused' })
    if (!approved.ok || !refused.ok) throw new Error('expected pages')
    expect(idsOf(approved.value)).toEqual(['ok'])
    expect(idsOf(refused.value)).toEqual(['no'])

    scene.clock.advance(31 * DAY)
    const later = await list({ status: 'approved' })
    if (!later.ok) throw new Error('expected a page')
    expect(later.value.items).toEqual([])
  })

  it('does not window pending requests: one that waited 20 days is still there', async () => {
    const { scene, list } = setup()
    await scene.seed({ id: 'old', email: 'old@example.test' })
    scene.clock.advance(20 * DAY)

    const result = await list({ status: 'pending' })

    if (!result.ok) throw new Error('expected a page')
    expect(idsOf(result.value)).toEqual(['old'])
  })

  it.each([0, 101, 1.5, Number.NaN])('refuses a page size of %s', async (limit) => {
    const { list } = setup()

    const result = await list({ status: 'pending', limit })

    if (result.ok) throw new Error('expected a refusal')
    expect(result.error.code).toBe('signup.pageLimitInvalid')
  })

  it('accepts the largest page, 100', async () => {
    const { list } = setup()

    expect((await list({ status: 'pending', limit: 100 })).ok).toBe(true)
  })
})
