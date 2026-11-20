import type { ChannelKind } from '../channels/channelKind'
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
 * Four questions, and each answer names the setting it reads (a fifth line, who hosts the
 * photograph, comes from the box and not from the event: see {@link PrivacyNotice.operator}):
 *
 * | Question               | Answered by                                                    |
 * | ---------------------- | -------------------------------------------------------------- |
 * | what happens to it     | `moderation` → {@link NoticePublication}                        |
 * | who sees it            | {@link NOTICE_AUDIENCES}, which no setting moves — see there   |
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
 * - `guestFeed` — the other guests of the event, on their own phones, in the page « Les photos
 *   de la soirée »: every published photo with its author’s first name, and its caption in the
 *   photo’s text alternative (a guest sees only their own reactions). Like the wall it shows `published` and nothing else. No setting
 *   switches it off (there is no per-event flag: the page is part of the guest flow), so like
 *   `sharedGallery` it is named on every event rather than conditioned on something that
 *   cannot vary.
 * - `organisers` — the host and their moderators, who see **everything** a guest sends,
 *   including what never reaches the screen, and who may download the album
 *   (`GET /album.zip` is `requireRole('moderator')`).
 * - `sharedGallery` — whoever the host sends the album's private link to (roadmap §4.1),
 *   and whoever it is forwarded to: a link is a capability, not a list of people. They see
 *   what the wall shows, `published` and nothing else, and download it in full
 *   resolution, until the link expires or the host withdraws it.
 *
 * **On every event, not only on one with a link — and that is the honest reading, not
 * the cautious one.** The obvious condition, "an active link exists", is false for the
 * notice almost every guest actually reads: it is shown before an upload, uploads happen
 * while the event is live, and a host makes the link the next morning. A notice
 * conditioned on it would tell the whole room "the wall and the organisers" and then be
 * contradicted by a link sent after their last photo — when nobody is ever asked again,
 * because a closed event takes no upload to ask before. No setting switches the gallery
 * off, and any owner may make a link at any time, so what is true of every event when a
 * guest reads this is that the host *may*. The sentence says exactly that. It is the rule
 * {@link PrivacyNotice.retentionDays} already follows: state what stays true whatever
 * the host does next.
 *
 * Adding it was the seam §5.1 left: one entry here, the web's own `NoticeAudience`
 * (`noticeVocabulary.test.ts` fails until it has the member), and one sentence per
 * language in `upload.noticeAudiences`, which is keyed by that type and refuses to
 * compile until all five tables can say it. {@link revisionOf} is built from the list, so
 * every guest who acknowledged the three-audience notice is asked once more before their
 * next photo — which is right: the notice now reads differently.
 */
export const NOTICE_AUDIENCES = ['wall', 'guestFeed', 'organisers', 'sharedGallery'] as const

export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number]

/**
 * The settings a notice is derived from, and nothing else.
 *
 * A structural slice rather than `EventSettings` itself, so the dependency is written
 * down: `EventSettings` satisfies it through its getters, and a clause that starts
 * reading a fifth setting has to add it here, where a reviewer sees the notice grow a
 * new source of truth. The shared gallery is deliberately not one of them: see
 * {@link NOTICE_AUDIENCES} for why no setting decides that audience.
 */
export interface NoticePolicy {
  readonly moderation: ModerationMode
  readonly retentionDays: number | null
  readonly allowGuestSelfDelete: boolean
  readonly guestSelfDeleteGraceSeconds: number
  /** The guestbook switch (spec 01): when on, a message is one more thing the notice covers. */
  readonly allowGuestbook: boolean
  /** The roll of a disposable-camera evening (spec 23): the cap a guest is told about. */
  readonly maxPhotosPerGuest: number | null
  /** The reveal gate (spec 23): whether the photographs are held back, and the film look on screen. */
  readonly reveal: { readonly enabled: boolean; readonly film: boolean }
  /** The guests' save switch (spec 24): when on, another guest may keep a copy of a published photo. */
  readonly allowGuestSave: boolean
  /**
   * Voice messages are on for the event's guests (spec 25): `allowGuestbook` **and** the host's
   * switch. Not the box's capability: the transcoder is a fact about the box, not a promise to a guest.
   */
  readonly allowGuestbookVoice: boolean
  /** The host keeps the voices secret until the end of the evening. Read only when voice is on. */
  readonly guestbookVoiceSealed: boolean
  /**
   * The messaging channels whose photographs reach this event (spec 27): `['telegram']` when the host switched
   * it on, none otherwise. A fact about the host's switch, never about the box (a bot token is a fact about the
   * box, not a promise to a guest), as the voice clause reads the switch and not the transcoder.
   */
  readonly channels: readonly ChannelKind[]
}

