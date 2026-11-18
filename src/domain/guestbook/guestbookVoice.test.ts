import { describe, expect, it } from 'vitest'
import { Caption } from '../photos/caption'
import { ContentHash } from '../photos/contentHash'
import type { DomainError } from '../shared/errors'
import type { Result } from '../shared/result'
import { GuestbookVoice, type NewGuestbookVoice, type VoiceOutput } from './guestbookVoice'
import { MAX_VOICE_ATTEMPTS } from './voiceFailure'

const AT = new Date('2026-06-20T21:00:00.000Z')
const later = (ms: number): Date => new Date(AT.getTime() + ms)

const must = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`fixture rejected by the domain: ${result.error.code}`)
  return result.value
}

const hash = (digit: string): ContentHash => must(ContentHash.create(digit.repeat(64)))

const newVoice = (overrides: Partial<NewGuestbookVoice> = {}): NewGuestbookVoice => ({
  sourceHash: hash('a'),
  sourceByteSize: 300_000,
  caption: null,
  ...overrides,
})

const OUTPUT: VoiceOutput = { hash: hash('b'), byteSize: 240_000, durationMs: 12_000 }

/** A reservation: the row as `create` makes it, before the bytes have been written. */
const reserved = (overrides: Partial<NewGuestbookVoice> = {}): GuestbookVoice =>
  must(GuestbookVoice.create(newVoice(overrides), AT))

const queued = (): GuestbookVoice => reserved().queue(AT)

const running = (): GuestbookVoice => must(queued().start(AT))

describe('GuestbookVoice.create', () => {
  it('reserves a recording: charged to the quota, and invisible to the worker', () => {
    const voice = reserved()

    expect(voice.state).toBe('reserved')
    expect(voice.attempts).toBe(0)
    expect(voice.audioHash).toBeNull()
    expect(voice.durationMs).toBeNull()
    expect(voice.isDue(later(60_000))).toBe(false)
  })

  it('keeps the guest’s caption, which is the text a host who cannot listen reads', () => {
    const caption = must(Caption.create('Pour Camille'))

    expect(reserved({ caption }).caption?.value).toBe('Pour Camille')
  })

  it.each([[0], [-1], [1.5], [Number.NaN]])(
    'refuses a source of %p bytes, which would charge the event nothing',
    (sourceByteSize) => {
      const created = GuestbookVoice.create(newVoice({ sourceByteSize }), AT)

      expect(!created.ok && created.error.code).toBe('voice.sourceByteSizeInvalid')
    },
  )
})

describe('GuestbookVoice transitions', () => {
  it('queues once the bytes are on the disk, and is then claimable', () => {
    const voice = reserved().queue(later(5))

    expect(voice.state).toBe('queued')
    expect(voice.isDue(later(5))).toBe(true)
    expect(voice.isDue(later(4))).toBe(false)
  })

  it('throws, rather than answering, when asked to queue what is not a reservation', () => {
    expect(() => queued().queue(AT)).toThrow('a voice that is not a reservation cannot be queued')
  })

  it('counts the attempt at the claim, so a recording that kills the process counts', () => {
    const claimed = running()

    expect(claimed.state).toBe('running')
    expect(claimed.attempts).toBe(1)
    expect(claimed.startedAt).toEqual(AT)
  })

  it('refuses to claim a reservation, and a second claim of a running voice', () => {
    const early = reserved().start(AT)
    const twice = running().start(AT)

    expect(!early.ok && early.error.code).toBe('guestbookVoice.illegalTransition')
    expect(!twice.ok && twice.error.code).toBe('guestbookVoice.illegalTransition')
  })

  it('is ready only with its output, and then carries all three facts of it', () => {
    const done = must(running().finish(OUTPUT, later(900)))

    expect(done.state).toBe('ready')
    expect(done.isReady()).toBe(true)
    expect(done.audioHash?.value).toBe('b'.repeat(64))
    expect(done.audioByteSize).toBe(240_000)
    expect(done.durationMs).toBe(12_000)
    expect(done.finishedAt).toEqual(later(900))
  })

  it('hands back its output once ready, and nothing before', () => {
    expect(must(running().finish(OUTPUT, later(900))).output()).toEqual(OUTPUT)
    expect(reserved().output()).toBeNull()
    expect(running().output()).toBeNull()
  })

  it('has no output for a ready row that lacks one, which the database refuses but a reader must not trust', () => {
    const ready = must(running().finish(OUTPUT, later(900)))
    const withhold = (changes: Partial<ReturnType<GuestbookVoice['toProps']>>) =>
      GuestbookVoice.restore({ ...ready.toProps(), ...changes }).output()

    expect(withhold({ audioHash: null })).toBeNull()
    expect(withhold({ audioByteSize: null })).toBeNull()
    expect(withhold({ durationMs: null })).toBeNull()
  })

  it.each([
    ['a zero size', { ...OUTPUT, byteSize: 0 }],
    ['a size that is not a whole number', { ...OUTPUT, byteSize: 12.5 }],
    ['a zero duration, which would be listenable and unmeasurable', { ...OUTPUT, durationMs: 0 }],
    ['a fractional duration', { ...OUTPUT, durationMs: 10.5 }],
    ['a negative duration', { ...OUTPUT, durationMs: -1 }],
  ])('refuses to be ready with %s', (_label, output) => {
    const done = running().finish(output, AT)

    expect(!done.ok && done.error.code).toBe('voice.outputInvalid')
  })

  it('refuses to be ready from a state that is not running', () => {
    const early = queued().finish(OUTPUT, AT)

    expect(!early.ok && early.error.code).toBe('guestbookVoice.illegalTransition')
  })

  it('is not ready, nor claimable, in any other state', () => {
    expect(reserved().isReady()).toBe(false)
    expect(queued().isReady()).toBe(false)
    expect(running().isReady()).toBe(false)
    expect(running().isDue(later(10_000))).toBe(false)
  })

  it('never leaves a terminal state', () => {
    const done = must(running().finish(OUTPUT, AT))
    const failed = must(running().fail('voice.corrupt', AT))

    expect(done.start(AT).ok).toBe(false)
    expect(done.fail('voice.corrupt', AT).ok).toBe(false)
    expect(done.retry(AT).ok).toBe(false)
    expect(failed.start(AT).ok).toBe(false)
    expect(failed.finish(OUTPUT, AT).ok).toBe(false)
  })
})

