import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { imageFor, playwrightVersion } from './e2eDocker'

/**
 * The end-to-end jobs of `.github/workflows/ci.yml` run in the Playwright container, and the
 * container is only worth having if it is the right one: the browsers inside it are the revisions
 * of one Playwright version, and a `package-lock.json` that moved to another leaves every job
 * failing at launch ("Executable doesn't exist") on a pull request that touches no test.
 * `container.image` cannot read an `env` variable, so the tag is written in each job and this
 * file is what keeps them equal to the lockfile (and to the local script, scripts/e2eDocker.ts).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
const lockfile = readFileSync(join(ROOT, 'package-lock.json'), 'utf8')

/** The text of one job, from its `  <name>:` line to the next job. */
function jobOf(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`)
  if (start < 0) throw new Error(`no job ${name}`)
  const rest = workflow.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-zA-Z][a-zA-Z0-9-]*:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

const CONTAINER_JOBS = ['e2e-shard', 'quarantine', 'repeat-changed-specs', 'visual']

describe('the Playwright container of the end-to-end jobs', () => {
  const expected = imageFor(playwrightVersion(lockfile))

  it('is the noble image of the exact @playwright/test version in package-lock.json, everywhere', () => {
    const images = [
      ...workflow.matchAll(/^\s*image:\s*(mcr\.microsoft\.com\/playwright\S*)\s*$/gm),
    ].map((match) => match[1])
    expect(images).toEqual(CONTAINER_JOBS.map(() => expected))
  })

  it.each(CONTAINER_JOBS)('%s runs in it with the shared-memory and HOME settings', (name) => {
    const job = jobOf(name)
    expect(job).toContain(`image: ${expected}`)
    expect(job).toMatch(/options: --ipc=host\s*$/m)
    expect(job).toMatch(/^\s+HOME: \/root\s*$/m)
  })

  it.each(CONTAINER_JOBS)(
    '%s runs its steps in bash, which a container does not default to',
    (name) => {
      // On the runner a `run:` step is `bash -e {0}`; in a container GitHub falls back to
      // `sh -e {0}`, and dash has no `mapfile`, arrays or `[[`: the repeat job died with
      // "mapfile: not found" (exit 127). `bash -e {0}` is the runner's own default, so the
      // steps keep exactly the semantics they were written for (no pipefail added).
      expect(jobOf(name)).toMatch(/^ {4}defaults:\n {6}run:\n {8}shell: bash -e \{0\}\s*$/m)
    },
  )

  it.each(CONTAINER_JOBS)(
    '%s trusts the workspace for git, which the container user does not own',
    (name) => {
      const job = jobOf(name)
      const trust = job.indexOf('git config --global --add safe.directory "$GITHUB_WORKSPACE"')
      expect(trust).toBeGreaterThan(0)
      // Before the first step that could run git (setup-node's cache key does not, the rest do).
      expect(trust).toBeLessThan(job.indexOf('actions/setup-node'))
    },
  )

  it.each(CONTAINER_JOBS)(
    '%s installs neither system packages nor a browser by project',
    (name) => {
      const job = jobOf(name)
      expect(job).not.toMatch(/install-deps|apt-get|apt\.conf|\bsudo\b|apt-archives/)
      // `playwright install` survives in one place: the visual job's guard for a merge base on
      // another Playwright version, which downloads Chromium alone and never by project name.
      const installs = [...job.matchAll(/playwright install[^\n]*/g)].map((match) => match[0])
      if (name === 'visual') {
        expect(installs.length).toBeGreaterThan(0)
        for (const install of installs) expect(install).toMatch(/^playwright install chromium( |$)/)
      } else {
        expect(installs).toEqual([])
      }
    },
  )

  it('leaves the quality, image and aggregate jobs on the runner', () => {
    for (const name of ['quality', 'image', 'e2e', 'licenseHistory']) {
      expect(jobOf(name), name).not.toContain('container:')
    }
  })
})
