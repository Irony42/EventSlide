import { describe, expect, it, vi } from 'vitest'
import { drainOutbox } from './drainOutbox'
import { MemoryOutbox } from './memoryOutbox'
import { CLAIM_LEASE_MS, MAX_AGE_MS, MAX_ATTEMPTS } from './outboxPolicy'
import { anEntry, t } from './outboxStoreContract'
import type { OutboxSendOutcome, OutboxSender } from './outbox'

/**
 * The one piece of behaviour the page and the service worker share, so it is tested
 * once, against the behaving in-memory store and a sender that is a plain function.
 * Neither transport appears here, which is the point of the seam.
 */

const SLUG = 'camille-et-sacha'

const sent = (): OutboxSendOutcome => ({ kind: 'sent', photoId: 'photo-1', duplicate: false })
const rejected = (): OutboxSendOutcome => ({ kind: 'rejected', code: 'image.unsupportedFormat' })
const deferred = (): OutboxSendOutcome => ({ kind: 'deferred' })

const fill = async (store: MemoryOutbox, names: readonly string[]) => {
  const ids: string[] = []
  for (const [index, fileName] of names.entries()) {
    ids.push((await store.add(anEntry({ slug: SLUG, fileName }), t + index)).id)
  }
  return ids
}

const drain = (store: MemoryOutbox, send: OutboxSender, now = () => t + 1_000) =>
  drainOutbox({ store, slug: SLUG, send, now })

