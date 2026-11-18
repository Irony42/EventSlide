import { ApiError } from '../http'
import { voiceOutcomeForFailure } from './voicePolicy'
import type { Api } from '../api/client'
import type { OutboxEntry, OutboxSendOutcome, OutboxSender } from './outbox'

/**
 * The page's half of the voice drain (spec 25): one stored recording, sent through the ordinary
 * transport to `POST …/guestbook/voice`.
 *
 * Calqued on `apiOutboxSender` and never sharing it: the photo sender posts to `/photos`, which
 * refuses a recording with `image.unsupportedFormat` (a terminal code, so the photo queue would
 * destroy it). A voice entry is only ever read by this sender, and only ever from the voice
 * database. What an answer means is `voicePolicy`'s three states.
 */

const fileFor = (entry: OutboxEntry): File =>
  new File([entry.bytes], entry.fileName, { type: entry.fileType })

export const apiVoiceSender = (api: Api): OutboxSender => {
  return async (entry: OutboxEntry): Promise<OutboxSendOutcome> => {
    try {
      const response = await api.leaveVoiceMessage(entry.slug, {
        file: fileFor(entry),
        caption: entry.caption,
      })
      return { kind: 'sent', photoId: response.entry.id, duplicate: response.entry.duplicate }
    } catch (cause) {
      if (cause instanceof ApiError) return voiceOutcomeForFailure(cause.status, cause.code)
      // An aborted request, a transport that threw: not evidence the server refused the recording.
      return { kind: 'deferred' }
    }
  }
}
