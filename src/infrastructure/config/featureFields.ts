import { z } from 'zod'
import {
  AUDIT_RETENTION_DEFAULT_DAYS,
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
} from '../../domain/audit/auditRetention'
import {
  DEFAULT_OPERATOR_RESET_LINKS,
  OPERATOR_RESET_LINK_MODES,
} from '../../domain/clients/operatorGuard'
import { JoinCode } from '../../domain/shared/joinCode'
import { Password } from '../../domain/users/password'
import { parseMailbox, parseSmtpUrl } from '../mail/smtpEndpoint'
import {
  PLACEHOLDER_SECRETS,
  blankAsAbsent,
  boolish,
  boolishWithDefault,
  choice,
  refuse,
} from './schemaPrimitives'

/**
 * The fields of the schema that switch a feature or a policy on: the operator's reach, who may
 * create an event, slugs and join codes, audit retention, the ceilings of a new client, the mail
 * relay and sender, the key an operator's second factor is sealed with, and the first owner's
 * password.
 */

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
export const siteAdmin = z.preprocess(blankAsAbsent, choice(['off', 'on']).default('off'))

/**
 * `REQUIRE_OPERATOR_2FA`: `true` or `false` (or `1` / `0`), `false` when absent (G2-13 / P3-15).
 *
 * **A blank is a refusal, not an absence** — the opposite of its neighbours, and on purpose.
 * Every other switch here is read blank-as-default because the default is the posture with
 * less surface, so a dangling `SITE_ADMIN=` can only take something away. This one is a
 * protection: a hosted instance whose compose file rendered it empty would boot, look
 * configured and guard nothing. Turning a protection off takes a word somebody had to mean,
 * so `REQUIRE_OPERATOR_2FA=` names the variable at boot. `compose.yaml` passes it as
 * `${REQUIRE_OPERATOR_2FA:-false}`, so a self-hoster who never set it still sends a word.
 */
export const requireOperator2fa = boolishWithDefault('false')

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
export const eventSlugSuffix = z.preprocess(
  blankAsAbsent,
  choice(['none', 'random']).default('none'),
)

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
export const eventCreation = z.preprocess(
  blankAsAbsent,
  choice(['anyAccount', 'clientMembers']).default('anyAccount'),
)

/**
 * Whether a password-reset link that an operator asked for may ever be shown to the operator
 * (G2-12 / P3-14, decision D-16): `mailOnly` or `copyLinkWithOwnerApproval`.
 *
 * **`mailOnly` is the default, here and on every box**, and it is the posture in which nothing
 * an operator does can put a credential for a client's account in front of the operator: the
 * link goes to the account's own mailbox, and on a box with no mail relay the operator simply
 * cannot reset a password. `copyLinkWithOwnerApproval` is an opt-in that **weakens that
 * invariant** and says so in docs/SECURITY.md: on a box with no relay, a link is handed to the
 * operator, but only after another owner of the account's client approved the request. It
 * additionally requires `SITE_ADMIN=on`, in the refinement below.
 *
 * Same spelling convention as {@link siteAdmin}, and the direction matters: a blank or an
 * absence lands on `mailOnly`, which is the less permissive of the two, so a template that
 * rendered empty can only take a path away; anything that is neither word is a refusal that
 * names the variable, never a guess at which was meant — a typo must not be read as the opt-in.
 */
