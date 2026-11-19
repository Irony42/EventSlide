import type { ChannelKind } from '../../../domain/channels/channelKind'
import { senderKeyMaterial } from '../../../domain/channels/channelSender'
import type { ChannelSender } from '../../../domain/channels/inboundMessage'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { ChannelMediaJobRepository } from '../../ports/channelMediaJobRepository'
import type { ChannelSenderKeyer } from '../../ports/channelSenderKeyer'
import type { GuestRepository } from '../../ports/guestRepository'
import type { EraseGuestContribution } from '../guests/eraseGuestContribution'

/**
 * `/oublier`: a person erases what they sent to an event through a group (spec 27 §3, §7).
 *
 * It is **the same erasure as `DELETE /guests/me`**: `eraseGuestContribution` takes the photographs, clips,
 * reactions and guestbook lines and the guest row itself, which is where the sender's fingerprint lives. What
 * this adds is finding the guest from the sender, and taking back what is still on its way: the queued media of
 * that sender are deleted, so a photograph posted a second before is not stored a second after.
 *
 * A sender who never sent anything is not told so: the answer is the same "done". Scoped by the event of the
 * conversation, so being in two groups of two events is two separate erasures.
 */

export interface ForgetChannelSenderInput {
  readonly eventId: EventId
  readonly channel: ChannelKind
  readonly sender: ChannelSender
}

export interface ForgetChannelSenderDeps {
  readonly guests: GuestRepository
  readonly jobs: ChannelMediaJobRepository
  readonly keyer: ChannelSenderKeyer
  readonly eraseGuestContribution: EraseGuestContribution
}

export type ForgetChannelSender = (
  input: ForgetChannelSenderInput,
) => Promise<Result<void, DomainError>>

export const makeForgetChannelSender =
  ({ guests, jobs, keyer, eraseGuestContribution }: ForgetChannelSenderDeps): ForgetChannelSender =>
  async ({ eventId, channel, sender }) => {
    const senderKey = keyer.keyOf(senderKeyMaterial(channel, sender))

    await jobs.deleteBySender(eventId, senderKey)

    const guest = await guests.findByChannelSender(eventId, channel, senderKey)
    if (guest === null) return ok(undefined)

    const erased = await eraseGuestContribution({ eventId, guestId: guest.id })
    return erased.ok ? ok(undefined) : erased
  }
