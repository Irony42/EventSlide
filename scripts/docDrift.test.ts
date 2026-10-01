import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Cross-checks for the G1-01 / P1-02 documentation drift pass.
 *
 * Each test pins one claim `docs/SECURITY.md`, `docs/ARCHITECTURE.md` or `AGENTS.md`
 * makes about the code to the code itself, so a doc that drifts again fails here by
 * name instead of waiting for the next reader who trusts it. This is the
 * `eventslide-mutation` skill's "Documentation" rule applied as a standing guard: if a
 * document names a route, a variable, an export or a file, check it exists — every
 * time, not just once.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

describe('docs/SECURITY.md', () => {
  const security = read('docs', 'SECURITY.md')

  it('never describes the fictitious POST /api/setup/owner endpoint', () => {
    // The real first-owner flow is BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD,
    // read once at boot by bootstrapFirstOwner (src/main/container.ts). There is no
    // route and no one-time token is logged — makeBootstrapOwner runs from
    // configuration, not from a request.
    expect(security).not.toContain('setup/owner')
    expect(security).toContain('BOOTSTRAP_OWNER_EMAIL')
    expect(security).toContain('BOOTSTRAP_OWNER_PASSWORD')
  })

  it('names the sharp version actually installed, not only the one a past audit read', () => {
    const installed = /"sharp":\s*"\^?([\d.]+)"/.exec(read('package.json'))?.[1]
    expect(installed, 'package.json dependencies.sharp').toBeDefined()
    expect(security).toContain(installed as string)
  })

  it('does not claim the operator role is unshipped once §10.1 has landed', () => {
    // src/infrastructure/db/migrations/004_site_role.ts and requireOperator
    // (middleware/authz.ts) are both on main as of #95.
    expect(security).not.toMatch(/operator role is not here yet/i)
    expect(existsSync(join(ROOT, 'src/infrastructure/db/migrations/004_site_role.ts'))).toBe(true)
  })

  it('gives POST /api/auth/login the rate-limit window the code actually uses', () => {
    const rateLimit = read('src', 'interface', 'http', 'middleware', 'rateLimit.ts')
    // loginLimiter shares the generic 60-second limiter; only galleryUnlockLimiters
    // uses the 15-minute UNLOCK_WINDOW_MS, and that is a different endpoint.
    expect(rateLimit).toMatch(/export const loginLimiter[\s\S]{0,80}limiter\(perMinute, 'rate\.limited'\)/)
    const loginRow = security
      .split('\n')
      .find((line) => line.trimStart().startsWith('| `POST /api/auth/login`'))
    expect(loginRow, 'the login row in the §5 rate-limit table').toBeDefined()
    expect(loginRow).toContain('1 min')
    expect(loginRow).not.toContain('15 min')
  })

  it("states PUBLIC_URL's real default instead of claiming it has none", () => {
    const defaultValue = /PUBLIC_URL:\s*publicUrl\.default\('([^']+)'\)/.exec(
      read('src', 'infrastructure', 'config', 'env.ts'),
    )?.[1]
    expect(defaultValue, "PUBLIC_URL's default in env.ts").toBeDefined()
    const row = security.split('\n').find((line) => line.trimStart().startsWith('| `PUBLIC_URL`'))
    expect(row, 'the PUBLIC_URL row in the §10 configuration table').toBeDefined()
    expect(row).toContain(defaultValue as string)
  })

  it('lists all seven event-unscoped repository methods, not five', () => {
    expect(security).toMatch(/seven methods/i)
    expect(security).toContain('deleteStaleReservations')
    expect(security).toContain('listEvents')
  })
})

describe('docs/ARCHITECTURE.md', () => {
  const architecture = read('docs', 'ARCHITECTURE.md')

  it('names the composition root export that actually exists', () => {
    expect(read('src', 'main', 'container.ts')).toContain('export const createContainer')
    expect(architecture).toContain('createContainer')
    expect(architecture).not.toContain('buildContainer')
  })

  it("defaults NODE_ENV the way env.ts does, in the §9 config example", () => {
    expect(read('src', 'infrastructure', 'config', 'env.ts')).toMatch(
      /NODE_ENV:[\s\S]{0,200}\.default\('production'\)/,
    )
    expect(architecture).not.toMatch(/NODE_ENV:[^\n]*\.default\('development'\)/)
  })

  it('names event_memberships and its real role values, not a fictitious event_members table', () => {
    const migration = read('src', 'infrastructure', 'db', 'migrations', '001_initial_schema.ts')
    expect(migration).toContain('event_memberships')
    expect(migration).toMatch(/role\s+TEXT NOT NULL CHECK \(role IN \('owner', 'moderator'\)\)/)
    expect(architecture).toContain('event_memberships')
    // "event_memberships" itself contains "event_members" as a substring (…hips), so
    // the fictitious name is only absent when it is not immediately followed by "hips".
    expect(architecture).not.toMatch(/event_members(?!hips)/)
  })

  it('names the real adapter files behind MediaStore and ArchiveWriter', () => {
    for (const file of ['fsMediaStore.ts', 'archiverWriter.ts']) {
      expect(architecture, file).toContain(file)
    }
    expect(architecture).not.toContain('filesystemMediaStore.ts')
    expect(architecture).not.toContain('archiverAlbumArchiver.ts')
    expect(existsSync(join(ROOT, 'src/infrastructure/media/fsMediaStore.ts'))).toBe(true)
    expect(existsSync(join(ROOT, 'src/infrastructure/media/archiverWriter.ts'))).toBe(true)
  })
})

describe('AGENTS.md', () => {
  const agents = read('AGENTS.md')

  it("keeps the node_modules-junction rule on one row, not split by a stray control character", () => {
    // Rule 18's cell once carried a literal line break where "\node_modules" belongs,
    // which split one table row into a well-formed row and a second line markdown then
    // read as a new, malformed one starting "| ode_modules...".
    expect(agents).toContain('"<wt>\\node_modules"')
    expect(agents.split('\n').some((line) => /^\|\s*ode_modules/.test(line))).toBe(false)
  })
})

describe('ssl/', () => {
  it('no longer ships an empty certificate placeholder — TLS terminates at the reverse proxy', () => {
    // docs/SECURITY.md §11: "the app never terminates TLS itself". The placeholder
    // directory implied otherwise and nothing in the tree ever read from it.
    expect(existsSync(join(ROOT, 'ssl'))).toBe(false)
  })
})
