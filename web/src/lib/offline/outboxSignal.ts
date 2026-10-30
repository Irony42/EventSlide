/**
 * "The photos you were waiting for are in the store now", said between two screens of one tab.
 *
 * A guest who leaves the upload screen while photos are on their way has them written to the outbox
 * by the screen that is going away (INV-1), and that can take seconds when the shrinking is slow. A
 * guest who comes straight back opens a new screen whose own first look at the store happened before
 * those writes landed, and nothing else would make it look again until the network or the tab
 * visibility changed. The old screen says so when its last write is done, and the new one looks.
 *
 * A BroadcastChannel and not a shared variable, because the two screens are two instances of a hook
 * with nothing in common but the origin. Where the browser has none, nothing is said and the next
 * `online` or visibility event does what it always did: this is a convenience, never a requirement.
 */

const channelName = (slug: string): string => `eventslide-outbox:${slug}`

const available = (): boolean => typeof BroadcastChannel === 'function'

/** Tells every other screen of this event that photos were just written to the outbox. */
export const announceHandOver = (slug: string): void => {
  if (!available()) return
  try {
    const channel = new BroadcastChannel(channelName(slug))
    channel.postMessage('written')
    channel.close()
  } catch {
    // A channel the browser refuses is the same as no channel: nothing to tell, nobody to tell it to.
  }
}

/** Calls `onWritten` whenever another screen of this event announces a hand-over. Returns the way to stop. */
export const listenForHandOver = (slug: string, onWritten: () => void): (() => void) => {
  if (!available()) return () => {}
  try {
    const channel = new BroadcastChannel(channelName(slug))
    channel.onmessage = onWritten
    return () => channel.close()
  } catch {
    return () => {}
  }
}
