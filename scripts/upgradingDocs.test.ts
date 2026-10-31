import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { configSources } from './configSources'

/**
 * `docs/UPGRADING.md` (roadmap G3-09 / P4-11), held to the code it describes.
 *
 * A page of instructions for the night something goes wrong is worth exactly as much as its
 * commands still being the ones that exist. Nothing else in the toolchain reads it: rename an
 * npm script, drop a flag from `restore`, reword the error an old build gives a newer
 * database, and the page goes on telling a host to type or to expect something that is no
 * longer there, with every check green.
 *
 * So this file pins what can be pinned: the commands and flags it names, the messages it
 * quotes, the files and settings it points at, the links it makes, and the places that must
 * point back at it. What it cannot pin is the judgement (what a major should be allowed to
 * break), and that is the page's to argue.
 *
 * The CHANGELOG half of the policy is `scripts/changelogPolicy.test.ts`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

/** Source text with the seams of a template-literal concatenation closed, so a phrase can be found. */
const closeSeams = (text: string): string => text.replace(/`\s*\+\s*`/g, '')

/** A source file as one string, seams closed. */
const source = (...segments: string[]): string => closeSeams(read(...segments))

/** The configuration module as one string, seams closed. */
const configSource = (): string => closeSeams(configSources())

/** Running text: Prettier wraps lines, and a phrase can break across one. */
const flat = (text: string): string => text.replace(/\s+/g, ' ')

const PAGE = join('docs', 'UPGRADING.md')
const page = read(PAGE)
const prose = flat(page)

/** The `## Upgrading to 3.0` section of the page, to its end. */
const section = page.slice(page.indexOf('\n## Upgrading to 3.0\n'))

/** The 3.0.0 entry of the CHANGELOG, heading included. */
const entry =
  read('CHANGELOG.md')
    .split(/^## /m)
    .find((part) => part.startsWith('[3.0.0]')) ?? ''

/** The names of the npm scripts in package.json. */
const scriptNames = (): readonly string[] => {
  const parsed: unknown = JSON.parse(read('package.json'))
  const found: unknown =
    typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'scripts') : null
  if (typeof found !== 'object' || found === null) throw new Error('package.json has no scripts')
  return Object.keys(found)
}

/** The flags in `text`: `--dry-run`, `--force`. A single-dash docker option is not one. */
const flagsIn = (text: string): readonly string[] =>
  [...text.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)].map((match) => match[0])

