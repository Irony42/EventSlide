/**
 * A controllable stand-in for `EventSource`.
 *
 * jsdom implements no `EventSource`, and a real one would need a server. This is the
 * same category of double as the `IntersectionObserver` stub in `setup.ts`: it stands
 * in for a browser API and stubs no application code, so the hook or page under test
 * stays real.
 *
 * It extends `EventTarget`, so `addEventListener` and `dispatchEvent` are the
 * platform's own rather than a hand-rolled registry that could disagree with them.
 * Install it with `vi.stubGlobal('EventSource', FakeEventSource)` and call `reset()`
 * first so a test only sees the connections it opened.
 *
 * `emit*` helpers dispatch outside `act`: a component test wraps them itself.
 */
export class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []

  /** Forget every connection opened so far. */
  static reset(): void {
    FakeEventSource.instances = []
  }

  /** The newest connection, or a thrown error naming who was expected to open one. */
  static latest(opener = 'the code under test'): FakeEventSource {
    const instance = FakeEventSource.instances[FakeEventSource.instances.length - 1]
    if (instance === undefined) throw new Error(`no stream was opened by ${opener}`)
    return instance
  }

  readyState = 0
  closeCount = 0

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    super()
    FakeEventSource.instances.push(this)
  }

  get closed(): boolean {
    return this.closeCount > 0
  }

  close(): void {
    this.closeCount += 1
    this.readyState = 2
  }

  /** The server answered and the stream is live. */
  emitOpen(): void {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  /** A raw `change` frame, the way the server writes it. */
  emitFrame(data: string): void {
    this.dispatchEvent(new MessageEvent('change', { data }))
  }

  /** What the server sends when something in the event changed. Never data. */
  emitSignal(type: string): void {
    this.emitFrame(JSON.stringify({ type }))
  }

  /** The server's named heartbeat: the pipe is alive and nothing has happened. */
  emitHeartbeat(): void {
    this.dispatchEvent(new MessageEvent('ping', { data: '{}' }))
  }

  /** A dropped connection the browser is already retrying by itself. */
  emitDrop(): void {
    this.readyState = 0
    this.dispatchEvent(new Event('error'))
  }

  /** A refusal the browser will not retry: a 500, or the wrong content type. */
  emitRefusal(): void {
    this.readyState = 2
    this.dispatchEvent(new Event('error'))
  }
}
