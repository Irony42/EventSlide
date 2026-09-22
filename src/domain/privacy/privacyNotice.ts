import type { ModerationMode } from '../events/eventSettings'

/**
 * What a guest is told happens to a photo, before they send one (roadmap §5.1).
 *
 * **Derived from the event's configuration, never written as prose**, and that is the
 * whole point of this module. A notice that says "photos are checked before they reach
 * the screen" on an event set to publish on arrival is a promise the configuration
 * contradicts, and the guest has no way to find out until their photo is on a projector
 * in front of two hundred people. So every clause below is a value computed from the
 * setting that decides it, and the sentences are composed from those values by the
 * client, in the guest's language.
 *
 * Four questions, and each answer names the setting it reads:
 *
 * | Question               | Answered by                                                    |
 * | ---------------------- | -------------------------------------------------------------- |
 * | what happens to it     | `moderation` → {@link NoticePublication}                        |
 * | who sees it            | {@link NOTICE_AUDIENCES}, which no setting moves yet           |
 * | how long it is kept    | `retentionDays`, counted from the close of the gallery         |
 * | how to have it removed | `allowGuestSelfDelete`, `guestSelfDeleteGraceSeconds`, and `moderation` |
 *
 * Two things are deliberately **not** here. The stripping of location and camera data on
 * ingest is a property of the product rather than of an event, so the client states it
 * unconditionally; it has no setting to contradict. And "ask the host" is always true —
 * a moderator can delete any photo of their event — so it is the fallback the client
 * always prints rather than a clause that could be switched off. There is no self-service
 * "delete everything I sent" to point at: that is roadmap §5.2, and it is not built.
 */

/**
 * Whether a person decides before a photo reaches the wall.
 *
 * Named from the guest's side of the glass rather than reusing `ModerationMode`: the
 * notice is a statement about what they will see happen, and a future mode that is
 * neither `manual` nor `auto` should have to say which of these two it is.
 */
export const NOTICE_PUBLICATIONS = ['afterReview', 'immediate'] as const

export type NoticePublication = (typeof NOTICE_PUBLICATIONS)[number]

/**
 * Who can see a photo once it is sent, in the order a guest reads them.
 *
 * - `wall` — anyone looking at the projected wall once the photo is published. That is
 *   the room, and it is also anyone the wall’s link reaches: the display page is public
 *   by design (docs/SECURITY.md §12, "a leaked display URL exposes published photos"),
 *   and it keeps playing after the gallery closes, until the host archives the event.
 *   Named for the page rather than for the people in front of it, so the notice cannot
 *   be read as promising that only the guests in the room will see a photo.
 * - `organisers` — the host and their moderators, who see **everything** a guest sends,
 *   including what never reaches the screen, and who may download the album
 *   (`GET /album.zip` is `requireRole('moderator')`).
 *
 * **A list rather than two booleans, because the next audience is already argued.**
 * Roadmap §4.1's shared gallery link — the host sending the published album to guests
 * after the evening — is a third audience, and adding it is meant to be exactly this:
 * one entry in this tuple, one conditional in {@link privacyNoticeFor} reading whatever
 * says sharing is on for the event, and one sentence per language. The chain that forces
 * the sentence is two links, and both are checked: `noticeVocabulary.test.ts` fails until
 * the web's own `NoticeAudience` carries the new member, and once it does,
 * `upload.noticeAudiences` — keyed by that type — refuses to compile until all five tables
 * can say it. Because {@link revisionOf} is built from the list, only the
 * guests of an event whose host turns sharing **on** are asked to read the notice again;
 * every other event's acknowledgements stay valid.
 */
export const NOTICE_AUDIENCES = ['wall', 'organisers'] as const

export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number]

/**
 * The settings a notice is derived from, and nothing else.
 *
 * A structural slice rather than `EventSettings` itself, so the dependency is written
 * down: `EventSettings` satisfies it through its getters, and a clause that starts
 * reading a fifth setting has to add it here, where a reviewer sees the notice grow a
 * new source of truth. The §4.1 seam lands here too — a `sharedGallery: boolean` beside
 * these four, from wherever the gallery keeps it.
 */
export interface NoticePolicy {
  readonly moderation: ModerationMode
  readonly retentionDays: number | null
  readonly allowGuestSelfDelete: boolean
  readonly guestSelfDeleteGraceSeconds: number
}

