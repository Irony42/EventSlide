import { admissionRefusalError } from '../../../domain/events/admission'
import { GuestbookEntry } from '../../../domain/guestbook/guestbookEntry'
import { GuestbookVoice } from '../../../domain/guestbook/guestbookVoice'
import {
  MAX_VOICE_PER_EVENT,
  voiceQueueFull,
  voiceRefusalFor,
  type VoiceRefusal,
} from '../../../domain/guestbook/guestbookVoiceLimits'
import {
  MAX_ENTRIES_PER_EVENT,
  MAX_ENTRIES_PER_GUEST,
} from '../../../domain/guestbook/guestbookLimits'
import { acceptsGuestbookEntries } from '../../../domain/guestbook/guestbookWindow'
import { Caption } from '../../../domain/photos/caption'
import { ContentHash } from '../../../domain/photos/contentHash'
import { STAGED_SOURCE } from '../../../domain/photos/mediaVariant'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AudioTranscoder } from '../../ports/audioTranscoder'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { ContentHasher } from '../../ports/contentHasher'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type {
  GuestbookVoiceRepository,
  VoiceAdmissionRefusal,
} from '../../ports/guestbookVoiceRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import { clientBytesOf, clientContextOf } from '../clients/clientContextOf'

/**
 * Staging a voice message: everything that has to happen while the guest is still holding the
 * request open, and nothing that does not (spec 25, section 5).
 *
 * It is `uploadClip` and `createGuestbookEntry` joined: a voice message is a line of the
 * guestbook (so it has that use case's gates and that book's ceilings) whose body is a file (so it
 * is staged to disk and handed to a queue). Transcoding is the worker's, not this request's.
 *
 * **The author is the device token**: `guestId` is the one `requireGuest` proved, never a value a
 * request names. Everything is scoped by `eventId`.
 *
 * ## The order, which is the order a guest can act on the answers
 *
 * 1. the event is still there for them, takes messages now (live, or closed for seven days), the
 *    host switched the guestbook on, **and** switched voice on;
 * 2. this box can transcode (`voice.transcoderUnavailable` **before any byte**: unlike a clip, a
 *    voice is not offered when it cannot be processed, and a request that arrives anyway is
 *    refused while the guest is still holding it);
 * 3. the **signature**, which starts no process, so a renamed PDF is refused before a byte
 *    reaches the disk (the application layer asks the port, which holds the signature table);
 * 4. the caption (140 characters, optional: the text a host who cannot listen reads instead);
 * 5. **the same bytes again** (a retry after a dropped upload) answer with the first message, and
 *    only then the ceilings, so a guest at their limit who retries is told "sent", not "too many";
 * 6. **the row first, the bytes second**: `admitVoice` writes the entry **and** its voice, `reserved`,
 *    in one transaction that judges the ceilings (three per guest, 500 and 200 per event), the
 *    queue's depth and the byte quota **before** a byte of the source touches the disk. A refusal
 *    costs zero bytes and the reservation is charged from the instant it exists.
 *
 * Then the source goes to the store (variant `source`, keyed by its digest), the voice becomes
 * `queued`, and a `voice.queued` fact wakes the worker. A request that dies between `admitVoice`
 * and the write leaves a `reserved` row that `reapStaleVoiceReservations` deletes.
 *
 * The message meets the moderation of the event as a written one does (`published` on arrival in
 * `auto`, `pending` otherwise): moderation and processing are two axes, and a voice is listenable,
 * decidable and archivable only once it is `ready`.
 */

export interface StageGuestbookVoiceFile {
  readonly bytes: Uint8Array
}

export interface StageGuestbookVoiceInput {
  readonly eventId: EventId
  /** The guest the device token proves. */
  readonly guestId: GuestId
  readonly file: StageGuestbookVoiceFile
  /** Untrusted: parsed here. Absent or blank means no caption. */
  readonly caption?: unknown
}

export interface StagedGuestbookVoice {
  readonly entry: GuestbookEntry
  /** These very bytes were already this event's: this is that message, and nothing is new. */
  readonly duplicate: boolean
}

export interface StageGuestbookVoiceLimits {
  /** Recordings waiting or running across the box (`MAX_QUEUED_VOICES`). */
  readonly maxQueuedVoices: number
  /** The same backpressure scoped to one event (`MAX_QUEUED_VOICES_PER_EVENT`). */
  readonly maxQueuedVoicesPerEvent: number
}

