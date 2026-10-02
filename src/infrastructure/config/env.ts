import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  AUDIT_RETENTION_DEFAULT_DAYS,
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
} from '../../domain/audit/auditRetention'
import { OPERATOR_NAME_MAX_LENGTH } from '../../domain/privacy/privacyNotice'
import { JoinCode } from '../../domain/shared/joinCode'
import { Password } from '../../domain/users/password'
import { parseMailbox, parseSmtpUrl, type SmtpSettings } from '../mail/smtpEndpoint'

/**
 * The only module in the codebase that reads `process.env`. Lint enforces that
 * everywhere else, and the reason is that 1.0 read the environment inline at module
 * load in `src/index.ts`, so a missing variable produced a runtime surprise at the
 * first request rather than a refusal to boot.
 *
 * Everything is parsed and validated once. Failure is fatal and the message names
 * every problem at once, because discovering misconfiguration one variable per restart
 * is miserable when you are setting up in a venue an hour before the guests arrive.
 */

/** `.env` files give strings; this coerces and bounds them. */
const positiveInt = (fallback: number, max?: number) => {
  const base = z.coerce.number().int().positive()
  return (max === undefined ? base : base.max(max)).default(fallback)
}

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

/**
 * {@link boolish}, with a default. Kept separate rather than adding `.default()` to
 * `boolish` itself: every existing caller passes it through `.optional()` and reads the
 * product's own fallback afterwards (`SESSION_COOKIE_SECURE` follows `NODE_ENV`,
 * `E2E_HOOKS` is refused outright in production), so none of them needed zod to supply
 * one — `ALLOW_CUSTOM_SLUGS` is the first variable here where the default is as simple
 * as "true, unless told otherwise", with nothing else to layer on top of it.
 */
const boolishWithDefault = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback)
    .transform((value) => value === 'true' || value === '1')

/**
 * Values shipped in `.env.example`. Booting production with one of these is worse than
 * booting with nothing, because it looks configured.
 */
const PLACEHOLDER_SECRETS = new Set([
  'change-me-in-production-at-least-32-characters',
  'change-me-too-at-least-32-characters-long',
  'dev-session-secret',
  'secret',
])

const secret = (name: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 characters`)
    .refine((value) => !PLACEHOLDER_SECRETS.has(value), {
      message: `${name} is still the example value from .env.example`,
    })

/**
 * What a boot that was given no secret signs with.
 *
 * There used to be two constants here — `development-only-session-secret-not-for-production`
 * and its guest-token twin — and they were the whole of the defect. A constant in a public
 * repository is a key every reader of the repository already holds, so an instance that
 * reached them could have its host session and its guest tokens forged by anybody; and the
 * only thing standing between a venue box and that state was an environment variable the
 * operator had to remember to set. Refusing in production was already correct and is
 * unchanged; what was wrong is that *not saying* meant development.
 *
 * Both halves of the fix live here. `NODE_ENV` now defaults to `production`, so silence is
 * the strict posture and the boot refuses; and the non-production fallback is 48 random
 * bytes rather than a constant, so there is no longer a repo-public secret for any
 * configuration to reach. The question "can a box boot with a secret this repository
 * publishes" now has no code path to answer yes with, rather than a discouraged one.
 *
 * What it costs is honest and small: an ephemeral secret dies with the process, so a
 * development restart logs every host out and invalidates every outstanding guest token.
 * `npm run dev` is a `tsx watch`, so that is a real inconvenience — and it is the one the
 * boot log names, with the two variables that end it. A developer who wants sessions to
 * survive a reload sets them; a venue box has to.
 */
const EPHEMERAL_SECRET_BYTES = 48
const ephemeralSecret = (): string => randomBytes(EPHEMERAL_SECRET_BYTES).toString('base64url')

/**
 * How often one of the in-process sweeps runs, in minutes — or the word `off`.
 *
 * **`0` is deliberately not the way to disable one.** Every other numeric setting here
 * goes through `z.coerce.number()`, and `Number('')` is `0`: a compose file with a
 * dangling `RETENTION_SWEEP_INTERVAL_MINUTES=`, a templated value that rendered empty,
 * a truncated secret manager entry would all silently switch off a deletion the host
 * promised their guests — the one failure mode nobody would notice, because its symptom
 * is that nothing happens. So the empty string and `0` are refusals that name the
 * variable at boot, and turning a sweep off takes a word somebody had to mean.
 *
 * Bounded at a day at the top, like the other numeric settings: a sweep that runs less
 * often than the thing it acts on is indistinguishable from one that is off, and should
 * be written as `off`.
 *
 * Shared by both sweeps rather than written twice. The rule here is subtle enough —
 * `Number('')` is the whole reason for it — that two copies would be two chances to
 * lose it.
 */
const SWEEP_OFF = 'off'
const SWEEP_MAX_MINUTES = 1_440

const sweepInterval = (name: string, consequence: string) =>
  z
    .string()
    .trim()
    .refine(
      (value) =>
        value === SWEEP_OFF ||
        (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= SWEEP_MAX_MINUTES),
      {
        message: `${name} must be a whole number of minutes from 1 to ${SWEEP_MAX_MINUTES}, or the word '${SWEEP_OFF}' ${consequence}`,
      },
    )
    // `null` is "never", and it is only ever reached through that word.
    .transform((value): number | null => (value === SWEEP_OFF ? null : Number(value)))

const retentionSweepInterval = sweepInterval(
  'RETENTION_SWEEP_INTERVAL_MINUTES',
  'to stop honouring retention automatically',
)

/**
 * The scheduling sweep. Five minutes, because this one's lag is visible in the room:
 * an event scheduled for 18:00 opens somewhere in 18:00–18:05, and a guest scanning the
 * QR code in that window is told the party has not started. Retention can afford an
 * hour; a door cannot.
 *
 * Shorter would buy very little — the work is one indexed query against a handful of
 * rows — but the instants a host types are minutes, not seconds, and a sweep that fires
 * twelve times an hour is already inside the granularity of the thing it acts on.
 */
const scheduleSweepInterval = sweepInterval(
  'SCHEDULE_SWEEP_INTERVAL_MINUTES',
  'to stop opening and closing events automatically',
)

/** Hourly. Retention is measured in days, so this is about bounding lag, not precision. */
const DEFAULT_RETENTION_SWEEP_MINUTES = 60

/** See {@link scheduleSweepInterval}: the worst case a guest can be told "not yet". */
const DEFAULT_SCHEDULE_SWEEP_MINUTES = 5

/**
 * The public origin. `z.string().url()` alone accepts any parseable URL, including
 * `javascript:alert(1)` and `data:text/html,…`: the value is concatenated into the
 * `joinUrl` on **two** responses, and this is the only place the scheme is narrowed.
 * `EventDto.joinUrl` is the admin console's link and QR, so a non-navigable scheme would
 * put a script URI behind the host's join button; `WallResponseDto.joinUrl` is the QR
 * **projected in front of the room**, which is the higher-stakes one — it is the code a
 * guest's phone actually scans, and §9 trap 1 is the record of what a wrong join link
 * costs. A phone has to be able to open it, which leaves exactly two schemes; production
 * narrows that further to https, or http on localhost behind a TLS proxy.
 */
const publicUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'PUBLIC_URL must be an http or https origin',
  })

/**
 * `""` is absent, not a value.
 *
 * `compose.yaml` passes the first-owner variables as `${BOOTSTRAP_OWNER_EMAIL:-}` and
 * `${BOOTSTRAP_OWNER_PASSWORD:-}`, which Docker renders as an **empty string** whenever
 * the operator did not set them — so the ordinary case, `docker compose up` with no
 * first owner wanted, arrives here as `""` and not as `undefined`. Read as a value it
 * made `bootstrapFirstOwner` call the use case with an empty password and log
 * `could not create the first owner account` on every boot of a default deployment;
 * read as a policy failure, now that there is a policy, it would refuse that boot.
 */
const blankAsAbsent = (value: unknown): unknown => (value === '' ? undefined : value)

/**
 * Where the AGPL section 13 source link points when the box says nothing: the upstream
 * repository, at the tag of the running version (roadmap G1-04 / P1-05, P1-06).
 *
 * The tag is the claim. `/tree/v${version}` is the source of exactly the build that is
 * running, which is what section 13 owes a user of a network service — so the default is
 * right for the published image, unmodified, and wrong for anything else. A deployment
 * built from a commit that no tag names must set `SOURCE_CODE_URL` to that commit, or
 * build with `SOURCE_REF` (the Dockerfile's build argument); docs/API.md says so.
 */
const UPSTREAM_REPOSITORY = 'https://github.com/Irony42/EventSlide'

/**
 * An https URL a browser may be sent to, in its canonical form, or `null`.
 *
 * https and nothing else, with no exception for localhost: the value is rendered as a link
 * on every guest and host screen and printed by a public endpoint, so `javascript:`,
 * `data:` and plain `http:` are refused alike. `PUBLIC_URL` above has to admit http for a
 * venue box on a LAN; this link has no such excuse. Credentials in the URL are refused
 * too, because they would be shown to every visitor.
 *
 * The raw text is checked for whitespace and control characters **before** it is parsed,
 * because the WHATWG parser silently deletes tabs and newlines from the middle of a URL:
 * an address with a newline in it would otherwise be accepted as something the operator
 * never typed. The canonical `href` is what is returned, never the input.
 */
const parseHttpsUrl = (value: string): string | null => {
  if (/[\s\p{Cc}]/u.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
  return url.href
}

/**
 * An optional https link an operator publishes, validated once for every variable that
 * carries one: `SOURCE_CODE_URL`, `DONATION_URL` and `BUDGET_URL`. Blank is absent, for the
 * reason on {@link blankAsAbsent}, and what is returned is the canonical form
 * ({@link parseHttpsUrl}), never the text as typed.
 *
 * One factory rather than three copies, so the three cannot drift apart: the rule that
 * refuses `http:` for the source link is the rule that refuses it for a donation page, and
 * a test that loosens one loosens all three and fails for all three.
 */
const optionalHttpsLink = (variable: string, shownTo: string) =>
  z.preprocess(
    blankAsAbsent,
    z
      .string()
      .trim()
      .transform((value, ctx) => {
        const parsed = parseHttpsUrl(value)
        if (parsed === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${variable} must be an https URL with no credentials in it: a javascript:, data: or http: address is refused, because this link is shown to ${shownTo}`,
          })
          return z.NEVER
        }
        return parsed
      })
      .optional(),
  )

