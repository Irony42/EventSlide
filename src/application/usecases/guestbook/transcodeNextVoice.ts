import { admissionRefusalError } from '../../../domain/events/admission'
import type { GuestbookEntry } from '../../../domain/guestbook/guestbookEntry'
import type { GuestbookVoice } from '../../../domain/guestbook/guestbookVoice'
import { VOICE_MIN_MS, voiceDeclaredTooLong } from '../../../domain/guestbook/guestbookVoiceLimits'
import { ContentHash } from '../../../domain/photos/contentHash'
import { STAGED_SOURCE } from '../../../domain/photos/mediaVariant'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestbookEntryId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { AudioTranscoder, TranscodeVoiceSpec } from '../../ports/audioTranscoder'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { ContentHasher } from '../../ports/contentHasher'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookVoiceRepository, VoiceFinish } from '../../ports/guestbookVoiceRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import { clientBytesOf, clientContextOf } from '../clients/clientContextOf'

/**
 * One pass of the voice queue: claim a recording, turn it into AAC in an MP4, and make it `ready`
 * (spec 25, section 5). The twin of `transcodeNextClip`, and like it **every decision lives here**:
 * `src/main` is excluded from coverage, so a retry ladder or a quota rule written into the timer
 * would be a rule nothing can test. The worker gets a loop and a timer, this gets the judgement.
 *
 * The order is the design:
 *
 * 0. **Do nothing on a box that cannot encode**: the rows stay `queued`, the bytes stay.
 * 1. **Claim atomically**, so two processes during a rolling restart cannot encode to one path.
 * 2. **Read the source and probe it, and refuse at the probe.** The cap is applied to the declared
 *    duration (five seconds of slack: the phone stops at the cap, so a header past it is not our
 *    client) before anything is decoded. A header that **declares no duration is not a refusal**:
 *    that is the normal case of a browser recording.
 * 3. **Encode, bounded by the cap whatever the header said.** The stored duration is the one the
 *    adapter measured on its output, never one the phone or the file declared.
 * 4. **The output goes into the store first, the row second**, as ingest does: a row naming bytes
 *    that do not exist is the failure 1.0 shipped, and the reverse is wreckage the sweep collects.
 * 5. **The row becomes `ready` through `markReady`**, which judges the quota inside its own
 *    transaction with **this voice's source credited**, because the output replaces it in the
 *    event's holdings. An event near its quota would otherwise refuse the file it is finishing.
 * 6. **Only then is the source deleted**, and the guest's phone and the console are told.
 *
 * ## Failure
 *
 * A failure is an outcome of the pass, not a failure of it. The entity decides, from the closed
 * table (`voiceFailureOf`), whether it comes back: a transient one with attempts left returns to
 * `queued` after a backoff, anything else is final. **The bytes go before the row does** when they
 * go at all: committing `failed` first would release the digest from the unique index, a re-upload
 * could reserve it in the gap, and the unlink would then take that new reservation's source.
 */

export interface TranscodeVoicePolicy {
  /** The longest message (`MAX_VOICE_SECONDS`): the encoder's `-t`, and the declared-length bound. */
  readonly maxDurationMs: number
  /** The ceiling on what the encoder may write (`-fs`), which the adapter also checks on disk. */
  readonly maxOutputBytes: number
}

export interface TranscodeNextVoiceDeps {
  readonly events: EventRepository
  /** For the ceilings of the event's client: its byte ceiling and its reduced quota. */
  readonly clients: ClientRepository
  readonly voices: GuestbookVoiceRepository
  readonly media: MediaStore
  readonly transcoder: AudioTranscoder
  readonly hasher: ContentHasher
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
  readonly policy: TranscodeVoicePolicy
}

export type TranscodeNextVoiceOutcome =
  /** Nothing was due. The ordinary answer for most of an evening. */
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'transcoded'
      readonly entryId: GuestbookEntryId
      readonly eventId: EventId
    }
  /** The message was erased while it was being worked on: the output was taken back, nothing is ready. */
  | {
      readonly kind: 'retired'
      readonly entryId: GuestbookEntryId
      readonly eventId: EventId
    }
  | {
      readonly kind: 'failed'
      readonly entryId: GuestbookEntryId
      readonly eventId: EventId
      readonly code: string
      readonly willRetry: boolean
    }

