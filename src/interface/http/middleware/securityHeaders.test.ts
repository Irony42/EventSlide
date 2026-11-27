import { describe, expect, it } from 'vitest'
import { microphoneOpenOn } from './securityHeaders'

/**
 * Which documents may ask for the microphone (spec 25, section 9). The list is inverted: what is
 * closed is named, everything else is open, because a document keeps the policy of the URL it was
 * loaded from and a guest enters by more doors than the ones that record.
 */
describe('microphoneOpenOn', () => {
  // A guest invitation is a door: its button into the wall is a client-side link, so the document
  // that is loaded here is the one that later hosts the join and upload pages (spec 29). Shut here,
  // the voice message of spec 25 would fail silently there, whatever those pages answer.
  it.each([
    '/',
    '/join',
    '/join/ABC123',
    '/e/x',
    '/e/x/upload',
    '/e/x/photos',
    '/about',
    '/i/7QX0M4TZ2KD9WB3H',
    '/I/7QX0M4TZ2KD9WB3H',
  ])('opens the microphone on %s', (path) => {
    expect(microphoneOpenOn(path)).toBe(true)
  })

  it.each([
    '/admin',
    '/admin/events/x/moderation',
    '/login',
    '/g',
    '/g/some-token',
    '/invite/some-token',
    '/password/forgot',
    '/password/reset/some-token',
    // Self-service signup (spec 31): the form, its confirmation page and the page of a mailed link.
    '/signup',
    '/signup/sent',
    '/signup/confirm/some-token',
    '/e/x/display',
    '/e/x/display/anything',
    '/api/health',
  ])('keeps the microphone shut on %s', (path) => {
    expect(microphoneOpenOn(path)).toBe(false)
  })

  it.each([
    ['another case, which Express routes to the same page', '/ADMIN/events', false],
    ['another case of the wall', '/E/x/Display', false],
    ['a percent-encoded segment', '/%61dmin', false],
    ['a doubled slash', '//admin', false],
    ['a dot segment', '/./admin', false],
    ['an undecodable path, which no guest was sent to', '/%E0%A4%A', false],
    ['an event whose slug is named like a closed page', '/e/admin/upload', true],
    ['a segment that only starts like a closed page', '/administration', true],
  ])('reads %s the way the router does', (_name, path, open) => {
    expect(microphoneOpenOn(path)).toBe(open)
  })
})
