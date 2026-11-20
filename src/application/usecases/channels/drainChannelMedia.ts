import { admitMedia, type AdmissionLimits } from '../../../domain/channels/channelAdmission'
import { replyReasonOfCode } from '../../../domain/channels/channelReplies'
import { shouldRenameGuest, senderDisplayName } from '../../../domain/channels/channelSender'
import { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import { err, flatMap, ok } from '../../../domain/shared/result'
import type { ChannelBindingRepository } from '../../ports/channelBindingRepository'
import type {
  ChannelMediaJob,
  ChannelMediaJobRepository,
} from '../../ports/channelMediaJobRepository'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { Logger } from '../../ports/logger'
import type { MessagingChannel } from '../../ports/messagingChannel'
import { ceilingsOf } from '../clients/clientContextOf'
import type { UploadClip } from '../clips/uploadClip'
import type { UploadOutcome, UploadPhotos } from '../photos/uploadPhotos'
import type { ChannelReplier } from './channelReplier'

/**
 * The worker's step (spec 27 §5): take one queued media, make it a photograph or a clip of the event, say so.
 *
 * It re-reads everything the queue could have outlived: the binding (a group unlinked since the message is a
 * job dropped), the event (closed since, or switched off), the plan, the guest (revoked since). Then it
 * **does not trust the declaration**: the size, the format and the length the message claimed only decided whether
 * the file was worth fetching; the photograph and clip pipelines read the bytes and decide for good, exactly as
 * they do for a phone, so a photograph from a group meets the same moderation, the same ceilings and the same
 * quotas as any other (`uploadPhotos` publishes `photo.uploaded` and the wall follows).
 *
 * **The sender becomes a guest here**, not when the message arrives: an unbound conversation, a refused media or a
 * flood must not mint guests. The first accepted media creates one (name: first name and initial, never the
 * channel's identifier), the next ones find it, a changed name renames it, a revoked one is refused silently.
 *
 * **A failure of the network is tried again, three times at most, with a growing wait**: a Telegram file reference
 * stays valid, so there is no clock to race. Anything else is final and, when it is something a person can act on
 * (too heavy, closed, the roll is full, a format we do not take), said once in the conversation. What is not said
 * stays in the log as a code, never a message from the remote service.
 */

export interface DrainChannelMediaDeps {
  readonly events: EventRepository
  readonly clients: ClientRepository
  readonly guests: GuestRepository
  readonly bindings: ChannelBindingRepository
  readonly jobs: ChannelMediaJobRepository
  readonly channels: ReadonlyMap<ChannelMediaJob['channel'], MessagingChannel>
  readonly uploadPhotos: UploadPhotos
  readonly uploadClip: UploadClip
  readonly replier: ChannelReplier
  readonly ids: IdGenerator
  readonly clock: Clock
  readonly logger: Logger
  /** The size, clip and format ceilings of this box (the clips switch is the event's, read here). */
  readonly limits: Omit<AdmissionLimits, 'clipsAccepted'>
}

export type DrainOutcome = 'idle' | 'stored' | 'duplicate' | 'refused' | 'retry' | 'skipped'

export type DrainChannelMedia = (signal: AbortSignal) => Promise<DrainOutcome>

/** A job is taken at most this many times: the first try and two more. */
export const MAX_ATTEMPTS = 3
/** The wait before the second try; the third waits twice as long. */
export const RETRY_BASE_MS = 30_000

export const makeDrainChannelMedia = (deps: DrainChannelMediaDeps): DrainChannelMedia => {
  const { events, clients, guests, bindings, jobs, channels, replier, ids, clock, logger } = deps

  return async (signal) => {
    const job = await jobs.claimNext(clock.now())
    if (job === null) return 'idle'

    /** Ends the job as failed and counts it: a code, never a message from the remote service. */
    const end = async (code: string, outcome: 'refused' | 'skipped'): Promise<DrainOutcome> => {
      await jobs.finish(job.id, { status: 'failed', failureCode: code }, clock.now())
      logger.info('channel.media', { eventId: job.eventId, outcome, code })
      return outcome
    }

    // A media that keeps crashing the process is put back by the recovery, each time one more attempt: it ends here.
    if (job.attempts >= MAX_ATTEMPTS) return end('channel.attemptsExhausted', 'skipped')

    const binding = await bindings.findById(job.eventId, job.bindingId)
    if (binding === null || !binding.isActive()) return end('channel.unbound', 'skipped')
    const channel = channels.get(job.channel)
    if (channel === undefined) return end('channel.unavailable', 'skipped')
    const event = await events.findById(job.eventId)
    if (event === null) return end('event.notFound', 'skipped')
    const language = event.settings.wallLanguage

    /** A refusal a person can act on is said once an hour in their conversation; the rest stays in the log. */
    const refuse = async (code: string): Promise<DrainOutcome> => {
      const outcome = await end(code, 'refused')
      const reason = replyReasonOfCode(code)
      if (reason !== null) {
        await replier.say(
          channel,
          job.conversationRef,
          job.senderKey,
          { reason },
          language,
          job.messageRef,
        )
      }
      return outcome
    }

    if (!event.acceptsUploads()) return refuse('event.notAcceptingUploads')

    const treatment = admitMedia(job, {
      ...deps.limits,
      clipsAccepted: event.acceptsClips(await ceilingsOf(clients, event)),
    })
    if (!treatment.ok) return refuse(treatment.error.code)

    const maxBytes =
      treatment.value.kind === 'photo' ? deps.limits.maxPhotoBytes : deps.limits.maxVideoBytes
    const downloaded = await channel.download(job.fileRef, maxBytes, signal)
    if (!downloaded.ok) {
      const { code, retryable } = downloaded.error
      if (retryable && job.attempts + 1 < MAX_ATTEMPTS) {
        const now = clock.now()
        const wait = RETRY_BASE_MS * 2 ** job.attempts
        await jobs.retryLater(job.id, now, new Date(now.getTime() + wait))
        return 'retry'
      }
      return refuse(retryable ? 'channel.downloadFailed' : code)
    }

    // An erasure (`/oublier`) deletes the sender's jobs: a job that is gone, or no longer ours, was cancelled while
    // the file travelled, and nothing it carried may be stored or its sender recreated.
    const still = await jobs.findById(job.eventId, job.id)
    if (still === null || still.status !== 'running') {
      logger.info('channel.media', {
        eventId: job.eventId,
        outcome: 'skipped',
        code: 'channel.cancelled',
      })
      return 'skipped'
    }

    // The guest: found, or created on this first accepted media; renamed if the channel shows another name;
    // refused (silently) if the host revoked them. One chain, one failure.
    const known = await guests.findByChannelSender(job.eventId, job.channel, job.senderKey)
    const name = senderDisplayName(job.senderName)
    const resolved = flatMap(
      known === null
        ? Guest.create(
            {
              eventId: job.eventId,
              displayName: name,
              channelIdentity: { channel: job.channel, senderKey: job.senderKey },
            },
            ids.guestId(),
            clock.now(),
          )
        : known.isRevoked()
          ? err(DomainError.forbidden('guest.revoked'))
          : ok(known),
      (guest) => (shouldRenameGuest(guest.displayName, name) ? guest.rename(name) : ok(guest)),
    )
    if (!resolved.ok) return end(resolved.error.code, 'refused')
    const guest = resolved.value
    if (guest !== known) await guests.save(guest)

    const author = { kind: 'guest', guestId: guest.id } as const
    let duplicate: boolean
    if (treatment.value.kind === 'photo') {
      const uploaded = await deps.uploadPhotos({
        eventId: job.eventId,
        author,
        files: [{ bytes: downloaded.value, declaredName: job.declaredName }],
      })
      if (!uploaded.ok) return refuse(uploaded.error.code)
      // One file went in, so one outcome came out.
      const [outcome] = uploaded.value.outcomes as readonly [UploadOutcome, ...UploadOutcome[]]
      if (outcome.kind === 'refused') return refuse(outcome.error.code)
      duplicate = outcome.kind === 'duplicate'
    } else {
      const uploaded = await deps.uploadClip({
        eventId: job.eventId,
        author,
        file: { bytes: downloaded.value, declaredName: job.declaredName },
        trim: treatment.value.trim,
      })
      if (!uploaded.ok) return refuse(uploaded.error.code)
      duplicate = uploaded.value.duplicate
    }

    await jobs.finish(job.id, { status: 'done' }, clock.now())
    if (!duplicate) await bindings.recordReceived(binding.id)
    await channel.acknowledge(job.conversationRef, job.messageRef)
    logger.info('channel.media', {
      eventId: job.eventId,
      outcome: duplicate ? 'duplicate' : 'stored',
    })
    return duplicate ? 'duplicate' : 'stored'
  }
}
