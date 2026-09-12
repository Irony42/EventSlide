/**
 * The switch that turns the offline queue off, on a phone that is already carrying it.
 *
 * Service-worker lifecycle bugs are hard to reproduce and easy to ship, and the thing
 * that makes them frightening is that a bad worker installed on a guest's phone keeps
 * running after the deploy that fixed it. So "off" here is not a flag that stops new
 * work: it actively unregisters the worker and deletes the stored photos on the next
 * page load, which is the only kind of kill switch worth having.
 *
 * Two ways in, because the two audiences are different:
 *
 * - `?offline=off` on any URL, for a host or an engineer holding one misbehaving phone
 *   at an event. It persists, so the guest does not have to keep the query string.
 * - `localStorage`, which is where that decision is kept and how an automated test
 *   states it without a navigation.
 *
 * There is deliberately no server-side switch. Adding one would mean an endpoint the
 * guest surface must reach *before* it can decide whether it needs to work offline,
 * which is the one request that cannot be assumed to succeed.
 */

const KEY = 'eventslide.offline'
const OFF = 'off'
const ON = 'on'

/** Reads the persisted decision, tolerating a storage area that throws. */
const read = (): string | null => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    // Safari in private browsing throws on access. Defaulting to enabled is right:
    // the queue degrades to the in-memory fallback there anyway.
    return null
  }
}

const write = (value: string): void => {
  try {
    localStorage.setItem(KEY, value)
  } catch {
    // The query parameter still governs this page load; only the memory of it is lost.
  }
}

/**
 * Applies `?offline=off` / `?offline=on` and returns whether the queue may run.
 *
 * Any other value — including none — leaves the persisted decision alone, so an
 * ordinary join link never resets a switch somebody set deliberately.
 */
export const resolveOfflineQueue = (search: string): boolean => {
  const requested = new URLSearchParams(search).get('offline')
  // Only a value this build understands is allowed to overrule the stored decision.
  // Folding an unrecognised one into the same comparison read as "not off, therefore
  // on" — so `?offline=maybe` quietly re-enabled a queue somebody had switched off.
  if (requested === OFF || requested === ON) {
    write(requested)
    return requested !== OFF
  }
  return read() !== OFF
}

/** Whether the queue is enabled, without consulting a URL. */
export const isOfflineQueueEnabled = (): boolean => read() !== OFF
