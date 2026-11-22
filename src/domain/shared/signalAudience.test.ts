import { describe, expect, it } from 'vitest'
import { MODERATION_ONLY_SIGNALS, canReceiveSignal } from './signalAudience'

describe('signal audience', () => {
  it('keeps the photo book signal off the public channel', () => {
    expect(canReceiveSignal('book.changed', 'public')).toBe(false)
    expect(canReceiveSignal('book.changed', 'moderation')).toBe(true)
  })
  it('keeps the archive signal off the public channel (a room must not learn the host is exporting)', () => {
    expect(canReceiveSignal('export.changed', 'public')).toBe(false)
    expect(canReceiveSignal('export.changed', 'moderation')).toBe(true)
  })
  it('keeps the two voice signals off the public channel (the wall re-reads on every public one)', () => {
    for (const type of ['guestbook.voice', 'voice.queued']) {
      expect(canReceiveSignal(type, 'public')).toBe(false)
      expect(canReceiveSignal(type, 'moderation')).toBe(true)
    }
  })
  it('keeps the two messaging channel signals off the public channel (spec 27)', () => {
    for (const type of ['channel.mediaQueued', 'channel.bindingChanged']) {
      expect(canReceiveSignal(type, 'public')).toBe(false)
      expect(canReceiveSignal(type, 'moderation')).toBe(true)
    }
  })
  it('keeps the replies signal off the public channel (spec 30)', () => {
    expect(canReceiveSignal('rsvp.changed', 'public')).toBe(false)
    expect(canReceiveSignal('rsvp.changed', 'moderation')).toBe(true)
  })
  it('lists exactly the private signals', () => {
    expect([...MODERATION_ONLY_SIGNALS]).toEqual([
      'book.changed',
      'export.changed',
      'guestbook.voice',
      'voice.queued',
      'channel.mediaQueued',
      'channel.bindingChanged',
      'rsvp.changed',
    ])
  })
  it('lets every other signal through to both channels', () => {
    for (const type of [
      'photo.uploaded',
      'event.statusChanged',
      'mission.changed',
      'challenge.changed',
      'announcement.changed',
    ]) {
      expect(canReceiveSignal(type, 'public')).toBe(true)
      expect(canReceiveSignal(type, 'moderation')).toBe(true)
    }
  })
})
