import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseWorkflow, valueAt, type YamlMap, type YamlValue } from './workflowYaml'

/**
 * The edge image (`.github/workflows/edge.yml`): every commit on main, built for a staging box.
 *
 * It is the one workflow that pushes on a merge, so what it may push is held here as tightly as
 * release.yml's "merging publishes nothing" is held in releasePipeline.test.ts. The product
 * image, `ghcr.io/irony42/eventslide`, is reached only by a release; this workflow names a
 * different package and only `main` / `main-<sha>` tags in it, never a version a user could
 * mistake for a release.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEXT = readFileSync(join(ROOT, '.github', 'workflows', 'edge.yml'), 'utf8')
const edge = parseWorkflow(TEXT)

const EDGE_IMAGE = 'ghcr.io/irony42/eventslide-edge'

const isMap = (value: YamlValue | undefined): value is YamlMap =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const mapAt = (root: YamlValue | undefined, ...path: string[]): YamlMap => {
  const found = valueAt(root, ...path)
  if (!isMap(found)) throw new Error(`${path.join('.')} is not a mapping`)
  return found
}

const job = mapAt(edge, 'jobs', 'edge')

const steps = (): readonly YamlMap[] => {
  const list = job['steps']
  if (!Array.isArray(list)) throw new Error('the edge job has no steps')
  return list.filter(isMap)
}

const build = (): YamlMap => {
  const found = steps().find((step) => step['id'] === 'build')
  if (found === undefined) throw new Error('no build step')
  return mapAt(found, 'with')
}

/** The file without its comment lines, so that prose cannot satisfy or break a check. */
const code = TEXT.split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

describe('the edge image workflow', () => {
  it('runs on a push to main and by hand, never on a tag, a pull request or a schedule', () => {
    expect(Object.keys(mapAt(edge, 'on')).sort()).toEqual(['push', 'workflow_dispatch'])
    expect(mapAt(edge, 'on', 'push')).toEqual({ branches: ['main'] })
  })

  it('publishes nothing from a manual run on another branch', () => {
    expect(job['if']).toBe("github.ref == 'refs/heads/main'")
  })

  it('names only the edge package, never the product image a release publishes', () => {
    const names = [...code.matchAll(/ghcr\.io\/[\w./-]+/g)].map((match) => match[0])

    expect(names).toEqual([EDGE_IMAGE])
    expect(mapAt(edge, 'env')['EDGE_IMAGE']).toBe(EDGE_IMAGE)
  })

  it('pushes only the main and main-<sha> tags, never a version', () => {
    const tags = String(build()['tags'])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')

    expect(tags).toEqual([
      '${{ env.EDGE_IMAGE }}:main',
      '${{ env.EDGE_IMAGE }}:main-${{ github.sha }}',
    ])
  })

  it('bakes in the commit it was built from, so /api/about offers that exact source', () => {
    expect(String(build()['build-args']).trim()).toBe('SOURCE_REF=${{ github.sha }}')
  })

  it('builds linux/amd64 only, the platform of the staging box, and pushes from one step', () => {
    expect(build()['platforms']).toBe('linux/amd64')
    expect(
      steps().filter((step) => isMap(step['with']) && step['with']['push'] === 'true'),
    ).toHaveLength(1)
  })

  it('keeps one build per ref at a time and never cancels one between its push and its signature', () => {
    // A cancel after the push leaves `main` unsigned; a group shared with other refs would let
    // a manual run from a branch, skipped by the job's `if`, cancel a build of main.
    expect(mapAt(edge, 'concurrency')['cancel-in-progress']).toBe('false')
    expect(mapAt(edge, 'concurrency')['group']).toBe('edge-image-${{ github.ref }}')
  })

  it('signs the digest it pushed, never a tag', () => {
    const sign = steps().find((step) => step['name'] === 'Sign the digest')

    expect(sign?.['run']).toBe('cosign sign --yes "$IMAGE_REF"')
    expect(mapAt(sign, 'env')['IMAGE_REF']).toBe(
      '${{ env.EDGE_IMAGE }}@${{ steps.build.outputs.digest }}',
    )
  })

  it('gives its one job the registry and a signing token, and nothing to write in the repository', () => {
    expect(edge['permissions']).toEqual({})
    expect(Object.keys(mapAt(edge, 'jobs'))).toEqual(['edge'])
    expect(job['permissions']).toEqual({
      contents: 'read',
      packages: 'write',
      'id-token': 'write',
    })
  })
})
