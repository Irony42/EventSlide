import { describe, expect, it, vi } from 'vitest'
import { drainOutbox } from './drainOutbox'
import { MemoryOutbox } from './memoryOutbox'
import { anEntry, t } from './testing/outboxStoreContract'
import type { OutboxSendOutcome, OutboxSender } from './outbox'

/**
 * The drain's third answer (spec 25): a refusal of the moment keeps the entry, stopped, with its
 * reason. A photo never gets there; a voice recording, which a guest cannot make again, does.
 */

const SLUG = 'camille-et-sacha'

const sent = (): OutboxSendOutcome => ({ kind: 'sent', photoId: 'voice-1', duplicate: false })
const blocked = (): OutboxSendOutcome => ({ kind: 'blocked', code: 'guestbook.voiceDisabled' })

const fill = async (store: MemoryOutbox, names: readonly string[]) => {
  const ids: string[] = []
  for (const [index, fileName] of names.entries()) {
    ids.push((await store.add(anEntry({ slug: SLUG, fileName }), t + index)).entry.id)
  }
  return ids
}

const drain = (store: MemoryOutbox, send: OutboxSender) =>
  drainOutbox({ store, slug: SLUG, send, now: () => t + 1_000 })

describe('drainOutbox, a refusal of the moment', () => {
  it('keeps the entry, says why, and does not drop it', async () => {
    // A recording the host switched off a minute early: kept, with the reason, never destroyed.
    const store = new MemoryOutbox()
    const [id] = await fill(store, ['un.webm'])

    const report = await drain(store, async () => blocked())

    expect(report.refusals).toEqual([{ id, kind: 'blocked', code: 'guestbook.voiceDisabled' }])
    expect(report.discarded).toEqual([])
    expect((await store.list(SLUG))[0]?.blockedCode).toBe('guestbook.voiceDisabled')
  })

  it('does not count a blocked entry as waiting, nor arm a timer for it', async () => {
    // It waits for a person or a setting, not for a clock: a timer would retry a refusal that
    // cannot change every minute of the evening.
    const store = new MemoryOutbox()
    await fill(store, ['un.webm'])

    const report = await drain(store, async () => blocked())

    expect(report.remaining).toBe(0)
    expect(report.retryAfterMs).toBeNull()
  })

  it('never sends an entry that is blocked, until it is unblocked', async () => {
    const store = new MemoryOutbox()
    await fill(store, ['un.webm'])
    await drain(store, async () => blocked())
    const send = vi.fn(async () => sent())

    await drain(store, send)
    expect(send).not.toHaveBeenCalled()

    await store.unblock(SLUG)
    await drain(store, send)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('lets the entries behind a blocked one go', async () => {
    // A blocked recording is not a dead network: the next one is judged on its own.
    const store = new MemoryOutbox()
    const [first] = await fill(store, ['un.webm', 'deux.webm'])
    await store.block(first ?? '', 'guestbook.limitReached')

    const report = await drain(store, async () => sent())

    expect(report.sent).toHaveLength(1)
  })

  it('names a refusal of the content as such, and drops it', async () => {
    const store = new MemoryOutbox()
    const [id] = await fill(store, ['un.webm'])

    const report = await drain(store, async () => ({ kind: 'rejected', code: 'voice.corrupt' }))

    expect(report.refusals).toEqual([{ id, kind: 'rejected', code: 'voice.corrupt' }])
    expect(await store.list(SLUG)).toHaveLength(0)
  })

  it('expires an entry by the policy it is drained under, not the photo queue’s', async () => {
    const store = new MemoryOutbox()
    await fill(store, ['un.webm'])
    const send = vi.fn(async () => sent())

    const report = await drainOutbox({
      store,
      slug: SLUG,
      send,
      now: () => t + 5_000,
      policy: { maxEntriesPerEvent: 3, maxAgeMs: 5_000, terminalCodes: new Set() },
    })

    expect(report.discarded).toHaveLength(1)
    expect(send).not.toHaveBeenCalled()
  })
})