export const operatorResetLinks = z.preprocess(
  blankAsAbsent,
  choice(OPERATOR_RESET_LINK_MODES).default(DEFAULT_OPERATOR_RESET_LINKS),
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
export const allowCustomSlugs = boolishWithDefault('true')

/**
 * How many characters a newly minted or rotated join code has (P4-09 / D-14), 6 to 10.
 * `JoinCode.minLength` is both the floor of the accepted range and the default — 2.0's
 * only length, and what every pre-existing printed card already is — so the two are
 * quoted from the same constant rather than restated as a second `6` free to drift away
 * from it. A code already on an event keeps whatever length it was minted with:
 * `JoinCode.create` accepts the whole range on the way back in, so lowering this
 * variable later does not strand an existing card.
 */
export const joinCodeLength = z.coerce
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
export const auditRetentionDays = z.preprocess(
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
 * One of the `NEW_CLIENT_*` ceilings that is a number (roadmap §10.5; free plan G2-18): what a
 * client created by `provisionClientOwner` starts with when nobody says otherwise.
 *
 * **Absent is "no ceiling", and absent is what a box that never heard of it has.** The
 * variable is `undefined` here, not a number, so a self-hosted box that sets none of them
 * provisions every client exactly as `createClient` always did. Blank is absent, for the
 * reason written on {@link blankAsAbsent}: a dangling `NEW_CLIENT_MAX_EVENTS=` must not be
 * read as a ceiling of zero, which would forbid a client its first event.
 *
 * **The bounds are the domain's own** (`clientCeilings.ts`, copied from the `CHECK`s of the
 * `clients` table), so a default that boots is a default `ClientCeilings.create` accepts: the
 * alternative is a refusal on the first client an operator provisions, hours or weeks after
 * the box was configured, which is the shape of failure this file exists to prevent. Whole
 * and safe, because a byte count above 2^53 is not a number the audit log or SQLite can hold
 * exactly.
 */
export const newClientCeiling = (variable: string, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const whole = { error: `${variable} must be a whole number` }
  return z.preprocess(
    blankAsAbsent,
    z.coerce
      .number(whole)
      .int(whole)
      .min(min, { error: `${variable} must be at least ${min}` })
      .max(max, { error: `${variable} must be at most ${max}` })
      .optional(),
  )
}

/**
 * `NEW_CLIENT_CLIPS_ALLOWED`: `true`, `false`, `1` or `0`, absent meaning "allowed" — which is
 * also what a client with no ceiling at all has. Blank is absent, as for its siblings.
 */
export const newClientClipsAllowed = z.preprocess(blankAsAbsent, boolish.optional())

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
export const smtpUrl = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .transform((value, ctx) => {
      const parsed = parseSmtpUrl(value)
      if (!parsed.ok) {
        return refuse(
          ctx,
          `SMTP_URL ${parsed.error}. Expected smtp://host:587 or smtps://user:password@host:465, with special characters in the credentials percent-encoded; the value is not repeated here because it may carry a password`,
        )
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
export const mailFrom = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .transform((value, ctx) => {
      const parsed = parseMailbox(value)
      if (!parsed.ok) {
        return refuse(ctx, `MAIL_FROM ${parsed.error}`)
      }
      return parsed.value
    })
    .optional(),
)

const MFA_KEY_MIN_BYTES = 32

const decodeMfaKey = (value: string): Uint8Array | null => {
  const text = value.trim()
  if (/^[0-9a-fA-F]+$/.test(text)) {
    return text.length % 2 === 0 ? Uint8Array.from(Buffer.from(text, 'hex')) : null
  }
  // Standard and URL-safe base64 alike, padded or not. A length of 1 modulo 4 is not the
  // encoding of any byte string, and Node would drop the stray character in silence.
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text) || text.replace(/=+$/, '').length % 4 === 1) {
    return null
  }
  return Uint8Array.from(Buffer.from(text, 'base64'))
}

/**
 * `MFA_ENCRYPTION_KEY`: the key the operator's TOTP secrets are encrypted under at rest
 * (roadmap §10.1, G2-13 / P3-15). 32 random bytes or more, written as hex (`openssl rand -hex
 * 32`, 64 characters) or as base64 (`openssl rand -base64 32`, 44).
 *
 * **Its own variable, on purpose** (C-10 in the paid plan). The first draft derived it from
 * `SESSION_SECRET`, and the cost of that is that rotating the session secret — which is
 * routine, and which invalidates every cookie — would also make every enrolled factor
 * undecryptable and lock every operator out of the box. A key that only ever encrypts one
 * kind of thing can be rotated, lost and guarded on its own terms.
 *
 * Blank is absent, for the reason on {@link blankAsAbsent}. **The value never appears in a
 * refusal**: the boot's list of problems is printed to a terminal and kept by whatever
 * collects it, and a key refused for a stray character is still a key. What is kept is the
 * decoded bytes, which are what the vault derives its AES key from.
 */
export const mfaEncryptionKey = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .transform((value, ctx) => {
      const decoded = decodeMfaKey(value)
      if (
        decoded === null ||
        decoded.length < MFA_KEY_MIN_BYTES ||
        PLACEHOLDER_SECRETS.has(value.trim())
      ) {
        return refuse(
          ctx,
          `MFA_ENCRYPTION_KEY must be at least ${MFA_KEY_MIN_BYTES} random bytes written as hex (64 characters or more) or as base64 (44 or more), and not an example value: generate one with 'openssl rand -base64 32'. The value is not repeated here because it is a key`,
        )
      }
      return { text: value.trim(), bytes: decoded }
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
export const bootstrapOwnerPassword = z.string().superRefine((value, ctx) => {
  const parsed = Password.create(value)
  if (parsed.ok) return
  ctx.addIssue({
    code: 'custom',
    message: `BOOTSTRAP_OWNER_PASSWORD must satisfy the same policy as any other account password: at least ${Password.minLength} characters, and not a guessable one (${parsed.error.code})`,
  })
})