/**
 * `SOURCE_CODE_URL`: the complete source of this build, as the operator publishes it. It
 * wins over `SOURCE_REF` and over the default.
 */
const sourceCodeUrl = optionalHttpsLink('SOURCE_CODE_URL', 'every visitor')

/**
 * `DONATION_URL`: where a visitor can support the project (roadmap G4-02). **Empty by
 * default**, so a self-hoster's screens never mention money; set, it is offered in the host
 * footer, on `/about` and once, closably, to a host whose event has just closed. It is
 * never shown to a guest or on the projected wall. A donation buys nothing, and no
 * setting adds a counterpart.
 */
const donationUrl = optionalHttpsLink('DONATION_URL', 'hosts and on the public /about page')

/**
 * `BUDGET_URL`: the public ledger the donations are accounted in, when the operator keeps
 * one (roadmap G4-02). Empty by default, for the same reason as {@link donationUrl}.
 */
const budgetUrl = optionalHttpsLink('BUDGET_URL', 'hosts and on the public /about page')

/**
 * The origin a path is parsed against to prove it stays on this site. Nothing is ever sent
 * there: the `.invalid` top-level domain is reserved and resolves nowhere, and only the
 * comparison of origins before and after parsing matters.
 */
const SAME_ORIGIN_PROBE = 'https://same-origin.invalid'

/** Long enough for any real address, short enough that a pasted blob is not one. */
const LINK_MAX_LENGTH = 2_048

/**
 * A path on this site in its canonical form, or `null`: one leading `/`, then anything the
 * URL parser keeps on the same origin.
 *
 * **Three ways a "path" leaves the site, each refused.** `//host/x` is protocol-relative.
 * `/\host/x` is read by every browser as `//host/x`, because for an http(s) address a
 * backslash is a slash. And `/.//host/x` is the subtle one: the parser removes the dot
 * segment and leaves a path that *starts* with `//`, so the canonical text would be
 * protocol-relative even though the input was not. The origin is therefore compared after
 * parsing, and the canonical result is checked for a leading `//` as well.
 *
 * Whitespace and control characters are refused before parsing, for the reason
 * {@link parseHttpsUrl} gives.
 */
const parseSameOriginPath = (value: string): string | null => {
  if (/[\s\p{Cc}]/u.test(value)) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  let url: URL
  try {
    url = new URL(value, SAME_ORIGIN_PROBE)
  } catch {
    return null
  }
  if (url.origin !== SAME_ORIGIN_PROBE) return null
  const path = `${url.pathname}${url.search}${url.hash}`
  return path.startsWith('//') ? null : path
}

/**
 * An optional link the operator owes a visitor (roadmap G2-17 / P3-18): their terms, privacy
 * policy, legal notice, help page or report page. **An https address, or a path on this
 * site**, and nothing else. A path is allowed because the hosted instance serves its legal
 * pages itself, from the same origin and ahead of this application (`/legal/signaler`), and
 * an absolute address would have to repeat the instance's own domain in its own
 * configuration.
 *
 * Blank is absent, for the reason on {@link blankAsAbsent}. What is returned is the
 * canonical form, never the text as typed.
 */
const optionalSiteLink = (variable: string, shownTo: string) =>
  z.preprocess(
    blankAsAbsent,
    z
      .string()
      .trim()
      .transform((value, ctx) => {
        const parsed =
          value.length > LINK_MAX_LENGTH
            ? null
            : value.startsWith('/')
              ? parseSameOriginPath(value)
              : parseHttpsUrl(value)
        if (parsed === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${variable} must be an https URL with no credentials in it, or a path on this site starting with a single / (as in /legal/terms), of at most ${LINK_MAX_LENGTH} characters: a javascript:, data: or http: address, or one that leaves the site, is refused, because this link is shown to ${shownTo}`,
          })
          return z.NEVER
        }
        return parsed
      })
      .optional(),
  )

/**
 * `OPERATOR_NAME`: who runs this box, as they wish to be named (roadmap G2-17 / P3-18).
 * **Empty by default**: a self-hoster has no one to name, and the guest notice then says
 * nothing about a host beyond the organiser.
 *
 * Plain text, shown on `/about` and in the guest's privacy notice, and part of the notice's
 * revision. No control character, line break or bidirectional override: the first two would
 * break a sentence apart, and the last can make a name read as another. React escapes the
 * rest.
 */
const operatorName = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .trim()
    .min(1, 'OPERATOR_NAME must not be blank')
    .max(
      OPERATOR_NAME_MAX_LENGTH,
      `OPERATOR_NAME must be at most ${OPERATOR_NAME_MAX_LENGTH} characters`,
    )
    .refine((value) => !/[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u.test(value), {
      message:
        'OPERATOR_NAME must not contain a control character, a line break or a bidirectional override',
    })
    .optional(),
)

/**
 * `OPERATOR_CONTACT_EMAIL`: where a visitor can reach the operator (roadmap G2-17). Required
 * to sit beside `OPERATOR_NAME`: an address with no one behind it is not an identity.
 *
 * One plain address, which is what zod's `email()` accepts and nothing wider: no display
 * name, no list, and no `?` or `&`, so the `mailto:` link built from it cannot carry a
 * header the operator did not mean to publish.
 */
const operatorContactEmail = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .trim()
    .max(254)
    .email('OPERATOR_CONTACT_EMAIL must be one e-mail address, such as contact@example.org')
    .optional(),
)

/** Terms of use. See {@link optionalSiteLink}. */
const legalTermsUrl = optionalSiteLink('LEGAL_TERMS_URL', 'every visitor')
/** Privacy policy; also linked from the guest's privacy notice. */
const legalPrivacyUrl = optionalSiteLink('LEGAL_PRIVACY_URL', 'every visitor')
/** Legal notice (the editor's and the host's identity, under the LCEN). */
const legalNoticeUrl = optionalSiteLink('LEGAL_NOTICE_URL', 'every visitor')
/** Where a host gets help. Shown to hosts and on `/about`. */
const supportUrl = optionalSiteLink('SUPPORT_URL', 'hosts and on the public /about page')
/** Where to report a piece of content (DSA art. 16). Shown to guests. */
const reportUrl = optionalSiteLink('REPORT_URL', 'every guest')

/**
 * `SOURCE_REF`: the tag or commit the image was built from, injected by the Dockerfile's
 * `SOURCE_REF` build argument. It replaces `/tree/v${version}` in the default link.
 *
 * A git ref in a URL path, so narrow: segments of letters, digits, dots, underscores and
 * hyphens joined by `/`, with no `..`. A tag (`v2.1.0`), a release branch (`release/2.1`)
 * and a 40-character commit all fit; a query string, a fragment, a space or a traversal
 * do not.
 */
const sourceRef = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
      'SOURCE_REF must be a git tag, branch or commit: letters, digits, dots, underscores and hyphens, joined by /',
    )
    .refine((value) => !value.includes('..'), { message: 'SOURCE_REF must not contain ..' })
    .optional(),
)

/**
 * Whether this box is run for other people (docs/ROADMAP.md §10.9): `off` or `on`, and
 * nothing else.
 *
 * **Two words, lower case, exactly as `NODE_ENV` and `LOG_LEVEL` take theirs.** Not
 * {@link boolish}: the roadmap, `.env.example` and `compose.yaml` all write this switch as
 * `off|on`, and a second set of spellings would be a second thing to document and to get
 * wrong. So `true`, `1`, `yes` and `ON` are refusals that name the variable at boot, beside
 * every other bad one — never a guess at which side of the switch was meant.
 *
 * **Absent is `off`, and so is blank**, for the reason written on `NODE_ENV`: a dangling
 * `SITE_ADMIN=` or a template that rendered empty lands on the default like any other
 * absence. Here the default is also the posture with less surface — no `/api/site` router
 * is mounted at all — so a blank can only ever take something away.
 */
const siteAdmin = z.preprocess(blankAsAbsent, z.enum(['off', 'on']).default('off'))

/**
 * Whether a derived slug always carries a random suffix (P4-09 / D-14, roadmap G3-05).
 *
 * **`'none'` reproduces 2.0's only behaviour exactly**, and is the core default a
 * self-hosted box keeps without setting anything: a derived slug is the bare folded
 * name, `camille-sacha`, exactly as every event created before this variable existed
 * has it. `'random'` is what the hosted instance sets from its first beta boot — see
 * `Slug.fromNameWithRandomSuffix` for why the suffix is **always** appended rather than
 * only on collision.
 *
 * Same spelling convention as {@link siteAdmin}: two lower-case words, blank or absent
 * lands on the default exactly as a dangling `EVENT_SLUG_SUFFIX=` would otherwise be a
 * silent and unintended change of posture, never a guess at a third spelling.
 */
const eventSlugSuffix = z.preprocess(blankAsAbsent, z.enum(['none', 'random']).default('none'))

/**
 * Who may create an event (P3-05 / G2-04, decision D-07).
 *
 * **`anyAccount` is the core default, and it is today's behaviour exactly**: every signed-in
 * account, a moderator someone invited included, may create events, with no client in the
 * picture at all. A self-hosted box whose compose file predates this variable sees nothing
 * change. `clientMembers` is what a box run for other people sets: only an account that
 * belongs to a client, or the box's operator, may create one.
 *
 * Same spelling convention as {@link siteAdmin}: exact words, blank or absent lands on the
 * default, and anything else is a refusal that names the variable. `clientMembers`
 * additionally requires `SITE_ADMIN=on`, in the refinement below.
 */
const eventCreation = z.preprocess(
  blankAsAbsent,
  z.enum(['anyAccount', 'clientMembers']).default('anyAccount'),
)

/**
 * Whether a host — or, over the API, any caller — may address their own event by a
 * slug they chose (P4-09 / D-14). `true` is the core default: a self-hosted host could
 * always type their own address, and nothing here takes that away. The hosted instance
 * sets `false`, so every event there is addressed by a derived, suffixed slug and a
 * caller handing one in anyway is refused outright (`400 event.customSlugNotAllowed`)
 * rather than silently overridden — overriding it would save a different event than the
 * one the caller believes they are about to open.
 */
const allowCustomSlugs = boolishWithDefault('true')

/**
 * How many characters a newly minted or rotated join code has (P4-09 / D-14), 6 to 10.
 * `JoinCode.minLength` is both the floor of the accepted range and the default — 2.0's
 * only length, and what every pre-existing printed card already is — so the two are
 * quoted from the same constant rather than restated as a second `6` free to drift away
 * from it. A code already on an event keeps whatever length it was minted with:
 * `JoinCode.create` accepts the whole range on the way back in, so lowering this
 * variable later does not strand an existing card.
 */
const joinCodeLength = z.coerce
  .number()
  .int()
  .min(JoinCode.minLength, `JOIN_CODE_LENGTH must be at least ${JoinCode.minLength}`)
  .max(JoinCode.maxLength, `JOIN_CODE_LENGTH must be at most ${JoinCode.maxLength}`)
  .default(JoinCode.minLength)

/**
 * How many days the audit log keeps a row (roadmap §10.8; paid plan P3-07 / free plan G2-06).
 *
 * **Bounded at both ends, and the floor is the point.** The log exists so that "who changed
 * that ceiling, and when" has an answer; a retention an operator could set to a week would
 * let the instance forget an action inside the window in which a client may still dispute
 * it. The numbers belong to `domain/audit/auditRetention.ts` and are quoted from there, not
 * restated, so the pruner and the boot refusal cannot disagree about what is allowed. The
 * hosted instance sets the floor itself, 365.
 *
 * Blank is absent, for the reason written on {@link blankAsAbsent}. Unlike a sweep interval
 * this is a *safe* direction to default in: a dangling `AUDIT_RETENTION_DAYS=` keeps the log
 * three years rather than deleting anything sooner, and `0` is a refusal that names the
 * variable, not a way to turn pruning off.
 */
const auditRetentionDays = z.preprocess(
  blankAsAbsent,
  z.coerce
    .number()
    .int()
    .min(
      AUDIT_RETENTION_MIN_DAYS,
      `AUDIT_RETENTION_DAYS must be at least ${AUDIT_RETENTION_MIN_DAYS}: a shorter log forgets an action while a client may still dispute it`,
    )
    .max(
      AUDIT_RETENTION_MAX_DAYS,
      `AUDIT_RETENTION_DAYS must be at most ${AUDIT_RETENTION_MAX_DAYS}`,
    )
    .default(AUDIT_RETENTION_DEFAULT_DAYS),
)

/**
 * `SMTP_URL`: the relay outgoing mail goes through (roadmap §10.3, G2-07 / P3-08), as
 * `smtp://host:587` (a plain connection upgraded with STARTTLS) or `smtps://host:465` (TLS
 * from the first byte), with `user:password@` in front when the relay wants a login. Absent
 * is the self-hoster default and means **no mail at all**: the composition root wires
 * `NullMailer` and the caller shows the link to copy.
 *
 * Blank is absent, for the reason on {@link blankAsAbsent}: `compose.yaml` passes it as
 * `${SMTP_URL:-}`, so an operator with no relay sends the empty string.
 *
 * **This value is a credential, and it never appears in a refusal.** The schema keeps the
 * message fixed and does not echo the input, because the boot's list of problems is printed
 * to a terminal and kept by whatever collects its output — and a URL refused for a stray
 * character still carries the password it was refused with. What is stored is the parsed
 * {@link SmtpEndpoint}, not the string: the adapter is handed parts and no query string
 * (`parseSmtpUrl` refuses one) and the password has one reader.
 */
const smtpUrl = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .transform((value, ctx) => {
      const parsed = parseSmtpUrl(value)
      if (!parsed.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `SMTP_URL ${parsed.error}. Expected smtp://host:587 or smtps://user:password@host:465, with special characters in the credentials percent-encoded; the value is not repeated here because it may carry a password`,
        })
        return z.NEVER
      }
      return parsed.value
    })
    .optional(),
)

