import { randomToken } from '../crypto/primitives'
import { z } from 'zod'

/**
 * The small pieces every field of the environment schema is made of: the refusal helper, the
 * enum, bounded integer and boolean parsers, the secret rules, the blank-is-absent
 * preprocessing and the sweep intervals. Nothing here names a variable of the product except the
 * two sweeps; the fields themselves are in `linkFields.ts` and `featureFields.ts`, and the
 * schema that lists them is `schema.ts`.
 */

/**
 * Refuses a value from inside a `transform`, and keeps the object's cross-field refinement
 * running afterwards.
 *
 * **The second half is the point of the helper.** zod 3 let that refinement run whenever the
 * fields had only been *refused*, as opposed to being the wrong type altogether, and the boot
 * refusal leans on it: it is what lets a malformed `SMTP_URL` and the missing `MAIL_FROM` be
 * named in one list rather than one per restart (`env.test.ts`, "names both problems when the
 * URL is malformed and there is no sender"). zod 4 marks an issue added from a `transform` as
 * stopping every later check on the object unless it says `continue: true`, so a bare
 * `ctx.addIssue` there would quietly turn "every problem at once" into "the first problem".
 * A wrong type, an unknown enum word and a number that is not one still stop it, as before.
 */
export const refuse = (ctx: z.core.$RefinementCtx<string>, message: string): typeof z.NEVER => {
  ctx.addIssue({ code: 'custom', message, continue: true })
  return z.NEVER
}

/**
 * A closed set of words, refused with the words named in single quotes: `Expected 'off' | 'on'`.
 *
 * That is the wording zod 3 gave an unknown enum word, and what the tests and the
 * operator-facing documentation read ("names both accepted words"). zod 4 words it
 * `expected one of "off"|"on"`. Unlike zod 3 this does **not** repeat what was typed: an
 * environment variable is where a secret ends up when a line is pasted into the wrong place,
 * and a boot refusal is printed and kept.
 */
export const choice = <const Values extends readonly [string, ...string[]]>(values: Values) =>
  z.enum(values, {
    error: (issue) =>
      issue.code === 'invalid_value'
        ? `Expected ${values.map((value) => `'${value}'`).join(' | ')}`
        : undefined,
  })

/** `.env` files give strings; this coerces and bounds them. */
export const positiveInt = (fallback: number, max?: number) => {
  const base = z.coerce.number().int().positive()
  return (max === undefined ? base : base.max(max)).default(fallback)
}

export const boolish = choice(['true', 'false', '1', '0']).transform(
  (value) => value === 'true' || value === '1',
)

/**
 * {@link boolish}, with a default. Kept separate rather than adding `.default()` to
 * `boolish` itself: every existing caller passes it through `.optional()` and reads the
 * product's own fallback afterwards (`SESSION_COOKIE_SECURE` follows `NODE_ENV`,
 * `E2E_HOOKS` is refused outright in production), so none of them needed zod to supply
 * one — `ALLOW_CUSTOM_SLUGS` is the first variable here where the default is as simple
 * as "true, unless told otherwise", with nothing else to layer on top of it.
 */
export const boolishWithDefault = (fallback: 'true' | 'false') =>
  choice(['true', 'false', '1', '0'])
    .default(fallback)
    .transform((value) => value === 'true' || value === '1')

/**
 * Values shipped in `.env.example`. Booting production with one of these is worse than
 * booting with nothing, because it looks configured.
 */
export const PLACEHOLDER_SECRETS = new Set([
  'change-me-in-production-at-least-32-characters',
  'change-me-too-at-least-32-characters-long',
  'dev-session-secret',
  'secret',
])

export const secret = (name: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 characters`)
    .refine((value) => !PLACEHOLDER_SECRETS.has(value), {
      error: `${name} is still the example value from .env.example`,
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

export const ephemeralSecret = (): string => randomToken(EPHEMERAL_SECRET_BYTES)

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
        error: `${name} must be a whole number of minutes from 1 to ${SWEEP_MAX_MINUTES}, or the word '${SWEEP_OFF}' ${consequence}`,
      },
    )
    // `null` is "never", and it is only ever reached through that word.
    .transform((value): number | null => (value === SWEEP_OFF ? null : Number(value)))

export const retentionSweepInterval = sweepInterval(
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
export const scheduleSweepInterval = sweepInterval(
  'SCHEDULE_SWEEP_INTERVAL_MINUTES',
  'to stop opening and closing events automatically',
)

/** Hourly. Retention is measured in days, so this is about bounding lag, not precision. */
export const DEFAULT_RETENTION_SWEEP_MINUTES = 60

/** See {@link scheduleSweepInterval}: the worst case a guest can be told "not yet". */
export const DEFAULT_SCHEDULE_SWEEP_MINUTES = 5

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
export const blankAsAbsent = (value: unknown): unknown => (value === '' ? undefined : value)