export interface PrivacyNotice {
  readonly publication: NoticePublication
  readonly audiences: readonly NoticeAudience[]
  /**
   * Days after the gallery **closes**, or `null` when nothing deletes the album on its own.
   *
   * Relative, never a date, and for a reason rather than for convenience. The retention
   * clock starts at `closedAt` (`Event.retentionDeadline`), and the notice is read before
   * an upload, which only a `live` event accepts — so there is no date yet to give. A date
   * computed from a scheduled close would be a promise the host's own "reopen" button can
   * move, since reopening clears `closedAt`. "Thirty days after the gallery closes" is true
   * whatever the host does next, including on the rare read after the doors have shut.
   *
   * `null` is said to the guest as what it is — no automatic deletion — rather than
   * papered over, because it is the answer the product's default gives.
   */
  readonly retentionDays: number | null
  /**
   * How long a guest may take a photo back themselves, or `null` when they cannot.
   *
   * `null` in three cases, and the third is the one a notice written as prose would get
   * wrong: the host turned self-deletion off; the window is zero; or the event publishes
   * on arrival. `Photo.canBeDeletedBy` only lets a guest delete a photo that has **not
   * been approved** — pending, or refused — and under `moderation: 'auto'` every photo
   * is approved the moment it lands, so a window promised there is a button that answers
   * 403. The same rule is why the sentence says "not yet approved" rather than "not on
   * the screen": a photo approved and then hidden is off the screen and still refused.
   */
  readonly selfRemovalSeconds: number | null
  /**
   * The notice's identity: two notices with the same revision say the same thing.
   *
   * What a guest's acknowledgement is recorded against, and what decides whether they are
   * asked again. See {@link revisionOf}.
   */
  readonly revision: string
}

/**
 * Whether a guest has read the notice that is in force.
 *
 * - `none` — they have never acknowledged one at this event.
 * - `current` — they acknowledged exactly this notice.
 * - `outdated` — they acknowledged a notice the host has since changed, so what they read
 *   is no longer what happens to their next photo.
 *
 * Three answers rather than a boolean because the client says different things to the
 * first and the third: a guest shown the notice again deserves to be told why.
 */
export const NOTICE_ACKNOWLEDGEMENTS = ['none', 'current', 'outdated'] as const

export type NoticeAcknowledgementStatus = (typeof NOTICE_ACKNOWLEDGEMENTS)[number]

/** A notice and where one guest stands with it: the shape every read of it answers. */
export interface NoticeForGuest {
  readonly notice: PrivacyNotice
  readonly acknowledgement: NoticeAcknowledgementStatus
}

const publicationFor = (moderation: ModerationMode): NoticePublication =>
  moderation === 'auto' ? 'immediate' : 'afterReview'

/**
 * `null` whenever a guest cannot actually take a photo back, whatever the switch says.
 * See {@link PrivacyNotice.selfRemovalSeconds} for the three cases.
 */
const selfRemovalFor = (policy: NoticePolicy): number | null => {
  const window = policy.guestSelfDeleteGraceSeconds
  const reachable = policy.allowGuestSelfDelete && window > 0 && policy.moderation === 'manual'
  return reachable ? window : null
}

/**
 * The revision: every clause, spelled out, in a fixed order.
 *
 * **Readable text rather than a hash**, and the readability is the feature. It is stored
 * on the guest's row when they acknowledge, so "what was this guest told?" is answered by
 * reading the column — `publication=afterReview;audiences=wall+organisers;retention=30;
 * selfRemoval=900` — rather than by recomputing hashes of every configuration the event
 * has ever had. It also cannot collide, which a 32-bit hash could, and a collision here
 * would be a guest silently not re-asked about a changed retention period.
 *
 * **Material means "reads differently", and nothing else.** Every field above is in it
 * and nothing outside the notice is: changing the accent colour, the wall's language or
 * the caption switch leaves every acknowledgement valid, because none of them changes
 * what happens to a photo. Changing retention, moderation or the self-delete window asks
 * every guest who acknowledged the old notice to read the new one before their next
 * upload — including a change that is *more* protective, deliberately: the rule "ask
 * again when it reads differently" has no judgement in it to get wrong, and the cost is
 * one tap, once, before a photo rather than after it.
 */
const revisionOf = (notice: Omit<PrivacyNotice, 'revision'>): string =>
  [
    `publication=${notice.publication}`,
    `audiences=${notice.audiences.join('+')}`,
    `retention=${notice.retentionDays ?? 'none'}`,
    `selfRemoval=${notice.selfRemovalSeconds ?? 'none'}`,
  ].join(';')

/** The notice a guest of an event with this policy must read before their first upload. */
export const privacyNoticeFor = (policy: NoticePolicy): PrivacyNotice => {
  const clauses = {
    publication: publicationFor(policy.moderation),
    audiences: [...NOTICE_AUDIENCES],
    retentionDays: policy.retentionDays,
    selfRemovalSeconds: selfRemovalFor(policy),
  }
  return { ...clauses, revision: revisionOf(clauses) }
}
