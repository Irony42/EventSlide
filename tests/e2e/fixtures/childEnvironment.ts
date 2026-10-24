/**
 * The environment of the server the end-to-end suite boots, built from nothing.
 *
 * `startTestApp` used to spread `process.env` and override a hand-picked list, with comments
 * arguing "stated, never inherited" for each override. Everything it did not list was still
 * taken from the shell or the CI runner: `SITE_ADMIN`, `NEW_CLIENT_*`, `MFA_ENCRYPTION_KEY`,
 * `REQUIRE_OPERATOR_2FA`, `SOURCE_REF`, `EVENT_SLUG_SUFFIX`, `ALLOW_CUSTOM_SLUGS`, `MAX_*`,
 * `MIN_FREE_DISK_BYTES`, `TRUST_PROXY_HOPS`... so one exported variable turned the "stock
 * server" specs into specs of a configured one, or refused the boot (`NEW_CLIENT_MAX_EVENTS`
 * with `SITE_ADMIN` off), on one machine and nowhere else.
 *
 * Here every configuration variable is stated or absent. What is inherited is a short list of
 * facts about the machine, not configuration: where programs are (`PATH`, `PATHEXT`, which the
 * server's binary resolver reads), the Windows system and temp directories, and the home
 * directory. A spec that wants a variable passes it in `env`, which wins over all of it.
 *
 * It is a module of its own, with no Playwright import, so `scripts/e2eEnvironment.test.ts` can
 * ask it what a polluted shell does to the server.
 */

/** Facts about the machine a child process cannot run without. Nothing here configures EventSlide. */
export const HOST_VARIABLES = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
] as const

/**
 * Who may create an event on the server under test (`EVENT_CREATION`, roadmap §10.9 /
 * P3-05). `anyAccount` is the core default and what every journey runs against;
 * `clientMembers` is what a box run for other people sets, and the one project that runs
 * the security specs under it is `chromium-client-members` in `playwright.config.ts`.
 */
export type EventCreation = 'anyAccount' | 'clientMembers'

export interface ServerEnvironmentOptions {
  /** `process.env` of the Playwright worker: only `HOST_VARIABLES` of it are read. */
  readonly host: Readonly<Record<string, string | undefined>>
  readonly worker: number | string
  readonly port: number
  readonly baseUrl: string
  readonly databasePath: string
  readonly mediaRoot: string
  readonly eventCreation: EventCreation
  readonly owner: { readonly email: string; readonly password: string }
  /** A spec's own variables, which win over everything above. */
  readonly overrides?: Readonly<Record<string, string>>
}

/** The machine's facts, and only those, from a source environment. */
export const hostEnvironment = (
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const found: Record<string, string> = {}
  for (const name of HOST_VARIABLES) {
    const value = source[name]
    if (value !== undefined) found[name] = value
  }
  return found
}

export const serverEnvironment = ({
  host,
  worker,
  port,
  baseUrl,
  databasePath,
  mediaRoot,
  eventCreation,
  owner,
  overrides = {},
}: ServerEnvironmentOptions): Record<string, string> => ({
  ...hostEnvironment(host),
  NODE_ENV: 'test',
  PORT: String(port),
  PUBLIC_URL: baseUrl,
  // Deterministic, so a token issued in one test is not affected by another
  // worker's secret, and so a fixture can be reasoned about.
  SESSION_SECRET: `e2e-session-secret-worker-${worker}-padding-padding`,
  GUEST_TOKEN_SECRET: `e2e-guest-secret-worker-${worker}-padding-padding`,
  DATABASE_PATH: databasePath,
  MEDIA_ROOT: mediaRoot,
  // The wall's timing hooks, so a visual test does not wait ten real seconds per
  // slide. The config module refuses to boot production with this set.
  E2E_HOOKS: '1',
  // Rate limits high enough that a fast test suite is not throttled — the limits
  // themselves are asserted in the security specs, which set them down again.
  UPLOAD_RATE_LIMIT_PER_MINUTE: '600',
  JOIN_RATE_LIMIT_PER_MINUTE: '600',
  LOGIN_RATE_LIMIT_PER_MINUTE: '600',
  REACTION_RATE_LIMIT_PER_MINUTE: '600',
  GUEST_WRITE_RATE_LIMIT_PER_MINUTE: '6000',
  GALLERY_RATE_LIMIT_PER_MINUTE: '600',
  GALLERY_MEDIA_RATE_LIMIT_PER_MINUTE: '6000',
  // Cost 10 rather than 12: this is the floor the hasher accepts, and it takes
  // roughly a quarter of the time. Every login in the suite pays it.
  BCRYPT_COST: '10',
  BOOTSTRAP_OWNER_EMAIL: owner.email,
  BOOTSTRAP_OWNER_PASSWORD: owner.password,
  LOG_LEVEL: 'warn',
  // The policy is stated, so `app.eventCreation` and the server cannot disagree. Everything
  // else a self-hoster may set (a relay, the operator's identity and links, ceilings, limits)
  // is absent unless a spec passes it: that is the stock server.
  EVENT_CREATION: eventCreation,
  ...(eventCreation === 'clientMembers' ? { SITE_ADMIN: 'on' } : {}),
  ...overrides,
})