describe('the commands docs/UPGRADING.md tells a host to type', () => {
  it('are npm scripts that package.json defines', () => {
    const named = [...page.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1] ?? '')

    expect(named.length, 'npm scripts named on the page').toBeGreaterThan(0)
    for (const name of named) expect(scriptNames(), `npm run ${name}`).toContain(name)
    expect(page).toMatch(/\bnpm start\b/)
    expect(scriptNames()).toContain('start')
  })

  it('are operator commands the image carries, compiled from tsconfig.ops.json', () => {
    const named = new Set([...page.matchAll(/dist\/ops\/scripts\/(\w+)\.js/g)].map((m) => m[1]))
    const carried = [...read('tsconfig.ops.json').matchAll(/"scripts\/(\w+)\.ts"/g)].map(
      (match) => match[1],
    )

    expect([...named], 'the commands every host needs').toEqual(
      expect.arrayContaining(['backup', 'restore']),
    )
    for (const name of named) expect(carried, `dist/ops/scripts/${name}.js`).toContain(name)
  })

  it('pass only flags that the command documents', () => {
    const lines = page
      .replace(/\\\n\s*/g, ' ')
      .split('\n')
      .flatMap((line) => {
        const image = /dist\/ops\/scripts\/(\w+)\.js(.*)/.exec(line)
        const checkout = /npm run (backup|restore|purge)[\w:-]*(.*)/.exec(line)
        return [image, checkout].flatMap((hit) =>
          hit === null ? [] : [{ command: hit[1] ?? '', rest: hit[2] ?? '' }],
        )
      })

    expect(lines.length, 'lines that run a command').toBeGreaterThan(0)
    const flags = lines.flatMap(({ command, rest }) => {
      const text = read('scripts', `${command}.ts`)
      // The command's own usage text: what `--help` tells a host. `restore.test.ts` and
      // `backup.test.ts` hold what each flag does; this holds that the page names real ones.
      return flagsIn(rest).map((flag) => ({ command, flag, documented: text.includes(flag) }))
    })

    expect(flags.length, 'flags passed to a command').toBeGreaterThan(0)
    for (const { command, flag, documented } of flags) {
      expect(documented, `${command} documents ${flag}`).toBe(true)
    }
  })

  it('run against a compose service, a volume and a backup directory that exist', () => {
    const compose = read('compose.yaml')

    expect(page).toContain('docker compose exec eventslide')
    expect(compose).toMatch(/^ {2}eventslide:$/m)
    expect(compose).toContain(':/data')
    // "Either way the container restarts and fails again": a boot that is refused loops.
    expect(compose).toMatch(/^ {4}restart: unless-stopped$/m)
    expect(page).toContain('/data/backups/')
    expect(read('Dockerfile')).toContain('BACKUP_DIR=/data/backups')
  })

  it('pull the image that compose.yaml names, because compose.yaml no longer builds one', () => {
    // This was the other way round, and held to it from both ends: the page said "no prebuilt
    // image is published" and told a host to `docker compose up -d --build`, while
    // compose.yaml said `build: .`. A page that tells a host to build what compose.yaml
    // pulls, or to pull what it builds, sends them to a stale image or an error on the night
    // they upgrade, so the page and the file are held to each other.
    expect(read('compose.yaml')).not.toMatch(/^\s*build:/m)
    expect(read('compose.yaml')).toMatch(/^ {4}image: ghcr\.io\/irony42\/eventslide:\S+/m)
    expect(page).toContain('docker compose pull')
    expect(prose).toContain('ghcr.io/irony42/eventslide:X.Y.Z')
    expect(prose).not.toContain('no prebuilt image is published')
    expect(page).not.toMatch(/docker compose up -d --build\s*$/m)
  })

  it('keep a way to build from the checkout, which compose.build.yaml is, and say how', () => {
    expect(page).toContain('docker compose -f compose.yaml -f compose.build.yaml up -d --build')
    expect(read('compose.build.yaml')).toMatch(/^ {4}build: \.$/m)
    expect(page).toMatch(/^## Building the image yourself$/m)
    expect(page).toContain('(#building-the-image-yourself)')
  })

  it('say an image is published only while the release workflow publishes it, and no other does', () => {
    // The mirror of the test that used to say no workflow may push: the page now says one is
    // published, so one has to be, and it has to be the one with the checks and the signature
    // in front of it. A push from ci.yml or the scan would be an image that skipped them.
    const workflows = readdirSync(join(ROOT, '.github', 'workflows')).filter((file) =>
      /.ya?ml$/.test(file),
    )
    const pushes =
      /build-push-action|docker push|imagetools create|push:\s*true|cosign (sign|attest)/

    expect(workflows).toContain('release.yml')
    for (const file of workflows) {
      const text = read('.github', 'workflows', file)
      if (file === 'release.yml') expect(text, `${file} publishes the image`).toMatch(pushes)
      else expect(text, `${file} pushes an image`).not.toMatch(pushes)
    }
  })

  it('name the tags the release workflow pushes, and say there is no latest', () => {
    // The tag policy itself is executed in releasePipeline.test.ts; this holds that the page
    // describes it: the exact tag, the minor, the major, a candidate on its own, and no latest.
    const table = section0(page, '## Which image tag')

    expect(table).toMatch(/\| `3\.0\.1`\s+\|/)
    expect(table).toMatch(/\| `3\.0`\s+\|/)
    expect(table).toMatch(/\| `3`\s+\|[^|]*never the next major/)
    expect(table).toMatch(/\| `3\.1\.0-rc\.1`\s+\|[^|]*no other tag ever points at it/)
    expect(flat(table)).toContain('There is no `latest`')
    expect(read('.github', 'workflows', 'release.yml')).not.toMatch(/^\s*[^#\s].*:latest\b/m)
  })
})

/** The text of the `##` section of `page` that starts with `heading`, to the next one. */
const section0 = (text: string, heading: string): string => {
  const start = text.indexOf(`\n${heading}\n`)
  if (start === -1) throw new Error(`no section ${heading}`)
  const next = text.indexOf('\n## ', start + 1)
  return text.slice(start, next === -1 ? undefined : next)
}

describe('the messages docs/UPGRADING.md says to expect', () => {
  const quoted: readonly { phrase: string; where: readonly string[] }[] = [
    // What the old build says to a database a newer one migrated.
    {
      phrase: 'downgrading is not supported',
      where: ['src', 'infrastructure', 'db', 'migrator.ts'],
    },
    // What a build says to a migration that was edited after it ran.
    {
      phrase: 'has changed since it was applied',
      where: ['src', 'infrastructure', 'db', 'migrator.ts'],
    },
    // What a migration that fails says, and the reason a later one is not applied.
    { phrase: 'failed and was rolled back', where: ['src', 'infrastructure', 'db', 'migrator.ts'] },
    // The line the first boot after an upgrade logs.
    { phrase: 'applied migrations', where: ['src', 'main', 'container.ts'] },
    // What `restore --dry-run` says of an archive older than the build.
    {
      phrase: 'the archive predates this build',
      where: ['src', 'infrastructure', 'db', 'backupArchive.ts'],
    },
    // What a build says of an archive a newer one took.
    {
      phrase: 'Restore it with the version that produced it',
      where: ['src', 'infrastructure', 'db', 'backupArchive.ts'],
    },
    // The exit code of a refused configuration.
    { phrase: 'code 78', where: ['src', 'main', 'index.ts'] },
  ]

  it.each(quoted)('"$phrase" is on the page and is what the code prints', ({ phrase, where }) => {
    const code = phrase === 'code 78' ? 'process.exit(78)' : phrase

    expect(prose, 'the page').toContain(phrase)
    expect(source(...where), where.join('/')).toContain(code)
  })

  it('cites the three boot warnings 3.0.0 added, which are warnings and not refusals', () => {
    const env = configSource()

    expect(prose).toContain('`PUBLIC_URL`')
    expect(prose).toContain('`TRUST_PROXY_HOPS=0`')
    expect(prose).toContain('`MAIL_FROM` set without `SMTP_URL`')
    expect(env).toContain('PUBLIC_URL is not set')
    expect(env).toContain('TRUST_PROXY_HOPS is 0')
    expect(env).toContain('MAIL_FROM is set but SMTP_URL is not')
  })
})

describe('the upgrade to 3.0 against the code it describes', () => {
  it('names the migrations 3.0.0 adds to a 2.1.0 database, in the page and in the entry', () => {
    // 2.1.0 ends at migration 007. Whoever adds the next one has to say so in both places, or
    // a host is told that three migrations will run when four will.
    const LAST_MIGRATION_OF_2_1_0 = 7
    // This page section is about 3.0.0, so a migration a later minor adds (015, operator takedown,
    // 3.3) is that release's to name, in its own section, and not this one's.
    const LAST_MIGRATION_OF_3_0_0 = 14
    const ids = [
      ...new Set(
        [
          ...read('src', 'infrastructure', 'db', 'migrations', 'index.ts').matchAll(
            /migration(\d{3})\b/g,
          ),
        ].map((match) => Number(match[1])),
      ),
    ].filter((id) => id > LAST_MIGRATION_OF_2_1_0 && id <= LAST_MIGRATION_OF_3_0_0)

    expect(ids.length, 'migrations after 007').toBeGreaterThan(0)
    for (const id of ids) {
      const padded = String(id).padStart(3, '0')
      expect(section, `${padded} in the 3.0 section`).toContain(padded)
      expect(entry, `${padded} in the 3.0.0 entry`).toContain(padded)
    }
    // The first boot logs the ids it applied; the page quotes them as a range.
    expect(flat(section), 'the range of ids the first boot logs').toContain(
      `ids ${Math.min(...ids)} to ${Math.max(...ids)}`,
    )
  })

  it('names the Docker Compose version that the long form of env_file in compose.yaml needs', () => {
    expect(read('compose.yaml')).toMatch(/env_file:\s+- path: \.env\s+required: false/)
    expect(flat(section)).toContain('Docker Compose 2.24 or later')
  })
})

describe('the error codes that docs/UPGRADING.md and the 3.0.0 entry of the CHANGELOG name', () => {
  // `403 auth.passwordChangeRequired`: a status and a code. They are what a client written
  // against 2.1.0 matches on, so a code that does not exist (or has another status in
  // docs/API.md, the contract) sends it to look for something that will never arrive.
  const named = [...(section + entry).matchAll(/\b([1-5]\d\d) ([a-z]+\.[a-zA-Z]+)\b/g)].map(
    (match) => ({ status: match[1] ?? '', code: match[2] ?? '' }),
  )

  /** Every dotted `'code.name'` string literal of the production source. */
  const literals = new Set(
    readdirSync(join(ROOT, 'src'), { recursive: true, withFileTypes: true })
      .filter((file) => file.isFile() && /\.ts$/.test(file.name) && !/\.test\.ts$/.test(file.name))
      .flatMap((file) =>
        [
          ...readFileSync(join(file.parentPath, file.name), 'utf8').matchAll(
            /'([a-z]+\.[a-zA-Z]+)'/g,
          ),
        ].map((match) => match[1] ?? ''),
      ),
  )

  const api = flat(read('docs', 'API.md'))
  const documented = (status: string, code: string): boolean =>
    new RegExp(`\\b${status}\\b[^|]{0,8}${code}|${code}[^|]{0,6}\\| ${status}\\b`).test(api)

  it('are read from the page and the entry, or this test checks nothing', () => {
    expect(new Set(named.map(({ code }) => code)).size, 'distinct codes named').toBeGreaterThan(5)
  })

  it('exist in the code', () => {
    for (const { code } of named) expect(literals.has(code), code).toBe(true)
  })

  it('are given the status docs/API.md gives them', () => {
    for (const { status, code } of named)
      expect(documented(status, code), `${status} ${code}`).toBe(true)
  })
})

describe('the setting that switches the terms of use on (G2-20)', () => {
  // A new boot-checked setting goes into the 3.0.0 list of new settings and into "Upgrading to 3.0"
  // (docs/UPGRADING.md, the upgrade policy). Nothing else enumerates the names, so this is the
  // only thing that notices the day one of the two lists loses it.
  it('is named in the list the 3.0.0 CHANGELOG gives and in the one this page gives', () => {
    expect(entry).toContain('`LEGAL_TERMS_VERSION` takes at most 32 characters')
    expect(entry).toContain('`LEGAL_TERMS_VERSION` without `LEGAL_TERMS_URL`')
    expect(section).toContain('`LEGAL_TERMS_VERSION`')
  })
})

describe('the settings and routes docs/UPGRADING.md names', () => {
  it('are documented: every setting in .env.example, every route in docs/API.md', () => {
    const settings = new Set(
      [...page.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?:=[^`]*)?`/g)].map((m) => m[1] ?? ''),
    )
    const routes = new Set([...page.matchAll(/`GET (\/api\/[\w/]+)`/g)].map((m) => m[1] ?? ''))

    expect(settings.size, 'settings named').toBeGreaterThan(0)
    for (const name of settings)
      expect(read('.env.example'), name).toMatch(new RegExp(`^#? ?${name}=`, 'm'))

    expect([...routes]).toEqual(expect.arrayContaining(['/api/health', '/api/ready']))
    for (const route of routes) {
      expect(read('docs', 'API.md'), route).toContain('### `GET ' + route + '`')
    }
  })
})

/** GitHub's anchor for a heading: lower case, no punctuation, hyphens for spaces. */
const anchorOf = (heading: string): string =>
  heading
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

const anchorsIn = (file: string): readonly string[] =>
  [...read(file).matchAll(/^#{1,6} (.+)$/gm)].map((match) => anchorOf(match[1] ?? ''))

describe('the links of CHANGELOG.md', () => {
  // The 3.0.0 entry sends the reader to `docs/UPGRADING.md#upgrading-to-30`, and that anchor is
  // the one thing in the CHANGELOG that goes dead when the heading is renamed.
  const links = [...read('CHANGELOG.md').matchAll(/\]\((?!https?:|mailto:)([^)\s]+)\)/g)].map(
    (match) => match[1] ?? '',
  )

  it('go to files that exist, and to headings that exist in them', () => {
    expect(links, 'the link to the upgrade section of the major').toContain(
      'docs/UPGRADING.md#upgrading-to-30',
    )
    for (const link of links) {
      const [path = '', anchor] = link.split('#')
      const target = path === '' ? 'CHANGELOG.md' : path

      expect(existsSync(resolve(ROOT, target)), link).toBe(true)
      if (anchor !== undefined) {
        expect(anchorsIn(target), `${link}: a heading of ${target}`).toContain(anchor)
      }
    }
  })
})

describe('the links of docs/UPGRADING.md', () => {
  const links = [...page.matchAll(/\]\((?!https?:|mailto:)([^)\s]+)\)/g)].map(
    (match) => match[1] ?? '',
  )

  it('go to files that exist, and to headings that exist in them', () => {
    expect(links.length, 'relative links on the page').toBeGreaterThan(0)
    for (const link of links) {
      const [path = '', anchor] = link.split('#')
      const target = path === '' ? PAGE : join('docs', path)
      const file = resolve(ROOT, target)

      expect(existsSync(file), link).toBe(true)
      if (anchor !== undefined) {
        expect(anchorsIn(target), `${link}: a heading of ${target}`).toContain(anchor)
      }
    }
  })

  it('reach the backups guide, the CHANGELOG and the API contract', () => {
    expect(links).toContain('OPERATING.md#backups')
    expect(links).toContain('../CHANGELOG.md')
    expect(links).toContain('API.md')
  })
})

