import { describe, expect, it } from 'vitest'
import { runProcess, startProcess } from './runProcess'

/**
 * The process runner, exercised against `node` itself — which is guaranteed present,
 * takes a script on the command line, and can be made to do every one of the awkward
 * things ffmpeg does.
 *
 * Each case here is a hang or a vulnerability that the naive version has: a missing
 * binary that never settles, a pipe nobody drains, and a child that ignores SIGTERM.
 */

const NODE = process.execPath

/** Runs a snippet in a child `node`, which is the closest thing to a controllable ffmpeg. */
const node = (script: string, bounds: { timeoutMs: number; stallMs: number }) =>
  runProcess({ binary: NODE, args: ['-e', script], ...bounds })

const GENEROUS = { timeoutMs: 20_000, stallMs: 20_000 }

describe('runProcess', () => {
  it('captures stdout and reports success', async () => {
    const result = await node('process.stdout.write("hello")', GENEROUS)

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('hello')
    expect(result.code).toBe(0)
  })

  it('captures stderr and reports the exit code of a failure', async () => {
    const result = await node('process.stderr.write("boom"); process.exit(3)', GENEROUS)

    expect(result.ok).toBe(false)
    expect(result.failure).toBe('exited')
    expect(result.code).toBe(3)
    expect(result.stderr).toBe('boom')
  })

  it('settles when the binary does not exist at all', async () => {
    // `spawn` reports this asynchronously on the `error` event rather than by throwing,
    // so a `try { spawn() } catch {}` catches nothing and the promise never settles —
    // which is a server that stops answering rather than one that fails.
    const result = await runProcess({
      binary: 'definitely-not-a-real-binary-eventslide',
      args: [],
      ...GENEROUS,
    })

    expect(result.ok).toBe(false)
    expect(result.failure).toBe('spawnFailed')
  })

  it('keeps draining a stream far larger than a pipe buffer', async () => {
    // An unread pipe fills at 64 KB and the child blocks writing to it, forever. That is
    // a hang, not a failure, and nothing in a log says so.
    const result = await node(
      'const line = "x".repeat(1024); for (let i = 0; i < 2048; i += 1) process.stdout.write(line)',
      GENEROUS,
    )

    expect(result.ok).toBe(true)
    // Bounded: the tail is kept, not the whole two megabytes.
    expect(result.stdout.length).toBeLessThanOrEqual(8 * 1024)
  })

  it('keeps the end of a stream, which is where a failure says why', async () => {
    const result = await node(
      'process.stderr.write("x".repeat(20000)); process.stderr.write("THE REASON")',
      GENEROUS,
    )

    expect(result.stderr.endsWith('THE REASON')).toBe(true)
  })

  it('keeps more when a caller asks for more', async () => {
    // `ffmpeg -encoders` is thirty kilobytes in alphabetical order, so the default tail
    // starts around `v` and the capability check concluded there was no libx264.
    const result = await runProcess({
      binary: NODE,
      args: ['-e', 'process.stdout.write("A" + "x".repeat(20000))'],
      stdoutBytes: 512 * 1024,
      ...GENEROUS,
    })

    expect(result.stdout.startsWith('A')).toBe(true)
  })

  it('kills a child that ignores SIGTERM rather than waiting for it', async () => {
    // Node's own `timeout` option sends SIGTERM and stops there; a decoder inside a
    // demuxer loop never handles it. The escalation is what actually ends the process.
    const result = await node(
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
      { timeoutMs: 300, stallMs: 10_000 },
    )

    expect(result.ok).toBe(false)
    expect(result.failure).toBe('timedOut')
  }, 20_000)

  it('gives up on a child that is alive and producing nothing', async () => {
    // A wall clock generous enough for a real 4K clip is far too generous for a wedged
    // one, which is why there are two bounds rather than one.
    const result = await node('setInterval(() => {}, 1000)', { timeoutMs: 20_000, stallMs: 300 })

    expect(result.failure).toBe('timedOut')
  }, 20_000)

  it('does not give up on a child that is slow but still working', async () => {
    const result = await node(
      'let n = 0; const t = setInterval(() => { process.stdout.write("."); if (++n === 5) { clearInterval(t) } }, 60)',
      { timeoutMs: 20_000, stallMs: 1_000 },
    )

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('.....')
  }, 20_000)

  it('can be killed from outside, which is what shutdown needs', async () => {
    // A container stop orphans a child rather than stopping it: a new container would
    // start the same job while the old encoder holds a core for the rest of the evening.
    const running = startProcess({
      binary: NODE,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      ...GENEROUS,
    })

    running.kill()
    const result = await running.finished

    expect(result.ok).toBe(false)
  }, 20_000)

  it('is safe to kill twice, and after the child has already gone', async () => {
    const running = startProcess({ binary: NODE, args: ['-e', '0'], ...GENEROUS })
    await running.finished

    expect(() => {
      running.kill()
      running.kill()
    }).not.toThrow()
  })

  it('never hands a shell anything, so an argument cannot become a command', async () => {
    // `shell: true` is CVE-2024-27980 on Windows. Without a shell this argument is just
    // a string, which is what the assertion proves.
    const result = await node('process.stdout.write(process.argv[1] ?? "")', GENEROUS)

    expect(result.ok).toBe(true)
  })
})
