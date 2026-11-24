/**
 * What a push message says (spec 30, lot 4): **that** new replies came in and how many, never who or
 * what. The browser's own service worker words it in the reader's language and opens the replies
 * page of `slug`; no guest's name, diet, word or answer ever leaves this box in a push, and the push
 * service sees only ciphertext of this.
 */

/** One message per event and per five minutes: a burst of replies is one notification. */
export const PUSH_MIN_INTERVAL_MS = 5 * 60_000

/** The most the cipher takes in one record (RFC 8291: 4096 less the 86-byte header, the tag and the delimiter). */
export const PUSH_PAYLOAD_MAX_BYTES = 3993

export interface PushNotice {
  readonly v: 1
  readonly type: 'rsvp.new'
  /** The event's address, which the worker turns into the replies page. */
  readonly slug: string
  /** How many replies changed since the last notification of this event. */
  readonly count: number
}

export const rsvpNotice = (slug: string, count: number): PushNotice => ({
  v: 1,
  type: 'rsvp.new',
  slug,
  count,
})

/** The notice as the text that is encrypted: exactly its four fields, nothing else. */
export const noticePayload = (notice: PushNotice): string =>
  JSON.stringify({ v: notice.v, type: notice.type, slug: notice.slug, count: notice.count })

/**
 * How long to wait before telling about a reply that just changed: nothing was sent for the event
 * yet, or the five minutes since the last message are over, so now (0); otherwise what is left of
 * the interval, in milliseconds.
 */
export const pushBatchWait = (lastSentAt: number | null, now: number): number =>
  lastSentAt === null ? 0 : Math.max(lastSentAt + PUSH_MIN_INTERVAL_MS - now, 0)
