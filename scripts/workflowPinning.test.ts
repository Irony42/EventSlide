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
 * `ci.yml` predates the rule, and is **not edited by the pull request that added it**: it is
 * being changed by others at the same time, and rewriting every `uses:` of a file under
 * review is how a conflict is made. It is named below, so that the exception is a line in a
 * test rather than a thing nobody remembers, and so that a new workflow is held to the rule
 * from its first commit. Pinning it, and giving it `permissions:`, is the one change left to
 * make there, and the day it is made this entry goes.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOWS = join(ROOT, '.github', 'workflows')

/** Workflows written before the rule, still on tags and on the repository's default token. */
const LEGACY: ReadonlySet<string> = new Set(['ci.yml'])

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

/** The `run:` scripts of every step of a workflow. */
const scriptsOf = (file: string): readonly string[] =>
  Object.values(jobsOf(file)).flatMap((job) => {
    const steps = job['steps']
    if (!Array.isArray(steps)) return []
    return steps.flatMap((step) => {
      const run = isMap(step) ? step['run'] : undefined
      return typeof run === 'string' ? [run] : []
    })
  })

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

  it.each(current)(
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