export interface StageGuestbookVoiceDeps {
  readonly events: EventRepository
  /** For the ceilings of the event's client: its byte ceiling and its reduced quota. */
  readonly clients: ClientRepository
  readonly guestbook: GuestbookRepository
  readonly voices: GuestbookVoiceRepository
  readonly media: MediaStore
  readonly transcoder: AudioTranscoder
  readonly hasher: ContentHasher
  readonly bus: EventBus
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly logger: Logger
  readonly limits: StageGuestbookVoiceLimits
}

export type StageGuestbookVoice = (
  input: StageGuestbookVoiceInput,
) => Promise<Result<StagedGuestbookVoice, DomainError>>

/** The refusal of a count ceiling, worded once for the early check and for the transaction. */
const limitError = (limit: VoiceRefusal): DomainError => {
  switch (limit) {
    case 'guestLimit':
      return DomainError.conflict('guestbook.limitReached', { max: MAX_ENTRIES_PER_GUEST })
    case 'eventFull':
      return DomainError.conflict('guestbook.eventFull', { max: MAX_ENTRIES_PER_EVENT })
    case 'voiceFull':
      return DomainError.conflict('guestbook.voiceEventFull', { max: MAX_VOICE_PER_EVENT })
  }
}

/** What a refusal at the door is answered with. One place, so the reasons cannot drift. */
const refusalError = (refusal: VoiceAdmissionRefusal, byteSize: number): DomainError => {
  switch (refusal.reason) {
    case 'limit':
      return limitError(refusal.limit)
    case 'queueFull':
      // `maxDepth` names whichever cap actually refused this, the box's or this event's.
      return voiceQueueFull(refusal.depth, refusal.maxDepth)
    case 'quotaExceeded':
    case 'clientStorageFull':
      return admissionRefusalError(refusal, byteSize)
  }
}

