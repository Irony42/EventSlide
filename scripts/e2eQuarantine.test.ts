import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The `@quarantine` policy, as `playwright.config.ts` and `.github/workflows/ci.yml` carry it.
 *
 * A quarantined test is excluded from every gating project and selected, alone, by a run with
 * `E2E_QUARANTINE=only` (the non-blocking `quarantine` job). Two things would silently break the
 * promise: a project that does not carry the exclusion (its gate then fails on a known flake),
 * and a project whose own `grep` replaces the exclusion instead of adding to it (Playwright takes
 * a project's `grep` over the top-level one, so `firefox-desktop`'s `@smoke` filter would have
 * let a quarantined smoke test through). So this loads the real config under both modes and
 * asks each project what it selects.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')

interface Project {
  readonly name: string
  readonly grep?: RegExp | readonly RegExp[]
  readonly grepInvert?: RegExp | readonly RegExp[]
}

async function projectsUnder(mode: 'gating' | 'only', ci = false): Promise<Project[]> {
  vi.resetModules()
  if (mode === 'only') vi.stubEnv('E2E_QUARANTINE', 'only')
  else vi.stubEnv('E2E_QUARANTINE', '')
  vi.stubEnv('CI', ci ? '1' : '')
  const config = (await import('../playwright.config')).default
  return (config.projects ?? []) as Project[]
}

const all = (value: RegExp | readonly RegExp[] | undefined): RegExp[] =>
  value === undefined ? [] : Array.isArray(value) ? [...value] : [value as RegExp]

/** What Playwright does: a title is selected when it matches grep and does not match grepInvert. */
const selects = (project: Project, title: string): boolean => {
  const grep = all(project.grep)
  const invert = all(project.grepInvert)
  return (
    (grep.length === 0 || grep.some((re) => re.test(title))) && !invert.some((re) => re.test(title))
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('playwright.config.ts quarantine selection', () => {
  it('leaves a quarantined test out of every gating project and keeps the others', async () => {
    const projects = await projectsUnder('gating')
    expect(projects.length).toBeGreaterThan(0)
    for (const project of projects) {
      expect(selects(project, 'a journey @quarantine'), project.name).toBe(false)
      expect(selects(project, 'a journey @smoke @quarantine'), project.name).toBe(false)
      // A journey project selects an untagged test; firefox-desktop only runs @smoke ones.
      const plain = project.name === 'firefox-desktop' ? 'a journey @smoke' : 'a journey'
      expect(selects(project, plain), project.name).toBe(true)
    }
  })

  it('selects only quarantined tests under E2E_QUARANTINE=only, in every project', async () => {
    const projects = await projectsUnder('only')
    for (const project of projects) {
      expect(selects(project, 'a journey'), project.name).toBe(false)
      const quarantined =
        project.name === 'firefox-desktop'
          ? 'a journey @smoke @quarantine'
          : 'a journey @quarantine'
      expect(selects(project, quarantined), project.name).toBe(true)
    }
  })

  it('keeps firefox-desktop to the smoke subset in both modes', async () => {
    for (const mode of ['gating', 'only'] as const) {
      const firefox = (await projectsUnder(mode)).find((p) => p.name === 'firefox-desktop')
      expect(firefox, mode).toBeDefined()
      expect(selects(firefox as Project, 'a journey @quarantine'), mode).toBe(false)
    }
  })

  it('writes a JSON report in CI, for the flake-rate job, and not locally', async () => {
    vi.resetModules()
    vi.stubEnv('E2E_QUARANTINE', '')
    vi.stubEnv('CI', '1')
    const inCi = (await import('../playwright.config')).default.reporter as unknown[][]
    expect(inCi.map((reporter) => reporter[0])).toContain('json')

    vi.resetModules()
    vi.stubEnv('CI', '')
    const local = (await import('../playwright.config')).default.reporter as unknown[][]
    expect(local.map((reporter) => reporter[0])).not.toContain('json')
  })
})

describe('ci.yml quarantine wiring', () => {
  const job = (name: string): string => {
    const start = workflow.indexOf(`\n  ${name}:\n`)
    expect(start, `job ${name}`).toBeGreaterThan(-1)
    const rest = workflow.slice(start + 1)
    const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/)
    return next < 0 ? rest : rest.slice(0, next + 1)
  }

  it('runs the quarantine job on its own, without ever blocking', () => {
    const quarantine = job('quarantine')
    expect(quarantine).toContain('continue-on-error: true')
    expect(quarantine).toContain('E2E_QUARANTINE: only')
    expect(quarantine).not.toMatch(/^\s+if: always\(\)\s*$/m)
  })

  it('never sets the quarantine mode on a gating job', () => {
    for (const name of ['e2e-shard', 'e2e', 'repeat-changed-specs']) {
      expect(job(name), name).not.toContain('E2E_QUARANTINE')
    }
  })

  it('keeps every e2e shard uploading its JSON report, whatever the outcome', () => {
    const shard = job('e2e-shard')
    expect(shard).toContain('playwright-json/')
    expect(shard).toContain('scripts/flakeRate.ts')
  })

  it('repeats the changed specs five times with no retry, on a pull request only', () => {
    const repeat = job('repeat-changed-specs')
    expect(repeat).toContain("github.event_name == 'pull_request'")
    expect(repeat).toContain('--repeat-each=5')
    expect(repeat).toContain('--retries=0')
    expect(repeat).toContain('scripts/changedSpecs.ts')
  })

  it('does not make the repeat or quarantine jobs required by naming them like a gate', () => {
    for (const name of ['quarantine', 'repeat-changed-specs']) {
      expect(job(name)).not.toMatch(/^\s+name: End-to-end \(/m)
    }
  })
})
