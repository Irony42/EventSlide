import {
  startProcess,
  type RunningProcess,
  type RunProcessOptions,
  type RunResult,
} from './runProcess'

export interface ChildRunner {
  /** Runs one child under this runner's environment, and tracks it until it finishes. */
  run(
    binary: string,
    args: readonly string[],
    bounds: Omit<RunProcessOptions, 'binary' | 'args' | 'env'>,
  ): Promise<RunResult>
  /** Kills every child in flight and refuses every later run. Idempotent. */
  close(): void
  isClosed(): boolean
}

/**
 * The children one adapter has started, so that `close()` can stop them and a job claimed
 * during shutdown cannot start another.
 *
 * `env` is the runner's, and deliberately not part of what a caller can override: every
 * child an adapter starts gets the same minimal environment, with no per-call escape hatch
 * back to the server's own.
 *
 * After `close()` a run answers `cancelled` without spawning, the same word a killed
 * child gets: a cancellation is a property of the deployment and must not cost a guest
 * their clip. Before this, a run that began after `close()` spawned an encoder nobody
 * would ever kill.
 */
export const createChildRunner = (
  env: Readonly<Record<string, string>>,
  start: (options: RunProcessOptions) => RunningProcess = startProcess,
): ChildRunner => {
  const running = new Set<RunningProcess>()
  let closed = false

  return {
    run: async (binary, args, bounds) => {
      if (closed) {
        return {
          ok: false,
          failure: 'cancelled',
          code: null,
          signal: null,
          stdout: '',
          stdoutTruncated: false,
          stderr: '',
        }
      }
      const child = start({ binary, args, env, ...bounds })
      running.add(child)
      try {
        return await child.finished
      } finally {
        running.delete(child)
      }
    },
    close: () => {
      closed = true
      for (const child of [...running]) child.kill()
    },
    isClosed: () => closed,
  }
}