/**
 * `MAIL_FROM`: the sender of every message, `no-reply@example.org` or
 * `EventSlide <no-reply@example.org>`. Required whenever {@link smtpUrl} is set, because a
 * relay refuses mail with no sender and the failure would otherwise show up as a rejected
 * invitation on the day someone first used it. Blank is absent.
 */
const mailFrom = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .transform((value, ctx) => {
      const parsed = parseMailbox(value)
      if (!parsed.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `MAIL_FROM ${parsed.error}` })
        return z.NEVER
      }
      return parsed.value
    })
    .optional(),
)

/**
 * The domain's password policy, applied at boot so the failure is a named ConfigError.
 *
 * This is exactly the reasoning written on `BCRYPT_COST` below, for the same shape of
 * defect. `bootstrapOwner` already runs `Password.create`, but it runs it while
 * `src/main/container.ts` is assembling the application, where the only outcome is one
 * log line saying the first owner could not be created — and the operator finds out by
 * meeting a login form that rejects them. Refusing here makes a weak bootstrap password
 * one of the problems the boot refusal lists, beside every other bad variable.
 *
 * The minimum is **not** restated: `Password.minLength` owns it, and a second `12` in
 * this file would be a number free to drift away from the rule it is quoting. The whole
 * policy is applied rather than the length alone, so `changemenow1` is refused here for
 * the same reason it is refused from the account form.
 *
 * No `PasswordContext`: the same-as-email and same-as-name checks need the other
 * variables, and a cross-field refusal belongs in the object refinement, not in a field
 * that cannot see them.
 */
const bootstrapOwnerPassword = z.string().superRefine((value, ctx) => {
  const parsed = Password.create(value)
  if (parsed.ok) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `BOOTSTRAP_OWNER_PASSWORD must satisfy the same policy as any other account password: at least ${Password.minLength} characters, and not a guessable one (${parsed.error.code})`,
  })
})

/**
 * One schema, built twice, differing in exactly one refinement.
 *
 * The maintenance commands — `db:migrate`, `purge`, `backup`, `restore`, `db:seed:demo` —
 * open the database and the media root and exit. They sign no cookie, mint no token and
 * answer no request, so the two secrets are not a precondition for them; and requiring
 * them would break the promise docs/SECURITY.md §11 makes about those commands, that they
 * need no configuration beyond `--database` and `--media`. A restore at two in the morning
 * must not fail because the operator's shell does not carry a value their compose file
 * holds.
 *
 * It is deliberately **not** done by handing those scripts a `NODE_ENV=development`, which
 * is where this landed first and was wrong twice over: it inverts "silence is the strict
 * posture" on exactly the box §11 sends the operator to, and it makes `seedDemo`'s own
 * refusal to touch a production database unreachable, since the guard's only input would
 * be a variable the npm script itself writes. Everything else — the `NODE_ENV` default,
 * the placeholder blocklist, the 32-character floor, the https `PUBLIC_URL` rule, the
 * `E2E_HOOKS` refusal — is the same in both.
 */
interface SchemaOptions {
  readonly secretsRequiredInProduction: boolean
}

