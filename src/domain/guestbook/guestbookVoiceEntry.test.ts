import { describe, expect, it } from 'vitest'
import { ContentHash } from '../photos/contentHash'
import { asEventId, asGuestId, asGuestbookEntryId, asUserId } from '../shared/ids'
import { GuestbookEntry, isVoiceMessage, isWritten, type EntryActor } from './guestbookEntry'
import { GuestbookText } from './guestbookText'
import { GuestbookVoice } from './guestbookVoice'
import type { VoiceState } from './guestbookVoiceState'

/**
 * A voice message is an entry of the book that carries a recording (spec 25). Everything the
 * entry does for a written message it does for a voice, with two exceptions that are rules:
 * `hide` is refused on a voice, and a voice has its own removal rule (1 bis).
 */

const AT = new Date('2026-06-20T21:00:00.000Z')
const at = (offsetMs: number): Date => new Date(AT.getTime() + offsetMs)

const GRACE_MS = 900_000
const SETTINGS = { allowGuestSelfDelete: true, guestSelfDeleteGraceMs: GRACE_MS }
const VETO = { allowGuestSelfDelete: false, guestSelfDeleteGraceMs: GRACE_MS }

const AUTHOR: EntryActor = { kind: 'guest', guestId: asGuestId('guest-1') }
const STRANGER: EntryActor = { kind: 'guest', guestId: asGuestId('guest-2') }
const HOST: EntryActor = { kind: 'host', userId: asUserId('user-host') }

const REVIEWER = { kind: 'host', userId: asUserId('user-host') } as const

const must = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

/** A written message of the default guest, `pending` or published on arrival. */
const aGuestbookEntry = (input: { readonly moderation?: 'manual' | 'auto' } = {}): GuestbookEntry =>
  GuestbookEntry.create(
    {
      eventId: asEventId('event-1'),
      guestId: asGuestId('guest-1'),
      text: must(GuestbookText.create('Bravo')),
    },
    asGuestbookEntryId('w1'),
    AT,
    input.moderation ?? 'manual',
  )

/** A voice message of the default guest, its recording in the given state. */
const aVoiceEntry = (
  input: { readonly state?: VoiceState; readonly moderation?: 'manual' | 'auto' } = {},
): GuestbookEntry => {
  const created = must(
    GuestbookVoice.create(
      {
        sourceHash: must(ContentHash.create('a'.repeat(64))),
        sourceByteSize: 300_000,
        caption: null,
      },
      AT,
    ),
  )
  const state = input.state ?? 'queued'
  const voice = GuestbookVoice.restore({
    ...created.toProps(),
    state,
    failure: state === 'failed' ? 'corrupt' : null,
  })
  return GuestbookEntry.createVoice(
    { eventId: asEventId('event-1'), guestId: asGuestId('guest-1'), voice },
    asGuestbookEntryId('v1'),
    AT,
    input.moderation ?? 'manual',
  )
}

describe('a voice message as an entry', () => {
  it('has a recording and no text, where a written message has the opposite', () => {
    const voice = aVoiceEntry()
    const written = aGuestbookEntry()

    expect(voice.text).toBeNull()
    expect(voice.voice?.state).toBe('queued')
    expect(written.text).not.toBeNull()
    expect(written.voice).toBeNull()
    expect(isWritten(voice)).toBe(false)
    expect(isWritten(written)).toBe(true)
    expect(isVoiceMessage(voice)).toBe(true)
    expect(isVoiceMessage(written)).toBe(false)
  })

  it('meets the moderation of the event as a written message does', () => {
    expect(aVoiceEntry({ moderation: 'manual' }).status).toBe('pending')
    const automatic = aVoiceEntry({ moderation: 'auto' })
    expect(automatic.status).toBe('published')
    expect(automatic.review).toEqual({ kind: 'automatic', at: AT })
  })

  it('is decided like a written message once ready: published, rejected, back to pending', () => {
    const entry = aVoiceEntry({ state: 'ready' })

    const published = entry.publish(REVIEWER, at(1))
    expect(published.ok && published.value.status).toBe('published')
    const rejected = entry.reject(REVIEWER, at(1))
    expect(rejected.ok && rejected.value.status).toBe('rejected')
    const back = entry.transitionTo('pending', REVIEWER, at(1))
    expect(back.ok && back.value.status).toBe('pending')
  })

  it.each(['pending', 'published', 'rejected'] as const)(
    'refuses to be hidden from %s: a voice is never on a screen, and a hidden one would keep its place in the album',
    (status) => {
      const base = aVoiceEntry({
        state: 'ready',
        moderation: status === 'published' ? 'auto' : 'manual',
      })
      const entry = status === 'rejected' ? must(base.reject(REVIEWER, at(1))) : base

      const hidden = entry.hide(REVIEWER, at(2))

      expect(!hidden.ok && hidden.error.code).toBe('guestbook.voiceCannotHide')
      expect(entry.transitionTo('hidden', REVIEWER, at(2)).ok).toBe(false)
    },
  )

  it('still hides a written message, which is what the screen is for', () => {
    const published = aGuestbookEntry({ moderation: 'auto' })

    const hidden = published.hide(REVIEWER, at(1))

    expect(hidden.ok && hidden.value.status).toBe('hidden')
  })

  it.each(['reserved', 'queued', 'running', 'failed'] as const)(
    'cannot be decided while its recording is %s: there is nothing to listen to yet, or ever',
    (state) => {
      const entry = aVoiceEntry({ state })

      for (const decision of ['published', 'rejected'] as const) {
        const moved = entry.transitionTo(decision, REVIEWER, at(1))
        expect(!moved.ok && moved.error.code).toBe('guestbook.voiceNotReady')
      }
      expect(entry.isDecidable()).toBe(false)
      expect(entry.allowedDecisions()).toEqual([])
    },
  )

  it('is decidable once ready, and a written message always is', () => {
    expect(aVoiceEntry({ state: 'ready' }).isDecidable()).toBe(true)
    expect(aGuestbookEntry().isDecidable()).toBe(true)
  })

  it('offers a voice every decision but hide, which a written message keeps', () => {
    const pendingVoice = aVoiceEntry({ state: 'ready' })
    const publishedVoice = aVoiceEntry({ state: 'ready', moderation: 'auto' })
    const publishedWritten = aGuestbookEntry({ moderation: 'auto' })

    expect(pendingVoice.allowedDecisions()).toEqual(['publish', 'reject'])
    expect(publishedVoice.allowedDecisions()).toEqual(['reject'])
    expect(publishedWritten.allowedDecisions()).toEqual(['reject', 'hide'])
  })

  it('keeps its recording through a decision', () => {
    const entry = aVoiceEntry({ state: 'ready' })

    const decided = entry.publish(REVIEWER, at(1))

    expect(decided.ok && decided.value.voice?.state).toBe('ready')
    expect(decided.ok && decided.value.text).toBeNull()
  })
})

