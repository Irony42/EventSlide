import { spawn, type ChildProcess } from 'node:child_process'

/**
 * Running a child process safely enough to point it at a stranger's file.
 *
 * Every rule below closed a defect that is either a hang or a vulnerability, and none of
 * them is obvious from the `child_process` documentation:
 *
 * 1. **The `'error'` listener is attached before anything else.** `spawn` reports a
 *    missing binary asynchronously, on the `'error'` event, not by throwing — so
 *    `try { spawn(...) } catch {}` catches nothing and the promise never settles. A
 *    server with no ffmpeg on it would not fail; it would stop answering.
 * 2. **Never `shell: true`.** On Windows that is CVE-2024-27980, where an argument
 *    containing a quote becomes a command. The cost is that Node will not run a `.bat` or
 *    `.cmd` without it, which is why the caller resolves an absolute executable instead.
 * 3. **`-nostdin` and `stdio[0]: 'ignore'`.** ffmpeg reads the parent's stdin when it has
 *    one, which in a terminal means it eats the operator's keystrokes and in a container
 *    means it can block.
 * 4. **stdout and stderr are consumed continuously**, into a bounded tail. A pipe nobody
 *    reads fills at 64 KB and the child blocks writing to it — forever. That is a hang,
 *    not a failure, and it is invisible in every log. `execFile` is not an option
 *    either: its 1 MB `maxBuffer` kills the child on exactly the corrupt files whose
 *    diagnostics you wanted.
 * 5. **SIGTERM, then SIGKILL.** Node's own `timeout` option sends SIGTERM, which a
 *    decoder spinning inside a demuxer loop never handles. Escalation is the only thing
 *    that actually ends it.
 * 6. **A stall bound as well as a wall-clock bound.** A pathological input can keep a
 *    process technically alive and producing nothing; a wall clock generous enough for a
 *    legitimate 4K clip is far too generous for that.
 * 7. **`kill()` is exposed**, because a child is orphaned by a container stop rather than
 *    stopped by it — a new container would start the same job while the old ffmpeg burns
 *    a core for the rest of the evening.
 */

/**
 * **stdout and stderr are different kinds of thing, and one bound for both is a bug.**
 *
 * stderr is a *diagnostic*: what matters is the last line, so it is kept as a tail and
 * 8 KB is generous. stdout is *output* — `ffprobe -print_format json` and
 * `ffmpeg -encoders` both write an answer a caller parses — so keeping the tail of it
 * means handing the parser a document with its head cut off.
 *
 * Both defects have now been paid for. `ffmpeg -encoders` prints some thirty kilobytes
 * alphabetically, so an 8 KB tail started around `v` and the capability check concluded
 * a perfectly good build had no `libx264`. Worse, an ordinary four-stream iPhone clip's
 * `ffprobe` JSON is **7.9 KB** — 97% of that same budget — so a fifth stream (spatial
 * audio, a display matrix, a timecode track) pushed it over, `JSON.parse` threw, and a
 * clip that decodes perfectly was answered `clip.corrupt`.
 *
 * So the two streams get two budgets, and a truncated stdout is **reported** rather than
 * silently handed over: a caller that parses output must be able to tell "this is what
 * the process said" from "this is the end of what the process said".
 */
const DEFAULT_STDOUT_BYTES = 4 * 1024 * 1024
const DEFAULT_STDERR_BYTES = 8 * 1024

export interface RunProcessOptions {
  /** An absolute path. Never a bare name, and never anything the shell would parse. */
  readonly binary: string
  readonly args: readonly string[]
  /** Wall-clock ceiling for the whole run. */
  readonly timeoutMs: number
  /**
   * How long the child may produce nothing before it is considered wedged. Every chunk
   * on either stream resets it, which is why the encoder is asked for `-progress`.
   */
  readonly stallMs: number
  /** How much stdout to keep. Output, not a diagnostic — see {@link DEFAULT_STDOUT_BYTES}. */
  readonly stdoutBytes?: number
  /** How much stderr to keep. The **tail**, because a failure's reason is its last line. */
  readonly stderrBytes?: number
  /** How long SIGTERM is given before SIGKILL. */
  readonly killGraceMs?: number
}

export type RunFailure =
  /** The binary could not be started at all: missing, not executable, wrong arch. */
  | 'spawnFailed'
  /** The wall-clock ceiling or the stall bound was reached; the child was killed. */
  | 'timedOut'
  /**
   * The caller asked for it to stop — shutdown, not a fault of the input.
   *
   * Separate from `timedOut` because the two mean opposite things to whoever classifies
   * the failure: a stall is a property of the file and comes back as a refusal, while a
   * cancellation is a property of the deployment and must not cost a guest their clip.
   * They were one value, and `dispose()` therefore reported every in-flight transcode as
   * a timeout — a *permanent* failure, which deleted the staged source on the first
   * attempt. It did not bite only because `process.exit` won the race, which is not a
   * guarantee, it is luck.
   */
  | 'cancelled'
  /** It ran and exited non-zero. */
  | 'exited'

