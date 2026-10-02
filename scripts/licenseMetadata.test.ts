import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Guards the AGPL-3.0-only relicence, asserted rather than described.
 *
 * Every fact checked here was, at some point, one line someone could edit without
 * noticing the others: `package.json`'s `license`, the lockfile root's `license`, the
 * Dockerfile's OCI label and `LICENSE` itself are four independent places that have to say
 * the same thing, and nothing in the toolchain fails the build if one of them drifts. That
 * is the shape of the `.github/dependabot.yml` `package-ecosystem` typo this repository
 * already learned from (see `scripts/dependabotConfig.test.ts`): no error, no warning, just
 * a declaration that stops matching the grant.
 *
 * `LICENSE` is checked by git blob hash rather than by content, on purpose: a hash cannot
 * pass by accident the way a substring match can. A modified file that still contains the
 * words "GNU Affero" would pass a content check and must not pass this one.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The git blob SHA-1 of the AGPL-3.0 text byte for byte as served by
 * https://www.gnu.org/licenses/agpl-3.0.txt (34523 bytes, 661 lines). It is also the blob
 * of the `LICENSE` file in grafana/grafana.
 *
 * A second widely used blob, `0ad25db4bd1d86c452db3f9602ccdbe172438f52`, is GitHub's own
 * rendering of the AGPL-3.0, served by its licence API and by choosealicense.com. It has
 * the same 661 lines but one line of the optional "How to Apply" appendix wraps
 * differently, so it is not the Free Software Foundation's file. The README and NOTICE
 * promise the FSF's text unmodified, so that is what is pinned here: a `LICENSE` copied
 * from GitHub fails this test, deliberately.
 */
const AGPL_3_0_BLOB_SHA = 'be3f7b28e564e7dd05eaf59d64adba1a4065ac0e'

/** A git blob SHA-1, computed the same way `git hash-object` does — no git binary needed. */
const gitBlobSha1 = (contents: Buffer): string =>
  createHash('sha1').update(`blob ${contents.length}\0`).update(contents).digest('hex')

const read = (...path: string[]): string => readFileSync(join(ROOT, ...path), 'utf8')

describe('license metadata agrees everywhere it is declared', () => {
  it('ships the unmodified, canonical AGPL-3.0 text as LICENSE', () => {
    const licenseBytes = readFileSync(join(ROOT, 'LICENSE'))

    expect(gitBlobSha1(licenseBytes)).toBe(AGPL_3_0_BLOB_SHA)
  })

  it('declares AGPL-3.0-only in package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { license?: unknown }

    expect(pkg.license).toBe('AGPL-3.0-only')
  })

  it('declares AGPL-3.0-only at the package-lock.json root', () => {
    const lockfile = JSON.parse(read('package-lock.json')) as {
      packages?: Record<string, { license?: unknown }>
    }

    expect(lockfile.packages?.['']?.license).toBe('AGPL-3.0-only')
  })

  it('labels the image that is actually published, once, AGPL-3.0-only', () => {
    // Docker keeps the last LABEL with a given key, and only the final stage becomes the
    // image. A label on `deps` or `build` describes nothing anyone pulls, and a second
    // one further down would override this one without a word.
    const dockerfile = read('Dockerfile')
    const runtimeAt = dockerfile.search(/^FROM .* AS runtime$/m)
    expect(runtimeAt, 'a `FROM ... AS runtime` stage').toBeGreaterThanOrEqual(0)
    const runtime = dockerfile.slice(runtimeAt)

    expect(runtime.match(/^FROM /gm), 'runtime is the final stage').toHaveLength(1)
    expect(
      runtime
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .filter((line) => line.includes('org.opencontainers.image.licenses')),
    ).toEqual(['LABEL org.opencontainers.image.licenses=AGPL-3.0-only'])
  })

  it('ships a NOTICE that names the project, the copyright holder and the AGPL grant', () => {
    const notice = read('NOTICE').replace(/\s+/g, ' ')

    expect(notice).toContain('EventSlide')
    expect(notice).toContain('Copyright (C) 2023-2026 Pierre Tijou')
    expect(notice).toContain(
      'under the terms of the GNU Affero General Public License as published by the Free ' +
        'Software Foundation, version 3 of the License only (AGPL-3.0-only)',
    )
  })
})

