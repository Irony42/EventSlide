import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOfflineQueueEnabled, resolveOfflineQueue } from './killSwitch'

/**
 * The switch that has to work on a phone already carrying a bad worker.
 *
 * Every case below is about one property: the default is on, "off" persists, and a
 * plain join link never resets a decision somebody made deliberately — because the
 * thing that makes a kill switch useless is a guest undoing it by scanning the QR code
 * again.
 */

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('resolveOfflineQueue', () => {
  it('is on for a guest who has never been told otherwise', () => {
    expect(resolveOfflineQueue('')).toBe(true)
  })

  it('turns off on ?offline=off and stays off afterwards', () => {
    expect(resolveOfflineQueue('?offline=off')).toBe(false)
    // The guest does not have to keep the query string: the host typed it once on a
    // phone that was misbehaving, and it has to survive the next navigation.
    expect(isOfflineQueueEnabled()).toBe(false)
    expect(resolveOfflineQueue('')).toBe(false)
  })

  it('turns back on on ?offline=on', () => {
    resolveOfflineQueue('?offline=off')

    expect(resolveOfflineQueue('?offline=on')).toBe(true)
    expect(isOfflineQueueEnabled()).toBe(true)
  })

  it('leaves a deliberate decision alone when the URL says nothing about it', () => {
    // A join link carries a code, not a policy. If an ordinary navigation reset this,
    // the switch would last exactly until the guest scanned the QR code again.
    resolveOfflineQueue('?offline=off')

    expect(resolveOfflineQueue('?code=H7K2QM')).toBe(false)
  })

  it('ignores a value it does not recognise', () => {
    resolveOfflineQueue('?offline=off')

    expect(resolveOfflineQueue('?offline=maybe')).toBe(false)
  })

  it('stays on when the browser refuses to read storage at all', () => {
    // Safari in private browsing throws on access. Defaulting to off there would
    // silently disable the feature for a whole class of guests.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(isOfflineQueueEnabled()).toBe(true)
  })

  it('still governs this page load when the decision cannot be written down', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(resolveOfflineQueue('?offline=off')).toBe(false)
  })
})