describe('drainOutbox', () => {
  it('sends every photo the device is holding and forgets each one', async () => {
    const store = new MemoryOutbox()
    await fill(store, ['un.jpg', 'deux.jpg'])

    const report = await drain(store, async () => sent())

    expect(report.sent).toHaveLength(2)
    expect(report.remaining).toBe(0)
    expect(await store.list(SLUG)).toHaveLength(0)
  })

  it('reports which entries arrived, not how many', async () => {
    // The upload screen has a row per photo and settles them by id. A count is right
    // only while the device holds nothing from an earlier visit — the one case this
    // feature exists for.
    const store = new MemoryOutbox()
    const [first] = await fill(store, ['un.jpg'])

    const report = await drain(store, async () => sent())

    expect(report.sent).toEqual([first])
  })

  it('sends one at a time, never side by side', async () => {
    // Four parallel uploads on a saturated access point finish later than four in a row.
    const store = new MemoryOutbox()
    await fill(store, ['un.jpg', 'deux.jpg', 'trois.jpg'])
    let inFlight = 0
    let peak = 0

    await drain(store, async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return sent()
    })

    expect(peak).toBe(1)
  })

  it('stops at the first photo the network would not take', async () => {
    // Everything after it would fail the same way; continuing only spends the guest's
    // battery discovering that the network is still down.
    const store = new MemoryOutbox()
    await fill(store, ['un.jpg', 'deux.jpg', 'trois.jpg'])
    const send = vi.fn(async () => deferred())

    const report = await drain(store, send)

    expect(send).toHaveBeenCalledTimes(1)
    expect(report.remaining).toBe(3)
    expect(await store.list(SLUG)).toHaveLength(3)
  })

  it('counts the attempt and hands the photo back when it defers', async () => {
    const store = new MemoryOutbox()
    await fill(store, ['un.jpg'])

    await drain(store, async () => deferred())

    const [held] = await store.list(SLUG)
    expect(held?.attempts).toBe(1)
  })

  it('forgets a photo the server refused on its merits', async () => {
    // The same bytes get the same answer, so keeping them would mean asking again every
    // time the guest walks past an access point.
    const store = new MemoryOutbox()
    await fill(store, ['un.jpg'])

    const report = await drain(store, async () => rejected())

    expect(report.discarded).toHaveLength(1)
    expect(await store.list(SLUG)).toHaveLength(0)
  })

  it('keeps going after a refusal, because the next photo may be fine', async () => {
    const store = new MemoryOutbox()
    await fill(store, ['un.jpg', 'deux.jpg'])
    const send = vi
      .fn<OutboxSender>()
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(sent())

    const report = await drain(store, send)

    expect(report.discarded).toHaveLength(1)
    expect(report.sent).toHaveLength(1)
  })

  it('drops a photo whose event ended without ever asking the server', async () => {
    const store = new MemoryOutbox()
    await fill(store, ['un.jpg'])
    const send = vi.fn(async () => sent())

    const report = await drain(store, send, () => t + MAX_AGE_MS)

    expect(send).not.toHaveBeenCalled()
    expect(report.discarded).toHaveLength(1)
  })

  it('drops a photo that has used up its attempts', async () => {
    const store = new MemoryOutbox()
    const [id] = await fill(store, ['un.jpg'])
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await store.release(id ?? '', t)
    }
    const send = vi.fn(async () => sent())

    const report = await drain(store, send, () => t + 1)

    expect(send).not.toHaveBeenCalled()
    expect(report.discarded).toHaveLength(1)
  })

  it('leaves alone a photo another drain is already sending', async () => {
    // A Background Sync firing while the tab is open is the ordinary case, and without
    // this the guest pays twice for one photo.
    const store = new MemoryOutbox()
    const [id] = await fill(store, ['un.jpg'])
    await store.claim(id ?? '', t, CLAIM_LEASE_MS)
    const send = vi.fn(async () => sent())

    const report = await drain(store, send, () => t + 1)

    expect(send).not.toHaveBeenCalled()
    expect(report.remaining).toBe(1)
  })

  it('never touches a photo held for another event', async () => {
    const store = new MemoryOutbox()
    await store.add(anEntry({ slug: 'gala' }), t)
    const send = vi.fn(async () => sent())

    const report = await drain(store, send)

    expect(send).not.toHaveBeenCalled()
    expect(report.remaining).toBe(0)
    expect(await store.list('gala')).toHaveLength(1)
  })

  it('does nothing at all when the device is holding nothing', async () => {
    const store = new MemoryOutbox()

    expect(await drain(store, async () => sent())).toEqual({
      sent: [],
      discarded: [],
      remaining: 0,
      retryAfterMs: null,
    })
  })

  it('takes an entry a dead drain was still holding, when told to reclaim', async () => {
    // A service worker woken by Background Sync claims an entry and is routinely killed
    // before it can give it back. Honouring that lease on a fresh page means a guest
    // watching a photo not go for two minutes.
    const store = new MemoryOutbox()
    const [id] = await fill(store, ['un.jpg'])
    await store.claim(id ?? '', t, CLAIM_LEASE_MS)
    const send = vi.fn(async () => sent())

    const report = await drainOutbox({
      store,
      slug: SLUG,
      send,
      now: () => t + 1,
      reclaim: true,
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(report.sent).toHaveLength(1)
  })

  it('still honours the backoff when reclaiming', async () => {
    // Reclaiming is about a drainer that died, not about ignoring the rules. An entry
    // that failed a second ago is no more likely to succeed because the page reloaded.
    const store = new MemoryOutbox()
    const [id] = await fill(store, ['un.jpg'])
    await store.claim(id ?? '', t, CLAIM_LEASE_MS)
    await store.release(id ?? '', t)
    const send = vi.fn(async () => sent())

    const report = await drainOutbox({
      store,
      slug: SLUG,
      send,
      now: () => t + 1,
      reclaim: true,
    })

    expect(send).not.toHaveBeenCalled()
    expect(report.remaining).toBe(1)
  })

  /**
   * When the screen should look again.
   *
   * This is what stopped a queued photo from sitting on a device for the rest of the
   * evening: `online` fires once, and once every remaining entry was inside its
   * backoff, nothing was ever going to schedule another drain.
   */
  describe('retryAfterMs', () => {
    it('asks for nothing more once the device is empty', async () => {
      const store = new MemoryOutbox()
      await fill(store, ['un.jpg'])

      const report = await drain(store, async () => sent())

      expect(report.retryAfterMs).toBeNull()
    })

    it('asks to be called back after a photo the network would not take', async () => {
      const store = new MemoryOutbox()
      await fill(store, ['un.jpg'])

      const report = await drain(store, async () => deferred())

      expect(report.retryAfterMs).toBeGreaterThan(0)
    })

    it('waits out another drain rather than hammering an entry it cannot have', async () => {
      const store = new MemoryOutbox()
      const [id] = await fill(store, ['un.jpg'])
      await store.claim(id ?? '', t, CLAIM_LEASE_MS)

      const report = await drain(
        store,
        async () => sent(),
        () => t + 1,
      )

      expect(report.retryAfterMs).toBeGreaterThanOrEqual(1_000)
      expect(report.retryAfterMs).toBeLessThanOrEqual(60_000)
    })

    it('never asks to be called back immediately, however soon an entry is due', async () => {
      // A zero would be a spin, and a spin on a phone is a flat battery by 23:00.
      const store = new MemoryOutbox()
      await fill(store, ['un.jpg', 'deux.jpg'])

      const report = await drain(store, async () => deferred())

      expect(report.retryAfterMs).toBeGreaterThanOrEqual(1_000)
    })
  })
})
