import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http'
import { fakeApi } from '../../testing/renderWithProviders'
import { apiOutboxSender } from './apiSender'
import { anEntry } from './outboxStoreContract'
import type { OutboxEntry } from './outbox'
import type { UploadInput } from '../api/client'

/**
 * The translation between "what the server said" and the three outcomes the drain acts
 * on. Getting this wrong is how a photo the server will never accept gets retried for
 * twelve hours, or how a dropped connection silently deletes a guest's photo.
 */

const entry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
  ...anEntry(),
  id: 'entry-1',
  enqueuedAt: 0,
  attempts: 0,
  lastAttemptAt: null,
  claimedAt: null,
  ...overrides,
})

describe('apiOutboxSender', () => {
  it('sends the stored bytes under their original name and type', async () => {
    // The server identifies an upload by magic bytes and stores it under a name it
    // generates, but the original name is metadata it keeps — losing it here would
    // make every queued photo arrive as something else.
    const uploadPhotos = vi.fn(async () => ({
      results: [{ index: 0, status: 'accepted' as const, photoId: 'photo-1' }],
    }))
    const send = apiOutboxSender(fakeApi({ uploadPhotos }))

    await send(entry({ caption: 'Les confettis' }))

    const [slug, input] = uploadPhotos.mock.calls[0] as unknown as [string, UploadInput]
    expect(slug).toBe('camille-et-sacha')
    expect(input.files[0]?.name).toBe('confettis.jpg')
    expect(input.files[0]?.type).toBe('image/jpeg')
    expect(input.caption).toBe('Les confettis')
  })

  it('reports an accepted photo as sent', async () => {
    const send = apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async () => ({
          results: [{ index: 0, status: 'accepted' as const, photoId: 'photo-1' }],
        })),
      }),
    )

    expect(await send(entry())).toEqual({ kind: 'sent', photoId: 'photo-1', duplicate: false })
  })

  it('reports a duplicate as sent, because the photo is in the event', async () => {
    // Reporting it as a failure is what made 1.0's guests send the same photo a third
    // time. The bytes are there; the outbox has nothing left to do.
    const send = apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async () => ({
          results: [{ index: 0, status: 'duplicate' as const, photoId: 'photo-1' }],
        })),
      }),
    )

    expect(await send(entry())).toEqual({ kind: 'sent', photoId: 'photo-1', duplicate: true })
  })

  it('reports a photo the server judged as rejected, so it is never retried', async () => {
    const send = apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async () => ({
          results: [{ index: 0, status: 'rejected' as const, code: 'image.unsupportedFormat' }],
        })),
      }),
    )

    expect(await send(entry())).toEqual({ kind: 'rejected', code: 'image.unsupportedFormat' })
  })

  it('defers a dropped connection', async () => {
    const send = apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )

    expect(await send(entry())).toEqual({ kind: 'deferred' })
  })

  it('defers a server that could not answer', async () => {
    const send = apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async () => {
          throw new ApiError(503, 'unknown')
        }),
      }),
    )

    expect(await send(entry())).toEqual({ kind: 'deferred' })
  })

  it('rejects a refusal that a retry cannot fix', async () => {
    // A revoked guest or a closed event answers identically every time; retrying it
    // for twelve hours would be the outbox arguing with the server.
    const send = apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async () => {
          throw new ApiError(403, 'guest.revoked')
        }),
      }),
    )

    expect(await send(entry())).toEqual({ kind: 'rejected', code: 'guest.revoked' })
  })

  it('defers a 2xx this build cannot read rather than losing the photo', async () => {
    // A newer server is allowed to grow its response. Discarding on a shape mismatch
    // would delete a guest's photo over a field name.
    const send = apiOutboxSender(fakeApi({ uploadPhotos: vi.fn(async () => ({ results: [] })) }))

    expect(await send(entry())).toEqual({ kind: 'deferred' })
  })

  it('defers a transport that threw something unrecognisable', async () => {
    const send = apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async () => {
          throw new Error('boom')
        }),
      }),
    )

    expect(await send(entry())).toEqual({ kind: 'deferred' })
  })
})
