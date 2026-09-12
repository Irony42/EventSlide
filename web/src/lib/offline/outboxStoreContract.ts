import { describe, expect, it } from 'vitest'
import { MAX_ENTRIES_PER_EVENT } from './outboxPolicy'
import type { NewOutboxEntry, OutboxStore } from './outbox'

/**
 * One suite, run against both implementations.
 *
 * The in-memory store is not a stub sitting beside the real one: it is what the upload
 * screen falls back to on a phone whose browser refuses a database, and it is what
 * every hook test drives. A fake that drifts from the adapter turns each of those into
 * a lie, so the two are pinned here — the same arrangement
 * `src/application/testing/contracts/` uses on the server side.
 */

export const t = 1_760_000_000_000

export const anEntry = (overrides: Partial<NewOutboxEntry> = {}): NewOutboxEntry => ({
  slug: 'camille-et-sacha',
  bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
  fileName: 'confettis.jpg',
  fileType: 'image/jpeg',
  caption: null,
  csrfToken: 'csrf-1',
  ...overrides,
})

export const outboxStoreContract = (
  name: string,
  makeSubject: () => Promise<OutboxStore>,
): void => {
  describe(`OutboxStore contract: ${name}`, () => {
    it('gives back what it was handed, with an id and the time it arrived', async () => {
      const store = await makeSubject()

      const stored = await store.add(anEntry({ caption: 'Les confettis' }), t)

      expect(stored.id).not.toBe('')
      expect(stored.enqueuedAt).toBe(t)
      expect(stored.attempts).toBe(0)
      expect(stored.claimedAt).toBeNull()
      expect(stored.lastAttemptAt).toBeNull()
      expect(stored.caption).toBe('Les confettis')
      expect(stored.fileName).toBe('confettis.jpg')
    })

    it('never lists a photo held for another event', async () => {
      // The same rule as every photo query on the server: a store that can hand back
      // another event's photo is a tenancy bug, not a feature gap.
      const store = await makeSubject()
      await store.add(anEntry({ slug: 'mariage' }), t)
      await store.add(anEntry({ slug: 'gala' }), t)

      const held = await store.list('mariage')

      expect(held).toHaveLength(1)
      expect(held[0]?.slug).toBe('mariage')
    })

    it('lists oldest first, whatever order the ids came out in', async () => {
      const store = await makeSubject()
      const first = await store.add(anEntry({ fileName: 'un.jpg' }), t)
      const second = await store.add(anEntry({ fileName: 'deux.jpg' }), t + 1_000)

      const held = await store.list('camille-et-sacha')

      expect(held.map((entry) => entry.id)).toEqual([first.id, second.id])
    })

    it('names every event it is holding photos for, once each', async () => {
      // How a service worker woken with no page and no URL finds the work to do.
      const store = await makeSubject()
      await store.add(anEntry({ slug: 'mariage' }), t)
      await store.add(anEntry({ slug: 'mariage' }), t + 1)
      await store.add(anEntry({ slug: 'gala' }), t + 2)

      expect([...(await store.slugs())].sort()).toEqual(['gala', 'mariage'])
    })

    it('refuses a second claim while the lease is live', async () => {
      // The page and a Background Sync can both be draining. Without this, both see an
      // unclaimed entry and the guest pays twice for one photo.
      const store = await makeSubject()
      const stored = await store.add(anEntry(), t)

      expect(await store.claim(stored.id, t, 60_000)).not.toBeNull()
      expect(await store.claim(stored.id, t + 59_999, 60_000)).toBeNull()
    })

    it('lets the next drain take an entry whose lease has run out', async () => {
      // A worker killed mid-upload must not strand the photo for the evening.
      const store = await makeSubject()
      const stored = await store.add(anEntry(), t)
      await store.claim(stored.id, t, 60_000)

      expect(await store.claim(stored.id, t + 60_000, 60_000)).not.toBeNull()
    })

    it('answers null when asked to claim an entry that is gone', async () => {
      const store = await makeSubject()

      expect(await store.claim('never-existed', t, 60_000)).toBeNull()
    })

    it('counts the attempt when an entry is released', async () => {
      const store = await makeSubject()
      const stored = await store.add(anEntry(), t)
      await store.claim(stored.id, t, 60_000)

      await store.release(stored.id, t + 500)

      const [held] = await store.list('camille-et-sacha')
      expect(held?.attempts).toBe(1)
      expect(held?.lastAttemptAt).toBe(t + 500)
      // Given back, not renewed. One field meaning both "a drain holds this" and "this
      // is when it last tried" made a deferred photo look leased for two minutes, so
      // the follow-up drain armed for its two-second backoff found nothing to do.
      expect(held?.claimedAt).toBeNull()
    })

    it('lets the very next drain take an entry a previous one gave back', async () => {
      // The backoff decides when it is worth trying again; the lease must not also be
      // holding it. These were the same field, and a deferred photo was unreachable for
      // two minutes because of it.
      const store = await makeSubject()
      const stored = await store.add(anEntry(), t)
      await store.claim(stored.id, t, 60_000)
      await store.release(stored.id, t + 500)

      expect(await store.claim(stored.id, t + 501, 60_000)).not.toBeNull()
    })

    it('ignores a release for an entry that is already gone', async () => {
      // The drain and a guest pressing "Retirer" race by construction.
      const store = await makeSubject()

      await expect(store.release('never-existed', t)).resolves.toBeUndefined()
    })

    it('forgets one entry without touching the others', async () => {
      const store = await makeSubject()
      const doomed = await store.add(anEntry({ fileName: 'un.jpg' }), t)
      await store.add(anEntry({ fileName: 'deux.jpg' }), t + 1)

      await store.remove(doomed.id)

      const held = await store.list('camille-et-sacha')
      expect(held.map((entry) => entry.fileName)).toEqual(['deux.jpg'])
    })

    it('clears one event and leaves another alone', async () => {
      const store = await makeSubject()
      await store.add(anEntry({ slug: 'mariage' }), t)
      await store.add(anEntry({ slug: 'gala' }), t)

      await store.clear('mariage')

      expect(await store.list('mariage')).toHaveLength(0)
      expect(await store.list('gala')).toHaveLength(1)
    })

    it('drops the oldest photo once one event is over the cap', async () => {
      // A phone's storage quota is not the guest's problem to manage, and a write that
      // fails silently at the browser's own limit is far worse than a documented cap.
      const store = await makeSubject()
      for (let index = 0; index <= MAX_ENTRIES_PER_EVENT; index += 1) {
        await store.add(anEntry({ fileName: `photo-${index}.jpg` }), t + index)
      }

      const held = await store.list('camille-et-sacha')

      expect(held).toHaveLength(MAX_ENTRIES_PER_EVENT)
      expect(held[0]?.fileName).toBe('photo-1.jpg')
    })

    it('keeps the bytes, not just a description of them', async () => {
      // The whole feature is worthless if what comes back out cannot be uploaded.
      const store = await makeSubject()
      const stored = await store.add(anEntry(), t)

      const [held] = await store.list('camille-et-sacha')
      expect(held?.id).toBe(stored.id)
      expect(new Uint8Array(held?.bytes ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array([0xff, 0xd8, 0xff]),
      )
    })
  })
}
