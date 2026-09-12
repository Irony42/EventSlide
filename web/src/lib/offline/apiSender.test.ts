import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http'
import { fakeApi } from '../../testing/renderWithProviders'
import { apiOutboxSender } from './apiSender'
import { outboxSenderContract } from './testing/outboxSenderContract'
import type { UploadInput } from '../api/client'
import type { UploadOutcome, UploadResponse } from '../api/dto'
import type { OutboxEntry } from './outbox'

/**
 * The page's sender, against the contract both senders answer — see
 * `testing/outboxSenderContract.ts` for why that contract exists and what each case is
 * really protecting.
 */

outboxSenderContract('api', {
  ok: (results) =>
    apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async (): Promise<UploadResponse> => ({
          results: results as unknown as readonly UploadOutcome[],
        })),
      }),
    ),
  failure: (status, code) =>
    apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async () => {
          throw new ApiError(status, code)
        }),
      }),
    ),
  offline: () =>
    apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    ),
})

const anEntry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
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
  ...overrides,
})

describe('apiOutboxSender', () => {
  it('sends the stored bytes under their original name and type', async () => {
    // The server identifies an upload by magic bytes and stores it under a name it
    // generates, but the original name is metadata it keeps — losing it here would make
    // every queued photo arrive as something else.
    const uploadPhotos = vi.fn(async () => ({
      results: [{ index: 0, status: 'accepted' as const, photoId: 'photo-1' }],
    }))

    await apiOutboxSender(fakeApi({ uploadPhotos }))(anEntry())

    const [slug, input] = uploadPhotos.mock.calls[0] as unknown as [string, UploadInput]
    expect(slug).toBe('camille-et-sacha')
    expect(input.files[0]?.name).toBe('confettis.jpg')
    expect(input.files[0]?.type).toBe('image/jpeg')
    expect(input.caption).toBe('Les confettis')
  })

  it('keeps a photo when the transport threw something unrecognisable', async () => {
    // Not an `ApiError`, so not evidence the server refused anything.
    const send = apiOutboxSender(
      fakeApi({
        uploadPhotos: vi.fn(async () => {
          throw new Error('boom')
        }),
      }),
    )

    expect(await send(anEntry())).toEqual({ kind: 'deferred' })
  })
})
