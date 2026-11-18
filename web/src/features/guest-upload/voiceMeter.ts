/**
 * The sound level shown while recording (spec 25, section 3): a discreet bar that moves with the voice.
 *
 * Best effort and nothing depends on it. A browser with no `AudioContext`, or one that refuses to
 * build the graph, gets `null` and the recording screen shows its clock without a level.
 *
 * **The context is created in the guest's tap, before the microphone is asked for**: iOS Safari only
 * lets a gesture start an `AudioContext`, and by the time the permission prompt is answered the
 * gesture is gone (the "piège (e)" of the spec). The stream is attached afterwards.
 */

export interface VoiceMeter {
  /** Connects the microphone stream once the guest has granted it. */
  readonly attach: (stream: MediaStream) => void
  /** The current level, from 0 (silence) to 1. */
  readonly read: () => number
  /** Releases the audio context. Safe to call twice. */
  readonly close: () => void
}

/** What the analyser reads: the root mean square of the waveform, which is 0 to about 0.5 for speech. */
const LEVEL_GAIN = 3

export const createVoiceMeter = (): VoiceMeter | null => {
  const Context =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  if (Context === undefined) return null
  try {
    const context = new Context()
    // A tap is what resumes it on iOS: this runs inside one.
    void context.resume().catch(() => undefined)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    const samples = new Uint8Array(analyser.fftSize)
    let source: MediaStreamAudioSourceNode | null = null
    let closed = false
    return {
      attach: (stream) => {
        if (closed) return
        try {
          source = context.createMediaStreamSource(stream)
          source.connect(analyser)
        } catch {
          // No level, and the recording goes on.
        }
      },
      read: () => {
        if (closed || source === null) return 0
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) {
          const centred = (sample - 128) / 128
          sum += centred * centred
        }
        return Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN)
      },
      close: () => {
        if (closed) return
        closed = true
        try {
          source?.disconnect()
          void context.close().catch(() => undefined)
        } catch {
          // Already released.
        }
      },
    }
  } catch {
    return null
  }
}
