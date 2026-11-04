// Writes the four "new photo" sounds of the wall (spec 12) to web/public/sounds/.
//
// Deterministic: a sum of sine partials under exponential envelopes, no randomness, no sample
// from anywhere. WAV is written by hand, then ffmpeg (the `ffmpeg-static` binary, or `ffmpeg` on
// the PATH) encodes it to a mono 44.1 kHz 64 kbit/s mp3. The output is dedicated to the public
// domain (CC0), see web/public/licenses/SOUNDS.txt.
//
//   node tools/sounds/generate.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 44_100
const ATTACK_S = 0.005
const RELEASE_S = 0.03
const PEAK = 0.8

/** A partial: frequency (Hz, or [from, to] for a glide), amplitude, decay time constant (s). */
const SOUNDS = {
  // Carillon: a bright major triad, long and gentle.
  chime: {
    seconds: 1.0,
    partials: [
      { hz: 880, amp: 1, tau: 0.28 },
      { hz: 1318.5, amp: 0.55, tau: 0.22 },
      { hz: 1760, amp: 0.3, tau: 0.16 },
    ],
  },
  // Cloche: the inharmonic partials of a struck bell.
  bell: {
    seconds: 1.2,
    partials: [
      { hz: 523.25, amp: 1, tau: 0.4 },
      { hz: 1444, amp: 0.5, tau: 0.25 },
      { hz: 2825, amp: 0.3, tau: 0.15 },
      { hz: 4672, amp: 0.15, tau: 0.09 },
    ],
  },
  // Goutte: a short downward glide, like a drop in water.
  drop: {
    seconds: 0.45,
    partials: [
      { hz: [1100, 520], amp: 1, tau: 0.09 },
      { hz: [2200, 1040], amp: 0.2, tau: 0.05 },
    ],
  },
  // Pop: a very short low glide.
  pop: {
    seconds: 0.2,
    partials: [
      { hz: [420, 140], amp: 1, tau: 0.035 },
      { hz: [840, 280], amp: 0.25, tau: 0.02 },
    ],
  },
}

const render = ({ seconds, partials }) => {
  const length = Math.round(seconds * RATE)
  const out = new Float64Array(length)
  for (const { hz, amp, tau } of partials) {
    const [from, to] = Array.isArray(hz) ? hz : [hz, hz]
    let phase = 0
    for (let i = 0; i < length; i += 1) {
      const t = i / RATE
      // Exponential glide from `from` to `to` over the first 80 ms, then steady.
      const k = Math.min(1, t / 0.08)
      const f = from * Math.pow(to / from, k)
      phase += (2 * Math.PI * f) / RATE
      out[i] += amp * Math.exp(-t / tau) * Math.sin(phase)
    }
  }
  let max = 0
  for (let i = 0; i < length; i += 1) {
    const t = i / RATE
    const attack = Math.min(1, t / ATTACK_S)
    const release = Math.min(1, (seconds - t) / RELEASE_S)
    out[i] *= attack * release
    max = Math.max(max, Math.abs(out[i]))
  }
  for (let i = 0; i < length; i += 1) out[i] = (out[i] / max) * PEAK
  return out
}

const wav = (samples) => {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(Math.round(s * 32767), i * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const ffmpegPath = () => {
  try {
    return createRequire(import.meta.url)('ffmpeg-static') ?? 'ffmpeg'
  } catch {
    return 'ffmpeg'
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const target = join(root, 'web', 'public', 'sounds')
mkdirSync(target, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'eventslide-sounds-'))
try {
  for (const [name, spec] of Object.entries(SOUNDS)) {
    const source = join(scratch, `${name}.wav`)
    writeFileSync(source, wav(render(spec)))
    execFileSync(ffmpegPath(), [
      '-y',
      '-loglevel',
      'error',
      '-i',
      source,
      '-ac',
      '1',
      '-ar',
      String(RATE),
      '-b:a',
      '64k',
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      '-flags:a',
      '+bitexact',
      join(target, `${name}.mp3`),
    ])
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
