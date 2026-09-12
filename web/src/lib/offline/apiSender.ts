import { ApiError } from '../http'
import { outcomeForFailure, outcomeForResults } from './sendOutcome'
import type { Api } from '../api/client'
import type { OutboxEntry, OutboxSendOutcome, OutboxSender } from './outbox'

/**
 * The page's half of the drain: one stored entry, sent through the ordinary transport.
 *
 * Deliberately the same `api.uploadPhotos` a guest pressing "Envoyer" goes through, so
 * a queued photo and a live one cross identical code — CSRF header, credentials,
 * multipart field name and all. A second upload path would be a second place for the
 * wire contract to drift.
 *
 * What the answer *means* is decided in `sendOutcome.ts`, shared with the worker.
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
      return outcomeForResults(response.results)
    } catch (cause) {
      if (cause instanceof ApiError) return outcomeForFailure(cause.status, cause.code)
      // An aborted request, a transport that threw: not evidence the server refused the
      // photo, so the photo is kept.
      return { kind: 'deferred' }
    }
  }
}
