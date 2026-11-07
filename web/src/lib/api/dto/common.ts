// The vocabulary every audience shares: statuses, themes, templates and the public About.

/**
 * The wire format, transcribed from docs/API.md.
 *
 * Deliberately duplicated rather than imported from `src/`: the web app talks to the
 * server over HTTP only, so the DTO is an explicit contract. Sharing the server's
 * types would make every internal rename a silently breaking API change, and lint
 * forbids the import.
 */

export type PhotoStatus = 'pending' | 'published' | 'rejected' | 'hidden'
export type EventStatus = 'draft' | 'live' | 'closed' | 'archived'
export type ModerationDecision = 'publish' | 'reject' | 'hide'
export type ReactionKind = 'love' | 'laugh' | 'wow' | 'cheers' | 'clap'
export type WallLayout =
  'spotlight' | 'mosaic' | 'polaroid' | 'filmstrip' | 'collage' | 'split' | 'clothesline'
/**
 * The language an event's projected wall speaks (roadmap 1.5).
 *
 * The same five tags as `SUPPORTED_LOCALES`, written out again rather than imported: this
 * file is the **wire**, and the wire must not change shape because the app added or
 * dropped a table. `parseLocale` is the join, and the only place either knows the other.
 */
export type EventLanguage = 'fr' | 'de' | 'en' | 'es' | 'it'
export type EventRole = 'owner' | 'moderator'
/**
 * What a row on the wall actually is.
 *
 * Consulted where a **rule** differs and nowhere else. Everything mechanical about a
 * clip already arrives resolved: `thumbUrl` and `displayUrl` point at its poster frame,
 * so a surface that does not care renders a still and needs no branch at all.
 */
export type MediaKind = 'photo' | 'clip'
/**
 * The life of one transcode, as the guest's phone polls it.
 *
 * A separate machine from `PhotoStatus`, and deliberately: a clip that is still
 * transcoding has no photo row at all, which is what makes "a half-encoded clip reached
 * the projector" unrepresentable rather than filtered out. `reserved` is a window of
 * milliseconds that only a second upload of the same file can observe; a fresh upload
 * answers `queued`.
 */
export type ClipJobStatus = 'reserved' | 'queued' | 'running' | 'done' | 'failed'
export type ReactionCounts = Record<ReactionKind, number>
/** The font pairing and the frame style an event's theme selects (roadmap 2.2). */
export type ThemeFonts = 'sans' | 'serif'
export type ThemeFrame = 'soft' | 'square' | 'round'
/** The ambiance the guest's phone and the wall wear (docs/adr/0010-event-ambiances.md). */
export type ThemeAmbiance =
  'eventslide' | 'guinguette' | 'riviera' | 'champs' | 'bivouac' | 'cabaret' | 'noces' | 'custom'
/** The designed ambiances a custom one may borrow its faces from (ADR 0011). */
export type ThemeFaces = Exclude<ThemeAmbiance, 'custom'>
/** The polarity of a custom ambiance's surfaces and inks. */
export type ThemeGround = 'light' | 'dark'
/** The host's own ambiance (ADR 0011): a polarity, a tint angle and borrowed faces. */
export interface ThemeCustom {
  readonly ground: ThemeGround
  /** Degrees on the oklch hue circle, 0-359. */
  readonly groundHue: number
  readonly faces: ThemeFaces
}
/**
 * The preset an event's settings are created from (roadmap 3.5).
 *
 * A **request** vocabulary and nothing else. It rides on `POST /api/events`, is applied
 * once, and never comes back: no response in this file carries it, because the event
 * stores the values rather than the name of where they came from. If one ever appears on
 * an `EventDto`, the template has stopped being a copy and started being an attachment —
 * see `src/domain/events/eventTemplate.ts` for why that is the wrong product.
 */
export type EventTemplateKey = 'wedding' | 'birthday' | 'conference' | 'party'
/**
 * Who one of the host's prompts is asked of (roadmap §2.1).
 *
 * `guest` is answered once per guest — "un selfie avec les mariés", which two hundred
 * people can each do. `event` is answered once for the room — "la première danse", which
 * happens once, and which one guest's photograph therefore ticks for everybody.
 */
