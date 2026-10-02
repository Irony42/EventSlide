import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asUserId } from '../../../domain/shared/ids'
import type { AuditLog } from '../../ports/auditLog'
import { AT, aCeilingsSnapshot, anAuditEntry, atPlus } from '../builders'

/**
 * The shared `AuditLog` contract, run against the in-memory fake and the SQLite adapter.
 *
 * `audit_log.actor_user_id` references `users`, so the SQLite adapter needs the accounts
 * the entries below name to exist. Neither table is this port's own to seed: each
 * implementation's test file creates `AUDIT_CONTRACT_FIXTURES.userIds` however it stores
 * them, the way `CLIENT_CONTRACT_FIXTURES` does for the client port.
 *
 * What this suite cannot state, because the port has no way to attempt it, is that the log
 * refuses to be changed: there is no `update` or `delete` to call. That guarantee is the
 * database's, and `migrator.test.ts` and `sqliteAuditLog.test.ts` hold it.
 */

export const AUDIT_CONTRACT_FIXTURES = {
  userIds: ['user-operator', 'user-member'],
} as const

const OPERATOR = asUserId('user-operator')
const MEMBER = asUserId('user-member')
const ONE_SECOND = 1_000

export const auditLogContract = (
  name: string,
  makeSubject: () => Promise<{ log: AuditLog; dispose?: () => Promise<void> }>,
): void => {
  describe(`AuditLog contract: ${name}`, () => {
    let log: AuditLog
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      log = subject.log
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    /** Records `count` entries one second apart for a client, oldest first. */
    const recordMany = async (count: number, clientId = 'client-1'): Promise<void> => {
      for (let index = 0; index < count; index += 1) {
        await log.record(anAuditEntry({ clientId, at: atPlus(index * ONE_SECOND) }))
      }
    }

    const seqsOf = async (filter: Parameters<AuditLog['list']>[0]): Promise<number[]> =>
      (await log.list(filter)).items.map((record) => record.seq)

    // --------------------------------------------------------- record and read --

    it('reads back what was recorded: actor, action, subject, client, instant and details', async () => {
      await log.record(
        anAuditEntry({
          at: atPlus(1_234),
          clientId: 'client-1',
          details: {
            before: aCeilingsSnapshot({
              maxEvents: 5,
              periodStartedAt: '2026-06-01T00:00:00.000Z',
            }),
            after: aCeilingsSnapshot({ maxEvents: null, clipsAllowed: false }),
          },
        }),
      )

      const { items } = await log.list({ limit: 10 })

      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({
        seq: expect.any(Number),
        at: atPlus(1_234),
        actor: { kind: 'operator', userId: OPERATOR, label: null },
        action: 'client.ceilingsChanged',
        subject: { type: 'client', id: 'client-1' },
        clientId: asClientId('client-1'),
        details: {
          before: aCeilingsSnapshot({ maxEvents: 5, periodStartedAt: '2026-06-01T00:00:00.000Z' }),
          after: aCeilingsSnapshot({ maxEvents: null, clipsAllowed: false }),
        },
      })
    })

    it('keeps the instant to the millisecond', async () => {
      await log.record(anAuditEntry({ at: new Date('2026-06-20T21:00:00.123Z') }))

      const { items } = await log.list({ limit: 1 })

      expect(items[0]?.at.toISOString()).toBe('2026-06-20T21:00:00.123Z')
    })

    it('reads back a member actor as the account it names', async () => {
      await log.record(anAuditEntry({ actor: { kind: 'member', userId: MEMBER } }))

      const { items } = await log.list({ limit: 1 })

      expect(items[0]?.actor).toEqual({ kind: 'member', userId: MEMBER, label: null })
    })

    it('reads back a process or an integration as an actor with a label and no account', async () => {
      await log.record(anAuditEntry({ actor: { kind: 'system', label: 'retention-sweeper' } }))
      await log.record(
        anAuditEntry({ actor: { kind: 'integration', label: 'cloud:stripe-webhook' } }),
      )

      const { items } = await log.list({ limit: 10 })

      expect(items.map((record) => record.actor)).toEqual([
        { kind: 'integration', userId: null, label: 'cloud:stripe-webhook' },
        { kind: 'system', userId: null, label: 'retention-sweeper' },
      ])
    })

    it('gives every entry a larger sequence number than the one recorded before it', async () => {
      await recordMany(3)

      const seqs = (await seqsOf({ limit: 10 })).reverse()

      expect(seqs[0]).toBeGreaterThan(0)
      expect(seqs[1]).toBeGreaterThan(seqs[0] as number)
      expect(seqs[2]).toBeGreaterThan(seqs[1] as number)
    })

    it('does not change a stored entry when the caller edits the details afterwards', async () => {
      const details = { before: aCeilingsSnapshot(), after: aCeilingsSnapshot({ maxEvents: 6 }) }
      await log.record(anAuditEntry({ details }))

      ;(details.after as { maxEvents: number | null }).maxEvents = 999

      const { items } = await log.list({ limit: 1 })
      expect(items[0]?.details).toEqual({
        before: aCeilingsSnapshot(),
        after: aCeilingsSnapshot({ maxEvents: 6 }),
      })
    })

    // ------------------------------------------------------------------ listing --

    it('lists an empty log as an empty page with no next one', async () => {
      expect(await log.list({ limit: 10 })).toEqual({ items: [], next: null })
    })

    it('lists newest first, by sequence and not by the instant an entry was stamped with', async () => {
      // The stamped instants run backwards here: the last entry written carries the
      // oldest `at`. Newest-first means the order they were written in.
      await log.record(anAuditEntry({ at: atPlus(3 * ONE_SECOND), clientId: 'client-1' }))
      await log.record(anAuditEntry({ at: atPlus(2 * ONE_SECOND), clientId: 'client-2' }))
      await log.record(anAuditEntry({ at: atPlus(1 * ONE_SECOND), clientId: 'client-3' }))

      const { items } = await log.list({ limit: 10 })

      expect(items.map((record) => record.clientId)).toEqual(['client-3', 'client-2', 'client-1'])
    })

    it('never returns an entry about one client when asked for another', async () => {
      await recordMany(2, 'client-1')
      await recordMany(3, 'client-2')

      const { items } = await log.list({ clientId: asClientId('client-1'), limit: 10 })

      expect(items).toHaveLength(2)
      expect(items.every((record) => record.clientId === 'client-1')).toBe(true)
    })

    it('returns nothing for a client that has no entries, rather than everyone’s', async () => {
      await recordMany(2, 'client-1')

      expect(await log.list({ clientId: asClientId('client-9'), limit: 10 })).toEqual({
        items: [],
        next: null,
      })
    })

    it('lists every client’s entries when no client is named, which is the operator’s view', async () => {
      await recordMany(2, 'client-1')
      await recordMany(1, 'client-2')

      const { items } = await log.list({ limit: 10 })

      expect(items.map((record) => record.clientId).sort()).toEqual([
        'client-1',
        'client-1',
        'client-2',
      ])
    })

    it('pages without a gap or a repeat, and reports no next page after the last', async () => {
      await recordMany(5)
      const everything = await seqsOf({ limit: 10 })

      const first = await log.list({ limit: 2 })
      const second = await log.list({ limit: 2, before: first.next as number })
      const third = await log.list({ limit: 2, before: second.next as number })

      expect(first.items).toHaveLength(2)
      expect(second.items).toHaveLength(2)
      expect(third.items).toHaveLength(1)
      expect(third.next).toBeNull()
      expect([...first.items, ...second.items, ...third.items].map((record) => record.seq)).toEqual(
        everything,
      )
    })

    it('reports no next page when the last page is exactly full', async () => {
      await recordMany(4)

      const page = await log.list({ limit: 4 })

      expect(page.items).toHaveLength(4)
      expect(page.next).toBeNull()
    })

    it('resumes strictly below the sequence number it was given', async () => {
      await recordMany(4)
      const [newest, second, third, oldest] = await seqsOf({ limit: 10 })

      expect(await seqsOf({ before: second as number, limit: 10 })).toEqual([third, oldest])
      expect(await seqsOf({ before: newest as number, limit: 1 })).toEqual([second])
    })

    it('pages inside one client without meeting another’s entries', async () => {
      await recordMany(3, 'client-1')
      await recordMany(3, 'client-2')

      const first = await log.list({ clientId: asClientId('client-1'), limit: 2 })
      const second = await log.list({
        clientId: asClientId('client-1'),
        limit: 2,
        before: first.next as number,
      })

      expect(first.items).toHaveLength(2)
      expect(second.items).toHaveLength(1)
      expect(second.next).toBeNull()
      expect(
        [...first.items, ...second.items].every((record) => record.clientId === 'client-1'),
      ).toBe(true)
    })

    it.each([0, -1, 1.5, Number.NaN])(
      'refuses a limit of %s rather than guessing what it meant',
      async (limit) => {
        await expect(log.list({ limit })).rejects.toThrow(/limit/)
      },
    )

    // -------------------------------------------------------------------- prune --

    it('prunes every entry stamped before the cutoff, keeps the rest, and says how many it removed', async () => {
      await recordMany(5)

      const removed = await log.pruneOlderThan(atPlus(3 * ONE_SECOND))

      expect(removed).toBe(3)
      const { items } = await log.list({ limit: 10 })
      expect(items.map((record) => record.at.getTime())).toEqual([
        atPlus(4 * ONE_SECOND).getTime(),
        atPlus(3 * ONE_SECOND).getTime(),
      ])
    })

    it('keeps an entry stamped exactly at the cutoff: it is that old, not older', async () => {
      await log.record(anAuditEntry({ at: AT }))

      expect(await log.pruneOlderThan(AT)).toBe(0)
      expect(await log.list({ limit: 10 })).toMatchObject({ items: [{ at: AT }] })
    })

    it('judges an entry by the instant stamped on it, not by the order the entries were written in', async () => {
      await log.record(anAuditEntry({ at: atPlus(9 * ONE_SECOND) }))
      await log.record(anAuditEntry({ at: atPlus(1 * ONE_SECOND) }))
      await log.record(anAuditEntry({ at: atPlus(8 * ONE_SECOND) }))

      expect(await log.pruneOlderThan(atPlus(5 * ONE_SECOND))).toBe(1)
      expect((await log.list({ limit: 10 })).items.map((record) => record.at.getTime())).toEqual([
        atPlus(8 * ONE_SECOND).getTime(),
        atPlus(9 * ONE_SECOND).getTime(),
      ])
    })

    it('prunes every client’s entries alike: retention is a property of the box', async () => {
      await recordMany(2, 'client-1')
      await recordMany(2, 'client-2')

      expect(await log.pruneOlderThan(atPlus(10 * ONE_SECOND))).toBe(4)
      expect(await log.list({ limit: 10 })).toEqual({ items: [], next: null })
    })

    it('says nothing was removed, and removes nothing, when nothing is old enough', async () => {
      await recordMany(2)

      expect(await log.pruneOlderThan(new Date(AT.getTime() - 1))).toBe(0)
      expect(await log.pruneOlderThan(new Date(AT.getTime() - 1))).toBe(0)
      expect((await log.list({ limit: 10 })).items).toHaveLength(2)
    })

    it('never reuses a sequence number after the newest entries are pruned', async () => {
      await recordMany(2)
      const [newest] = await seqsOf({ limit: 10 })
      await log.pruneOlderThan(atPlus(10 * ONE_SECOND))

      await recordMany(1)

      const [afterPrune] = await seqsOf({ limit: 10 })
      expect(afterPrune).toBeGreaterThan(newest as number)
    })

    it('keeps accepting entries after a prune, and reads them back', async () => {
      await recordMany(2)
      await log.pruneOlderThan(atPlus(10 * ONE_SECOND))

      await log.record(anAuditEntry({ at: atPlus(20 * ONE_SECOND) }))

      expect((await log.list({ limit: 10 })).items).toHaveLength(1)
    })

    it('refuses a cutoff that is not a real date, instead of reading it as "everything" or "nothing"', async () => {
      await recordMany(2)

      await expect(log.pruneOlderThan(new Date(Number.NaN))).rejects.toThrow(/cutoff/)
      expect((await log.list({ limit: 10 })).items).toHaveLength(2)
    })
  })
}