/**
 * The longest operator name `OPERATOR_NAME` may carry, in UTF-16 units.
 *
 * Here and not in `env.ts` because it is a property of the notice: the name is the last
 * clause of {@link PrivacyNotice.revision}, and a guest sends the revision back when they
 * press "J'ai compris". The HTTP schema that receives it caps the text at 512, so this
 * number has to leave room under it for the other four clauses; `privacyNotice.test.ts`
 * holds the two together.
 */
export const OPERATOR_NAME_MAX_LENGTH = 100

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
   * Who hosts the photo, as the box's operator named themselves (`OPERATOR_NAME`), or
   * `null` on a box whose operator said nothing — which is every self-hosted box.
   *
   * The notice is where a guest is told *who* holds their photograph, and a self-hoster
   * has no one to name: the host of the event is the only party, and the notice already
   * says so ("the organiser"). An instance run for other people is a second party — a
   * processor of the hosts' data and, for the guest, the one a complaint is addressed to —
   * so it names itself here, once, in the guest's own screen (roadmap G2-17).
   *
   * It is part of the revision when present, because a guest who read a notice naming no
   * one has not read one naming an operator.
   */
  readonly operator: string | null
  /**
   * Whether guests may also leave written messages (spec 01), which then follow the same rules
   * as a photograph: the notice says so, and its sentences read for a message too.
   *
   * It is part of the revision **only when true**, so an event without a guestbook produces the
   * revision it always produced and asks nobody to read anything again. An event that turns it on
   * mid-evening shows the notice once more to every guest before their next photo or message.
   */
  readonly guestbook: boolean
  /**
   * Whether the guests' photographs are held back from the other guests and the room until the
   * host reveals the evening (spec 23): then the notice says so, and that the host and the
   * moderators see them as they arrive. **A clause of the notice only, never of the hour**: the
   * hour is told by the reveal block of the guest's own read, and an hour that moved (or became
   * "now") must not ask every guest to read the notice again. Part of the revision only when true.
   */
  readonly deferredReveal: boolean
  /**
   * The number of poses a guest has, **told only on a disposable-camera evening** (spec 23), or
   * `null`. A plain cap on an ordinary event is not a clause: telling it would change the
   * revision of every event that has one and ask its guests to read again for nothing. Part of
   * the revision only when present.
   */
  readonly shotLimit: number | null
  /**
   * That the film look exists on screen only and the original is kept as it is (spec 23), told
   * with the reveal, and part of the revision only when true.
   */
  readonly film: boolean
  /**
   * Whether the other guests may save a photo from the feed onto their phone (spec 24). The notice
   * then says so, and says a saved copy cannot be taken back: a guest who read "the other guests
   * see your photo" has not read "and keep it".
   *
   * Part of the revision **only when true**, like {@link PrivacyNotice.guestbook}: an event whose
   * switch is off produces the revision it produced before this clause existed, character for
   * character, so an event that predates it (which reads `false`) asks nobody to read anything
   * again. The revision is derived from the configuration with no memory, so switching it on or
   * off in the middle of the evening shows the notice once more to every guest who had read the
   * other one, before their next photo.
   */
  readonly guestSave: boolean
  /**
   * Whether guests may leave voice messages (spec 25). The notice then says who hears them, that the
   * room never does, what the moderation does with them, how long they are kept, that the microphone
   * only runs while recording, and how to take one back.
   *
   * Part of the revision **only when true**, like {@link PrivacyNotice.guestbook}: an event without
   * voice produces the revision it produced before this clause existed, character for character, so
   * nobody who read it is asked to read it again. An event that turns it on mid-evening shows the
   * notice once more to every guest before their next photo or message (spec 25, question 17).
   */
  readonly voice: boolean
  /**
   * The host keeps the voices secret until the end of the evening. `false` whenever {@link voice}
   * is. A fact about the configuration, not a stronger promise than it makes: the notice says "unless
   * the organiser decides otherwise". Part of the revision only when voice is on and this is true.
   */
  readonly voiceSealed: boolean
  /**
   * How long a guest may take a voice message back themselves, or `null` when they cannot (or when
   * voice is off). **Not {@link selfRemovalSeconds}**: a voice is never on a screen, so the rule of the
   * photograph ("only until it is approved") does not apply and an author may remove it inside the
   * window whatever its status, under automatic publication too (`GuestbookEntry`, rule 1 bis). Only
   * the host's veto and the window itself decide.
   */
  readonly voiceRemovalSeconds: number | null
  /**
   * The messaging channels that carry photographs to this event (spec 27). The notice then says they pass through
   * that messenger before arriving here, and that only a first name and a fingerprint of the account are kept.
   *
   * Part of the revision **only when there is one** (`channels=telegram`), like {@link PrivacyNotice.guestbook}: an
   * event with no channel produces the revision it produced before this clause existed, so nobody is asked to read
   * anything again. A web guest of an event that connects a group mid-evening reads the notice once more.
   */
  readonly channels: readonly ChannelKind[]
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