const buildSchema = ({ secretsRequiredInProduction }: SchemaOptions) =>
  z
    .object({
      /**
       * **Absent means production.** This is the security default of the whole file.
       *
       * It used to default to `development`, and five controls hang off it at once: both
       * signing secrets fell back to constants published in this repository, the session
       * cookie lost `Secure`, HSTS and `upgrade-insecure-requests` were not sent, and the
       * CSP admitted `'unsafe-inline'` in `script-src`. So a self-hosted operator who ran
       * the built server without setting one variable got a box whose session cookie
       * anybody could forge — and nothing said so. `docker compose up` was never the
       * problem (`compose.yaml` and the `Dockerfile` both set `NODE_ENV=production`); the
       * problem was every other way of starting it, including the systemd unit
       * docs/SECURITY.md §11 recommends.
       *
       * Inverting it makes the failure mode a refusal instead of a silent downgrade: a
       * process that was told nothing now asks for real secrets and stops without them.
       * Development declares itself — `scripts/dev.env`, loaded by the npm scripts that run
       * from a source checkout, is where it does.
       *
       * The blank is deliberately absent rather than a value, for the reason written on
       * {@link sweepInterval}: a compose file with a dangling `NODE_ENV=`, or a template
       * that rendered empty, must not be the one input that relaxes the posture. It lands
       * on the strict default like any other absence.
       */
      NODE_ENV: z.preprocess(
        blankAsAbsent,
        z.enum(['development', 'test', 'production']).default('production'),
      ),
      PORT: positiveInt(4300, 65535),
      PUBLIC_URL: publicUrl.default('http://localhost:5173'),
      LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

      // Optional here, required for production by the refinement below, so a developer
      // can `npm run dev` with no .env at all.
      //
      // Blank is absent, for the reason written on `NODE_ENV` and on the sweep intervals:
      // a compose file with a dangling `SESSION_SECRET=` deserves to be told the variable
      // is required rather than that it is thirty-two characters short — and
      // `scripts/verify-image.sh` asserts on the first of those two messages, so without
      // this the image check reads as one assertion and makes another.
      SESSION_SECRET: z.preprocess(blankAsAbsent, secret('SESSION_SECRET').optional()),
      GUEST_TOKEN_SECRET: z.preprocess(blankAsAbsent, secret('GUEST_TOKEN_SECRET').optional()),

      SESSION_COOKIE_SECURE: boolish.optional(),
      /** Reverse proxies in front of the app. Wrong values break per-IP rate limiting. */
      TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

      DATABASE_PATH: z.string().min(1).default('./data/eventslide.sqlite'),
      MEDIA_ROOT: z.string().min(1).default('./media'),
      /**
       * Where `backup` writes an archive when it is not given `--to`. Nothing the server
       * does reads it.
       *
       * A variable rather than a constant because the constant was wrong on the install
       * the README leads with: `./backups` resolves against the working directory, which
       * in the image is `/app` — owned by root, on a filesystem `compose.yaml` mounts
       * read-only — so the bare command could not write anywhere. The image sets
       * `/data/backups` instead, which is on the data volume and therefore on **the same
       * disk as what it protects** — a place to write an archive, not a place to keep
       * one. The README's Backups section gives the copy that takes it off the box.
       */
      BACKUP_DIR: z.string().min(1).default('./backups'),

      /**
       * The floor `statfs` must find on the directory holding `DATABASE_PATH` and on
       * `MEDIA_ROOT` before another upload is admitted (G3-06 / P4-10). Below it:
       * **413** `storage.boxFull`.
       *
       * **Without a separate `SCRATCH_ROOT` (P4-04)**, `MEDIA_ROOT` is where a clip
       * also stages while it uploads, so checking it already covers that scratch
       * directory too — there is no third path to add once P4-04 lands, only a
       * narrower reason the second one matters.
       *
       * The default is a floor for a single small box, not a sizing recommendation —
       * an operator with real traffic sets this from a load test, the way
       * `docs/capacity.md` is meant to.
       */
      MIN_FREE_DISK_BYTES: positiveInt(1_000_000_000),

      MAX_UPLOAD_BYTES: positiveInt(25_000_000),
      MAX_FILES_PER_UPLOAD: positiveInt(20, 100),
      /** Checked against the header before decoding — the decompression-bomb control. */
      MAX_IMAGE_PIXELS: positiveInt(50_000_000),
      DEFAULT_EVENT_QUOTA_BYTES: positiveInt(5_000_000_000),
      /**
       * The box-wide ceiling on a single event's `quotaBytes` (roadmap §10.5 / G3-02).
       *
       * **Absent, not a fallback number.** Every other numeric setting in this file has a
       * default because silence has to mean *something*, and for this one the something a
       * self-hosted box has always had is no ceiling at all beyond the domain's own "a
       * positive integer" — so absence is `undefined` here, not a number, and `undefined`
       * is what makes `createEvent` skip the comparison entirely rather than compare
       * against a number nobody chose. An instance run for other people sets this
       * explicitly; a solo box that never heard of it sees no change.
       *
       * Blank is absent for the reason written on {@link sweepInterval}: a compose file
       * with a dangling `MAX_EVENT_QUOTA_BYTES=` must not be read as a ceiling of zero,
       * which would refuse every event a host tries to create.
       */
      MAX_EVENT_QUOTA_BYTES: z.preprocess(
        blankAsAbsent,
        z.coerce.number().int().positive().optional(),
      ),

      /**
       * Clips have their own byte limit, deliberately separate from `MAX_UPLOAD_BYTES`.
       *
       * Raising the photo limit would raise the per-request heap ceiling that
       * `guestRoutes.ts` derives from it, and `compose.yaml`'s memory limit was reasoned
       * against that number. A clip does not need the same budget anyway: it goes to disk
       * rather than to the heap, one file per request, and fifteen seconds off a phone is
       * 20 to 60 MB.
       */
      MAX_CLIP_BYTES: positiveInt(80_000_000),
      /**
       * The duration cap, enforced twice — refused at the probe and passed to the encoder
       * as a hard bound, because a truncated container's header is a claim by the file.
       * Bounded at two minutes so that no configuration turns the wall into a cinema.
       */
      MAX_CLIP_SECONDS: positiveInt(15, 120),
      /**
       * How many clips may be waiting or transcoding across the whole box before an upload
       * is answered `429 clip.queueFull`. Process-wide, because one worker drains the queue
       * for every event and the wait a guest experiences is the global one.
       */
      MAX_QUEUED_CLIPS: positiveInt(20, 500),
      /**
       * The same backpressure, scoped to **one** event, and checked inside the same
       * `stage` transaction as the box-wide count above.
       *
       * `MAX_QUEUED_CLIPS` alone has a known cost, written on `src/domain/clips/clipQueue.ts`:
       * one event can fill every slot and make another event's guests wait behind its
       * backlog, which is the one trade that is wrong for a box running more than one
       * event at a time (roadmap R-10, "noisy neighbours"). This does not replace the
       * box-wide cap — a single event still cannot out-queue what one worker can chew
       * through — it adds a second, per-event ceiling so a wedding running over
       * capacity cannot also starve a gala on the same machine.
       *
       * Defaulted to the same number as `MAX_QUEUED_CLIPS`: on a box that only ever
       * runs one event at a time — the deployment this product ships for — the two
       * caps are reached together and nothing observable changes. Lowering this one is
       * what a multi-event cell asks for.
       */
      MAX_QUEUED_CLIPS_PER_EVENT: positiveInt(20, 500),
      /** The projected height of a clip. 720p reads well at 3 m and encodes quickly. */
      CLIP_MAX_HEIGHT: positiveInt(720, 2_160),
      /**
       * The decompression-bomb control for video, judged from the header before a frame is
       * decoded — the exact counterpart of MAX_IMAGE_PIXELS.
       *
       * CLIP_MAX_HEIGHT is not one: it scales the *output*, and the filter that does it
       * runs after the decoder has already allocated the frame. The default admits 8K UHD
       * (7680x4320, 33 MP) and refuses the 16000x16000 container that is 380 MB a frame.
       */
      MAX_CLIP_PIXELS: positiveInt(33_177_600),

      /**
       * How many upload requests — photos and clips together — may be in flight at
       * once, process-wide (G3-06 / P4-10). Past it: `429 upload.busy` with
       * `Retry-After`. A slot is held from admission to response, which spans both the
       * buffering (`guestRoutes.ts`'s 150 MB per-request ceiling) and the `sharp` decode
       * after it (~200 MB) — so four in flight at the default is ~1.4 GB, not 600 MB of
       * buffers alone, and that full figure is what an operator's memory limit actually
       * has to cover. See `compose.yaml`'s own budget comment for the rest of it.
       */
      MAX_CONCURRENT_UPLOAD_REQUESTS: positiveInt(4, 1_000),

      /**
       * Where the encoder is, when it is not simply on `PATH`.
       *
       * A configured path that does not exist is a refusal rather than a fallback: an
       * operator who set this wanted that build, and quietly using another one is how a
       * deployment ends up encoding with something nobody chose.
       */
      FFMPEG_PATH: z.preprocess(blankAsAbsent, z.string().optional()),
      FFPROBE_PATH: z.preprocess(blankAsAbsent, z.string().optional()),

      /**
       * `PATH` and `PATHEXT`, read here because this is the only module allowed to read
       * the environment at all — and then handed to the binary resolver as a value.
       *
       * The resolver needs them because `spawn` is never given `shell: true` (that is
       * CVE-2024-27980 on Windows), and without a shell Node does not apply `PATHEXT`, so
       * a bare `ffmpeg` fails on a machine where `ffmpeg.exe` is sitting on the path.
       * Carrying them as configuration also lets a test hand the resolver an empty search
       * path and exercise the "no encoder anywhere" branch without depending on the
       * machine running the suite.
       */
      PATH: z.string().default(''),
      PATHEXT: z.string().default(''),

      /**
       * The Windows-only quarter of the whitelist a spawned ffmpeg or ffprobe child is
       * given (menace T9, `docs/SECURITY.md` §4.1) — read here for the same reason as
       * `PATH` and `PATHEXT` just above: this is the one module allowed to touch
       * `process.env`, so the policy of which names survive into the child's own
       * environment is decided in `minimalChildEnv` (`infrastructure/media/runProcess.ts`)
       * from values carried as plain configuration, never read there directly. Blank by
       * default off Windows, where `minimalChildEnv` ignores all four regardless.
       */
      SYSTEMROOT: z.string().default(''),
      WINDIR: z.string().default(''),
      TEMP: z.string().default(''),
      TMP: z.string().default(''),

      /**
       * Left optional so the default can depend on NODE_ENV, below: a background sweep
       * firing inside the end-to-end suite would delete a fixture's event mid-journey.
       */
      RETENTION_SWEEP_INTERVAL_MINUTES: retentionSweepInterval.optional(),

      /**
       * The warning a client is owed when an operator lowers its retention ceiling, in days
       * (roadmap §10.5 / P3-06; `RETENTION_CAP_NOTICE_DAYS` in the paid plan).
       *
       * Lowering `max_retention_days` stamps `clients.retention_cap_since`, and the purge of
       * an event under that ceiling may not happen before `retention_cap_since` plus this
       * many days — whatever the new ceiling says. Without it, an operator who tightens a
       * client from 90 days to 14 deletes the albums closed 60 days ago the same night, with
       * no window to export them in. Thirty days by default, a month being what a host
       * reasonably needs to notice an e-mail and download a ZIP. Capped at a year, past which
       * a "notice" is a different promise.
       *
       * Inert on a box with no clients: only an event that belongs to one has a ceiling.
       */
      RETENTION_CAP_NOTICE_DAYS: positiveInt(30, 365),

      /**
       * Optional for the same reason as the line above: under `NODE_ENV=test` the default
       * has to be off. A sweep firing mid-journey would open — or close — the event a
       * Playwright spec is asserting on, on a timer nothing in the test can see.
       */
      SCHEDULE_SWEEP_INTERVAL_MINUTES: scheduleSweepInterval.optional(),

      GUEST_SELF_DELETE_GRACE_SECONDS: positiveInt(900, 86_400),
      UPLOAD_RATE_LIMIT_PER_MINUTE: positiveInt(12, 600),
      JOIN_RATE_LIMIT_PER_MINUTE: positiveInt(20, 600),
      LOGIN_RATE_LIMIT_PER_MINUTE: positiveInt(10, 600),
      REACTION_RATE_LIMIT_PER_MINUTE: positiveInt(30, 600),
      /**
       * Per **account** and per **hour**, not per minute (P4-09 / D-14):
       * `eventCreationLimiter` keys on who is signed in rather than on an address, so an
       * office or a venue's guest Wi-Fi shared by several hosts is not throttled as if
       * it were one determined attacker. The ceiling is generous headroom above the
       * default of twenty — high enough that a test environment creating many events in
       * a loop is never the one tripping it.
       */
      EVENT_CREATION_RATE_LIMIT_PER_HOUR: positiveInt(20, 1_000),
      /**
       * The shared gallery (roadmap §4.1), the one surface a stranger reaches with only a
       * URL. Pages and bytes are separate budgets because a grid of sixty thumbnails is
       * sixty requests the moment it renders; password attempts are per quarter hour and
       * count failures only, per client and per link.
       *
       * The byte budget is sized for an address, not a person. A family on one box at
       * home, or a table of colleagues on an office's Wi-Fi, is one IP: ten people each
       * scrolling five pages of sixty thumbnails is 3 000 requests before anybody opens a
       * photograph, and a budget of 600 throttled the fourth of them. The page budget
       * carries each device's password unlock as well as its pages, for the same reason.
       */
      GALLERY_RATE_LIMIT_PER_MINUTE: positiveInt(120, 1_200),
      GALLERY_MEDIA_RATE_LIMIT_PER_MINUTE: positiveInt(3_000, 30_000),
      GALLERY_UNLOCK_ATTEMPTS_PER_CLIENT: positiveInt(10, 600),
      GALLERY_UNLOCK_ATTEMPTS_PER_LINK: positiveInt(50, 6_000),

      /**
       * How many event streams one client key may hold **open at the same time**, and
       * how many the process serves at once across every client and event.
       *
       * Concurrency, not a rate — see `streamConnectionLimiter`, which carried these as
       * constants until now. The defaults are unchanged (12, 500): a single-event box
       * never reaches either, and what becomes configurable is the backstop a busier,
       * multi-event cell needs to raise or lower.
       */
      MAX_STREAMS_PER_CLIENT: positiveInt(12, 10_000),
      MAX_STREAMS_TOTAL: positiveInt(500, 100_000),
      /**
       * The event bus's own cap, independent of the two above: how many SSE
       * subscriptions `createInMemoryEventBus` holds for a single event before it
       * refuses a fresh one with `503`. Guards the same box against the same shape of
       * leak or abuse, one level down from the HTTP connection limiter.
       */
      MAX_SUBSCRIBERS_PER_EVENT: positiveInt(200, 10_000),

      /**
       * What `closeDatabase` runs at shutdown: `truncate` (the default, unchanged),
       * `passive`, or `none`.
       *
       * Carried for Litestream, which replicates the WAL and is sensitive to how a
       * clean shutdown leaves it — `passive` checkpoints without ever blocking on a
       * reader, where `truncate` can be partial when one is attached. **Unused on a
       * self-hosted instance**, which has no Litestream adapter: `truncate` keeps
       * closing exactly as it always has, and this variable exists so the paid plan's
       * cell can override it without a second code path.
       *
       * Blank is absent, for the reason written on {@link siteAdmin}: a dangling
       * `SQLITE_SHUTDOWN_CHECKPOINT=` lands on the unconditional behaviour every boot
       * before this had, not on a guess at which mode was meant.
       */
      SQLITE_SHUTDOWN_CHECKPOINT: z.preprocess(
        blankAsAbsent,
        z.enum(['truncate', 'passive', 'none']).default('truncate'),
      ),

      /**
       * Bounded at both ends. `createBcryptPasswordHasher` refuses anything outside
       * 10-15 with a bare `Error`, so without the floor a cost of 9 passed validation
       * here and then failed while the container was assembling adapters — an exception
       * that names neither the variable nor the file that owns it. Refusing it here is
       * what makes the aggregated ConfigError the single place a misconfigured boot is
       * explained.
       */
      BCRYPT_COST: z.coerce
        .number()
        .int()
        .min(10, 'BCRYPT_COST must be at least 10')
        .max(15, 'BCRYPT_COST must be at most 15')
        .default(12),

      /**
       * The first owner of an instance, created once against an empty database and then
       * ignored. Both halves are needed or neither is; see the refinement below.
       */
      BOOTSTRAP_OWNER_EMAIL: z.preprocess(blankAsAbsent, z.string().optional()),
      BOOTSTRAP_OWNER_PASSWORD: z.preprocess(blankAsAbsent, bootstrapOwnerPassword.optional()),

      /** Enables the display timing hooks the Playwright suite drives. Never in production. */
      E2E_HOOKS: boolish.optional(),

      /** See {@link siteAdmin}. `off` unless the box says otherwise. */
      SITE_ADMIN: siteAdmin,

      /** See {@link sourceCodeUrl}. Absent means the tag of the running version upstream. */
      SOURCE_CODE_URL: sourceCodeUrl,
      /** See {@link sourceRef}. Set by the Dockerfile's build argument, never by hand. */
      SOURCE_REF: sourceRef,

      /** See {@link eventCreation}. `anyAccount` unless the box says otherwise. */
      EVENT_CREATION: eventCreation,

      /** See {@link donationUrl}. Absent means no donation link anywhere. */
      DONATION_URL: donationUrl,
      /** See {@link budgetUrl}. Absent means no public-budget link anywhere. */
      BUDGET_URL: budgetUrl,

      /** See {@link operatorName}. Absent means the box names no operator. */
      OPERATOR_NAME: operatorName,
      /** See {@link operatorContactEmail}. Needs OPERATOR_NAME beside it. */
      OPERATOR_CONTACT_EMAIL: operatorContactEmail,
      /** See {@link legalTermsUrl}. Absent means no terms link anywhere. */
      LEGAL_TERMS_URL: legalTermsUrl,
      /** See {@link legalPrivacyUrl}. Absent means no privacy-policy link anywhere. */
      LEGAL_PRIVACY_URL: legalPrivacyUrl,
      /** See {@link legalNoticeUrl}. Absent means no legal-notice link anywhere. */
      LEGAL_NOTICE_URL: legalNoticeUrl,
      /** See {@link supportUrl}. Absent means no help link anywhere. */
      SUPPORT_URL: supportUrl,
      /** See {@link reportUrl}. Absent means no "report content" link anywhere. */
      REPORT_URL: reportUrl,

      /** See {@link eventSlugSuffix}. `none` unless the box says otherwise. */
      EVENT_SLUG_SUFFIX: eventSlugSuffix,
      /** See {@link allowCustomSlugs}. `true` unless the box says otherwise. */
      ALLOW_CUSTOM_SLUGS: allowCustomSlugs,
      /** See {@link joinCodeLength}. Six unless the box says otherwise. */
      JOIN_CODE_LENGTH: joinCodeLength,

      /** See {@link auditRetentionDays}. Three years unless the box says otherwise. */
      AUDIT_RETENTION_DAYS: auditRetentionDays,

      /** See {@link smtpUrl}. Absent means no mail: the composition root wires `NullMailer`. */
      SMTP_URL: smtpUrl,
      /** See {@link mailFrom}. Required whenever `SMTP_URL` is set. */
      MAIL_FROM: mailFrom,
    })
    .superRefine((raw, ctx) => {
      // The first owner is a pair, and half of one creates nothing. Before `""` meant
      // absent, the missing half reached `bootstrapOwner` as an empty string and was
      // refused into a log line; silently doing nothing instead would be no better, so
      // the half that is missing is named at boot beside every other bad variable.
      const email = raw.BOOTSTRAP_OWNER_EMAIL
      const password = raw.BOOTSTRAP_OWNER_PASSWORD
      if ((email === undefined) !== (password === undefined)) {
        const missing = email === undefined ? 'BOOTSTRAP_OWNER_EMAIL' : 'BOOTSTRAP_OWNER_PASSWORD'
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [missing],
          message: `${missing} is required alongside the other half of the first-owner bootstrap: an email with no password, or a password with no email, creates no account at all`,
        })
      }

      // Not production-gated either: a relay with no sender is wrong everywhere. A relay
      // refuses a message with no `MAIL FROM`, so without this the box boots, the operator
      // believes mail works, and the first invitation fails with `mail.rejected` on the one
      // day somebody needed it. The reverse — a sender and no relay — is only a warning, below.
      if (raw.SMTP_URL !== undefined && raw.MAIL_FROM === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MAIL_FROM'],
          message:
            'MAIL_FROM is required when SMTP_URL is set: a relay will not accept a message with no sender, so every invitation would be refused',
        })
      }

      // Not production-gated: a ceiling under the default is wrong in every environment,
      // because every event created with no opinion asks for `DEFAULT_EVENT_QUOTA_BYTES`
      // (`createEvent.ts`) and would already violate a lower one. Refusing here is what
      // keeps "the box boots" and "the default event it was about to create is legal"
      // the same claim, rather than one a host discovers by having their first event
      // refused.
      if (
        raw.MAX_EVENT_QUOTA_BYTES !== undefined &&
        raw.MAX_EVENT_QUOTA_BYTES < raw.DEFAULT_EVENT_QUOTA_BYTES
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MAX_EVENT_QUOTA_BYTES'],
          message: `MAX_EVENT_QUOTA_BYTES (${raw.MAX_EVENT_QUOTA_BYTES}) must be at least DEFAULT_EVENT_QUOTA_BYTES (${raw.DEFAULT_EVENT_QUOTA_BYTES}), or every event created with no opinion would already be above the ceiling`,
        })
      }

      // Roadmap §10.9, "configuration that only means something with an operator is refused
      // when the mode is off". Restricting creation to client members is a policy that only
      // an operator can satisfy — nobody can create a client, or add a member to one, on a box
      // with no operator surface — so on such a box it would lock every account but the
      // operator's out of creating anything, and the operator who set it would believe it was
      // a feature. Not production-gated, for the reason the ceiling check above is not.
      if (raw.EVENT_CREATION === 'clientMembers' && raw.SITE_ADMIN !== 'on') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EVENT_CREATION'],
          message:
            'EVENT_CREATION=clientMembers requires SITE_ADMIN=on: restricting event creation to client members only means something on a box that has an operator and clients, and with SITE_ADMIN=off there is no way to create either (docs/ROADMAP.md §10.9)',
        })
      }

      // An address with no name behind it is not an identity, and `/api/about`'s `operator`
      // has no shape for one: accepting it would publish nothing and look configured.
      if (raw.OPERATOR_CONTACT_EMAIL !== undefined && raw.OPERATOR_NAME === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPERATOR_CONTACT_EMAIL'],
          message:
            'OPERATOR_CONTACT_EMAIL requires OPERATOR_NAME: a contact address is published beside the name of the operator it belongs to, and with no name it would be published nowhere',
        })
      }

      if (raw.NODE_ENV !== 'production') return

      if (secretsRequiredInProduction) {
        for (const name of ['SESSION_SECRET', 'GUEST_TOKEN_SECRET'] as const) {
          if (raw[name] === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [name],
              message: `${name} is required in production`,
            })
          }
        }
      }
      if (raw.E2E_HOOKS === true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['E2E_HOOKS'],
          message: 'E2E_HOOKS must not be enabled in production',
        })
      }
      if (raw.PUBLIC_URL.startsWith('http://') && !raw.PUBLIC_URL.startsWith('http://localhost')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PUBLIC_URL'],
          message:
            'PUBLIC_URL must use https in production: guests submit photos over this origin, and a Secure session cookie will not be sent over http',
        })
      }
    })

