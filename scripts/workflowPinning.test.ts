import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseWorkflow, valueAt, type YamlMap, type YamlValue } from './workflowYaml'

/**
 * What every workflow of this repository is held to (roadmap G3-08 / P4-08): its actions are
 * pinned to a commit, and it says what its token may do.
 *
 * A tag such as `actions/checkout@v4` is a pointer its owner can move, and every job of this
 * repository runs with a token that can read the code. An action that has been moved, or
 * taken over, runs with it. A full commit SHA is the only reference that cannot be moved; the
 * `# vX.Y.Z` after it is what a human (and Dependabot, `package-ecosystem: github-actions`)
 * reads to know which release it is.
 *
 * `ci.yml` predated the rule and was the one exception (SEC-03); it is pinned and read-only now,
 * and `LEGACY` is empty. A workflow added later that is not yet pinned would be named there, so
 * that the exception is a line in a test rather than a thing nobody remembers.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOWS = join(ROOT, '.github', 'workflows')

/** Workflows written before the rule, still on tags and on the repository's default token. */
const LEGACY: ReadonlySet<string> = new Set<string>()

/** A line break, spelled once so that a regular expression above never has to. */
const NL = String.fromCharCode(10)

const files = readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file))
const text = (file: string): string => readFileSync(join(WORKFLOWS, file), 'utf8')
const current = files.filter((file) => !LEGACY.has(file))

interface Use {
  readonly reference: string
  readonly comment: string
}

/** Every `uses:` of a workflow, from the text, so that ci.yml (which the reader refuses) is covered. */
const usesOf = (file: string): readonly Use[] =>
  text(file)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .flatMap((line) => {
      const match = /^\s*(?:-\s+)?uses:\s*(\S+)(?:\s+#\s*(.*))?$/.exec(line)
      return match === null ? [] : [{ reference: match[1] ?? '', comment: (match[2] ?? '').trim() }]
    })

const isMap = (value: YamlValue | undefined): value is YamlMap =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every job of a workflow, by name. */
const jobsOf = (file: string): Readonly<Record<string, YamlMap>> => {
  const jobs = valueAt(parseWorkflow(text(file)), 'jobs')
  if (!isMap(jobs)) throw new Error(`${file} has no jobs`)
  return Object.fromEntries(
    Object.entries(jobs).map(([name, job]) => {
      if (!isMap(job)) throw new Error(`${file}: job ${name} is not a mapping`)
      return [name, job]
    }),
  )
}

/**
 * The `run:` scripts of a workflow, from the text, like `usesOf`: the reader refuses ci.yml (flow
 * mappings in its matrices). A script is the rest of the `run:` line, or for `run: |` the lines
 * indented deeper than the key.
 */
const scriptsOf = (file: string): readonly string[] => {
  const lines = text(file).split(NL)
  const scripts: string[] = []
  for (const [index, line] of lines.entries()) {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line)
    if (match === null || line.trimStart().startsWith('#')) continue
    const indent = (match[1] ?? '').length
    const body = [match[2] ?? '']
    if (/^[|>]/.test(body[0] ?? '')) {
      for (const next of lines.slice(index + 1)) {
        const nextIndent = next.length - next.trimStart().length
        if (next.trim() !== '' && nextIndent <= indent) break
        body.push(next)
      }
    }
    scripts.push(body.join(NL))
  }
  return scripts
}

