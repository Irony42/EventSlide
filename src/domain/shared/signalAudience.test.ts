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
  it('lists exactly the private signals', () => {
    expect([...MODERATION_ONLY_SIGNALS]).toEqual(['book.changed', 'export.changed'])
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
