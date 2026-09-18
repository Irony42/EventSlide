import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `.github/dependabot.yml`, asserted rather than described.
 *
 * The file spent its whole life so far declaring `package-ecosystem: node`, which is
 * not a name Dependabot has — the one for a `package.json` tree is `npm`. Nothing said
 * so. There is no error, no warning and no failing job for an ecosystem that does not
 * exist; the block is simply skipped, and the repository looks configured while
 * scheduling nothing. It read as working because Dependabot's *other* engine, security
 * updates, was opening pull requests all along from the alert list, which never consults
 * this file at all.
 *
 * That is the same shape as the trap CLAUDE.md §9 records about a tsconfig `include`
 * matching nothing, and it gets the same answer: name the thing in something that fails.
 * These three tests are the guard. A typo in the ecosystem, a deleted npm entry, or a
 * group quietly extended to swallow security updates each fail here, by name.
 *
 * Parsed by hand because this repository has no YAML dependency and adding one to read a
 * fifty-line config would cost more than it protects. The file is small, flat and
 * hand-written; a line scan is enough, and it is honest about being one.
 */

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'dependabot.yml')

/**
 * The ecosystems Dependabot documents. If GitHub adds one and this list has not caught
 * up, the failure names the value it rejected and the fix is to add it here — which is a
 * far better failure than the silence this test exists to end.
 *
 * https://docs.github.com/code-security/reference/supported-ecosystems-and-repositories
 */
const SUPPORTED_ECOSYSTEMS = [
  'bun',
  'bundler',
  'cargo',
  'composer',
  'devcontainers',
  'docker',
  'docker-compose',
  'dotnet-sdk',
  'elm',
  'gitsubmodule',
  'github-actions',
  'gomod',
  'gradle',
  'helm',
  'maven',
  'mix',
  'npm',
  'nuget',
  'pip',
  'pub',
  'rust-toolchain',
  'swift',
  'terraform',
  'uv',
  'vcpkg',
]

const unquote = (value: string): string => value.trim().replace(/^['"]|['"]$/g, '')

/** Every value given for `key`, with comment lines ignored so prose cannot match. */
const valuesOf = (key: string, yaml: string): string[] =>
  yaml
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .map((line) => new RegExp(`^[\\s-]*${key}:(.*)$`).exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => unquote(match[1] ?? ''))

describe('.github/dependabot.yml', () => {
  const yaml = readFileSync(CONFIG_PATH, 'utf8')

  it('names only ecosystems Dependabot has, so a typo cannot make the schedule inert', () => {
    const declared = valuesOf('package-ecosystem', yaml)

    expect(declared.length).toBeGreaterThan(0)
    for (const ecosystem of declared) {
      expect(SUPPORTED_ECOSYSTEMS, `package-ecosystem: ${ecosystem}`).toContain(ecosystem)
    }
  })

  it('still schedules the npm tree at the repository root', () => {
    expect(valuesOf('package-ecosystem', yaml)).toContain('npm')
    expect(valuesOf('directory', yaml)).toContain('/')
  })

  it('leaves security updates ungrouped, so one advisory stays one pull request', () => {
    // Grouping them would mean a single red member holding every other fix in the batch,
    // which is the opposite of what a security pull request is for.
    expect(valuesOf('applies-to', yaml)).not.toContain('security-updates')
  })

  it('keeps vite out of the development group, where a minor hides a bundler swap', () => {
    // vite 8.0.16 -> 8.3.0 moves rolldown from 1.0.0-rc.17 to 1.2.9. That is an engine
    // change arriving on a *minor*, which `update-types: ['minor', 'patch']` cannot tell
    // from a patch, so the group would carry the exact bump #46 declined with reasons.
    // Excluded rather than ignored: it still gets a pull request, just its own.
    expect(valuesOf('exclude-patterns', yaml).join(' ')).toContain('vite')
  })

  it('holds @types/node below 25, because types describe the runtime that executes', () => {
    // The runtime is Node 22 in CI and in the image. Types ahead of it make the compiler
    // believe in APIs that are not there — a green typecheck for code that throws at a
    // wedding. The day the runtime moves, this pin moves with it and this test says so.
    const ignored = yaml
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')

    expect(ignored).toContain('@types/node')
    expect(valuesOf('versions', ignored).join(' ')).toContain('>=25')
  })
})
