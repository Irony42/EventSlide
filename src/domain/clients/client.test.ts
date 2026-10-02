import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import { asClientId } from '../shared/ids'
import type { Result } from '../shared/result'
import { Client, type ClientProps, type NewClient } from './client'
import { ClientCeilings } from './clientCeilings'

const AT = new Date('2026-06-20T21:00:00.000Z')
const ID = asClientId('client-1')

const must = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`fixture rejected: ${result.error.code}`)
  return result.value
}

const aNewClient = (overrides: Partial<NewClient> = {}): NewClient => ({
  name: 'Atelier Photo Camille',
  ...overrides,
})

describe('Client.create', () => {
  it('builds a client from a name alone', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    expect(client.name.value).toBe('Atelier Photo Camille')
    expect(client.id).toBe(ID)
    expect(client.createdAt).toBe(AT)
  })

  it('refuses an invalid name', () => {
    const result = Client.create(aNewClient({ name: '' }), ID, AT)

    expect(!result.ok && result.error.code).toBe('clientName.empty')
  })

  it('starts with no contact on file when none is given', () => {
    const client = must(Client.create(aNewClient({ contactEmail: undefined }), ID, AT))

    expect(client.contactEmail).toBeNull()
  })

  it('starts with no contact on file when explicitly null', () => {
    const client = must(Client.create(aNewClient({ contactEmail: null }), ID, AT))

    expect(client.contactEmail).toBeNull()
  })

  it('parses a contact email', () => {
    const client = must(Client.create(aNewClient({ contactEmail: 'contact@example.test' }), ID, AT))

    expect(client.contactEmail?.value).toBe('contact@example.test')
  })

  it('refuses a malformed contact email', () => {
    const result = Client.create(aNewClient({ contactEmail: 'not-an-email' }), ID, AT)

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })

  it('defaults to unlimited ceilings', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    expect(client.ceilings.maxEvents).toBeNull()
  })

  it('accepts ceilings given up front', () => {
    const ceilings = must(ClientCeilings.create({ maxEvents: 3 }))

    const client = must(Client.create(aNewClient({ ceilings }), ID, AT))

    expect(client.ceilings.maxEvents).toBe(3)
  })

  it('starts the per-period counter at zero', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    expect(client.eventsCreatedInPeriod).toBe(0)
  })

  it('starts with no suspension, no purge date and no retention-cap clock', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    expect(client.suspendedAt).toBeNull()
    expect(client.purgeAfter).toBeNull()
    expect(client.retentionCapSince).toBeNull()
  })

  it('defaults the locale to fr, the system mail language nobody chose', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    expect(client.locale).toBe('fr')
  })

  it('accepts a locale given up front', () => {
    const client = must(Client.create(aNewClient({ locale: 'de' }), ID, AT))

    expect(client.locale).toBe('de')
  })

  it('refuses a locale the catalogue does not have', () => {
    const result = Client.create(aNewClient({ locale: 'pt' }), ID, AT)

    expect(!result.ok && result.error.code).toBe('client.localeInvalid')
  })
})

describe('Client.restore', () => {
  it('rehydrates a row the database already validated', () => {
    const props: ClientProps = {
      id: ID,
      name: must(Client.create(aNewClient(), ID, AT)).name,
      contactEmail: null,
      createdAt: AT,
      suspendedAt: AT,
      purgeAfter: AT,
      retentionCapSince: AT,
      ceilings: ClientCeilings.unlimited(),
      eventsCreatedInPeriod: 4,
      locale: 'es',
    }

    const client = Client.restore(props)

    expect(client.toProps()).toEqual(props)
  })
})

describe('Client.rename', () => {
  it('renames the client', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    const renamed = must(client.rename('Studio Jean'))

    expect(renamed.name.value).toBe('Studio Jean')
  })

  it('refuses an invalid name', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    const result = client.rename('')

    expect(!result.ok && result.error.code).toBe('clientName.empty')
  })
})

describe('Client.setContactEmail', () => {
  it('sets a contact email', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    const updated = must(client.setContactEmail('contact@example.test'))

    expect(updated.contactEmail?.value).toBe('contact@example.test')
  })

  it('clears the contact email', () => {
    const client = must(Client.create(aNewClient({ contactEmail: 'contact@example.test' }), ID, AT))

    const updated = must(client.setContactEmail(null))

    expect(updated.contactEmail).toBeNull()
  })

  it('refuses a malformed contact email', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    const result = client.setContactEmail('not-an-email')

    expect(!result.ok && result.error.code).toBe('email.malformed')
  })
})

