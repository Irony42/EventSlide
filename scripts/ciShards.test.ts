import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The end-to-end matrices of `.github/workflows/ci.yml` agree with each other and with
 * `playwright.config.ts`.
 *
 * `e2e-shard` runs the shards; `e2e` is the required check that answers for them and carries the
 * shard count it expects to hear from. If the two drift, or a project is added to the Playwright
 * config and to neither matrix, a project is ungated without anything turning red. This reads the
 * workflow as text (one flow-style `- { project: ..., shard: i, shards: n ... }` line per entry:
 * the repository carries no YAML parser, and the shape is the one the file documents).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const config = readFileSync(join(root, 'playwright.config.ts'), 'utf8')

interface Entry {
  readonly project: string
  readonly shard: number | undefined
  readonly shards: number
}

/** The matrix entries between the line starting `  <job>:` and the next job. */
function entriesOf(source: string, job: string): Entry[] {
  const start = source.indexOf(`\n  ${job}:\n`)
  if (start < 0) throw new Error(`no job ${job}`)
  const rest = source.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/)
  const body = next < 0 ? rest : rest.slice(0, next + 1)
  return [...body.matchAll(/^\s*- \{ (.*) \}\s*$/gm)].map((match) => {
    const fields = Object.fromEntries(
      (match[1] ?? '').split(',').map((pair) => pair.split(':').map((part) => part.trim())),
    ) as Record<string, string>
    return {
      project: fields['project'] ?? '',
      shard: fields['shard'] === undefined ? undefined : Number(fields['shard']),
      shards: Number(fields['shards']),
    }
  })
}

function shardCounts(source: string): Map<string, number> {
  const counts = new Map<string, number>()
  const seen = new Map<string, number[]>()
  for (const entry of entriesOf(source, 'e2e-shard')) {
    seen.set(entry.project, [...(seen.get(entry.project) ?? []), entry.shard ?? 0])
    counts.set(entry.project, entry.shards)
  }
  for (const [project, shards] of seen) {
    const expected = Array.from({ length: counts.get(project) ?? 0 }, (_, i) => i + 1)
    expect(shards.sort(), `${project}: shards numbered 1..n, each once`).toEqual(expected)
  }
  return counts
}

describe('ci.yml end-to-end matrices', () => {
  it('lists the same projects with the same shard counts in the shard job and the gate job', () => {
    const gate = new Map(entriesOf(workflow, 'e2e').map((entry) => [entry.project, entry.shards]))
    expect([...gate].sort()).toEqual([...shardCounts(workflow)].sort())
  })

  it('runs every project declared in playwright.config.ts', () => {
    const declared = [...config.matchAll(/^\s{6}name: '([a-z-]+)',/gm)].map((match) => match[1])
    expect(declared.length).toBeGreaterThan(0)
    expect([...shardCounts(workflow).keys()].sort()).toEqual([...declared].sort())
  })

  it('notices a gate that expects fewer shards than the job runs', () => {
    const drifted = workflow.replace(
      '{ project: webkit-mobile, shards: 4 }',
      '{ project: webkit-mobile, shards: 3 }',
    )
    expect(drifted).not.toBe(workflow)
    const gate = new Map(entriesOf(drifted, 'e2e').map((entry) => [entry.project, entry.shards]))
    expect([...gate].sort()).not.toEqual([...shardCounts(drifted)].sort())
  })
})
