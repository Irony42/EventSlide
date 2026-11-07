/**
 * Runs tasks that share a key one after another, and tasks with different keys side by side.
 *
 * A key's entry lives only while a task for it is pending: `size` is how many keys are being
 * waited on, and goes back to 0 once everything settled, so a long-lived process does not grow
 * one entry per key it ever saw. A task that rejects does not stop the ones behind it; its own
 * caller still gets the rejection.
 */
export interface KeyedQueue {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
  readonly size: number
}

export const createKeyedQueue = (): KeyedQueue => {
  const queues = new Map<string, Promise<void>>()
  return {
    run: <T>(key: string, task: () => Promise<T>): Promise<T> => {
      const ahead = queues.get(key) ?? Promise.resolve()
      const run = ahead.then(task)
      const settled = run.then(
        () => undefined,
        () => undefined,
      )
      queues.set(key, settled)
      void settled.then(() => {
        if (queues.get(key) === settled) queues.delete(key)
      })
      return run
    },
    get size(): number {
      return queues.size
    },
  }
}