/**
 * The `licenseHistory` job in `.github/workflows/ci.yml`.
 *
 * Its logic is bash inside YAML, which nothing executes locally, and a job that is green
 * while checking nothing is worse than no job. So the step's own script is extracted and
 * run here against throwaway git repositories, once per rule it states, rather than
 * grepped for the words it uses.
 */
describe('the licenseHistory CI job and its GPL boundary', () => {
  const STEP_NAME = 'Every commit since the GPL boundary carries the AGPL LICENSE'
  const ci = read('.github', 'workflows', 'ci.yml')

  /** The text of one job, whole-line comments dropped so prose cannot satisfy an assertion. */
  const jobText = (name: string): string => {
    const lines = ci.split('\n')
    const start = lines.indexOf(`  ${name}:`)
    if (start === -1) return ''
    const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line))
    return lines
      .slice(start, end === -1 ? undefined : end)
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
  }

  /**
   * The `run: |` script of the named step, dedented. A line scan, because this repository
   * has no YAML dependency and a block scalar is simple enough to read by indentation.
   */
  const stepScript = (job: string, stepName: string): string => {
    const lines = job.split('\n')
    const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`)
    const runAt = start === -1 ? -1 : lines.findIndex((l, i) => i > start && l.trim() === 'run: |')
    if (runAt === -1) return ''
    const indent = (lines[runAt] ?? '').search(/\S/) + 2
    const block: string[] = []
    for (const line of lines.slice(runAt + 1)) {
      if (line.trim() !== '' && line.search(/\S/) < indent) break
      block.push(line.slice(indent))
    }
    return block.join('\n')
  }

  const job = jobText('licenseHistory')
  const script = stepScript(job, STEP_NAME)

  it('has the job and the step whose script the rest of this file runs', () => {
    expect(job, 'licenseHistory job in ci.yml').not.toBe('')
    expect(script, `the "${STEP_NAME}" step's run script`).not.toBe('')
  })

  it('fetches the whole history, because the boundary can be arbitrarily far back', () => {
    expect(job).toMatch(/^\s+fetch-depth: 0\s*$/m)
  })

  it('stays on the default checkout ref, which is the merge commit on a pull request', () => {
    // The merge commit's first-parent chain is what main will look like after the merge.
    // Pinning the pull request head would check commits main never sees, and would turn
    // every branch cut before the relicence red for lack of the boundary file.
    expect(job).not.toMatch(/^\s+ref:/m)
  })

  it('cannot be skipped or made advisory from inside the job', () => {
    expect(job).not.toMatch(/^\s+(if|continue-on-error):/m)
  })

  it('does not depend on a gpl-final tag, which the maintainer pushes later', () => {
    expect(job).not.toContain('gpl-final')
  })

  it('compares against the same AGPL blob as LICENSE, so the two copies cannot drift', () => {
    expect(script).toMatch(new RegExp(`^agpl_blob="${AGPL_3_0_BLOB_SHA}"$`, 'm'))
  })

  it('commits one full commit SHA in .github/gpl-boundary', () => {
    expect(read('.github', 'gpl-boundary')).toMatch(/^[0-9a-f]{40}\n$/)
  })

  // The behavioural half runs the extracted script under bash with the real `git`. CI is
  // Linux and always has both. Where bash cannot run git against a Windows temp directory
  // (WSL's launcher shadowing Git Bash, say) the probe says so and the half is skipped
  // rather than reported as a failure of the job it cannot reach.
  const canRunGitUnderBash = ((): boolean => {
    const probe = mkdtempSync(join(tmpdir(), 'licensehistory-probe-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: probe })
      const result = spawnSync('bash', ['-c', 'git rev-parse --git-dir'], {
        cwd: probe,
        encoding: 'utf8',
      })
      return result.status === 0 && result.stdout.trim() === '.git'
    } catch {
      return false
    } finally {
      rmSync(probe, { recursive: true, force: true })
    }
  })()

  describe.skipIf(!canRunGitUnderBash)('running its script against a throwaway repository', () => {
    const GPL_STAND_IN = 'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n'
    const AGPL = read('LICENSE')
    let repo: string

    const git = (...args: string[]): string =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.com',
          '-c',
          'core.autocrlf=false',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: repo, encoding: 'utf8' },
      ).trim()

    /** Writes the files, commits them, and returns the new commit's SHA. */
    const commit = (message: string, files: Record<string, string>): string => {
      for (const [path, contents] of Object.entries(files)) {
        mkdirSync(dirname(join(repo, path)), { recursive: true })
        writeFileSync(join(repo, path), contents)
      }
      git('add', '-A')
      git('commit', '-q', '-m', message)
      return git('rev-parse', 'HEAD')
    }

    /** Runs the step the way Actions does: bash with -e, in the checkout. */
    const runJob = (): { status: number | null; output: string } => {
      const result = spawnSync('bash', ['-e', '-c', script], { cwd: repo, encoding: 'utf8' })
      return { status: result.status, output: `${result.stdout}${result.stderr}` }
    }

    /** A repository whose last GPL commit is returned, with `.github/gpl-boundary` not yet written. */
    const startAtBoundary = (): string => {
      git('init', '-q', '-b', 'main')
      return commit('last GPL commit', { LICENSE: GPL_STAND_IN })
    }

    beforeEach(() => {
      repo = mkdtempSync(join(tmpdir(), 'licensehistory-'))
    })

    afterEach(() => {
      rmSync(repo, { recursive: true, force: true })
    })

    it('passes when every first-parent commit after the boundary carries the AGPL LICENSE', () => {
      const boundary = startAtBoundary()
      commit('relicense', { LICENSE: AGPL, '.github/gpl-boundary': `${boundary}\n` })
      commit('later work', { 'a.txt': 'a' })

      const { status, output } = runJob()

      expect(output).toContain('All 2 first-parent commit(s)')
      expect(status).toBe(0)
    })

    it('fails, naming the commit, when one first-parent commit restores another LICENSE', () => {
      const boundary = startAtBoundary()
      commit('relicense', { LICENSE: AGPL, '.github/gpl-boundary': `${boundary}\n` })
      const regressed = commit('restore the GPL text', { LICENSE: GPL_STAND_IN })
      commit('later work', { LICENSE: AGPL })

      const { status, output } = runJob()

      expect(output).toContain(`::error::${regressed}`)
      expect(status).toBe(1)
    })

    it('fails when main moved past the boundary after it was pinned, because those commits are GPL', () => {
      const boundary = startAtBoundary()
      const movedPast = commit('another pull request, still GPL', { 'a.txt': 'a' })
      commit('relicense', { LICENSE: AGPL, '.github/gpl-boundary': `${boundary}\n` })

      const { status, output } = runJob()

      expect(output).toContain(`::error::${movedPast}`)
      expect(status).toBe(1)
    })

    it('does not look at a GPL commit that only reaches the chain through a second parent', () => {
      const boundary = startAtBoundary()
      git('checkout', '-q', '-b', 'cut-before-the-relicence')
      commit('work on a branch cut before the relicence', { 'b.txt': 'b' })
      git('checkout', '-q', 'main')
      commit('relicense', { LICENSE: AGPL, '.github/gpl-boundary': `${boundary}\n` })
      git('merge', '-q', '--no-ff', '-m', 'merge the old branch', 'cut-before-the-relicence')
      expect(git('show', 'HEAD^2:LICENSE'), 'the merged-in commit is GPL').toBe(GPL_STAND_IN.trim())

      const { status, output } = runJob()

      expect(output).toContain('All 2 first-parent commit(s)')
      expect(status).toBe(0)
    })

    it('fails when HEAD is the boundary itself, because an empty range checks nothing', () => {
      const boundary = startAtBoundary()
      mkdirSync(join(repo, '.github'), { recursive: true })
      writeFileSync(join(repo, '.github', 'gpl-boundary'), `${boundary}\n`)

      const { status, output } = runJob()

      expect(output).toContain('nothing to check')
      expect(status).toBe(1)
    })

    it('fails when the boundary is not in the checkout, as a shallow clone would leave it', () => {
      startAtBoundary()
      commit('relicense', { LICENSE: AGPL, '.github/gpl-boundary': `${'0'.repeat(40)}\n` })

      const { status, output } = runJob()

      expect(output).toContain('is not an ancestor of HEAD')
      expect(status).toBe(1)
    })

    it('fails, with an annotation, when .github/gpl-boundary is missing', () => {
      startAtBoundary()
      commit('relicense', { LICENSE: AGPL })

      const { status, output } = runJob()

      expect(output).toContain('::error::.github/gpl-boundary is missing')
      expect(status).toBe(1)
    })
  })
})
