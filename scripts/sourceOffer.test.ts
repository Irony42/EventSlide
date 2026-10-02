import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The files that carry the AGPL section 13 source offer into a deployment, held to what
 * the code does with them (roadmap G1-04 / P1-05, P1-06).
 *
 * None of these is reachable from a test ring: a Dockerfile `ARG` declared on the wrong
 * stage builds fine and quietly offers the wrong source, a compose variable nobody passes
 * through is a setting that cannot be set, and a documented field that the DTO dropped is
 * a contract nobody reads until a client breaks on it. `scripts/verify-image.sh` proves
 * what the built image does; this proves the declarations that make it possible. It is the
 * `eventslide-mutation` skill's "Documentation" rule as a standing guard: if a document
 * names a variable, a route or a field, check that it exists.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

/** Lines that are code: no blank lines, no whole-line comments. */
const codeLines = (text: string): readonly string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

/** One stage of the Dockerfile, from its `FROM` to the next. */
const stage = (name: string): readonly string[] => {
  const lines = codeLines(read('Dockerfile'))
  const start = lines.findIndex((line) => new RegExp(`^FROM .* AS ${name}$`).test(line))
  if (start === -1) throw new Error(`no Dockerfile stage named ${name}`)
  const next = lines.findIndex((line, index) => index > start && line.startsWith('FROM '))
  return lines.slice(start, next === -1 ? undefined : next)
}

describe('the Dockerfile’s SOURCE_REF', () => {
  it('is declared on the build stage, ahead of COPY, so a different ref is a different bundle', () => {
    // Vite reads it while building (`web/buildInfo.ts`), and the layers after it must not
    // come from the cache when it changes.
    const build = stage('build')

    const arg = build.indexOf('ARG SOURCE_REF=""')
    const copy = build.indexOf('COPY . .')

    expect(arg, 'ARG SOURCE_REF="" on the build stage').toBeGreaterThanOrEqual(0)
    expect(copy, 'COPY . . on the build stage').toBeGreaterThan(arg)
  })

  it('is declared again on the runtime stage and exported, because an ARG does not cross stages', () => {
    // One declaration would reach the bundle and not the server: the footer would show
    // the build's ref for a moment and `GET /api/about` would then replace it with the
    // upstream tag of the version.
    const runtime = stage('runtime')

    expect(runtime).toContain('ARG SOURCE_REF=""')
    expect(runtime).toContain('ENV SOURCE_REF=$SOURCE_REF')
  })

  it('defaults to empty, which the server reads as not set', () => {
    for (const name of ['build', 'runtime']) {
      expect(stage(name).filter((line) => line.startsWith('ARG SOURCE_REF'))).toEqual([
        'ARG SOURCE_REF=""',
      ])
    }
  })
})

describe('the deployment files', () => {
  it('compose.yaml passes SOURCE_CODE_URL through, blank when unset', () => {
    // `:-` renders an empty string, which `env.ts` reads as absent: the ordinary
    // `docker compose up` must not be refused for a variable nobody set.
    expect(codeLines(read('compose.yaml'))).toContain('SOURCE_CODE_URL: ${SOURCE_CODE_URL:-}')
  })

  it('.env.example documents SOURCE_CODE_URL and SOURCE_REF, and sets neither', () => {
    // Commented out: the default is right for the published image, so a copied
    // `.env.example` must not pin a placeholder address as the offer.
    const example = read('.env.example')
    const lines = example.split('\n')

    expect(example).toContain('# SOURCE_CODE_URL=https://')
    expect(example).toContain('SOURCE_REF')
    expect(lines.filter((line) => /^(SOURCE_CODE_URL|SOURCE_REF)=/.test(line))).toEqual([])
  })

  it('.env.example says the link cannot be hidden', () => {
    // The comment wraps, so read it as prose rather than as lines.
    const prose = read('.env.example').replace(/\n#\s*/g, ' ')

    expect(prose).toContain('There is no setting that removes it')
  })
})

describe('docs/API.md', () => {
  const api = read('docs', 'API.md')
  const section = (): string => {
    const start = api.indexOf('### `GET /api/about`')
    if (start === -1) return ''
    const end = api.indexOf('\n### ', start + 1)
    return api.slice(start, end === -1 ? undefined : end)
  }

  it('documents GET /api/about in §2', () => {
    expect(section(), 'a "### `GET /api/about`" section').not.toBe('')
  })

  it.each(['name', 'version', 'license', 'sourceUrl', 'links', 'features.siteAdmin'])(
    'documents the %s field',
    (field) => {
      expect(section()).toContain(`\`${field}\``)
    },
  )

  it('documents the three ways the source address is chosen, and that there is no switch', () => {
    const text = section()

    expect(text).toContain('SOURCE_CODE_URL')
    expect(text).toContain('SOURCE_REF')
    expect(text).toContain('/tree/v<version>')
    expect(text).toMatch(/no switch/i)
  })

  it('says SOURCE_REF is only for an unmodified upstream tag or commit, and in .env.example too', () => {
    // SOURCE_REF always points into the upstream repository, so for a modified build it
    // would offer code that lacks the modification — a false section 13 offer. The one
    // sentence that stops an operator reaching for it is worth pinning.
    expect(section().replace(/\s+/g, ' ')).toContain(
      'is only for an **unmodified upstream** tag or commit',
    )
    expect(read('.env.example').replace(/\n#\s*/g, ' ')).toContain(
      'only for an UNMODIFIED upstream tag or commit',
    )
  })

  it('says a modified or untagged deployment must set SOURCE_CODE_URL', () => {
    expect(section().replace(/\s+/g, ' ')).toMatch(/must\*\* set `SOURCE_CODE_URL`/)
  })
})