describe('GuestbookVoice.fail', () => {
  it('gives up at once on a permanent failure: the file is the problem', () => {
    const failed = must(running().fail('voice.notAudio', later(10)))

    expect(failed.state).toBe('failed')
    expect(failed.failure).toBe('notAudio')
    expect(failed.finishedAt).toEqual(later(10))
    // A failed voice carries no output: the database's CHECK says a ready one does and no other.
    expect(failed.audioHash).toBeNull()
    expect(failed.durationMs).toBeNull()
  })

  it('puts a transient failure back on the queue after a short backoff, keeping the reason', () => {
    const retried = must(running().fail('voice.transcodeFailed', AT))

    expect(retried.state).toBe('queued')
    expect(retried.failure).toBe('transcodeFailed')
    expect(retried.isDue(AT)).toBe(false)
    expect(retried.isDue(later(2_000))).toBe(true)
  })

  it('backs off for longer once it has been tried again', () => {
    const second = must(must(running().fail('voice.transcodeFailed', AT)).start(later(2_000)))
    const retried = must(second.fail('voice.transcodeFailed', later(2_000)))

    expect(second.attempts).toBe(2)
    expect(retried.isDue(later(2_000 + 9_999))).toBe(false)
    expect(retried.isDue(later(2_000 + 10_000))).toBe(true)
  })

  it('gives up on a transient failure once the attempts are spent', () => {
    let voice = running()
    for (let attempt = 1; attempt < MAX_VOICE_ATTEMPTS; attempt += 1) {
      voice = must(must(voice.fail('voice.transcodeTimedOut', AT)).start(AT))
    }

    const failed = must(voice.fail('voice.transcodeTimedOut', AT))

    expect(voice.attempts).toBe(MAX_VOICE_ATTEMPTS)
    expect(failed.state).toBe('failed')
    expect(failed.failure).toBe('timedOut')
  })

  it('files a code it was never taught as a transient transcode failure', () => {
    const retried = must(running().fail('some.new.adapter.code', AT))

    expect(retried.state).toBe('queued')
    expect(retried.failure).toBe('transcodeFailed')
  })
})

describe('GuestbookVoice.retry (crash recovery)', () => {
  it('puts a voice a dead process held back on the queue at once, with no backoff', () => {
    const recovered = must(running().retry(later(500)))

    expect(recovered.state).toBe('queued')
    expect(recovered.isDue(later(500))).toBe(true)
    expect(recovered.attempts).toBe(1)
  })

  it('gives up on a voice that has spent its attempts, rather than handing it to the next boot', () => {
    let voice = running()
    for (let attempt = 1; attempt < MAX_VOICE_ATTEMPTS; attempt += 1) {
      voice = must(must(voice.retry(AT)).start(AT))
    }

    const abandoned = must(voice.retry(later(5)))

    expect(abandoned.state).toBe('failed')
    expect(abandoned.failure).toBe('transcodeFailed')
    expect(abandoned.finishedAt).toEqual(later(5))
  })

  it('only recovers what is running', () => {
    const early = queued().retry(AT)

    expect(!early.ok && early.error.code).toBe('guestbookVoice.illegalTransition')
  })
})
