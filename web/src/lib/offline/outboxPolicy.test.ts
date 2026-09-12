import { describe, expect, it } from 'vitest'
import {
  CLAIM_LEASE_MS,
  MAX_AGE_MS,
  MAX_ATTEMPTS,
  backoffMs,
  isDue,
  isExpired,
  isExhausted,
  isLeased,
  isSpent,
  isTerminal,
  shouldQueue,
} from './outboxPolicy'
import type { OutboxEntry } from './outbox'

/**
 * The only decisions in the offline queue that are rules rather than plumbing, and the
 * ones a service worker is the worst possible place to debug. Pure, so they are pinned
 * here and nowhere else.
 */

const t = 1_760_000_000_000

const anEntry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: 'entry-1',
  slug: 'camille-et-sacha',
  bytes: new ArrayBuffer(3),
  fileName: 'confettis.jpg',
  fileType: 'image/jpeg',
  caption: null,
  enqueuedAt: t,
  attempts: 0,
  lastAttemptAt: null,
  claimedAt: null,
  csrfToken: null,
  ...overrides,
})

describe('expiry', () => {
  it('keeps a photo queued for as long as an evening lasts', () => {
    expect(isExpired(anEntry(), t + MAX_AGE_MS - 1)).toBe(false)
  })

  it('drops a photo whose event is over', () => {
    // Pushing yesterday's photo to a wall the morning after is worse than losing it:
    // the guests have gone home and the host has downloaded the album.
    expect(isExpired(anEntry(), t + MAX_AGE_MS)).toBe(true)
  })
})

describe('attempts', () => {
  it('gives a photo many tries, because the fix is usually walking ten metres', () => {
    expect(isExhausted(anEntry({ attempts: MAX_ATTEMPTS - 1 }))).toBe(false)
  })

  it('stops trying a photo the server will evidently never take', () => {
    expect(isExhausted(anEntry({ attempts: MAX_ATTEMPTS }))).toBe(true)
  })
})

describe('isSpent', () => {
  it('is true for either reason on its own', () => {
    expect(isSpent(anEntry(), t + MAX_AGE_MS)).toBe(true)
    expect(isSpent(anEntry({ attempts: MAX_ATTEMPTS }), t)).toBe(true)
  })

  it('is false for a fresh entry', () => {
    expect(isSpent(anEntry(), t)).toBe(false)
  })
})

describe('leases', () => {
  it('treats an unclaimed entry as free', () => {
    expect(isLeased(anEntry(), t)).toBe(false)
  })

  it('treats an entry another drain just took as busy', () => {
    expect(isLeased(anEntry({ claimedAt: t }), t + CLAIM_LEASE_MS - 1)).toBe(true)
  })

  it('frees an entry whose holder evidently died', () => {
    // A worker killed mid-upload must not strand the photo for the rest of the evening.
    expect(isLeased(anEntry({ claimedAt: t }), t + CLAIM_LEASE_MS)).toBe(false)
  })
})

describe('backoff', () => {
  it('does not delay the first attempt at all', () => {
    // A guest pressing "Envoyer" must not wait on a timer that exists for the tenth try.
    expect(backoffMs(0)).toBe(0)
    expect(isDue(anEntry(), t)).toBe(true)
  })

  it('grows with the attempt count', () => {
    expect(backoffMs(2)).toBeGreaterThan(backoffMs(1))
    expect(backoffMs(4)).toBeGreaterThan(backoffMs(3))
  })

  it('stops growing, so a long evening never becomes an hour between tries', () => {
    expect(backoffMs(50)).toBe(backoffMs(MAX_ATTEMPTS))
  })

  it('holds an entry back until its backoff has elapsed', () => {
    const entry = anEntry({ attempts: 3, lastAttemptAt: t })

    expect(isDue(entry, t + backoffMs(3) - 1)).toBe(false)
    expect(isDue(entry, t + backoffMs(3))).toBe(true)
  })
})

describe('MAX_ATTEMPTS', () => {
  it('is above what twelve hours of minute-apart retries can reach', () => {
    // The age limit is meant to be the one that ever fires. Two hundred was not: with
    // the backoff capped at a minute it is under four hours, and a wedding's bad window
    // is 19:00 to 23:00. The arithmetic is the assertion.
    const attemptsInTwelveHours = MAX_AGE_MS / backoffMs(MAX_ATTEMPTS)

    expect(MAX_ATTEMPTS).toBeGreaterThan(attemptsInTwelveHours)
  })
})

/**
 * The drain's question, and the one that deletes photos when it is answered wrongly.
 *
 * Every case here is really "does this photo survive?", because `isTerminal` returning
 * true means `store.remove()` and there is nothing left to try.
 */
describe('isTerminal', () => {
  it('gives up on bytes the server looked at and refused', () => {
    expect(isTerminal('image.unsupportedFormat')).toBe(true)
    expect(isTerminal('image.tooManyPixels')).toBe(true)
    expect(isTerminal('upload.tooLarge')).toBe(true)
  })

  it('gives up when the host has taken the guest’s access away', () => {
    expect(isTerminal('guest.revoked')).toBe(true)
  })

  it('does not give up on a rate limit', () => {
    // The limit defaults to twelve a minute keyed per client and event, so one venue
    // behind one NAT reconnecting pushes every phone past it at once. Treating that as
    // terminal deletes the evening's photos from every device in the room.
    expect(isTerminal('rate.limited')).toBe(false)
  })

  it('does not give up because the device token now belongs to another event', () => {
    // A guest who scans the after-party's QR code overwrites their one token. The
    // wedding's queue has to survive that, not be deleted by it.
    expect(isTerminal('guest.wrongEvent')).toBe(false)
  })

  it('does not give up because the gallery is momentarily full', () => {
    // A host can raise a quota. The twelve-hour expiry is a kinder bound than deleting
    // on the first refusal.
    expect(isTerminal('event.quotaExceeded')).toBe(false)
  })

  it('keeps a photo refused with a code this build has never heard of', () => {
    // The default is the whole point. A newer server growing a code must not become a
    // silent data-loss bug on every phone running an older build.
    expect(isTerminal('event.somethingNew')).toBe(false)
    expect(isTerminal('')).toBe(false)
  })
})

describe('shouldQueue', () => {
  it('stores a photo when nothing reached the server', () => {
    // The saturated venue Wi-Fi this whole feature exists for.
    expect(shouldQueue(0)).toBe(true)
  })

  it('stores a photo when the server could not answer', () => {
    expect(shouldQueue(500)).toBe(true)
    expect(shouldQueue(502)).toBe(true)
  })

  it('does not store a photo the server refused on its merits', () => {
    // An unsupported format, a revoked guest, a closed event: identical on the tenth
    // attempt as on the first, so queueing it would only spend the guest's battery.
    expect(shouldQueue(400)).toBe(false)
    expect(shouldQueue(403)).toBe(false)
    expect(shouldQueue(413)).toBe(false)
  })

  it('does not store a rate-limited photo', () => {
    // The guest is standing there pressing the button and the limit is per minute:
    // "réessayez dans un instant" is the honest answer, not a silent queue.
    expect(shouldQueue(429)).toBe(false)
  })
})
