import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId } from '../../../domain/shared/ids'
import { asUserId } from '../../../domain/shared/ids'
import type { AuditRecorder } from '../../ports/auditLog'
import { aClient, atPlus } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { makeRenameClient, type RenameClient } from './renameClient'

const CLIENT = asClientId('client-1')
const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const
const NOW = atPlus(86_400_000)

describe('renameClient', () => {
  let clients: FakeClientRepository
  let audit: FakeAuditLog
  let renameClient: RenameClient

  beforeEach(() => {
    clients = new FakeClientRepository().seed(aClient({ id: 'client-1', name: 'Atelier Camille' }))
    audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
    renameClient = makeRenameClient({ clients, audit, clock: new FakeClock(NOW) })
  })

  it('renames the client and stores the new name', async () => {
    const result = await renameClient({ clientId: CLIENT, name: 'Studio Jean', actor: OPERATOR })

    expect(result.ok && result.value.name.value).toBe('Studio Jean')
    expect((await clients.findById(CLIENT))?.name.value).toBe('Studio Jean')
  })

  it('leaves everything but the name as it was', async () => {
    await clients.save(aClient({ id: 'client-1', ceilings: { maxEvents: 4 }, locale: 'it' }))

    await renameClient({ clientId: CLIENT, name: 'Studio Jean', actor: OPERATOR })

    const stored = await clients.findById(CLIENT)
    expect(stored?.ceilings.maxEvents).toBe(4)
    expect(stored?.locale).toBe('it')
  })

  it('answers client.notFound for a client that does not exist', async () => {
    const result = await renameClient({
      clientId: asClientId('ghost'),
      name: 'Studio Jean',
      actor: OPERATOR,
    })

    expect(!result.ok && result.error.code).toBe('client.notFound')
    expect(!result.ok && result.error.kind).toBe('notFound')
  })

  it('refuses an invalid name, and keeps the old one', async () => {
    const result = await renameClient({ clientId: CLIENT, name: '', actor: OPERATOR })

    expect(!result.ok && result.error.code).toBe('clientName.empty')
    expect((await clients.findById(CLIENT))?.name.value).toBe('Atelier Camille')
  })

  describe('the audit trail (roadmap 10.8)', () => {
    it('writes client.renamed, naming the client and who did it, and never the old or the new name', async () => {
      await renameClient({ clientId: CLIENT, name: 'Studio Jean', actor: OPERATOR })

      expect(audit.all()).toEqual([
        {
          seq: 1,
          at: NOW,
          actor: { kind: 'operator', userId: OPERATOR.userId, label: null },
          action: 'client.renamed',
          subject: { type: 'client', id: 'client-1' },
          clientId: CLIENT,
          details: {},
        },
      ])
      expect(JSON.stringify(audit.all())).not.toContain('Camille')
      expect(JSON.stringify(audit.all())).not.toContain('Jean')
    })

    it('writes nothing when the name is the one the client already has, so a restated name is not an act on it', async () => {
      const result = await renameClient({
        clientId: CLIENT,
        name: 'Atelier Camille',
        actor: OPERATOR,
      })

      expect(result.ok).toBe(true)
      expect(audit.all()).toEqual([])
    })

    it('writes nothing for a client that does not exist or a name that is refused', async () => {
      await renameClient({ clientId: asClientId('ghost'), name: 'Studio Jean', actor: OPERATOR })
      await renameClient({ clientId: CLIENT, name: '', actor: OPERATOR })

      expect(audit.all()).toEqual([])
    })

    it('refuses an actor that makes no sense, and renames nothing: no rename without a name behind it', async () => {
      const result = await renameClient({
        clientId: CLIENT,
        name: 'Studio Jean',
        actor: { kind: 'operator' },
      })

      expect(!result.ok && result.error.code).toBe('audit.actorUserRequired')
      expect((await clients.findById(CLIENT))?.name.value).toBe('Atelier Camille')
    })

    it('records before it saves: a failure to write the entry leaves the name as it was', async () => {
      const broken: AuditRecorder = {
        record: async () => {
          throw new Error('disk full')
        },
      }
      const failing = makeRenameClient({ clients, audit: broken, clock: new FakeClock(NOW) })

      await expect(
        failing({ clientId: CLIENT, name: 'Studio Jean', actor: OPERATOR }),
      ).rejects.toThrow('disk full')

      expect((await clients.findById(CLIENT))?.name.value).toBe('Atelier Camille')
    })
  })
})
