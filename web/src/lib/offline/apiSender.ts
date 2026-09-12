import { ApiError } from '../http'
import { shouldQueue } from './outboxPolicy'
import type { Api } from '../api/client'
import type { OutboxEntry, OutboxSendOutcome, OutboxSender } from './outbox'

/**
 * The page's half of the drain: one stored entry, sent through the ordinary transport.
 *
 * Deliberately the same `api.uploadPhotos` a guest pressing "Envoyer" goes through, so
 * a queued photo and a live one cross identical code — CSRF header, credentials,
 * multipart field name and all. A second upload path would be a second place for the
 * wire contract to drift.
 */

/** Rebuilds the `File` the transport expects from the bytes the store kept. */
const fileFor = (entry: OutboxEntry): File =>
  new File([entry.bytes], entry.fileName, { type: entry.fileType })

export const apiOutboxSender = (api: Api): OutboxSender => {
  return async (entry: OutboxEntry): Promise<OutboxSendOutcome> => {
    try {
      const response = await api.uploadPhotos(entry.slug, {
        files: [fileFor(entry)],
        caption: entry.caption,
      })

      const outcome = response.results[0]
      // A 2xx carrying no result is a server this build does not understand. Deferring
      // rather than discarding keeps the photo; the attempt cap stops it looping.
      if (outcome === undefined) return { kind: 'deferred' }
      if (outcome.status === 'rejected') return { kind: 'rejected', code: outcome.code }
      return {
        kind: 'sent',
        photoId: outcome.photoId,
        duplicate: outcome.status === 'duplicate',
      }
    } catch (cause) {
      if (cause instanceof ApiError) {
        return shouldQueue(cause.status)
          ? { kind: 'deferred' }
          : { kind: 'rejected', code: cause.code }
      }
      // Anything else — an aborted request, a transport that threw — is not evidence
      // the server refused the photo, so the photo is kept.
      return { kind: 'deferred' }
    }
  }
}
