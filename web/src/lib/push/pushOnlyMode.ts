/**
 * Whether the service worker is in **push-only** mode (spec 30, lot 4): the registration stays because a
 * browser notification is subscribed on it, but the worker does not serve the app shell or drain the
 * outbox (the offline queue is switched off).
 *
 * Held in the Cache Storage, **not in memory**: a worker is stopped and started again by the browser all
 * the time (and a push wakes it), and a flag kept in a variable was lost at the first restart. The
 * entry is one tiny response in a cache of its own, whose name does not start with the shell's prefix,
 * so sweeping the shell caches never removes it. Everything goes through a `CacheStorage`-shaped value so
 * that it is tested without a browser.
 */

export const PUSH_ONLY_CACHE = 'eventslide-push-only'
const ENTRY = '/__push-only__'

/** The part of `CacheStorage` this needs. */
export interface ModeStorage {
  open(name: string): Promise<{
    match(request: string): Promise<Response | undefined>
    put(request: string, response: Response): Promise<void>
    delete(request: string): Promise<boolean>
  }>
}

/** Whether the mode is on. Never rejects: a storage that cannot be read is "not push-only". */
export const readPushOnly = async (storage: ModeStorage): Promise<boolean> => {
  try {
    const cache = await storage.open(PUSH_ONLY_CACHE)
    return (await cache.match(ENTRY)) !== undefined
  } catch {
    return false
  }
}

/** Turns the mode on or off. Never rejects. */
export const writePushOnly = async (storage: ModeStorage, on: boolean): Promise<void> => {
  try {
    const cache = await storage.open(PUSH_ONLY_CACHE)
    if (on) await cache.put(ENTRY, new Response('on'))
    else await cache.delete(ENTRY)
  } catch {
    // Nothing to keep it in: the worker serves as it always did, which is the safe side.
  }
}