describe('Client.withCeilings', () => {
  const clientWithPeriod = (periodStartedAt: Date | null, eventsCreatedInPeriod: number): Client =>
    Client.restore({
      id: ID,
      name: must(Client.create(aNewClient(), ID, AT)).name,
      contactEmail: null,
      createdAt: AT,
      suspendedAt: null,
      purgeAfter: null,
      retentionCapSince: null,
      ceilings: must(ClientCeilings.create({ periodStartedAt })),
      eventsCreatedInPeriod,
      locale: 'fr',
    })

  it('keeps the counter when neither period has started', () => {
    const client = clientWithPeriod(null, 7)

    const updated = client.withCeilings(must(ClientCeilings.create({ maxEvents: 2 })))

    expect(updated.eventsCreatedInPeriod).toBe(7)
  })

  it('keeps the counter when the period instant is unchanged', () => {
    const client = clientWithPeriod(AT, 7)

    const updated = client.withCeilings(must(ClientCeilings.create({ periodStartedAt: AT })))

    expect(updated.eventsCreatedInPeriod).toBe(7)
  })

  it('resets the counter when a period starts for the first time', () => {
    const client = clientWithPeriod(null, 7)

    const updated = client.withCeilings(must(ClientCeilings.create({ periodStartedAt: AT })))

    expect(updated.eventsCreatedInPeriod).toBe(0)
  })

  it('resets the counter when the period is cleared', () => {
    const client = clientWithPeriod(AT, 7)

    const updated = client.withCeilings(must(ClientCeilings.create({ periodStartedAt: null })))

    expect(updated.eventsCreatedInPeriod).toBe(0)
  })

  it('resets the counter on a renewal, a different period instant', () => {
    const client = clientWithPeriod(AT, 7)
    const later = new Date(AT.getTime() + 1_000)

    const updated = client.withCeilings(must(ClientCeilings.create({ periodStartedAt: later })))

    expect(updated.eventsCreatedInPeriod).toBe(0)
  })

  it('replaces the ceilings themselves', () => {
    const client = clientWithPeriod(null, 0)

    const updated = client.withCeilings(must(ClientCeilings.create({ maxEvents: 9 })))

    expect(updated.ceilings.maxEvents).toBe(9)
  })
})

describe('Client lifecycle', () => {
  it('suspends an active client', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    const suspended = client.suspend(AT)

    expect(suspended.suspendedAt).toBe(AT)
    expect(suspended.isSuspended()).toBe(true)
  })

  it('keeps the first suspension instant on a repeated suspend, like Guest.revoke', () => {
    const client = must(Client.create(aNewClient(), ID, AT))
    const suspended = client.suspend(AT)
    const later = new Date(AT.getTime() + 1_000)

    const suspendedAgain = suspended.suspend(later)

    expect(suspendedAgain.suspendedAt).toBe(AT)
  })

  it('reinstates a suspended client', () => {
    const client = must(Client.create(aNewClient(), ID, AT)).suspend(AT)

    const reinstated = client.reinstate()

    expect(reinstated.suspendedAt).toBeNull()
    expect(reinstated.isSuspended()).toBe(false)
  })

  it('is a no-op to reinstate a client that was never suspended', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    const reinstated = client.reinstate()

    expect(reinstated.suspendedAt).toBeNull()
  })

  it('reports an active client as not suspended', () => {
    const client = must(Client.create(aNewClient(), ID, AT))

    expect(client.isSuspended()).toBe(false)
  })
})

describe('Client.equals', () => {
  it('considers two clients with the same id equal', () => {
    const one = must(Client.create(aNewClient(), ID, AT))
    const other = must(Client.create(aNewClient({ name: 'Studio Jean' }), ID, AT))

    expect(one.equals(other)).toBe(true)
  })

  it('considers two clients with different ids unequal', () => {
    const one = must(Client.create(aNewClient(), ID, AT))
    const other = must(Client.create(aNewClient(), asClientId('client-2'), AT))

    expect(one.equals(other)).toBe(false)
  })
})
