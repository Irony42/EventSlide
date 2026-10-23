import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asUserId } from '../../../domain/shared/ids'
import type { AuditRecorder } from '../../ports/auditLog'
import { AT, aClient, atPlus } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { makeResumeClient, type ResumeClient } from './resumeClient'
import { makeSuspendClient, type SuspendClient } from './suspendClient'

/**
 * Freezing a client and lifting it (G2-14 / P3-13, roadmap §10.7). What a suspension does at the
 * surfaces is held where the surfaces are (`suspension.container.test.ts`, the entity's own
 * predicates, the gallery and the stream); what is held **here** is the act: audited, write-ahead,
 * idempotent, and nothing else changed.
 */

const CLIENT = asClientId('client-1')
const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const
const NOW = atPlus(86_400_000)

describe('suspendClient and resumeClient', () => {
  let clients: FakeClientRepository
  let audit: FakeAuditLog
  let suspend: SuspendClient
  let resume: ResumeClient

  beforeEach(() => {
    clients = new FakeClientRepository().seed(
      aClient({ id: 'client-1', ceilings: { maxEvents: 3 }, eventsCreatedInPeriod: 2 }),
    )
    audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
    const clock = new FakeClock(NOW)
    suspend = makeSuspendClient({ clients, audit, clock })
    resume = makeResumeClient({ clients, audit, clock })
  })

  const standing = async () => (await clients.findById(CLIENT))?.suspendedAt ?? null

  describe('suspendClient', () => {
    it('freezes the client at the injected instant and writes one line naming the client and who did it', async () => {
      const result = await suspend({ clientId: CLIENT, actor: OPERATOR })

      expect(result.ok).toBe(true)
      expect(await standing()).toEqual(NOW)
      expect(audit.all()).toEqual([
        {
          seq: 1,
          at: NOW,
          actor: { kind: 'operator', userId: OPERATOR.userId, label: null },
          action: 'client.suspended',
          subject: { type: 'client', id: 'client-1' },
          clientId: CLIENT,
          details: {},
        },
      ])
    })

    it('changes nothing but the one column: the ceilings, the counter and the name are as they were', async () => {
      await suspend({ clientId: CLIENT, actor: OPERATOR })

      const stored = await clients.findById(CLIENT)
      expect(stored?.ceilings.maxEvents).toBe(3)
      expect(stored?.eventsCreatedInPeriod).toBe(2)
      expect(stored?.name.value).toBe('Atelier Photo Camille')
    })

    it('is idempotent: a second suspension keeps the first instant and writes no second line', async () => {
      await suspend({ clientId: CLIENT, actor: OPERATOR })
      const later = makeSuspendClient({
        clients,
        audit,
        clock: new FakeClock(atPlus(2 * 86_400_000)),
      })

      const again = await later({ clientId: CLIENT, actor: OPERATOR })

      expect(again.ok).toBe(true)
      expect(await standing()).toEqual(NOW)
      expect(audit.all()).toHaveLength(1)
    })

    it('answers client.notFound for a client that does not exist, and writes nothing', async () => {
      const result = await suspend({ clientId: asClientId('ghost'), actor: OPERATOR })

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'notFound',
        'client.notFound',
      ])
      expect(audit.all()).toEqual([])
    })

    it('refuses an actor that makes no sense, and freezes nothing: no suspension without a name behind it', async () => {
      const result = await suspend({ clientId: CLIENT, actor: { kind: 'operator' } })

      expect(!result.ok && result.error.code).toBe('audit.actorUserRequired')
      expect(await standing()).toBeNull()
    })

    it('records before it saves: a failure to write the line leaves the client unfrozen', async () => {
      const broken: AuditRecorder = {
        record: async () => {
          throw new Error('disk full')
        },
      }
      const failing = makeSuspendClient({ clients, audit: broken, clock: new FakeClock(NOW) })

      await expect(failing({ clientId: CLIENT, actor: OPERATOR })).rejects.toThrow('disk full')

      expect(await standing()).toBeNull()
    })
  })

  describe('resumeClient', () => {
    beforeEach(async () => {
      await suspend({ clientId: CLIENT, actor: OPERATOR })
    })

    it('lifts the suspension and writes one line, and the ceilings are as they were before it', async () => {
      const result = await resume({ clientId: CLIENT, actor: OPERATOR })

      expect(result.ok).toBe(true)
      expect(await standing()).toBeNull()
      expect(audit.all().map((record) => record.action)).toEqual([
        'client.suspended',
        'client.resumed',
      ])
      expect((await clients.findById(CLIENT))?.ceilings.maxEvents).toBe(3)
    })

    it('is idempotent: resuming a client that is not suspended changes nothing and writes no line', async () => {
      await resume({ clientId: CLIENT, actor: OPERATOR })
      await resume({ clientId: CLIENT, actor: OPERATOR })

      expect(audit.all().map((record) => record.action)).toEqual([
        'client.suspended',
        'client.resumed',
      ])
    })

    it('answers client.notFound for a client that does not exist', async () => {
      const result = await resume({ clientId: asClientId('ghost'), actor: OPERATOR })

      expect(!result.ok && result.error.code).toBe('client.notFound')
    })

    it('records before it saves: a failure to write the line leaves the client frozen', async () => {
      const broken: AuditRecorder = {
        record: async () => {
          throw new Error('disk full')
        },
      }
      const failing = makeResumeClient({ clients, audit: broken, clock: new FakeClock(NOW) })

      await expect(failing({ clientId: CLIENT, actor: OPERATOR })).rejects.toThrow('disk full')

      expect(await standing()).toEqual(NOW)
    })

    it('freezes it again after a resumption, with the later instant: each suspension is its own act', async () => {
      await resume({ clientId: CLIENT, actor: OPERATOR })
      const lateSuspend = makeSuspendClient({ clients, audit, clock: new FakeClock(atPlus(5)) })

      await lateSuspend({ clientId: CLIENT, actor: OPERATOR })

      expect(await standing()).toEqual(atPlus(5))
      expect(audit.all().map((record) => record.action)).toEqual([
        'client.suspended',
        'client.resumed',
        'client.suspended',
      ])
    })
  })

  it('reads the instant AT of the fixtures as before any of it', () => {
    expect(NOW.getTime()).toBeGreaterThan(AT.getTime())
  })
})
