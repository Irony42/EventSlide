import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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

/** A source file as one string, with the seams of `'a' + 'b'` closed so a phrase can be found. */
const source = (...segments: string[]): string => read(...segments).replace(/`\s*\+\s*`/g, '')

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

  it('build the image from the checked-out tag only while compose.yaml builds it', () => {
    // When compose.yaml points at a published image instead, `--build` does nothing and the
    // step that says "build" is wrong: this fails then, and the page is rewritten with it.
    expect(page).toContain('docker compose up -d --build')
    expect(read('compose.yaml')).toMatch(/^ {4}build: \./m)
    expect(prose).toContain('no prebuilt image is published')
  })

  it('say no prebuilt image is published only while no workflow publishes one', () => {
    const workflows = readdirSync(join(ROOT, '.github', 'workflows')).filter((file) =>
      /.ya?ml$/.test(file),
    )

    expect(workflows.length, 'workflows').toBeGreaterThan(0)
    for (const file of workflows) {
      const text = read('.github', 'workflows', file)
      expect(text, `${file} pushes an image`).not.toMatch(/build-push-action|ghcr.io|docker push/)
    }
  })
})

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
    const env = source('src', 'infrastructure', 'config', 'env.ts')

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
    const ids = [
      ...new Set(
        [
          ...read('src', 'infrastructure', 'db', 'migrations', 'index.ts').matchAll(
            /migration(\d{3})\b/g,
          ),
        ].map((match) => Number(match[1])),
      ),
    ].filter((id) => id > LAST_MIGRATION_OF_2_1_0)

    expect(ids.length, 'migrations after 007').toBeGreaterThan(0)
    for (const id of ids) {
      const padded = String(id).padStart(3, '0')
      expect(section, `${padded} in the 3.0 section`).toContain(padded)
      expect(entry, `${padded} in the 3.0.0 entry`).toContain(padded)
    }
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

  it('reach the README, the CHANGELOG and the API contract', () => {
    expect(links).toContain('../README.md#backups')
    expect(links).toContain('../CHANGELOG.md')
    expect(links).toContain('API.md')
  })
})

describe('the places that must point at docs/UPGRADING.md', () => {
  it.each(['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md'])('%s links it', (file) => {
    expect(read(file)).toContain('(docs/UPGRADING.md)')
  })
})