export const makeStageGuestbookVoice = ({
  events,
  clients,
  guestbook,
  voices,
  media,
  transcoder,
  hasher,
  bus,
  clock,
  ids,
  logger,
  limits,
}: StageGuestbookVoiceDeps): StageGuestbookVoice => {
  /**
   * Give the reservation back, with anything that landed under its digest.
   *
   * Safe to delete the bytes here and only here: the reservation is committed and the unique index
   * covers it, so no other request can be holding this digest. **The bytes go first**, as in
   * `uploadClip`: deleting the row first would release the digest, and a re-upload could reserve it
   * in the gap and have its own source unlinked. Best effort on the media: a file that will not
   * unlink is a leak `sweepOrphanedMedia` collects, whereas an exception escaping here would leave
   * the reservation charging the event until the reaper came.
   */
  const releaseReservation = async (
    eventId: EventId,
    entry: GuestbookEntry,
    digest: ContentHash,
  ): Promise<void> => {
    await media.delete(eventId, digest).catch((cause: unknown) => {
      logger.warn('could not remove a reserved voice message’s source; left for the sweep', {
        eventId,
        cause: String(cause),
      })
    })
    await voices.deleteByEntry(eventId, entry.id)
  }

  return async ({ eventId, guestId, file, caption }) => {
    const event = await events.findById(eventId)
    if (event === null || !event.isReachable()) {
      return err(DomainError.notFound('event.notFound'))
    }

    const now = clock.now()
    if (!acceptsGuestbookEntries(event, now)) {
      return err(DomainError.conflict('event.notAcceptingUploads', { status: event.status }))
    }
    if (!event.settings.allowGuestbook) return err(DomainError.conflict('guestbook.disabled'))
    if (!event.settings.guestbookVoice.enabled) {
      return err(DomainError.conflict('guestbook.voiceDisabled'))
    }

    // The box cannot process a recording: refused here, while the guest still holds the request,
    // and before any byte is written. Costs nothing, the capability being decided once at boot.
    if (!transcoder.available()) {
      logger.error('a voice message was offered to a deployment with no audio encoder', { eventId })
      return err(DomainError.unexpected('voice.transcoderUnavailable'))
    }

    // Signature before anything touches the disk. No process is started, so a renamed document
    // costs the box nothing and the guest is told at once.
    if (transcoder.identify(file.bytes) === null) {
      return err(DomainError.invalid('voice.unsupportedFormat'))
    }

    const parsedCaption = Caption.createOptional(caption)
    if (!parsedCaption.ok) return parsedCaption

    // `GuestbookVoice.create` is the one gate on the staged size: those bytes are charged to a
    // quota the instant the row exists, and a second spelling of the rule is a second thing to
    // keep in step.
    const digest = ContentHash.create(hasher.sha256Hex(file.bytes))
    if (!digest.ok) {
      logger.error('content hasher returned something that is not a sha-256 digest', {
        eventId,
        code: digest.error.code,
      })
      return err(DomainError.unexpected('photo.hashFailed'))
    }

    // The retry on venue Wi-Fi: the same bytes again are the same message, and the answer comes
    // **before** the ceilings so a guest at their limit who retries is told "sent".
    const held = await voices.findBySourceHash(eventId, digest.value)
    if (held !== null) return ok({ entry: held, duplicate: true })

    // A cheap early refusal against counts read now; the transaction below decides it again with
    // the same function, which is the one that holds when requests overlap.
    const early = voiceRefusalFor({
      heldByGuest: await guestbook.countByGuest(eventId, guestId),
      openInEvent: await guestbook.countOpenByEvent(eventId),
      voicesInEvent: await voices.countOpenByEvent(eventId),
    })
    if (early !== null) return err(limitError(early))

    const voice = GuestbookVoice.create(
      {
        sourceHash: digest.value,
        sourceByteSize: file.bytes.byteLength,
        caption: parsedCaption.value,
      },
      now,
    )
    // Fails closed on an empty upload a signature check waved through. Nothing is written yet.
    if (!voice.ok) return voice

    const entry = GuestbookEntry.createVoice(
      { eventId, guestId, voice: voice.value },
      ids.guestbookEntryId(),
      now,
      event.settings.moderation,
    )

    const context = await clientContextOf(clients, event)
    const admission = await voices.admitVoice(entry, {
      quotaBytes: event.effectiveQuotaBytes(context?.ceilings ?? null),
      maxQueuedVoices: limits.maxQueuedVoices,
      maxQueuedVoicesPerEvent: limits.maxQueuedVoicesPerEvent,
      clientBytes: clientBytesOf(context),
    })
    if (admission.kind === 'refused') {
      // Refused against committed state, and nothing has been written: that is why the row is first.
      return err(refusalError(admission.refusal, file.bytes.byteLength))
    }
    if (admission.kind === 'duplicate') return ok({ entry: admission.entry, duplicate: true })

    try {
      await media.put(eventId, digest.value, STAGED_SOURCE, file.bytes)
    } catch (cause) {
      logger.error('could not stage a voice message for transcoding', {
        eventId,
        cause: String(cause),
      })
      await releaseReservation(eventId, entry, digest.value)
      return err(DomainError.unexpected('voice.stageFailed'))
    }

    // The bytes are there. Only now may the worker see it: a voice is claimable only `queued`.
    // `queue()` throws rather than answering, and is **inside** the try for that reason: unreachable
    // today (it runs on a reservation `create` just made), but outside one it would leave the
    // source on disk, the row `reserved` and the digest locked against the guest's own retry.
    let queued: GuestbookVoice
    let saved: boolean
    try {
      queued = voice.value.queue(clock.now())
      saved = await voices.saveVoice(eventId, entry.id, queued)
    } catch (cause) {
      logger.error('could not hand a staged voice message to the queue', {
        eventId,
        cause: String(cause),
      })
      await releaseReservation(eventId, entry, digest.value)
      return err(DomainError.unexpected('voice.stageFailed'))
    }

    if (!saved) {
      // **The one exit that deletes nothing, and the only one where it would be wrong.** Every other
      // failure still holds its reservation, which is what makes removing the source safe. Here the
      // row is gone (reaped as wreckage, or taken with an erased guest), that proof has evaporated,
      // and the guest may already have re-sent the same recording onto a fresh reservation holding
      // these very bytes. The bytes stay and `sweepOrphanedMedia` collects them if nothing names them.
      logger.warn('a voice message’s reservation was gone before its bytes were handed over', {
        eventId,
        entryId: entry.id,
      })
      return err(DomainError.unexpected('voice.stageFailed'))
    }

    // Last, after the row says the bytes are there: a subscriber must never learn about work that
    // cannot be done yet. It wakes the worker, and reaches no screen.
    bus.publish({ type: 'voice.queued', eventId })

    return ok({
      entry: GuestbookEntry.restore({ ...entry.toProps(), voice: queued }),
      duplicate: false,
    })
  }
}
