/**
 * Runs work one at a time per key, in the order it was asked (spec 27 review): the worker storing a photograph for a
 * sender and that sender's `/oublier` must not interleave, or a photograph is stored for a guest who was just erased.
 * One process holds the queue, so an in-process chain is enough; a throwing task releases the key like any other.
 */
export interface EventLock {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
}

export const makeEventLock = (): EventLock => {
  const tails = new Map<string, Promise<unknown>>()
  return {
    run: <T>(key: string, task: () => Promise<T>): Promise<T> => {
      const previous = tails.get(key) ?? Promise.resolve()
      const result = previous.then(task, task)
      const tail = result.then(
        () => undefined,
        () => undefined,
      )
      tails.set(key, tail)
      // Forget the key once nobody is queued behind this task, so the map does not grow with the events of a year.
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key)
      })
      return result
    },
  }
}
