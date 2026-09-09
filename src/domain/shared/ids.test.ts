import { describe, expect, it } from 'vitest'

import {
  asEventId,
  asGuestId,
  asPhotoId,
  asReactionId,
  asUserId,
  type EventId,
  type GuestId,
  type PhotoId,
  type ReactionId,
  type UserId,
} from './ids'

/**
 * The guarantee this module exists for is a compile-time one, and vitest cannot see
 * it: an `it()` around `expect(aConstantDeclaredTrue).toBe(true)` reports green
 * forever, whatever the brands do. So the brand checks are plain statements below,
 * verified by `npm run typecheck:domain` — `tsconfig.domain.json` includes this file —
 * and the only `it()` in this file is the one runtime behaviour there is.
 */

const takesEventId = (id: EventId): EventId => id
const takesPhotoId = (id: PhotoId): PhotoId => id
const takesGuestId = (id: GuestId): GuestId => id
const takesUserId = (id: UserId): UserId => id
const takesReactionId = (id: ReactionId): ReactionId => id

/* Each helper must produce the brand its name promises. A helper that quietly widened
   to `string` would stop compiling here. */
takesEventId(asEventId('evt-42'))
takesPhotoId(asPhotoId('pho-42'))
takesGuestId(asGuestId('gst-42'))
takesUserId(asUserId('usr-42'))
takesReactionId(asReactionId('rct-42'))

/* Tenant isolation in this product *is* "did you pass the right event id", so the
   cross-assignments below must not compile. Each suppression is load-bearing: if
   TypeScript ever stops reporting the mistake, `@ts-expect-error` becomes an error
   itself and the domain typecheck fails — which is precisely the alarm we want. */

// @ts-expect-error an EventId is not a PhotoId, and never should be.
takesPhotoId(asEventId('evt-42'))
// @ts-expect-error a GuestId is not a UserId, and never should be.
takesUserId(asGuestId('gst-42'))
// @ts-expect-error ids only enter the domain through the as*Id helpers.
takesEventId('evt-42')

const HELPERS: readonly [string, (value: string) => string][] = [
  ['asEventId', asEventId],
  ['asPhotoId', asPhotoId],
  ['asGuestId', asGuestId],
  ['asUserId', asUserId],
  ['asReactionId', asReactionId],
]

describe('branded id helpers', () => {
  it.each(HELPERS)('%s hands back exactly the string it was given', (_name, helper) => {
    expect(helper('01JBXG7Q2K')).toBe('01JBXG7Q2K')
  })

  // Shape is the IdGenerator port's business, not the domain's, so nothing is
  // validated here and even the empty string passes straight through.
  it('validates nothing, because an id is opaque to the domain', () => {
    expect(asEventId('')).toBe('')
  })
})