/** The top-level `permissions:` block of a workflow, as scope -> level (`{}` is empty), or undefined. */
const topLevelPermissions = (file: string): Readonly<Record<string, string>> | undefined => {
  const lines = text(file).split(NL)
  const start = lines.findIndex((line) => /^permissions:/.test(line))
  if (start < 0) return undefined
  if (/^permissions:\s*\{\}\s*(#.*)?$/.test(lines[start] ?? '')) return {}
  // `read-all` / `write-all`: a scalar, which no scope can be read from, and never a safe default.
  const scalar = /^permissions:\s*([\w-]+)\s*(?:#.*)?$/.exec(lines[start] ?? '')
  if (scalar !== null) return { '*': scalar[1] ?? '' }
  const scopes: Record<string, string> = {}
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+([\w-]+):\s*([\w-]+)\s*(?:#.*)?$/.exec(line)
    if (match === null) break
    scopes[match[1] ?? ''] = match[2] ?? ''
  }
  return scopes
}

/** The jobs of a workflow that declare their own `permissions:` (at the job's indent), by name. */
const jobsWithPermissions = (file: string): readonly string[] => {
  const names: string[] = []
  let job = ''
  for (const line of text(file).split(NL)) {
    const header = /^ {2}([\w-]+):\s*(#.*)?$/.exec(line)
    if (header !== null) job = header[1] ?? ''
    else if (/^ {4}permissions:/.test(line)) names.push(job)
  }
  return names
}

describe('the workflows', () => {
  it('are found, so that nothing below passes by looking at an empty directory', () => {
    expect(files).toEqual(
      expect.arrayContaining(['ci.yml', 'release.yml', 'image-scan.yml', 'release-please.yml']),
    )
    expect(current.length).toBeGreaterThan(0)
  })

  it.each(current)('%s pins every action to a full commit SHA', (file) => {
    const uses = usesOf(file).filter(({ reference }) => !reference.startsWith('./'))

    expect(uses.length, `uses: in ${file}`).toBeGreaterThan(0)
    for (const { reference } of uses) {
      expect(reference, `${file}: ${reference}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/)
    }
  })

  it.each(current)('%s says which release each pinned action is', (file) => {
    for (const { reference, comment } of usesOf(file)) {
      expect(comment, `${file}: the comment after ${reference}`).toMatch(/^v\d+(\.\d+){0,2}$/)
    }
  })

  it('pin one action to one commit, whatever the workflow', () => {
    // Two workflows on two versions of the same action is two things to review and two to
    // update, and it is how a pin is left behind when Dependabot moves the other one.
    const pins = new Map<string, Set<string>>()
    for (const file of current) {
      for (const { reference, comment } of usesOf(file)) {
        const [action = '', sha = ''] = reference.split('@')
        const known = pins.get(action) ?? new Set<string>()
        known.add(`${sha} ${comment}`)
        pins.set(action, known)
      }
    }

    expect(pins.size, 'distinct actions').toBeGreaterThan(5)
    for (const [action, versions] of pins) {
      expect([...versions], `${action} is pinned to more than one commit`).toHaveLength(1)
    }
  })

  it.each(files)('every workflow declares top-level permissions: %s', (file) => {
    // Without the key a job runs with the repository's default token, which is write access
    // when the repository setting allows it. Read-only (or none) is what a workflow may default to.
    const permissions = topLevelPermissions(file)

    expect(permissions, `${file}: the workflow-level permissions`).toBeDefined()
    for (const [scope, level] of Object.entries(permissions ?? {})) {
      expect(['read', 'none'], `${file}: top-level permission ${scope}`).toContain(level)
    }
  })

  it.each(files.filter((file) => file !== 'ci.yml'))(
    '%s declares permissions: none by default, and per job what the job needs',
    (file) => {
      const workflow = parseWorkflow(text(file))

      expect(workflow['permissions'], `${file}: the workflow-level permissions`).toEqual({})
      for (const [name, job] of Object.entries(jobsOf(file))) {
        expect(isMap(job['permissions']), `${file}: job ${name} declares its own permissions`).toBe(
          true,
        )
        expect(job['permissions'], `${file}: job ${name}`).not.toEqual({})
      }
    },
  )

  it('keeps ci.yml read-only by default, with only e2e widening it (to read the jobs of the run)', () => {
    expect(topLevelPermissions('ci.yml')).toEqual({ contents: 'read' })
    expect(jobsWithPermissions('ci.yml')).toEqual(['e2e'])
    const block = /^ {4}permissions:\n((?: {6}[^\n]*\n)+)/m.exec(text('ci.yml'))
    expect(block?.[1]).toBe('      actions: read\n')
  })

  it.each(current)('%s never puts an expression inside a script', (file) => {
    // `run: echo ${{ inputs.tag }}` is the shell being handed whatever was typed into the
    // input. Everything a script reads reaches it through `env:` instead, where it is data.
    for (const script of scriptsOf(file)) {
      expect(script, `${file}: a run: script`).not.toContain('${{')
    }
  })

  it.each(current)('%s is not started by a pull request from a fork', (file) => {
    expect(text(file)).not.toMatch(/^\s*pull_request_target:/m)
  })

  it('keeps an exception only while it is one: a legacy workflow that is pinned is taken off the list', () => {
    for (const file of LEGACY) {
      const unpinned = usesOf(file).filter(({ reference }) => !/@[0-9a-f]{40}$/.test(reference))

      expect(
        unpinned.length,
        `${file} has no unpinned action left: remove it from LEGACY, so that the rule covers it from now on`,
      ).toBeGreaterThan(0)
    }
  })
})