/** What a server parses with: both secrets are a precondition in production. */
const serverSchema = buildSchema({ secretsRequiredInProduction: true })

/** What a maintenance command parses with. See {@link buildSchema}. */
const maintenanceSchema = buildSchema({ secretsRequiredInProduction: false })

export type RawConfig = z.infer<typeof serverSchema>

/**
 * The shape the rest of the application receives. Grouped by concern rather than
 * mirroring the flat variable names, so a use case takes `config.uploads` instead of
 * eleven separate arguments.
 */
export interface AppConfig {
  readonly env: 'development' | 'test' | 'production'
  readonly isProduction: boolean
  readonly port: number
  readonly publicUrl: string
  readonly logLevel: RawConfig['LOG_LEVEL']
  readonly trustProxyHops: number

  readonly secrets: {
    readonly session: string
    readonly guestToken: string
    /**
     * Which of the two were generated for this boot instead of configured, by name.
     *
     * Names rather than a flag, because the two are independent and the consequence is
     * not: a developer who set `SESSION_SECRET` and not `GUEST_TOKEN_SECRET` keeps their
     * sign-in across a reload and loses every guest token, and a single boolean made the
     * log line say both were going. Empty is the configured case.
     *
     * Only ever non-empty outside a server's production boot — the refinement refuses one
     * that is missing either — and it exists so the boot log can say which arrangement is
     * in force. §14.7 of docs/SECURITY.md recorded that nothing did, and a developer who
     * cannot tell why they were signed out by a hot reload is the mild case; the expensive
     * one is not knowing that a restart invalidates every guest token.
     *
     * Deliberately not reported by `/api/ready`: that endpoint answers an unauthenticated
     * caller, and how a box signs its cookies is not something it should volunteer.
     */
    readonly generated: readonly ('SESSION_SECRET' | 'GUEST_TOKEN_SECRET')[]
  }