describe('the places that must point at docs/UPGRADING.md', () => {
  it.each(['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md'])('%s links it', (file) => {
    expect(read(file)).toContain('(docs/UPGRADING.md)')
  })
})

describe('a setting that was documented and is read by nothing (docs/UPGRADING.md, the deprecation policy)', () => {
  // A documented setting is removed in a major, and only after a deprecation: marked
  // `### Deprecated` in the CHANGELOG and, where the code can, a warning logged when it is
  // used. `GUEST_SELF_DELETE_GRACE_SECONDS` was validated and mapped into the config and read by
  // nothing (the grace is a setting of each event), so it is kept parsing and warned about
  // instead of being deleted outright. Nothing else says that the three agree.
  const NAME = 'GUEST_SELF_DELETE_GRACE_SECONDS'
  const deprecated = entry.slice(entry.indexOf('### Deprecated'))

  it('is listed under Deprecated in the 3.0.0 entry, before the next heading', () => {
    expect(entry).toContain('### Deprecated')
    expect(deprecated.slice(0, deprecated.indexOf('\n### Added'))).toContain(`\`${NAME}\``)
  })

  it('is named on the upgrade page, as a setting to remove', () => {
    expect(section).toContain(NAME)
  })

  it('is warned about at boot by the code that still validates it', () => {
    const env = configSource()

    expect(env).toContain(`${NAME}: positiveInt(`)
    expect(env).toContain(`${NAME} is deprecated and does nothing`)
  })

  it('names the same release for its removal in the warning and in the entry', () => {
    // Four places carry the version; an operator who reads one must not be told another.
    const env = configSource()

    expect(env).toContain('it will be removed in 4.0.0')
    expect(flat(deprecated)).toContain('removed in 4.0.0')
    expect(read('.env.example')).toContain('Removed in 4.0.0')
  })

  it('is no longer an active line of .env.example, which a host copies', () => {
    // A copied line would set it, and the boot would warn about a setting the operator never chose.
    expect(read('.env.example')).not.toMatch(new RegExp(`^${NAME}=`, 'm'))
  })
})

