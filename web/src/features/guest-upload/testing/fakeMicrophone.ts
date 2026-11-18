import { vi, type Mock } from 'vitest'

/**
 * A microphone and a `MediaRecorder` for jsdom, which has neither (spec 25, ring 5).
 *
 * Behaving fakes and not stubs: the recorder obeys the states of the real one (`inactive`,
 * `recording`), delivers the bytes it was given through `dataavailable` and then `stop`, and a
 * track records that it was stopped, which is what the "the microphone is released" tests read.
 * A fake that answered `stop()` with a synchronous `stop` event would hide the ordering of the
 * real one, where the data and the event arrive after the call has returned.
 */

export class FakeTrack {
  stopped = false
  readonly stop = vi.fn(() => {
    this.stopped = true
  })
}

export class FakeStream {
  readonly tracks = [new FakeTrack()]
  getTracks(): FakeTrack[] {
    return this.tracks
  }
}

export class FakeRecorder {
  static supported: readonly string[] = []
  static instances: FakeRecorder[] = []
  static isTypeSupported = (type: string): boolean => FakeRecorder.supported.includes(type)

  state: 'inactive' | 'recording' = 'inactive'
  readonly mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  startedWith: number | undefined
  /** What a stop delivers: set by a test to say how much was "said". */
  payload = new Uint8Array([1, 2, 3, 4])

  constructor(
    readonly stream: FakeStream,
    options: { mimeType?: string } = {},
  ) {
    this.mimeType = options.mimeType ?? ''
    FakeRecorder.instances.push(this)
  }

  start(timeslice?: number): void {
    this.state = 'recording'
    this.startedWith = timeslice
  }

  stop(): void {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    // After the call has returned, data first and then the event, like the real recorder.
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob([this.payload], { type: this.mimeType }) })
      this.onstop?.()
    })
  }
}

export interface FakeMicrophone {
  readonly getUserMedia: Mock<() => Promise<FakeStream>>
  readonly streams: FakeStream[]
  readonly recorders: () => FakeRecorder[]
  /** The next permission prompt is answered with this error name. */
  readonly refuseWith: (name: string) => void
  /** Whether every track of every stream was stopped. */
  readonly released: () => boolean
  readonly uninstall: () => void
}

export interface InstallOptions {
  /** The formats `isTypeSupported` accepts. Safari's first by default. */
  readonly formats?: readonly string[]
  readonly secure?: boolean
}

/** Puts the fakes on the globals. Call `uninstall` (or let `afterEach` do it) when done. */
export const installFakeMicrophone = (options: InstallOptions = {}): FakeMicrophone => {
  FakeRecorder.supported = options.formats ?? ['audio/webm;codecs=opus', 'audio/webm']
  FakeRecorder.instances = []
  const streams: FakeStream[] = []
  let refusal: string | null = null

  const getUserMedia = vi.fn(async (): Promise<FakeStream> => {
    if (refusal !== null) {
      const name = refusal
      refusal = null
      throw new DOMException('refused', name)
    }
    const stream = new FakeStream()
    streams.push(stream)
    return stream
  })

  vi.stubGlobal('MediaRecorder', FakeRecorder)
  const previousDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
  const previousSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
  Object.defineProperty(window, 'isSecureContext', {
    value: options.secure ?? true,
    configurable: true,
  })

  return {
    getUserMedia,
    streams,
    recorders: () => FakeRecorder.instances,
    refuseWith: (name) => {
      refusal = name
    },
    released: () => streams.length > 0 && streams.every((s) => s.tracks.every((t) => t.stopped)),
    uninstall: () => {
      vi.unstubAllGlobals()
      if (previousDevices === undefined) Reflect.deleteProperty(navigator, 'mediaDevices')
      else Object.defineProperty(navigator, 'mediaDevices', previousDevices)
      if (previousSecure === undefined) Reflect.deleteProperty(window, 'isSecureContext')
      else Object.defineProperty(window, 'isSecureContext', previousSecure)
    },
  }
}