export type MissionScope = 'guest' | 'event'
/**
 * How one event looks, as three settled choices rather than as colours.
 *
 * **No colour crosses this wire.** `accentHue` is an angle; the lightness and chroma that
 * turn it into a palette are declared once in `tokens.css`, which stays the only file in
 * the product holding a raw colour. `design-system/eventTheme.ts` applies it as
 * `--accent-hue` on the surface that carries it.
 */
/** What the host says to their guests (spec 03): content, shown as written. */
export interface EventBrandDto {
  readonly welcomeMessage: string | null
  readonly logoUrl: string | null
}
export interface EventThemeDto {
  /** Degrees on the oklch hue circle, 0-359. The server refuses one it cannot read. */
  readonly accentHue: number
  readonly fonts: ThemeFonts
  readonly frame: ThemeFrame
  readonly ambiance: ThemeAmbiance
  /** Present exactly when `ambiance` is `custom` (ADR 0011); absent from the wire otherwise. */
  readonly custom?: ThemeCustom
  /**
   * Where the host's own photograph of their venue is served, replacing the ambiance's bundled
   * ground (ADR 0010, decision 8), or `null`. A path on this origin that names the photograph's
   * digest, so it changes when the photograph does.
   *
   * Optional on the client alone, and only because a theme a tab stored before this field
   * existed has none: the server always sends it. `readEventTheme` is what lets one through.
   */
  readonly groundUrl?: string | null
}
/**
 * What a box can and cannot do, read without probing. Additive: a client that does not
 * know a flag ignores it. Mirrors `AboutFeaturesDto` on the server.
 */
export interface AboutFeatures {
  /**
   * `SITE_ADMIN=on`: the operator's namespace is mounted on this box. What the SPA reads
   * to decide whether to offer `/admin/site` — never a request that answers 401 in one
   * mode and 404 in the other.
   */
  readonly siteAdmin: boolean
  /**
   * The box can send mail, so `POST /api/auth/password-reset/request` is not
   * `404 feature.unavailable` and the sign-in page may offer "Forgot your password?"
   * (G2-08 / P3-09). Read with `false` for a server that does not say, which is the one
   * that must not offer a link to a page that cannot work.
   */
  readonly forgotPassword: boolean
}
/**
 * The operator's optional links, each present only when the operator set it (roadmap
 * G4-02). Mirrors `AboutLinksDto` on the server. A donation buys no counterpart, so
 * nothing here says who gave or what they get.
 */
export interface AboutLinks {
  /** `LEGAL_TERMS_URL`: the terms of use. An https address or a path on this site. */
  readonly terms?: string
  /** `LEGAL_PRIVACY_URL`: the privacy policy. An https address or a path on this site. */
  readonly privacy?: string
  /** `LEGAL_NOTICE_URL`: the legal notice. An https address or a path on this site. */
  readonly legalNotice?: string
  /** `SUPPORT_URL`: help for a host. An https address or a path on this site. */
  readonly support?: string
  /** `REPORT_URL`: where to report a piece of content (DSA art. 16). Same kinds of address. */
  readonly report?: string
  /** `DONATION_URL`: where to support the project. */
  readonly donate?: string
  /** `BUDGET_URL`: the public ledger the donations are accounted in. */
  readonly budget?: string
}
/**
 * Who runs this box (roadmap G2-17 / P3-18), present only when the operator named
 * themselves. Mirrors `AboutOperatorDto` on the server.
 */
export interface AboutOperator {
  /** `OPERATOR_NAME`. Plain text. */
  readonly name: string
  /** `OPERATOR_CONTACT_EMAIL`. Present only when set. */
  readonly contactEmail?: string
}
/**
 * `GET /api/about`: what this box is, its licence and **where its source is** (roadmap
 * G1-04 / P1-05) — the AGPL section 13 offer. Mirrors `AboutDto` on the server.
 */
export interface About {
  readonly name: string
  readonly version: string
  readonly license: 'AGPL-3.0-only'
  readonly sourceUrl: string
  /** Who runs the box. Absent until the operator names themselves; see {@link AboutOperator}. */
  readonly operator?: AboutOperator
  /** Operator links. Empty until the box has any to offer; see {@link AboutLinks}. */
  readonly links: AboutLinks
  readonly features: AboutFeatures
}