describe('every setting the configuration declares that 2.1.0 did not (docs/UPGRADING.md, the upgrade policy)', () => {
  // An operator learns what a major adds from two places: the 3.0.0 entry, whose BREAKING list says
  // what each new setting accepts and refuses, and the order "Upgrading to 3.0" gives. A setting
  // added and written in neither is one a box can set, or inherit from its environment, without
  // anything having said so. `OPERATOR_RESET_LINKS` was in neither on the day this was written,
  // and nothing noticed, because the two lists are prose and `envDocs.test.ts` only reads
  // `.env.example`.

  /** The variables `buildSchema` declared at 2.1.0 (the commit `gpl-final` names), the host's own included. */
  const SETTINGS_OF_2_1_0: ReadonlySet<string> = new Set([
    'ALLOW_CUSTOM_SLUGS',
    'BACKUP_DIR',
    'BCRYPT_COST',
    'BOOTSTRAP_OWNER_EMAIL',
    'BOOTSTRAP_OWNER_PASSWORD',
    'CLIP_MAX_HEIGHT',
    'DATABASE_PATH',
    'DEFAULT_EVENT_QUOTA_BYTES',
    'E2E_HOOKS',
    'EVENT_CREATION_RATE_LIMIT_PER_HOUR',
    'EVENT_SLUG_SUFFIX',
    'FFMPEG_PATH',
    'FFPROBE_PATH',
    'GALLERY_MEDIA_RATE_LIMIT_PER_MINUTE',
    'GALLERY_RATE_LIMIT_PER_MINUTE',
    'GALLERY_UNLOCK_ATTEMPTS_PER_CLIENT',
    'GALLERY_UNLOCK_ATTEMPTS_PER_LINK',
    'GUEST_SELF_DELETE_GRACE_SECONDS',
    'GUEST_TOKEN_SECRET',
    'JOIN_CODE_LENGTH',
    'JOIN_RATE_LIMIT_PER_MINUTE',
    'LOGIN_RATE_LIMIT_PER_MINUTE',
    'LOG_LEVEL',
    'MAX_CLIP_BYTES',
    'MAX_CLIP_PIXELS',
    'MAX_CLIP_SECONDS',
    'MAX_EVENT_QUOTA_BYTES',
    'MAX_FILES_PER_UPLOAD',
    'MAX_IMAGE_PIXELS',
    'MAX_QUEUED_CLIPS',
    'MAX_UPLOAD_BYTES',
    'MEDIA_ROOT',
    'NODE_ENV',
    'PATH',
    'PATHEXT',
    'PORT',
    'PUBLIC_URL',
    'REACTION_RATE_LIMIT_PER_MINUTE',
    'RETENTION_SWEEP_INTERVAL_MINUTES',
    'SCHEDULE_SWEEP_INTERVAL_MINUTES',
    'SESSION_COOKIE_SECURE',
    'SESSION_SECRET',
    'SITE_ADMIN',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'TRUST_PROXY_HOPS',
    'UPLOAD_RATE_LIMIT_PER_MINUTE',
    'WINDIR',
  ])

  /** Read off the schema's own source, as `envDocs.test.ts` does: six spaces, two levels in. */
  const declared = [...configSource().matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map(
    (match) => match[1] ?? '',
  )
  const added = declared.filter((name) => !SETTINGS_OF_2_1_0.has(name))

  /** What the entries newer than 3.0.0 say: a setting a later release adds is announced there. */
  // From the first entry's heading, not from the top of the file: the introduction names no setting
  // as announced, and a name mentioned there would exempt a setting nobody announced.
  const changelog = read('CHANGELOG.md')
  const laterEntries = changelog.slice(
    changelog.search(/^## \[/m),
    changelog.search(/^## \[3\.0\.0\]/m),
  )

  /** `name` as a whole word: `NEW_CLIENT_MAX_EVENTS` is not found inside `..._PER_PERIOD`. */
  const names = (text: string, name: string): boolean =>
    new RegExp(`(?<![A-Z0-9_])${name}(?![A-Z0-9_])`).test(text)

  it('are read off the schema, or the check below would pass for the wrong reason', () => {
    expect(declared.length, 'variables declared by the configuration').toBeGreaterThan(
      SETTINGS_OF_2_1_0.size,
    )
    expect(added.length, 'variables added since 2.1.0').toBeGreaterThanOrEqual(34)
    expect(added).toContain('OPERATOR_RESET_LINKS')
    // A name of 2.1.0 that the schema stopped declaring would hide behind this list for good.
    for (const name of SETTINGS_OF_2_1_0) expect(declared, name).toContain(name)
  })

  it.each(added)(
    '%s is named in the 3.0.0 entry and in "Upgrading to 3.0", or by a later one',
    (name) => {
      if (names(laterEntries, name)) return

      expect(names(entry, name), `${name} in the 3.0.0 entry`).toBe(true)
      expect(names(section, name), `${name} in the "Upgrading to 3.0" section`).toBe(true)
    },
  )
})

describe('the routes the 3.0.0 entry and "Upgrading to 3.0" name', () => {
  // The page and the entry send an operator, or a script, to a method and a path. One that
  // docs/API.md does not carry is one nobody can look up: a typo, a route renamed in the
  // contract, or one that was dropped. The check above reads `GET` on the page only.
  const routes = [
    ...new Set(
      [...(section + entry).matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/api\/[\w/:.-]+)`/g)].map(
        (match) => `${match[1]} ${match[2]}`,
      ),
    ),
  ]

  it('are read from the text, or this checks nothing', () => {
    expect(routes.length, 'routes named').toBeGreaterThan(15)
  })

  it('are all in docs/API.md, spelled as it spells them', () => {
    const api = read('docs', 'API.md')

    // With the closing backtick: `POST /api/auth/password` is a prefix of the route that resets one.
    for (const route of routes) expect(api, route).toContain(`\`${route}\``)
  })
})