export interface RunResult {
  readonly ok: boolean
  readonly failure: RunFailure | null
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  /** What the process wrote to stdout, up to the budget. */
  readonly stdout: string
  /**
   * True when stdout hit its budget and the beginning was dropped.
   *
   * A caller that parses stdout must refuse rather than parse: a truncated JSON document
   * is not a malformed one, and the difference decides whether a guest's clip is retried
   * or destroyed.
   */
  readonly stdoutTruncated: boolean
  /** The kept tail of stderr, as text. */
  readonly stderr: string
}

const DEFAULT_KILL_GRACE_MS = 2_000

/** A bounded tail. Keeps the end of the stream, which is where a failure's reason is. */
class Tail {
  constructor(private readonly limit: number) {}

  private chunks: Buffer[] = []

  private size = 0

  /** Whether anything was dropped, so a parser can refuse instead of guessing. */
  truncated = false

  append(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.size += chunk.length
    while (this.size > this.limit && this.chunks.length > 1) {
      const dropped = this.chunks.shift()
      this.size -= dropped === undefined ? 0 : dropped.length
      this.truncated = true
    }
  }

  toString(): string {
    return Buffer.concat(this.chunks, this.size).subarray(-this.limit).toString('utf8')
  }
}

export interface RunningProcess {
  readonly finished: Promise<RunResult>
  /** SIGTERM now, SIGKILL shortly after. Idempotent; safe once the child has exited. */
  kill(): void
}

export const startProcess = ({
  binary,
  args,
  timeoutMs,
  stallMs,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  stdoutBytes = DEFAULT_STDOUT_BYTES,
  stderrBytes = DEFAULT_STDERR_BYTES,
}: RunProcessOptions): RunningProcess => {
  const stdout = new Tail(stdoutBytes)
  const stderr = new Tail(stderrBytes)

  let settled = false
  /** `null` while the run is its own; set by the wall clock, the stall bound or a kill. */
  let endedBy: 'timedOut' | 'cancelled' | null = null
  let child: ChildProcess | null = null
  let wallTimer: NodeJS.Timeout | null = null
  let stallTimer: NodeJS.Timeout | null = null
  let killTimer: NodeJS.Timeout | null = null

  let resolveFinished: (result: RunResult) => void = () => {}
  const finished = new Promise<RunResult>((resolve) => {
    resolveFinished = resolve
  })

  const clearTimers = (): void => {
    for (const timer of [wallTimer, stallTimer, killTimer]) {
      if (timer !== null) clearTimeout(timer)
    }
    wallTimer = null
    stallTimer = null
    killTimer = null
  }

  const settle = (result: RunResult): void => {
    if (settled) return
    settled = true
    clearTimers()
    resolveFinished(result)
  }

  const terminate = (): void => {
    if (child === null || child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    // A decoder inside a demuxer loop never handles SIGTERM. This is the escalation that
    // actually ends it, and it must not hold the event loop open on its own.
    killTimer = setTimeout(() => {
      if (child !== null) child.kill('SIGKILL')
    }, killGraceMs)
    killTimer.unref()
  }

  const giveUp = (): void => {
    endedBy ??= 'timedOut'
    terminate()
  }

  const resetStall = (): void => {
    if (stallTimer !== null) clearTimeout(stallTimer)
    stallTimer = setTimeout(giveUp, stallMs)
    stallTimer.unref()
  }

  try {
    child = spawn(binary, [...args], {
      // stdin ignored, both output streams piped and read. Never `shell`.
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (cause) {
    // A synchronous throw is possible for a malformed argument list, which is a bug
    // here rather than a condition — but leaving the promise unsettled would be worse.
    settle({
      ok: false,
      failure: 'spawnFailed',
      code: null,
      signal: null,
      stdout: '',
      stdoutTruncated: false,
      stderr: String(cause),
    })
    return { finished, kill: () => {} }
  }

  // **Before anything else.** ENOENT arrives here, asynchronously, and nowhere else.
  child.on('error', (error) => {
    settle({
      ok: false,
      failure: 'spawnFailed',
      code: null,
      signal: null,
      stdout: stdout.toString(),
      stdoutTruncated: stdout.truncated,
      stderr: error.message,
    })
  })

  child.stdout?.on('data', (chunk: Buffer) => {
    stdout.append(chunk)
    resetStall()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr.append(chunk)
    resetStall()
  })

  child.on('close', (code, signal) => {
    const failed = endedBy !== null || code !== 0
    settle({
      ok: !failed,
      failure: failed ? (endedBy ?? 'exited') : null,
      code,
      signal,
      stdout: stdout.toString(),
      stdoutTruncated: stdout.truncated,
      stderr: stderr.toString(),
    })
  })

  wallTimer = setTimeout(giveUp, timeoutMs)
  wallTimer.unref()
  resetStall()

  return {
    finished,
    kill: () => {
      // Shutdown. Without this the child is orphaned rather than stopped, and a new
      // container starts the same job while the old encoder holds a core.
      //
      // Recorded as `cancelled`, never as `timedOut`: the two are opposite claims about
      // whose fault it was, and the classifier acts on the difference.
      endedBy ??= 'cancelled'
      terminate()
    },
  }
}

/** The common case: start it, wait for it. */
export const runProcess = async (options: RunProcessOptions): Promise<RunResult> =>
  startProcess(options).finished
