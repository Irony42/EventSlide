import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId } from '../../../domain/shared/ids'
import { AT } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeCreateClient, type CreateClient } from './createClient'

describe('createClient', () => {
  let clients: FakeClientRepository
  let createClient: CreateClient

  beforeEach(() => {
    clients = new FakeClientRepository()
    createClient = makeCreateClient({
      clients,
      ids: new SequentialIdGenerator(),
      clock: new FakeClock(AT),
    })
  })

  it('creates a client and stores it, so it can be read back', async () => {
    const result = await createClient({ name: 'Atelier Photo Camille' })

    expect(result.ok && result.value.id).toBe('client-1')
    expect((await clients.findById(asClientId('client-1')))?.name.value).toBe(
      'Atelier Photo Camille',
    )
  })

  it('stamps the creation instant from the injected clock', async () => {
    const result = await createClient({ name: 'Atelier Photo Camille' })

    expect(result.ok && result.value.createdAt).toEqual(AT)
  })

  it('starts with no member, because an owner arrives by invitation and not by being typed in', async () => {
    await createClient({ name: 'Atelier Photo Camille' })

    // The port has no "list the members of a client", and emptiness is what it can state:
    // a client with a member would refuse this delete.
    expect(await clients.deleteIfEmpty(asClientId('client-1'))).toBe(true)
  })

  it('starts with every ceiling unlimited when none is given', async () => {
    const result = await createClient({ name: 'Atelier Photo Camille' })

    expect(result.ok && result.value.ceilings.maxEvents).toBeNull()
    expect(result.ok && result.value.ceilings.allowsOpening()).toBe(true)
  })

  it('applies the ceilings the operator chose', async () => {
    const result = await createClient({
      name: 'Atelier Photo Camille',
      ceilings: { maxEvents: 3, liveAllowed: false },
    })

    expect(result.ok && result.value.ceilings.maxEvents).toBe(3)
    expect(result.ok && result.value.ceilings.allowsOpening()).toBe(false)
  })

  it('keeps the contact email and the locale it was given', async () => {
    const result = await createClient({
      name: 'Atelier Photo Camille',
      contactEmail: 'contact@example.test',
      locale: 'de',
    })

    expect(result.ok && result.value.contactEmail?.value).toBe('contact@example.test')
    expect(result.ok && result.value.locale).toBe('de')
  })

  it('defaults the contact to none and the locale to fr', async () => {
    const result = await createClient({ name: 'Atelier Photo Camille' })

    expect(result.ok && result.value.contactEmail).toBeNull()
    expect(result.ok && result.value.locale).toBe('fr')
  })

  it('refuses an invalid name, and stores nothing', async () => {
    const result = await createClient({ name: '   ' })

    expect(!result.ok && result.error.code).toBe('clientName.empty')
    expect((await clients.list({ limit: 10 })).items).toEqual([])
  })

  it('refuses a ceiling outside the catalogue bounds, and stores nothing', async () => {
    const result = await createClient({
      name: 'Atelier Photo Camille',
      ceilings: { maxRetentionDays: 3651 },
    })

    expect(!result.ok && result.error.code).toBe('clientCeilings.maxRetentionDaysInvalid')
    expect((await clients.list({ limit: 10 })).items).toEqual([])
  })

  it('refuses a malformed contact email, and stores nothing', async () => {
    const result = await createClient({ name: 'Atelier Photo Camille', contactEmail: 'nope' })

    expect(!result.ok && result.error.code).toBe('email.malformed')
    expect((await clients.list({ limit: 10 })).items).toEqual([])
  })

  it('refuses a locale the catalogue does not have, and stores nothing', async () => {
    const result = await createClient({ name: 'Atelier Photo Camille', locale: 'pt' })

    expect(!result.ok && result.error.code).toBe('client.localeInvalid')
    expect((await clients.list({ limit: 10 })).items).toEqual([])
  })

  it('gives two clients two different ids', async () => {
    const first = await createClient({ name: 'Atelier Photo Camille' })
    const second = await createClient({ name: 'Studio Jean' })

    expect(first.ok && second.ok && first.value.id !== second.value.id).toBe(true)
  })
})