  readonly session: {
    readonly secureCookie: boolean
  }

  readonly storage: {
    readonly databasePath: string
    readonly mediaRoot: string
    /** The default parent of a backup archive. Read by the backup command only. */
    readonly backupDir: string
    /** See {@link RawConfig} field `MIN_FREE_DISK_BYTES`. */
    readonly minFreeDiskBytes: number
    /** What `closeDatabase` runs at shutdown. See {@link RawConfig} for the reasoning. */
    readonly sqliteShutdownCheckpoint: 'truncate' | 'passive' | 'none'
  }

  readonly uploads: {
    readonly maxBytes: number
    readonly maxFiles: number
    readonly maxPixels: number
    readonly defaultEventQuotaBytes: number
    /**
     * The box-wide ceiling from `MAX_EVENT_QUOTA_BYTES`. `null` is "no ceiling", which is
     * what every self-hosted box that never set the variable gets — see the schema.
     */
    readonly maxEventQuotaBytes: number | null
    /** See {@link RawConfig} field `MAX_CONCURRENT_UPLOAD_REQUESTS`. */
    readonly maxConcurrentRequests: number
  }

  readonly clips: {
    readonly maxBytes: number
    readonly maxDurationMs: number
    readonly maxQueuedClips: number
    /** The same backpressure, scoped to one event. See `MAX_QUEUED_CLIPS_PER_EVENT`. */
    readonly maxQueuedClipsPerEvent: number
    readonly maxHeight: number
    readonly maxPixels: number
    readonly ffmpegPath: string | null
    readonly ffprobePath: string | null
    /** `PATH` and `PATHEXT` as values; see the schema for why they are carried at all. */
    readonly executableSearch: {
      readonly path: string
      readonly extensions: string
    }
    /**
     * The raw material for `minimalChildEnv` — `PATH` plus the four Windows-only
     * variables, as values. `src/main/container.ts` is where the whitelist itself gets
     * built; see the schema entries for why this module only carries the inputs.
     */
    readonly childEnvSource: {
      readonly path: string
      readonly pathExt: string
      readonly systemRoot: string
      readonly winDir: string
      readonly temp: string
      readonly tmp: string
    }
  }

  /**
   * The server-sent-events channel's own backpressure, separate from `rateLimits`
   * because what it bounds is held, not spent: a connection lives for hours rather
   * than milliseconds, so the right unit is "open at once", not "per minute".
   */
  readonly realtime: {
    /** `streamConnectionLimiter`'s per-client concurrency ceiling. */
    readonly maxStreamsPerClient: number
    /** `streamConnectionLimiter`'s process-wide concurrency ceiling. */
    readonly maxStreamsTotal: number
    /** `createInMemoryEventBus`'s per-event subscriber ceiling. */
    readonly maxSubscribersPerEvent: number
  }

  readonly guests: {
    readonly selfDeleteGraceMs: number
  }

  readonly retention: {
    /**
     * How often `src/main` sweeps events whose retention deadline has passed.
     * `null` means never: `npm run purge` is then the only thing that honours the
     * setting, which is the supported arrangement when a cron or systemd timer owns
     * the schedule.
     */
    readonly sweepIntervalMs: number | null
    /**
     * Days an event closed long ago is spared after its client's retention ceiling is
     * lowered (`RETENTION_CAP_NOTICE_DAYS`). Read by the purge, and by nothing on a box with
     * no clients.
     */
    readonly capNoticeDays: number
  }

  readonly schedule: {
    /**
     * How often `src/main` opens the events that were due to open and closes the ones
     * that were due to close. `null` means never: the two fields stay settable and
     * visible, and nothing ever acts on them — which is the right answer under
     * `NODE_ENV=test`, and a deliberate choice anywhere else.
     */
    readonly sweepIntervalMs: number | null
  }

  readonly rateLimits: {
    readonly uploadPerMinute: number
    readonly joinPerMinute: number
    readonly loginPerMinute: number
    readonly reactionPerMinute: number
    readonly galleryPerMinute: number
    readonly galleryMediaPerMinute: number
    /** Failed password attempts per client, per fifteen minutes. */
    readonly galleryUnlockPerClient: number
    /** Failed password attempts per link, from every client together, per fifteen minutes. */
    readonly galleryUnlockPerLink: number
    /** `EVENT_CREATION_RATE_LIMIT_PER_HOUR` — per account, not per client. See {@link eventSlugSuffix}'s siblings below for the rest of P4-09. */
    readonly eventCreationPerHour: number
  }

