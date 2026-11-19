import { ChannelBinding } from '../../domain/channels/channelBinding'
import type { ChannelKind } from '../../domain/channels/channelKind'
import type { ChannelBindingId, EventId } from '../../domain/shared/ids'
import type { ChannelBindingRepository } from '../ports/channelBindingRepository'
import { compareIds } from './ordering'

/**
 * In-memory `ChannelBindingRepository`, behaving as the adapter does: the counter belongs to the
 * repository (a save never writes it), a save keeps the event, the channel and the instant of binding,
 * and a second active binding of one conversation is refused like the unique index refuses it.
 */
export class FakeChannelBindingRepository implements ChannelBindingRepository {
  private readonly rows = new Map<string, ChannelBinding>()

  async findActive(channel: ChannelKind, conversationRef: string): Promise<ChannelBinding | null> {
    return (
      [...this.rows.values()].find(
        (binding) =>
          binding.isActive() &&
          binding.channel === channel &&
          binding.conversationRef === conversationRef,
      ) ?? null
    )
  }

  async findById(eventId: EventId, bindingId: ChannelBindingId): Promise<ChannelBinding | null> {
    const stored = this.rows.get(bindingId)
    return stored !== undefined && stored.eventId === eventId ? stored : null
  }

  async listActiveForEvent(eventId: EventId): Promise<readonly ChannelBinding[]> {
    return [...this.rows.values()]
      .filter((binding) => binding.eventId === eventId && binding.isActive())
      .sort(
        (left, right) =>
          left.boundAt.getTime() - right.boundAt.getTime() || compareIds(left.id, right.id),
      )
  }

  async save(binding: ChannelBinding): Promise<void> {
    const stored = this.rows.get(binding.id)
    if (stored !== undefined && stored.eventId !== binding.eventId) {
      throw new Error(`channel_bindings.id ${binding.id} is already held by another event`)
    }
    const taken = [...this.rows.values()].some(
      (other) =>
        other.id !== binding.id &&
        binding.isActive() &&
        other.isActive() &&
        other.channel === binding.channel &&
        other.conversationRef === binding.conversationRef,
    )
    if (taken) {
      throw new Error('channel_bindings: this conversation already has an active binding')
    }

    const props = binding.toProps()
    this.rows.set(
      binding.id,
      stored === undefined
        ? binding
        : ChannelBinding.restore({
            ...props,
            channel: stored.channel,
            boundAt: stored.boundAt,
            receivedCount: stored.receivedCount,
          }),
    )
  }

  async recordReceived(bindingId: ChannelBindingId): Promise<void> {
    const stored = this.rows.get(bindingId)
    if (stored === undefined) return
    this.rows.set(
      bindingId,
      ChannelBinding.restore({ ...stored.toProps(), receivedCount: stored.receivedCount + 1 }),
    )
  }

  /** What `ON DELETE CASCADE` does when the event is purged. */
  removeEvent(eventId: EventId): void {
    for (const [id, binding] of this.rows) if (binding.eventId === eventId) this.rows.delete(id)
  }
}
