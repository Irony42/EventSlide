import type { ChannelSenderKeyer } from '../ports/channelSenderKeyer'

/**
 * A keyer a test can read: `key:` and the material, so an assertion names the sender it means. Like the
 * real one it is deterministic and one-way as far as a caller is concerned: nothing in the application
 * derives the material back from the key.
 */
export class FakeChannelSenderKeyer implements ChannelSenderKeyer {
  keyOf(material: string): string {
    return `key:${material}`
  }
}