  readonly crypto: {
    readonly bcryptCost: number
  }

  readonly bootstrap: {
    readonly ownerEmail: string | null
    readonly ownerPassword: string | null
  }

  readonly e2eHooks: boolean

  /**
   * `SITE_ADMIN=on`: this box is run for other people, and the operator's own namespace,
   * `/api/site`, is mounted (docs/ROADMAP.md §10.9). `false` on every install that never
   * said so, which is what keeps a solo box exactly as it was.
   *
   * It decides how much surface exists and nothing else. Authorization on that surface is
   * `requireOperator`'s, in both modes; migrations run in both modes.
   */
  readonly siteAdmin: boolean

  /**
   * The inputs of the AGPL section 13 source link (roadmap G1-04 / P1-05), both optional.
   * What the link finally is depends on the running version too, which this module does
   * not read, so {@link resolveSourceUrl} composes the three.
   */
  readonly source: {
    /** `SOURCE_CODE_URL`, canonical https, or `null` when the operator set none. */
    readonly url: string | null
    /** `SOURCE_REF`, a git tag, branch or commit, or `null` when the image has none baked in. */
    readonly ref: string | null
  }

  /**
   * The optional links of an instance that asks for support (roadmap G4-02), both
   * `null` unless the operator set them — so a self-hosted box says nothing about money.
   * Canonical https, validated like `SOURCE_CODE_URL`. A link that is set is shown to
   * hosts and on `/about`; there is deliberately no field here that could make it a
   * condition of anything, because a donation buys no counterpart.
   */
  readonly support: {
    /** `DONATION_URL`. See {@link donationUrl}. */
    readonly donationUrl: string | null
    /** `BUDGET_URL`. See {@link budgetUrl}. */
    readonly budgetUrl: string | null
  }

  /**
   * Who runs this box and the links they owe a visitor (roadmap G2-17 / P3-18), every field
   * `null` unless the operator set it — so a self-hosted box names nobody, links to nothing,
   * and its guests are shown exactly the notice they always were. Links are canonical https
   * addresses or paths on this site; see {@link optionalSiteLink}.
   */
  readonly operator: {
    /** `OPERATOR_NAME`. See {@link operatorName}. */
    readonly name: string | null
    /** `OPERATOR_CONTACT_EMAIL`. Never set without a `name`. */
    readonly contactEmail: string | null
    /** `LEGAL_TERMS_URL`. */
    readonly termsUrl: string | null
    /** `LEGAL_PRIVACY_URL`. */
    readonly privacyUrl: string | null
    /** `LEGAL_NOTICE_URL`. */
    readonly legalNoticeUrl: string | null
    /** `SUPPORT_URL`: help for a host. Not the donation link, which is {@link support}. */
    readonly supportUrl: string | null
    /** `REPORT_URL`: where a piece of content is reported (DSA art. 16). */
    readonly reportUrl: string | null
  }

  /**
   * P4-09 / D-14, grouped the way `createEvent` and `rotateJoinCode` consume them. A
   * self-hosted box that sets none of the three keeps 2.0's only behaviour exactly; the
   * hosted instance sets `slugSuffix: 'random'` and `allowCustomSlugs: false` from its
   * first beta boot, and may widen `joinCodeLength` independently of either.
   */
  readonly events: {
    /** `EVENT_SLUG_SUFFIX`. See {@link eventSlugSuffix}. */
    readonly slugSuffix: 'none' | 'random'
    /** `ALLOW_CUSTOM_SLUGS`. See {@link allowCustomSlugs}. */
    readonly allowCustomSlugs: boolean
    /** `JOIN_CODE_LENGTH`. See {@link joinCodeLength}. */
    readonly joinCodeLength: number
    /**
     * `EVENT_CREATION`. See {@link eventCreation}. `clientMembers` is possible only when
     * {@link AppConfig.siteAdmin} is true: the schema refuses the pair at boot.
     */
    readonly creation: 'anyAccount' | 'clientMembers'
  }

  /**
   * Outgoing mail (roadmap §10.3, G2-07 / P3-08). `smtp` is `null` on every box that never
   * set `SMTP_URL`, which is what makes the composition root wire `NullMailer` and what keeps
   * a solo install exactly as it was: no relay, no outbound connection, no mail.
   *
   * Carries the password, in `smtp.endpoint.credentials`, like `secrets` above carries the
   * signing keys. **Nothing logs this object, and nothing may**: the logger's redaction list
   * is shallow and would not catch a password four levels down, so the only protection is
   * that no caller hands this to a log line (the container's boot line names the host and the
   * port and nothing else, and a test pins it). A new field here is a new place a secret can
   * leak from, so none is added without a reason.
   */
  readonly mail: {
    readonly smtp: SmtpSettings | null
  }

  /**
   * Problems worth telling an operator about that are not worth refusing the boot
   * over — see {@link computeWarnings}. Empty outside production, and usually empty
   * inside it too; `src/main/index.ts` logs each one once, after the container
   * exists. These start as warnings and stay warnings in a minor release: turning one
   * into a boot refusal is a breaking change for an existing self-hosted install, and
   * belongs in a major version with its own CHANGELOG entry, not a silent tightening.
   */
  readonly warnings: readonly string[]

  readonly audit: {
    /**
     * `AUDIT_RETENTION_DAYS`: how long a row of the audit log is kept, 365 at least. Read by
     * `pruneAuditLog` through the retention sweep; see {@link auditRetentionDays}.
     */
    readonly retentionDays: number
  }
}

/**
 * The address of the source of the build that is running — what AGPL section 13 obliges
 * a network service to offer to the people using it.
 *
 * In order: the operator's own `SOURCE_CODE_URL`; the ref the image was built from
 * (`SOURCE_REF`); and otherwise the upstream tag named after the running `version`. There
 * is no way to switch the offer off, deliberately, and no input that can make it empty.
 *
 * `version` is a parameter because this module does not read the manifest — it lives in
 * `src/main/version.ts` and an adapter may not import the composition root.
 */
export const resolveSourceUrl = (version: string, source: AppConfig['source']): string => {
  if (source.url !== null) return source.url
  if (source.ref !== null) return `${UPSTREAM_REPOSITORY}/tree/${source.ref}`
  return `${UPSTREAM_REPOSITORY}/tree/v${version}`
}

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'ConfigError'
  }
}

type Source = Record<string, string | undefined>

interface WarningInputs {
  readonly isProduction: boolean
  /** The unparsed source, because a default and an explicit value parse identically. */
  readonly source: Source
  readonly secureCookie: boolean
  readonly trustProxyHops: number
  /** `MAIL_FROM` is set and `SMTP_URL` is not: a sender with nothing to send through. */
  readonly mailFromWithoutRelay: boolean
}

/**
 * Boot-time problems that are real but not worth a refusal — see `AppConfig.warnings`
 * and R-16 (roadmap: "self-hosters go silent on a changed default"). Both cases here are
 * a production boot that looks configured and is not, and both were a boot refusal in an
 * earlier draft; **`loadConfig` never throws for either**, because the configurations
 * they describe already run in the wild and a new refusal in a minor release would be
 * the rupture R-16 exists to name.
 */
const computeWarnings = ({
  isProduction,
  source,
  secureCookie,
  trustProxyHops,
  mailFromWithoutRelay,
}: WarningInputs): readonly string[] => {
  if (!isProduction) return []

  const warnings: string[] = []

  // Parsed, `raw.PUBLIC_URL` already carries its default and cannot say whether an
  // operator set it — only the unparsed source can. `PUBLIC_URL` has no `blankAsAbsent`
  // preprocessing, so a dangling `PUBLIC_URL=` never gets here: it fails `.url()` and the
  // boot is refused before this runs. Only an absent variable reaches this check; the
  // blank branch is a belt-and-braces guard, not a state a boot can observe today.
  const rawPublicUrl = source['PUBLIC_URL']
  const publicUrlConfigured = rawPublicUrl !== undefined && rawPublicUrl.trim() !== ''
  if (!publicUrlConfigured) {
    warnings.push(
      'PUBLIC_URL is not set: production is falling back to http://localhost:5173, which is ' +
        'not an address a guest’s phone can reach. Set PUBLIC_URL to the address guests will ' +
        'actually use.',
    )
  }

  if (secureCookie && trustProxyHops === 0) {
    warnings.push(
      'TRUST_PROXY_HOPS is 0 with a Secure session cookie in production. If a reverse proxy ' +
        'sits in front of this box, as docs/SECURITY.md §11 expects, this is the same ' +
        'misconfiguration that silently breaks per-IP rate limiting, and a host can find a ' +
        'session stops working with no visible cause. Set TRUST_PROXY_HOPS to the number of ' +
        'reverse proxies in front of this box, or leave it at 0 only when nothing does.',
    )
  }

  if (mailFromWithoutRelay) {
    warnings.push(
      'MAIL_FROM is set but SMTP_URL is not: no mail will be sent, and an invitation or a ' +
        'password reset will be shown as a link to copy instead. Set SMTP_URL to send by ' +
        'e-mail, or remove MAIL_FROM.',
    )
  }

  return warnings
}