/**
 * `null` unless a guest can take a voice message back themselves: the host's veto is off and the
 * window is not zero. The status of the message and the moderation mode do not enter: see
 * {@link PrivacyNotice.voiceRemovalSeconds}.
 */
const voiceRemovalFor = (policy: NoticePolicy): number | null =>
  policy.allowGuestbookVoice &&
  policy.allowGuestSelfDelete &&
  policy.guestSelfDeleteGraceSeconds > 0
    ? policy.guestSelfDeleteGraceSeconds
    : null

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
 * reading the column — `publication=afterReview;audiences=wall+guestFeed+organisers+sharedGallery;
 * retention=30;selfRemoval=900` — rather than by recomputing hashes of every configuration the event
 * has ever had. It also cannot collide, which a 32-bit hash could, and a collision here
 * would be a guest silently not re-asked about a changed retention period.
 *
 * **The operator is the last clause, and only when there is one.** A box that names no
 * operator produces the revision it always produced, character for character, so a
 * self-hosted install that upgrades does not ask one of its guests to read the notice
 * again; a box that starts naming one, changes the name, or stops, does — it reads
 * differently, and "reads differently" is the whole definition of material here.
 * Last, because the name is free text: placed after the fixed clauses it can lengthen
 * only itself.
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
    // Always true, so a constant rather than a field: the guest can delete everything they sent from
    // their own phone (roadmap §5.2). It is in the revision so that the notice that first says so is
    // read by every guest who acknowledged the one that did not.
    'selfErase=phone',
    // Before the operator: the free-text name stays the last clause, as above.
    // Spec 26: the host may put a guest's words and first name in the photo book and have it printed.
    // Told with the guestbook, whose messages it is about, so it is one more constant of an event that has
    // one: the notice that first says so is read again by every guest of such an event, and an event
    // without a guestbook keeps its revision, character for character.
    ...(notice.guestbook ? ['guestbook=on', 'guestbookBook=print'] : []),
    ...(notice.guestSave ? ['guestSave=on'] : []),
    // Spec 23: each clause only when it is told, so an event without the mode keeps its revision.
    ...(notice.deferredReveal ? ['reveal=on'] : []),
    ...(notice.shotLimit === null ? [] : [`shots=${notice.shotLimit}`]),
    ...(notice.film ? ['film=on'] : []),
    // The voice clause, after the other switches and before the operator, which stays last. Its two
    // sub-clauses are the two facts the notice words that no other clause carries: a book kept secret,
    // and the voice's own removal window, which differs from the photograph's under automatic publication.
    ...(notice.voice
      ? [
          'voice=on',
          ...(notice.voiceSealed ? ['voiceSealed=on'] : []),
          `voiceRemoval=${notice.voiceRemovalSeconds ?? 'none'}`,
        ]
      : []),
    // Spec 27: the channels clause, after the voice and before the operator, which stays last.
    ...(notice.channels.length === 0 ? [] : [`channels=${notice.channels.join('+')}`]),
    ...(notice.operator === null ? [] : [`operator=${notice.operator}`]),
  ].join(';')

/**
 * The notice a guest of an event with this policy must read before their first upload.
 *
 * `operator` is the box's `OPERATOR_NAME`, already validated by the configuration, and
 * `null` unless the operator set it. It is a parameter and not a policy field because it
 * belongs to the box, not to the event: no host setting moves it.
 */
export const privacyNoticeFor = (
  policy: NoticePolicy,
  operator: string | null = null,
): PrivacyNotice => {
  const clauses = {
    publication: publicationFor(policy.moderation),
    audiences: [...NOTICE_AUDIENCES],
    retentionDays: policy.retentionDays,
    selfRemovalSeconds: selfRemovalFor(policy),
    operator,
    guestbook: policy.allowGuestbook,
    guestSave: policy.allowGuestSave,
    // The three clauses of the disposable camera hang on the mode being on: with it off the event
    // is the one it always was, and its notice says what it always said.
    deferredReveal: policy.reveal.enabled,
    shotLimit: policy.reveal.enabled ? policy.maxPhotosPerGuest : null,
    film: policy.reveal.enabled && policy.reveal.film,
    voice: policy.allowGuestbookVoice,
    // Read only when voice is on: a sealed book on an event without voice says nothing to a guest.
    voiceSealed: policy.allowGuestbookVoice && policy.guestbookVoiceSealed,
    voiceRemovalSeconds: voiceRemovalFor(policy),
    channels: [...policy.channels],
  }
  return { ...clauses, revision: revisionOf(clauses) }
}