describe('removing a voice message (rule 1 bis of spec 25)', () => {
  it.each(['pending', 'published', 'rejected'] as const)(
    'lets its author remove it inside the grace window whatever its status: %s',
    (status) => {
      const base = aVoiceEntry({
        state: 'ready',
        moderation: status === 'published' ? 'auto' : 'manual',
      })
      const entry = status === 'rejected' ? must(base.reject(REVIEWER, at(1))) : base

      expect(entry.deletionVerdict(AUTHOR, at(GRACE_MS), SETTINGS)).toBe('allowed')
    },
  )

  it('is the whole difference from a photograph, whose published ones are the host’s to take down', () => {
    const published = aVoiceEntry({ state: 'ready', moderation: 'auto' })
    const written = aGuestbookEntry({ moderation: 'auto' })

    expect(published.deletionVerdict(AUTHOR, at(1_000), SETTINGS)).toBe('allowed')
    expect(written.deletionVerdict(AUTHOR, at(1_000), SETTINGS)).toBe('forbidden')
  })

  it('refuses its author once the grace window is over, because the window is the only guard', () => {
    const entry = aVoiceEntry({ state: 'ready', moderation: 'auto' })

    expect(entry.deletionVerdict(AUTHOR, at(GRACE_MS + 1), SETTINGS)).toBe('forbidden')
  })

  it('answers selfDeleteDisabled when the host switched the feature off', () => {
    const entry = aVoiceEntry({ state: 'ready' })

    expect(entry.deletionVerdict(AUTHOR, at(1_000), VETO)).toBe('selfDeleteDisabled')
  })

  it('refuses another guest, whose own veto answer would hide that it is not theirs', () => {
    const entry = aVoiceEntry({ state: 'ready' })

    expect(entry.deletionVerdict(STRANGER, at(1_000), SETTINGS)).toBe('forbidden')
  })

  it('refuses its author once the operator took it down, which they cannot see', () => {
    const entry = aVoiceEntry({ state: 'ready' })
    // The operator's take-down is written by its own route and a read never returns such a row,
    // which is why it is rebuilt here.
    const takenDown = GuestbookEntry.restore({ ...entry.toProps(), takenDownAt: at(10) })

    expect(takenDown.deletionVerdict(AUTHOR, at(1_000), SETTINGS)).toBe('forbidden')
  })

  it('lets the host remove it at any time, the window and the veto being a guest’s', () => {
    const entry = aVoiceEntry({ state: 'ready' })

    expect(entry.deletionVerdict(HOST, at(GRACE_MS * 10), VETO)).toBe('allowed')
  })

  it('lets its author remove a voice that failed without condition: window and veto included', () => {
    const failed = aVoiceEntry({ state: 'failed' })

    expect(failed.deletionVerdict(AUTHOR, at(GRACE_MS * 100), VETO)).toBe('allowed')
    expect(failed.deletionVerdict(AUTHOR, at(GRACE_MS * 100), SETTINGS)).toBe('allowed')
  })

  it('does not let a stranger remove a failed voice, which is the author’s cleanup alone', () => {
    const failed = aVoiceEntry({ state: 'failed' })

    expect(failed.deletionVerdict(STRANGER, at(1_000), SETTINGS)).toBe('forbidden')
    expect(failed.deletionVerdict(STRANGER, at(1_000), VETO)).toBe('selfDeleteDisabled')
  })

  it('lets the host remove a failed voice', () => {
    expect(aVoiceEntry({ state: 'failed' }).deletionVerdict(HOST, at(1), VETO)).toBe('allowed')
  })

  it('leaves a written message exactly the photograph’s rule: pending or rejected, in the window', () => {
    const pending = aGuestbookEntry()
    const published = aGuestbookEntry({ moderation: 'auto' })

    expect(pending.deletionVerdict(AUTHOR, at(1_000), SETTINGS)).toBe('allowed')
    expect(published.deletionVerdict(AUTHOR, at(1_000), SETTINGS)).toBe('forbidden')
    expect(pending.deletionVerdict(AUTHOR, at(GRACE_MS + 1), SETTINGS)).toBe('forbidden')
  })
})
