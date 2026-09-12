import { describe, expect, it } from 'vitest'
import type { OutboxEntry, OutboxSender } from '../outbox'

/**
 * One suite, run against both senders.
 *
 * The page sends through the ordinary transport and the service worker sends through
 * bare `fetch`. They are two code paths reading one wire contract, and a disagreement
 * between them does not fail a build — it shows up as a photo the worker threw away and
 * the page would have kept. This is the store contract's counterpart, for the same
 * reason.
 *
 * What each case pins is the **consequence**, because the consequences are not
 * symmetric. `sent` and `rejected` both delete the bytes off the guest's device;
 * `deferred` keeps them. So every "is this terminal?" case below is really asking
 * whether a photo survives.
 */

/** How a test drives one sender: give it a server answer, get an outcome. */
export interface SenderHarness {
  /** A 2xx whose body is this list of per-file results. */
  readonly ok: (results: readonly Record<string, unknown>[]) => OutboxSender
  /** A non-2xx with this status and this error code. */
  readonly failure: (status: number, code: string) => OutboxSender
  /** Nothing reached the server at all. */
  readonly offline: () => OutboxSender
}

const anEntry = (): OutboxEntry => ({
  id: 'entry-1',
  slug: 'camille-et-sacha',
  bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
  fileName: 'confettis.jpg',
  fileType: 'image/jpeg',
  caption: 'Les confettis',
  enqueuedAt: 0,
  attempts: 0,
  lastAttemptAt: null,
  claimedAt: null,
  csrfToken: 'csrf-1',
})

export const outboxSenderContract = (name: string, harness: SenderHarness): void => {
  describe(`OutboxSender contract: ${name}`, () => {
    it('reports an accepted photo as sent', async () => {
      const outcome = await harness.ok([{ index: 0, status: 'accepted', photoId: 'photo-1' }])(
        anEntry(),
      )

      expect(outcome).toEqual({ kind: 'sent', photoId: 'photo-1', duplicate: false })
    })

    it('reports a duplicate as sent, because the photo is in the event', async () => {
      // Reporting it as a failure is what made 1.0's guests send the same photo a third
      // time. The bytes are there; the outbox has nothing left to do.
      const outcome = await harness.ok([{ index: 0, status: 'duplicate', photoId: 'photo-1' }])(
        anEntry(),
      )

      expect(outcome).toEqual({ kind: 'sent', photoId: 'photo-1', duplicate: true })
    })

    it('discards a photo the server judged on its merits', async () => {
      const outcome = await harness.ok([
        { index: 0, status: 'rejected', code: 'image.unsupportedFormat' },
      ])(anEntry())

      expect(outcome).toEqual({ kind: 'rejected', code: 'image.unsupportedFormat' })
    })

    it('keeps a photo when nothing reached the server', async () => {
      expect(await harness.offline()(anEntry())).toEqual({ kind: 'deferred' })
    })

    it('keeps a photo when the server could not answer', async () => {
      expect(await harness.failure(503, 'unknown')(anEntry())).toEqual({ kind: 'deferred' })
    })

    it('keeps a rate-limited photo rather than deleting it', async () => {
      // The case that made this contract necessary. `shouldQueue` — the *foreground*
      // question — answers no to 429 for good reasons, and both senders reused it here,
      // where "no" means `store.remove()`. The upload limit defaults to twelve a minute
      // keyed per client and event, so one venue behind one NAT coming back online at
      // 22:10 pushes every phone past it, and every queued photo on all of them would
      // have been thrown away in a single pass.
      expect(await harness.failure(429, 'rate.limited')(anEntry())).toEqual({ kind: 'deferred' })
    })

    it('keeps a photo when the device token now belongs to another event', async () => {
      // A guest who scans the after-party's QR code overwrites their one device token,
      // and the wedding's queue answers 403 `guest.wrongEvent` until they scan back.
      // Deleting on that refusal loses the evening's photos to a second QR code.
      expect(await harness.failure(403, 'guest.wrongEvent')(anEntry())).toEqual({
        kind: 'deferred',
      })
    })

    it('discards a photo whose guest the host has revoked', async () => {
      // The one 403 that does not come back.
      expect(await harness.failure(403, 'guest.revoked')(anEntry())).toEqual({
        kind: 'rejected',
        code: 'guest.revoked',
      })
    })

    it('discards a photo the server refused as too large', async () => {
      expect(await harness.failure(413, 'upload.tooLarge')(anEntry())).toEqual({
        kind: 'rejected',
        code: 'upload.tooLarge',
      })
    })

    it('keeps a photo refused with a code this build has never heard of', async () => {
      // A newer server is allowed to grow its codes. Defaulting to "delete" would make
      // every such addition a silent data-loss bug on every phone running an old build.
      expect(await harness.failure(409, 'event.somethingNew')(anEntry())).toEqual({
        kind: 'deferred',
      })
    })

    it('keeps a photo when a 2xx carried no result this build can read', async () => {
      expect(await harness.ok([])(anEntry())).toEqual({ kind: 'deferred' })
    })
  })
}