const load = (schema: typeof serverSchema, source: Source): AppConfig => {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    // Every issue this schema can raise names a variable: an object-shape failure
    // carries its key, and each `addIssue` above sets `path` explicitly. There is no
    // path-less case to format around, so there is no branch here either.
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    )
  }

  const raw = parsed.data
  const isProduction = raw.NODE_ENV === 'production'

  /**
   * Off under `NODE_ENV=test`, on everywhere else.
   *
   * The end-to-end suite boots this exact binary (`tests/e2e/fixtures/startTestApp.ts`)
   * with `NODE_ENV=test` and no retention variable, so the safe value has to be the one
   * nobody sets: a sweep firing between two steps of a journey would delete the event
   * the journey is asserting on, and it would do it on a timer nothing in the test can
   * see. Development and production get an hourly sweep with no configuration at all,
   * which is what makes `docker compose up` honour a host's retention setting.
   */
  // Not `??`: the configured value is `null` for `off`, which is nullish and would fall
  // straight back to the default it was written to override.
  const sweepMinutes =
    raw.RETENTION_SWEEP_INTERVAL_MINUTES === undefined
      ? raw.NODE_ENV === 'test'
        ? null
        : DEFAULT_RETENTION_SWEEP_MINUTES
      : raw.RETENTION_SWEEP_INTERVAL_MINUTES

  /** Same shape, same reasoning, for the sweep that opens and closes events. */
  const scheduleSweepMinutes =
    raw.SCHEDULE_SWEEP_INTERVAL_MINUTES === undefined
      ? raw.NODE_ENV === 'test'
        ? null
        : DEFAULT_SCHEDULE_SWEEP_MINUTES
      : raw.SCHEDULE_SWEEP_INTERVAL_MINUTES

  return {
    env: raw.NODE_ENV,
    isProduction,
    port: raw.PORT,
    // Trailing slashes would produce `//join/ABC123` in a QR code.
    publicUrl: raw.PUBLIC_URL.replace(/\/+$/, ''),
    logLevel: raw.LOG_LEVEL,
    trustProxyHops: raw.TRUST_PROXY_HOPS,

    secrets: {
      // Non-production only: the superRefine above makes these present in production.
      // Generated rather than constant, and generated per secret rather than once, so a
      // guest cookie can never be replayed as a session — see {@link ephemeralSecret}.
      session: raw.SESSION_SECRET ?? ephemeralSecret(),
      guestToken: raw.GUEST_TOKEN_SECRET ?? ephemeralSecret(),
      generated: (['SESSION_SECRET', 'GUEST_TOKEN_SECRET'] as const).filter(
        (name) => raw[name] === undefined,
      ),
    },

    session: {
      // Follows NODE_ENV unless set explicitly. Getting this wrong behind plain HTTP
      // makes login silently impossible, which is why it is worth an explicit default.
      secureCookie: raw.SESSION_COOKIE_SECURE ?? isProduction,
    },

    storage: {
      databasePath: raw.DATABASE_PATH,
      mediaRoot: raw.MEDIA_ROOT,
      backupDir: raw.BACKUP_DIR,
      minFreeDiskBytes: raw.MIN_FREE_DISK_BYTES,
      sqliteShutdownCheckpoint: raw.SQLITE_SHUTDOWN_CHECKPOINT,
    },

    uploads: {
      maxBytes: raw.MAX_UPLOAD_BYTES,
      maxFiles: raw.MAX_FILES_PER_UPLOAD,
      maxPixels: raw.MAX_IMAGE_PIXELS,
      defaultEventQuotaBytes: raw.DEFAULT_EVENT_QUOTA_BYTES,
      maxEventQuotaBytes: raw.MAX_EVENT_QUOTA_BYTES ?? null,
      maxConcurrentRequests: raw.MAX_CONCURRENT_UPLOAD_REQUESTS,
    },

    clips: {
      maxBytes: raw.MAX_CLIP_BYTES,
      maxDurationMs: raw.MAX_CLIP_SECONDS * 1000,
      maxQueuedClips: raw.MAX_QUEUED_CLIPS,
      maxQueuedClipsPerEvent: raw.MAX_QUEUED_CLIPS_PER_EVENT,
      maxHeight: raw.CLIP_MAX_HEIGHT,
      maxPixels: raw.MAX_CLIP_PIXELS,
      ffmpegPath: raw.FFMPEG_PATH ?? null,
      ffprobePath: raw.FFPROBE_PATH ?? null,
      executableSearch: { path: raw.PATH, extensions: raw.PATHEXT },
      childEnvSource: {
        path: raw.PATH,
        pathExt: raw.PATHEXT,
        systemRoot: raw.SYSTEMROOT,
        winDir: raw.WINDIR,
        temp: raw.TEMP,
        tmp: raw.TMP,
      },
    },

    realtime: {
      maxStreamsPerClient: raw.MAX_STREAMS_PER_CLIENT,
      maxStreamsTotal: raw.MAX_STREAMS_TOTAL,
      maxSubscribersPerEvent: raw.MAX_SUBSCRIBERS_PER_EVENT,
    },

    guests: {
      selfDeleteGraceMs: raw.GUEST_SELF_DELETE_GRACE_SECONDS * 1000,
    },

    retention: {
      sweepIntervalMs: sweepMinutes === null ? null : sweepMinutes * 60_000,
      capNoticeDays: raw.RETENTION_CAP_NOTICE_DAYS,
    },

    schedule: {
      sweepIntervalMs: scheduleSweepMinutes === null ? null : scheduleSweepMinutes * 60_000,
    },

    rateLimits: {
      uploadPerMinute: raw.UPLOAD_RATE_LIMIT_PER_MINUTE,
      joinPerMinute: raw.JOIN_RATE_LIMIT_PER_MINUTE,
      loginPerMinute: raw.LOGIN_RATE_LIMIT_PER_MINUTE,
      reactionPerMinute: raw.REACTION_RATE_LIMIT_PER_MINUTE,
      galleryPerMinute: raw.GALLERY_RATE_LIMIT_PER_MINUTE,
      galleryMediaPerMinute: raw.GALLERY_MEDIA_RATE_LIMIT_PER_MINUTE,
      galleryUnlockPerClient: raw.GALLERY_UNLOCK_ATTEMPTS_PER_CLIENT,
      galleryUnlockPerLink: raw.GALLERY_UNLOCK_ATTEMPTS_PER_LINK,
      eventCreationPerHour: raw.EVENT_CREATION_RATE_LIMIT_PER_HOUR,
    },

    crypto: {
      bcryptCost: raw.BCRYPT_COST,
    },

    bootstrap: {
      ownerEmail: raw.BOOTSTRAP_OWNER_EMAIL ?? null,
      ownerPassword: raw.BOOTSTRAP_OWNER_PASSWORD ?? null,
    },

    e2eHooks: raw.E2E_HOOKS ?? false,

    siteAdmin: raw.SITE_ADMIN === 'on',

    source: {
      url: raw.SOURCE_CODE_URL ?? null,
      ref: raw.SOURCE_REF ?? null,
    },

    support: {
      donationUrl: raw.DONATION_URL ?? null,
      budgetUrl: raw.BUDGET_URL ?? null,
    },

    operator: {
      name: raw.OPERATOR_NAME ?? null,
      contactEmail: raw.OPERATOR_CONTACT_EMAIL ?? null,
      termsUrl: raw.LEGAL_TERMS_URL ?? null,
      privacyUrl: raw.LEGAL_PRIVACY_URL ?? null,
      legalNoticeUrl: raw.LEGAL_NOTICE_URL ?? null,
      supportUrl: raw.SUPPORT_URL ?? null,
      reportUrl: raw.REPORT_URL ?? null,
    },

    events: {
      slugSuffix: raw.EVENT_SLUG_SUFFIX,
      allowCustomSlugs: raw.ALLOW_CUSTOM_SLUGS,
      joinCodeLength: raw.JOIN_CODE_LENGTH,
      creation: raw.EVENT_CREATION,
    },

    mail: {
      // Both halves or none: the refinement above refuses a relay with no sender, and a
      // sender with no relay has nothing to send through, so it is dropped — and warned about.
      smtp:
        raw.SMTP_URL !== undefined && raw.MAIL_FROM !== undefined
          ? { endpoint: raw.SMTP_URL, from: raw.MAIL_FROM }
          : null,
    },

    warnings: computeWarnings({
      isProduction,
      source,
      secureCookie: raw.SESSION_COOKIE_SECURE ?? isProduction,
      trustProxyHops: raw.TRUST_PROXY_HOPS,
      mailFromWithoutRelay: raw.MAIL_FROM !== undefined && raw.SMTP_URL === undefined,
    }),

    audit: {
      retentionDays: raw.AUDIT_RETENTION_DAYS,
    },
  }
}

/**
 * Parse and validate, for a process that is going to serve requests. Throws
 * {@link ConfigError} listing every problem.
 *
 * `source` is a parameter so tests pass a plain object and never touch the real
 * environment.
 */
export const loadConfig = (source: Source = process.env): AppConfig => load(serverSchema, source)

/**
 * The same, for a command that opens the database and exits — `db:migrate`, `purge`,
 * `backup`, `restore`, `db:seed:demo`.
 *
 * One difference and it is written on {@link buildSchema}: the two secrets are not a
 * precondition, because nothing here signs anything. Every other refusal is identical,
 * `NODE_ENV` still defaults to `production`, and `isProduction` therefore still means what
 * it means everywhere else — which is what `seedDemo` needs it to mean.
 *
 * It is not a way to start a server without secrets. Absent ones are generated per boot,
 * so a server built on this config would mint sessions nothing else can verify and lose
 * every one of them on restart. `src/main/index.ts` calls `loadConfig`.
 */
export const loadMaintenanceConfig = (source: Source = process.env): AppConfig =>
  load(maintenanceSchema, source)