export type TranscodeNextVoice = () => Promise<Result<TranscodeNextVoiceOutcome, DomainError>>

/** A step that either carries on with a value or names why the recording is given up on. */
type Step<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string }
const stepOk = <T>(value: T): Step<T> => ({ ok: true, value })
const stepFailed = (code: string): { readonly ok: false; readonly code: string } => ({
  ok: false,
  code,
})

export const makeTranscodeNextVoice = ({
  events,
  clients,
  voices,
  media,
  transcoder,
  hasher,
  bus,
  clock,
  logger,
  policy,
}: TranscodeNextVoiceDeps): TranscodeNextVoice => {
  const spec: TranscodeVoiceSpec = {
    maxDurationMs: policy.maxDurationMs,
    minDurationMs: VOICE_MIN_MS,
    maxOutputBytes: policy.maxOutputBytes,
  }

  /**
   * Remove bytes this pass is finished with, **without letting the disk strand the row.** A
   * failing unlink is correlated with the failure that brought the worker here (a disk remounted
   * read-only), and an exception out of the pass would leave the row `running` for the life of the
   * process, holding a queue slot and the event's quota. Leaving bytes behind is the trade the
   * feature makes: `sweepOrphanedMedia` collects them.
   */
  const discard = async (eventId: EventId, hash: ContentHash): Promise<void> => {
    await media.delete(eventId, hash).catch((cause: unknown) => {
      logger.warn('could not remove a voice message’s bytes; left for the reconciliation sweep', {
        eventId,
        cause: String(cause),
      })
    })
  }

  /**
   * Take back an output this pass wrote, **and only if nothing else names it**: the output's digest
   * is a hash of bytes, and two recordings of the same sound can come out identical.
   */
  const unwind = async (eventId: EventId, hash: ContentHash): Promise<void> => {
    const named = await voices.listReferencedDigests(eventId).catch(() => null)
    // A lookup that cannot answer leaves the bytes: the sweep decides with the database in hand.
    if (named === null || named.has(hash.value)) return
    await discard(eventId, hash)
  }

  /** Record a failure and decide, through the entity, whether it comes back. Never throws. */
  const giveUpOn = async (
    entry: GuestbookEntry,
    voice: GuestbookVoice,
    code: string,
    now: Date,
  ): Promise<Result<TranscodeNextVoiceOutcome, DomainError>> => {
    const failed = voice.fail(code, now)
    if (!failed.ok) return failed

    // The bytes first, then the row, for the reason in the header.
    const givingUp = failed.value.state !== 'queued'
    if (givingUp) await discard(entry.eventId, voice.sourceHash)

    const stillThere = await voices.saveVoice(entry.eventId, entry.id, failed.value)
    const willRetry = stillThere && !givingUp
    if (stillThere && givingUp) bus.publish({ type: 'guestbook.voice', eventId: entry.eventId })

    logger.warn('voice transcode failed', {
      eventId: entry.eventId,
      entryId: entry.id,
      code,
      attempts: failed.value.attempts,
      willRetry,
    })

    return ok({ kind: 'failed', entryId: entry.id, eventId: entry.eventId, code, willRetry })
  }

  /** What the header says about the file, judged before anything is decoded. */
  const refusalAtProbe = async (source: Uint8Array): Promise<string | null> => {
    const probed = await transcoder.probe(source)
    if (!probed.ok) return probed.error.code
    return voiceDeclaredTooLong(probed.value.durationMs, policy.maxDurationMs)
      ? 'voice.tooLong'
      : null
  }

  return async () => {
    // **Before the claim, not after the probe.** A box that cannot encode (switch off, ffmpeg gone
    // after an upgrade) must leave the rows `queued` with their bytes: `voice.transcoderUnavailable`
    // is transient, but three transient failures are the end of the ladder, and a recording is the
    // one thing a guest cannot redo. The messages wait until the box can encode again.
    if (!transcoder.available()) return ok({ kind: 'idle' })

    const now = clock.now()

    const entry = await voices.claimNext(now)
    if (entry === null) return ok({ kind: 'idle' })
    const voice = entry.voice
    // Unreachable: the queue only holds voices. Failing the pass loudly beats guessing.
    if (voice === null) throw new Error(`guestbook entry ${entry.id} was claimed without a voice`)

    const event = await events.findById(entry.eventId)
    if (event === null) return giveUpOn(entry, voice, 'event.notFound', now)

    const source = await media.read(entry.eventId, voice.sourceHash, STAGED_SOURCE)
    if (source === null) return giveUpOn(entry, voice, 'voice.sourceMissing', now)

    const refused = await refusalAtProbe(source)
    if (refused !== null) return giveUpOn(entry, voice, refused, now)

    const encoded = await transcoder.transcode(source, spec)
    if (!encoded.ok) return giveUpOn(entry, voice, encoded.error.code, now)

    const { bytes, byteSize, durationMs } = encoded.value
    const hash = ContentHash.create(hasher.sha256Hex(bytes))
    if (!hash.ok) return giveUpOn(entry, voice, 'photo.hashFailed', now)

    const stored: Step<null> = await media
      .put(entry.eventId, hash.value, 'voice', bytes)
      .then(() => stepOk(null))
      .catch(async (cause: unknown) => {
        logger.error('could not store a transcoded voice message; removing what this pass wrote', {
          eventId: entry.eventId,
          entryId: entry.id,
          cause: String(cause),
        })
        await unwind(entry.eventId, hash.value)
        return stepFailed('voice.storageFailed')
      })
    if (!stored.ok) return giveUpOn(entry, voice, stored.code, now)

    const ready = voice.finish({ hash: hash.value, byteSize, durationMs }, now)
    if (!ready.ok) {
      await unwind(entry.eventId, hash.value)
      return giveUpOn(entry, voice, ready.error.code, now)
    }

    const context = await clientContextOf(clients, event)
    let finished: VoiceFinish
    try {
      finished = await voices.markReady(entry.eventId, entry.id, ready.value, {
        quotaBytes: event.effectiveQuotaBytes(context?.ceilings ?? null),
        clientBytes: clientBytesOf(context),
      })
    } catch (cause) {
      logger.error('could not record a transcoded voice message; removing what this pass wrote', {
        eventId: entry.eventId,
        entryId: entry.id,
        cause: String(cause),
      })
      await unwind(entry.eventId, hash.value)
      return giveUpOn(entry, voice, 'voice.storageFailed', now)
    }

    if (finished.kind === 'refused') {
      await unwind(entry.eventId, hash.value)
      return giveUpOn(entry, voice, admissionRefusalError(finished.refusal, byteSize).code, now)
    }

    if (finished.kind === 'gone') {
      // **No delete of the source here, and a guarded one of the output.** The guest erased the
      // message while it ran, and may already have sent the same recording again onto a reservation
      // that holds this very source digest, so only `sweepOrphanedMedia`, which asks the database,
      // may collect it. The output is ours and nothing names it.
      await unwind(entry.eventId, hash.value)
      logger.info('the voice message this pass transcoded was erased while it ran', {
        eventId: entry.eventId,
        entryId: entry.id,
      })
      return ok({ kind: 'retired', entryId: entry.id, eventId: entry.eventId })
    }

    // The row is `ready` and still blocks a re-upload (the unique index covers it), so the digest
    // is ours and the source can go. Best effort, for the reason `discard` gives.
    await discard(entry.eventId, voice.sourceHash)

    // Last, after the row says it is ready: the console's Messages tab re-reads. Never `guestbook.changed`,
    // which would make every wall read its playlist for a recording nobody on the wall will hear.
    bus.publish({ type: 'guestbook.voice', eventId: entry.eventId })

    return ok({ kind: 'transcoded', entryId: entry.id, eventId: entry.eventId })
  }
}
