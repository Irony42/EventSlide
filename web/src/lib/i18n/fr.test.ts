import { describe, expect, it } from 'vitest'
import { fr, messageForCode } from './fr'

/**
 * The copy table is the subject here, not a source of expected values, so this is the
 * one file in `web/src` allowed to look at French wording directly. Everywhere else
 * asserts against `fr.*`; a test that did that here would only prove `fr.x === fr.x`.
 *
 * Even so, nothing below pins a sentence. What is pinned is the two properties a copy
 * edit must not silently break: a counted phrase changes wording with its count, and
 * every error code the API can answer with has a sentence of its own.
 */

/**
 * Phrases that agree with a count, reduced to one argument so the rule can be stated
 * once. The second argument of a two-argument phrase is held fixed: it is not the one
 * the agreement depends on.
 */
type CountedPhrase = [name: string, phrase: (count: number) => string]

const COUNTED: readonly CountedPhrase[] = [
  ['upload.sendCount', fr.upload.sendCount],
  ['upload.queueSummary', (count) => fr.upload.queueSummary(count, 3)],
  ['upload.queueFailed', fr.upload.queueFailed],
  ['upload.offlineTitle', fr.upload.offlineTitle],
  ['moderation.pending', fr.moderation.pending],
  ['moderation.bulkSkipped', fr.moderation.bulkSkipped],
  ['moderation.selected', fr.moderation.selected],
  ['moderation.published', fr.moderation.published],
  ['moderation.refused', fr.moderation.refused],
  ['moderation.removed', fr.moderation.removed],
  ['admin.photos', fr.admin.photos],
  ['admin.guests', fr.admin.guests],
  ['admin.graceSeconds', fr.admin.graceSeconds],
  ['admin.graceMinutes', fr.admin.graceMinutes],
  ['admin.graceHours', fr.admin.graceHours],
]

describe('counted French copy', () => {
  it.each(COUNTED)('%s is worded differently for one than for several', (_name, phrase) => {
    // Substituting the digit isolates the wording: if swapping 2 for 1 in the plural
    // reproduces the singular exactly, then nothing but the number changed and the
    // phrase reads "2 photo en attente" somewhere in the UI.
    expect(phrase(2).replace('2', '1')).not.toBe(phrase(1))
  })
})

/**
 * Numbered per-row copy from the upload queue. Each label is the accessible name of a
 * control that exists once per photo, so the number is what separates one row's button
 * from the next one's for anybody not looking at the thumbnails.
 */
const NUMBERED: readonly [name: string, label: (position: number) => string][] = [
  ['upload.itemAlt', fr.upload.itemAlt],
  ['upload.itemProgress', fr.upload.itemProgress],
  ['upload.removeItem', fr.upload.removeItem],
  ['upload.retryItem', fr.upload.retryItem],
  ['upload.deleteOwnNumbered', fr.upload.deleteOwnNumbered],
]

describe('numbered French copy', () => {
  it.each(NUMBERED)('%s names the photo it belongs to', (_name, label) => {
    // A label that dropped its argument would read "Retirer la photo" on all four rows,
    // and a guest on a screen reader would have no way to tell which photo they are
    // about to remove.
    expect(label(2)).not.toBe(label(3))
    expect(label(2)).toContain('2')
  })
})

/**
 * Every code a client can receive, transcribed rather than imported: lint forbids the
 * web app importing the server, the same reason `dto.ts` transcribes the wire format.
 * Taken from `docs/API.md` **and** from the refusals the use cases return, because the
 * two disagree in one place — see `event.photoLimitReached` below. Adding a code to
 * the API means adding a row here, and the row fails until the code has French copy.
 */
const DOCUMENTED_CODES: readonly string[] = [
  'request.invalid',
  'request.csrfMissing',
  'request.csrfMismatch',
  'rate.limited',

  'auth.invalidCredentials',
  'auth.required',
  'auth.forbidden',

  'event.notFound',
  'event.notAcceptingUploads',
  'event.quotaExceeded',
  'event.slugTaken',
  'event.immutable',
  'event.illegalTransition',
  'event.captionsNotAllowed',
  'event.reactionsDisabled',
  'event.guestSelfDeleteDisabled',

  'guest.wrongEvent',
  'guest.revoked',
  'guestToken.expired',
  'guestToken.malformed',
  'guestToken.badSignature',

  'photo.notFound',
  'photo.illegalTransition',
  'photo.tooManyForGuest',
  'photo.captionEditForbidden',
  'photo.deleteForbidden',

  'image.unsupportedFormat',
  'image.corrupt',
  'image.tooManyPixels',
  'image.animated',
  'image.renderFailed',

  'upload.noFiles',
  'upload.tooLarge',
  'upload.tooManyFiles',
  'upload.unexpectedField',

  'caption.tooLong',
  'caption.empty',

  'reaction.alreadyExists',
  'reaction.notPublished',
  'reaction.notFound',
  'reaction.rateLimited',

  'password.tooShort',
  'password.tooLong',
  'password.tooCommon',
  'password.sameAsEmail',
  'password.sameAsName',
  'password.tooRepetitive',
  'password.unchanged',

  'eventName.empty',
  'eventName.tooShort',
  'eventName.tooLong',
  'slug.tooShort',
  'slug.tooLong',
  'slug.malformed',
  'slug.reserved',
  'displayName.tooLong',
  'joinCode.wrongLength',
  'joinCode.malformed',

  'email.malformed',
  'user.notFound',
  'membership.alreadyExists',
  'membership.notFound',
  'membership.lastOwner',
  'guest.notFound',

  // Answered by a use case under a name docs/API.md does not use, or does not list at
  // all. `event.photoLimitReached` is what the server sends where the doc says
  // `photo.tooManyForGuest`; both are pinned until the contract picks one.
  'event.photoLimitReached',
  'event.notModeratable',
  'photo.pixelBudgetExceeded',
  'upload.rejected',
]

describe('messageForCode', () => {
  it.each(DOCUMENTED_CODES)('says something specific about %s', (code) => {
    // The generic sentence is a fallback, not an answer: a guest told only "une erreur
    // est survenue" cannot tell a disabled feature from a dropped connection.
    expect(messageForCode(code)).not.toBe(fr.errors.unknown)
  })

  it('falls back to a generic sentence for a code this build has never heard of', () => {
    // A newer server is allowed to grow codes, and `event.somethingNew` rendered raw on
    // a phone would be worse than a vague sentence.
    expect(messageForCode('event.somethingNew')).toBe(fr.errors.unknown)
  })

  it('falls back when the failure carried no code at all', () => {
    expect(messageForCode(undefined)).toBe(fr.errors.unknown)
  })

  it('refuses a code that names an inherited property instead of a message', () => {
    // A bare lookup resolves `constructor` to `Object` and `__proto__` to a prototype,
    // neither of which is a sentence — and the code comes from whatever answered the
    // request, which behind a misconfigured proxy is not necessarily this server.
    expect(messageForCode('constructor')).toBe(fr.errors.unknown)
    expect(messageForCode('__proto__')).toBe(fr.errors.unknown)
    expect(messageForCode('toString')).toBe(fr.errors.unknown)
  })
})
