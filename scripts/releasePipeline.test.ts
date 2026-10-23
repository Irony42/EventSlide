import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseWorkflow, valueAt, type YamlMap, type YamlValue } from './workflowYaml'

/**
 * The release pipeline (roadmap G3-08 / P4-08), held to what it promises.
 *
 * Nothing here can run the workflows: the registry, the signing service and the runners are
 * GitHub's. So the tests do the two things that are possible. They read the workflow files
 * as structure (`workflowYaml.ts`) and pin the properties that must not move: when it runs,
 * what each job may do, what only a publication reaches, and that the image compose.yaml
 * pulls is the one it publishes. And they **run the shell of the steps that decide
 * something**, with the commands that talk to GitHub or Docker replaced by stubs: which tags a
 * release pushes, which finding opens an issue, what a rehearsal skips.
 *
 * The first property is the one the maintainer asked for in so many words: merging a pull
 * request publishes nothing. A trigger that gained `branches: [main]` would make every merge a
 * release, and nothing else in the toolchain would notice.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

const isMap = (value: YamlValue | undefined): value is YamlMap =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const mapAt = (root: YamlValue | undefined, ...path: string[]): YamlMap => {
  const found = valueAt(root, ...path)
  if (!isMap(found)) throw new Error(`${path.join('.')} is not a mapping`)
  return found
}

const textOf = (value: YamlValue | undefined, what: string): string => {
  if (typeof value !== 'string') throw new Error(`${what} is not a string`)
  return value
}

const release = parseWorkflow(read('.github', 'workflows', 'release.yml'))
const scan = parseWorkflow(read('.github', 'workflows', 'image-scan.yml'))
const releaseJobs = mapAt(release, 'jobs')

const jobOf = (workflow: YamlMap, name: string): YamlMap => mapAt(workflow, 'jobs', name)

const stepsOf = (job: YamlMap): readonly YamlMap[] => {
  const steps = job['steps']
  if (!Array.isArray(steps)) throw new Error('a job has no steps')
  return steps.map((step) => {
    if (!isMap(step)) throw new Error('a step is not a mapping')
    return step
  })
}

/** The step named `name` (or with that `id`) of a job: its `run:` script or `uses:`. */
const stepOf = (job: YamlMap, name: string): YamlMap => {
  const found = stepsOf(job).find((step) => step['name'] === name || step['id'] === name)
  if (found === undefined) throw new Error(`no step named ${name}`)
  return found
}

const runOf = (job: YamlMap, name: string): string => textOf(stepOf(job, name)['run'], name)

const packageVersion = (): string => {
  const manifest: unknown = JSON.parse(read('package.json'))
  const version =
    typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'version') : null
  if (typeof version !== 'string') throw new Error('package.json has no version')
  return version
}

const REGISTRY_IMAGE = 'ghcr.io/irony42/eventslide'

describe('when the release workflow runs', () => {
  const on = mapAt(release, 'on')

  it('only on a pushed tag and on a manual run: never on a push to a branch, a pull request or a schedule', () => {
    // A trigger that gains `branches: [main]`, `pull_request` or `schedule` makes a merge, a
    // proposal or a clock a publication. The pull request that adds this file merges to main,
    // and must publish nothing.
    expect(Object.keys(on).sort()).toEqual(['push', 'workflow_dispatch'])
  })

  it('on a push, only for a tag that starts with v, and for no branch', () => {
    expect(on['push']).toEqual({ tags: ['v*'] })
  })

  it('on a manual run, publishes only when asked, and the default is not to', () => {
    const inputs = mapAt(on, 'workflow_dispatch', 'inputs')

    expect(mapAt(inputs, 'publish')['type']).toBe('boolean')
    expect(mapAt(inputs, 'publish')['default']).toBe('false')
    expect(mapAt(inputs, 'tag')['required']).toBe('false')
  })

  it('does not cancel a release that is half way when another is started', () => {
    expect(mapAt(release, 'concurrency')['cancel-in-progress']).toBe('false')
  })
})

describe('what each job of the release workflow may do', () => {
  /** The token each job gets. A job added later has to be named here, with its reason. */
  const PERMISSIONS: Readonly<Record<string, Record<string, string>>> = {
    resolve: { contents: 'read' },
    gate: { contents: 'read' },
    publish: { contents: 'read', packages: 'write' },
    'verify-published': { contents: 'read', packages: 'read' },
    sign: { packages: 'write', 'id-token': 'write' },
    release: { contents: 'write' },
  }

  it('starts from nothing, and gives each job exactly what it needs', () => {
    expect(release['permissions']).toEqual({})
    expect(Object.keys(releaseJobs).sort()).toEqual(Object.keys(PERMISSIONS).sort())
    for (const [name, expected] of Object.entries(PERMISSIONS)) {
      expect(jobOf(release, name)['permissions'], `the permissions of ${name}`).toEqual(expected)
    }
  })

  it('lets only the job that publishes and the job that signs write to the registry', () => {
    const writers = Object.keys(releaseJobs).filter(
      (name) => mapAt(jobOf(release, name), 'permissions')['packages'] === 'write',
    )

    expect(writers.sort()).toEqual(['publish', 'sign'])
  })

  it('lets only the job that creates the release write to the repository, and only the signing job mint a token', () => {
    const permissionOf = (scope: string, level: string): string[] =>
      Object.keys(releaseJobs).filter(
        (name) => mapAt(jobOf(release, name), 'permissions')[scope] === level,
      )

    expect(permissionOf('contents', 'write')).toEqual(['release'])
    expect(permissionOf('id-token', 'write')).toEqual(['sign'])
  })
})

describe('what only a publication reaches', () => {
  const published = ['publish', 'verify-published', 'sign', 'release']
  const stepsWith = (name: string): readonly YamlMap[] => stepsOf(jobOf(release, name))

  it.each(published)('%s is skipped unless the run was asked to publish', (name) => {
    expect(jobOf(release, name)['if']).toBe("needs.resolve.outputs.publish == 'true'")
  })

  it('pushes an image from one step of one job, the one behind the publish condition', () => {
    const pushing = Object.keys(releaseJobs).flatMap((name) =>
      stepsWith(name)
        .filter((step) => isMap(step['with']) && step['with']['push'] === 'true')
        .map(() => name),
    )

    expect(pushing).toEqual(['publish'])
  })

  it('logs in to the registry only in the jobs that push, read the pushed digest or sign it', () => {
    const logging = Object.keys(releaseJobs).filter((name) =>
      stepsWith(name).some((step) => String(step['uses']).startsWith('docker/login-action@')),
    )

    expect(logging.sort()).toEqual(['publish', 'sign', 'verify-published'])
  })

  it('waits for the maintainer at the first byte pushed, through an environment', () => {
    // The environment's rules (required reviewers) are a repository setting; naming it is
    // what makes them apply to this job and to no other.
    expect(jobOf(release, 'publish')['environment']).toBe('release')
    expect(
      Object.keys(releaseJobs).filter((name) => 'environment' in jobOf(release, name)),
    ).toEqual(['publish'])
  })

  it('pushes nothing before the image has been checked, and signs nothing before the pushed digest has been', () => {
    const needs = (name: string): YamlValue | undefined => jobOf(release, name)['needs']

    expect(needs('publish')).toEqual(expect.arrayContaining(['gate']))
    expect(needs('verify-published')).toEqual(expect.arrayContaining(['publish']))
    expect(needs('sign')).toEqual(expect.arrayContaining(['publish', 'verify-published']))
    expect(needs('release')).toEqual(expect.arrayContaining(['sign']))
  })
})

describe('what is checked before an image is signed', () => {
  it.each(['gate', 'verify-published'])(
    '%s runs scripts/verify-image.sh, the script the image job of ci.yml runs, on the image it names',
    (name) => {
      const checks = stepsOf(jobOf(release, name))
        .map((step) => step['run'])
        .filter((run): run is string => typeof run === 'string' && run.includes('verify-image.sh'))

      expect(checks, `the verify-image.sh step of ${name}`).toHaveLength(1)
      expect(checks[0]).toMatch(/^IMAGE=\S+ bash \.\/scripts\/verify-image\.sh --no-build$/)
    },
  )

  it('checks the pushed digest, not a tag that could move, and never rebuilds it', () => {
    const job = jobOf(release, 'verify-published')

    expect(mapAt(job, 'env')['IMAGE_REF']).toBe(
      `${REGISTRY_IMAGE}@\${{ needs.publish.outputs.digest }}`,
    )
    expect(runOf(job, 'Check what the image promises')).toContain('IMAGE="$IMAGE_REF"')
    expect(runOf(job, 'Check what the image promises')).toContain('--no-build')
  })

  it('scans for a critical vulnerability that a newer package fixes, before and after the push', () => {
    for (const name of ['gate', 'verify-published']) {
      const scans = stepsOf(jobOf(release, name)).filter((step) =>
        String(step['uses']).startsWith('anchore/scan-action@'),
      )

      expect(scans, `the scan of ${name}`).toHaveLength(1)
      expect(scans[0]?.['with']).toMatchObject({
        'fail-build': 'true',
        'severity-cutoff': 'critical',
        'only-fixed': 'true',
      })
    }
  })

  it('builds for both platforms, from the checkout, and gives the index no attestation of its own', () => {
    const build = stepOf(jobOf(release, 'publish'), 'build')

    expect(build['with']).toMatchObject({
      context: '.',
      platforms: 'linux/amd64,linux/arm64',
      provenance: 'false',
      sbom: 'false',
    })
  })

  it('leaves the licence label to the Dockerfile, where a test holds it', () => {
    // A `labels:` input overrides the Dockerfile's LABEL of the same key, and GitHub's own
    // name for this licence is not the SPDX identifier the image has to carry.
    const labels = textOf(
      mapAt(stepOf(jobOf(release, 'publish'), 'build'), 'with')['labels'],
      'labels',
    )

    expect(labels).toContain(
      'org.opencontainers.image.source=https://github.com/Irony42/EventSlide',
    )
    expect(labels).not.toContain('org.opencontainers.image.licenses')
    expect(code(read('.github', 'workflows', 'release.yml'))).not.toMatch(
      /org\.opencontainers\.image\.licenses=/,
    )
    expect(runOf(jobOf(release, 'verify-published'), 'The labels say what the image is')).toContain(
      'AGPL-3.0-only',
    )
  })
})

describe('how the image is signed', () => {
  const sign = jobOf(release, 'sign')
  const script = runOf(sign, 'Verify what was just signed, as a user would')

  it('signs the digest that was pushed, never a tag', () => {
    expect(mapAt(sign, 'env')['IMAGE_REF']).toBe(
      `${REGISTRY_IMAGE}@\${{ needs.publish.outputs.digest }}`,
    )
    expect(runOf(sign, 'Sign the digest')).toBe('cosign sign --yes "$IMAGE_REF"')
  })

  it('is keyless: no key, no password and no secret other than the run token', () => {
    const text = read('.github', 'workflows', 'release.yml')

    expect(text).not.toMatch(/--key\b|COSIGN_PRIVATE_KEY|COSIGN_PASSWORD|secrets\.(?!GITHUB_TOKEN)/)
  })

  it('verifies the signature and the SBOM attestation afterwards, as a user would', () => {
    const attest = runOf(sign, 'Attach the SBOM as a signed attestation')

    expect(attest).toContain('cosign attest --yes --type spdxjson')
    expect(script).toContain('cosign verify ')
    expect(script).toContain('cosign verify-attestation --type spdxjson')
    expect(script).toContain('--certificate-oidc-issuer "$issuer"')
    expect(script).toContain("issuer='https://token.actions.githubusercontent.com'")
  })

  it('names, as the only identity it accepts, this repository and this workflow file', () => {
    expect(script).toContain(
      String.raw`identity='^https://github\.com/Irony42/EventSlide/\.github/workflows/release\.yml@refs/(tags/v.+|heads/main)$'`,
    )
  })
})

/** A file without its comment lines, so that prose cannot satisfy or break a check on its code. */
const code = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')

describe('the image name', () => {
  it('is written once as the workflow-level REGISTRY_IMAGE, and the other workflows and jobs agree', () => {
    expect(mapAt(release, 'env')['REGISTRY_IMAGE']).toBe(REGISTRY_IMAGE)
    expect(mapAt(scan, 'env')['REGISTRY_IMAGE']).toBe(REGISTRY_IMAGE)

    for (const file of ['release.yml', 'image-scan.yml']) {
      const names = [...read('.github', 'workflows', file).matchAll(/ghcr\.io\/[\w./-]+/g)].map(
        (match) => match[0].replace(/@$/, ''),
      )

      expect(names.length, `${file} names the image`).toBeGreaterThan(0)
      for (const name of names) expect(name, `${file}: ${name}`).toBe(REGISTRY_IMAGE)
    }
  })

  it('is what compose.yaml pulls, at the version package.json declares', () => {
    const image = /^ {4}image:\s*(\S+)/m.exec(read('compose.yaml'))?.[1]

    expect(image).toBe(`${REGISTRY_IMAGE}:${packageVersion()}`)
  })

  it('is not built by compose.yaml, which pulls', () => {
    expect(read('compose.yaml')).not.toMatch(/^\s*build:/m)
  })

  it('is replaced by a local name when compose.build.yaml builds from the checkout', () => {
    const build = read('compose.build.yaml')

    expect(build).toMatch(/^ {4}build: \.$/m)
    expect(/^ {4}image:\s*(\S+)/m.exec(build)?.[1]).toBe(`eventslide:${packageVersion()}`)
    expect(build).toMatch(/^ {4}pull_policy: never$/m)
    expect(code(build)).not.toContain('ghcr.io')
  })
})

// --------------------------------------------------------------------------- the shell --

const bashAvailable = spawnSync('bash', ['--version']).status === 0

/** A path in the form bash understands on every platform this runs on. */
const posix = (path: string): string => path.replaceAll('\\', '/')

interface Ran {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly outputs: Readonly<Record<string, string>>
  /** What the stubbed commands were asked, one line per call, in order. */
  readonly calls: string
  readonly summary: string
  /** Files the script wrote in its working directory. */
  readonly read: (name: string) => string
}

/** `name=value` lines and `name<<DELIMITER` blocks, as GitHub reads a $GITHUB_OUTPUT file. */
const parseOutputs = (text: string): Record<string, string> => {
  const outputs: Record<string, string> = {}
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const block = /^([^=<]+)<<(.+)$/.exec(line)
    if (block !== null) {
      const body: string[] = []
      for (i++; i < lines.length && lines[i] !== block[2]; i++) body.push(lines[i] ?? '')
      outputs[block[1] ?? ''] = body.join('\n')
    } else if (line.includes('=')) {
      outputs[line.slice(0, line.indexOf('='))] = line.slice(line.indexOf('=') + 1)
    }
  }
  return outputs
}

/**
 * Runs the `run:` script of a step with bash, in a directory of its own, with `stubs` put in
 * front of PATH under the name of the command they replace.
 */
const runStep = (
  script: string,
  env: Readonly<Record<string, string>>,
  options: {
    readonly stubs?: Readonly<Record<string, string>>
    readonly files?: Readonly<Record<string, string>>
  } = {},
): Ran => {
  const dir = mkdtempSync(join(tmpdir(), 'eventslide-step-'))
  try {
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    for (const [name, body] of Object.entries(options.stubs ?? {})) {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 })
    }
    const work = join(dir, 'work')
    mkdirSync(work)
    for (const [name, body] of Object.entries(options.files ?? {})) {
      mkdirSync(dirname(join(work, name)), { recursive: true })
      writeFileSync(join(work, name), body)
    }
    writeFileSync(join(dir, 'step.sh'), script)
    const output = join(dir, 'github-output')
    const summary = join(dir, 'github-summary')
    const calls = join(dir, 'calls')
    for (const file of [output, summary, calls]) writeFileSync(file, '')

    const ran = spawnSync('bash', [posix(join(dir, 'step.sh'))], {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: posix(output),
        GITHUB_STEP_SUMMARY: posix(summary),
        GITHUB_REPOSITORY: 'Irony42/EventSlide',
        CALLS: posix(calls),
        PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
        ...env,
      },
    })
    // Read now: the directory is removed below, and a closure over it would find nothing.
    const written = Object.fromEntries(
      readdirSync(work, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const file = join(entry.parentPath, entry.name)
          return [posix(file).slice(posix(work).length + 1), readFileSync(file, 'utf8')]
        }),
    )
    return {
      status: ran.status,
      stdout: ran.stdout,
      stderr: ran.stderr,
      outputs: parseOutputs(readFileSync(output, 'utf8')),
      calls: readFileSync(calls, 'utf8'),
      summary: readFileSync(summary, 'utf8'),
      read: (name) => {
        const found = written[name]
        if (found === undefined) throw new Error(`the step wrote no ${name}`)
        return found
      },
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!bashAvailable)(
  'which tags a release pushes, by running the step that decides',
  () => {
    const script = runOf(jobOf(release, 'resolve'), 'resolve')

    const resolve = (env: Record<string, string>): Ran =>
      runStep(script, {
        REGISTRY_IMAGE,
        EVENT_NAME: 'push',
        REF_NAME: '',
        TAG_INPUT: '',
        PUBLISH_INPUT: '',
        PACKAGE_VERSION: '',
        ...env,
      })

    const tags = (ran: Ran): string[] => (ran.outputs['tags'] ?? '').split('\n')

    it('pushes X.Y.Z, X.Y and X for a final tag', () => {
      const ran = resolve({ REF_NAME: 'v3.1.4', PACKAGE_VERSION: '3.1.4' })

      expect(ran.status, ran.stderr).toBe(0)
      expect(tags(ran)).toEqual([
        `${REGISTRY_IMAGE}:3.1.4`,
        `${REGISTRY_IMAGE}:3.1`,
        `${REGISTRY_IMAGE}:3`,
      ])
      expect(ran.outputs).toMatchObject({
        tag: 'v3.1.4',
        version: '3.1.4',
        prerelease: 'false',
        publish: 'true',
      })
    })

    it('reads two-digit parts as numbers, not as digits', () => {
      const ran = resolve({ REF_NAME: 'v10.20.30', PACKAGE_VERSION: '10.20.30' })

      expect(tags(ran)).toEqual([
        `${REGISTRY_IMAGE}:10.20.30`,
        `${REGISTRY_IMAGE}:10.20`,
        `${REGISTRY_IMAGE}:10`,
      ])
    })

    it('pushes only X.Y.Z-rc.N for a release candidate, so that no floating tag points at one', () => {
      const ran = resolve({ REF_NAME: 'v3.0.0-rc.2', PACKAGE_VERSION: '3.0.0-rc.2' })

      expect(ran.status, ran.stderr).toBe(0)
      expect(tags(ran)).toEqual([`${REGISTRY_IMAGE}:3.0.0-rc.2`])
      expect(ran.outputs).toMatchObject({
        prerelease: 'true',
        publish: 'true',
        version: '3.0.0-rc.2',
      })
    })

    it('never pushes a latest tag', () => {
      const ran = resolve({ REF_NAME: 'v3.0.0', PACKAGE_VERSION: '3.0.0' })

      expect(ran.outputs['tags']).not.toContain('latest')
    })

    it('refuses a tag that is not the version package.json declares, in either direction', () => {
      for (const [tag, declared] of [
        ['v3.0.0', '3.0.1'],
        ['v3.0.1', '3.0.0'],
        ['v3.0.0-rc.1', '3.0.0'],
        ['v3.0.0', '3.0.0-rc.1'],
      ] as const) {
        const ran = resolve({ REF_NAME: tag, PACKAGE_VERSION: declared })

        expect(ran.status, `${tag} against ${declared}`).toBe(1)
        expect(ran.stdout).toContain(`::error::The tag says ${tag.slice(1)}`)
        expect(ran.outputs, 'nothing is handed to the next job').toEqual({})
      }
    })

    it.each([
      'v3',
      'v3.0',
      '3.0.0',
      'V3.0.0',
      'v3.0.0-beta.1',
      'v3.0.0-rc',
      'v3.0.0-rc.01',
      'v03.0.0',
      'v3.0.0+build',
      'v3.0.0-rc.1-x',
      'v3.0.0 ',
      'v3.0.0\nv3.0.1',
      'v3.0.0;id',
      'v3.0.0$(id)',
      'vx.y.z',
      '',
    ])('refuses %j as a release tag, before it is used for anything', (tag) => {
      // package.json is given the very version the tag spells, so that nothing but the shape
      // of the tag can be what refuses it.
      const ran = resolve({ REF_NAME: tag, PACKAGE_VERSION: tag.replace(/^v/, '') })

      expect(ran.status).toBe(1)
      expect(ran.outputs).toEqual({})
    })

    it('does not publish from a manual run unless it says so', () => {
      for (const input of ['false', '']) {
        const ran = resolve({
          EVENT_NAME: 'workflow_dispatch',
          TAG_INPUT: 'v3.0.0',
          PUBLISH_INPUT: input,
          PACKAGE_VERSION: '3.0.0',
        })

        expect(ran.status, ran.stderr).toBe(0)
        expect(ran.outputs['publish'], `publish input ${JSON.stringify(input)}`).not.toBe('true')
      }
    })

    it('publishes from a manual run that says so and names an existing tag', () => {
      const ran = resolve({
        EVENT_NAME: 'workflow_dispatch',
        TAG_INPUT: 'v3.0.0',
        PUBLISH_INPUT: 'true',
        PACKAGE_VERSION: '3.0.0',
      })

      expect(ran.status, ran.stderr).toBe(0)
      expect(ran.outputs['publish']).toBe('true')
    })

    it('refuses to publish from a manual run that names no tag', () => {
      const ran = resolve({
        EVENT_NAME: 'workflow_dispatch',
        PUBLISH_INPUT: 'true',
        PACKAGE_VERSION: '3.0.0',
      })

      expect(ran.status).toBe(1)
      expect(ran.outputs).toEqual({})
    })

    it('rehearses a branch as the version it declares, and publishes nothing', () => {
      const ran = resolve({
        EVENT_NAME: 'workflow_dispatch',
        PUBLISH_INPUT: 'false',
        PACKAGE_VERSION: '3.2.0',
      })

      expect(ran.status, ran.stderr).toBe(0)
      expect(ran.outputs).toMatchObject({ tag: 'v3.2.0', version: '3.2.0', publish: 'false' })
    })

    it('takes a tag push as the request to publish it, whatever a manual input says', () => {
      const ran = resolve({
        REF_NAME: 'v3.0.0',
        PUBLISH_INPUT: 'false',
        PACKAGE_VERSION: '3.0.0',
      })

      expect(ran.outputs['publish']).toBe('true')
    })
  },
)

describe.skipIf(!bashAvailable)(
  'what the pipeline writes down, by running the steps that write it',
  () => {
    const verified = jobOf(release, 'verify-published')

    /** A `docker` that answers what the steps ask, from the environment. */
    const docker = [
      'echo "docker $*" >> "$CALLS"',
      'case "$*" in',
      '  *"imagetools inspect"*) printf "%s\\n" "$INDEX" ;;',
      '  *"image.licenses"*) printf "%s\\n" "$LABEL_LICENSES" ;;',
      '  *"image.source"*) printf "%s\\n" "$LABEL_SOURCE" ;;',
      '  *"image.version"*) printf "%s\\n" "$LABEL_VERSION" ;;',
      '  *"--entrypoint cat"*) echo "12.8" ;;',
      '  *"--entrypoint node"*"--version"*) echo "v24.9.0" ;;',
      '  *"--entrypoint node"*) printf "%s\\n" \'{"vips": "8.17.2"}\' ;;',
      '  *"--entrypoint dpkg-query"*) printf "%b" "$PACKAGES" ;;',
      'esac',
    ].join('\n')

    const INDEX_BOTH = '  Platform:    linux/amd64\n  Platform:    linux/arm64'

    it('refuses a pushed index that lacks a platform', () => {
      const script = runOf(verified, 'Both platforms are in the index')
      const run = (index: string): Ran =>
        runStep(
          script,
          { IMAGE_REF: `${REGISTRY_IMAGE}@sha256:abc`, INDEX: index },
          { stubs: { docker } },
        )

      expect(run(INDEX_BOTH).status).toBe(0)
      expect(run('  Platform:    linux/amd64').status).toBe(1)
      expect(run('  Platform:    linux/arm64').status).toBe(1)
      expect(run('  Platform:    linux/amd64\n  Platform:    linux/arm64/v8').status).toBe(1)
    })

    it('refuses an image whose labels are not the licence, the source and the version of the release', () => {
      const script = runOf(verified, 'The labels say what the image is')
      const labels = {
        LABEL_LICENSES: 'AGPL-3.0-only',
        LABEL_SOURCE: 'https://github.com/Irony42/EventSlide',
        LABEL_VERSION: '3.0.0',
      }
      const run = (changed: Record<string, string>): Ran =>
        runStep(
          script,
          { IMAGE_REF: `${REGISTRY_IMAGE}@sha256:abc`, VERSION: '3.0.0', ...labels, ...changed },
          { stubs: { docker } },
        )

      expect(run({}).status).toBe(0)
      expect(run({ LABEL_LICENSES: 'AGPL-3.0' }).status).toBe(1)
      expect(run({ LABEL_LICENSES: 'GPL-3.0' }).status).toBe(1)
      expect(run({ LABEL_SOURCE: 'https://github.com/someone/EventSlide' }).status).toBe(1)
      expect(run({ LABEL_VERSION: '3.0.1' }).status).toBe(1)
    })

    describe('the list of source packages the release attaches', () => {
      const script = runOf(verified, 'List the source packages the image carries')
      const dockerfile = `FROM node:24-bookworm-slim@sha256:${'a'.repeat(64)} AS deps\nFROM deps AS build\nFROM node:24-bookworm-slim@sha256:${'a'.repeat(64)} AS runtime\n`
      const packages = [
        ['ffmpeg', '7:5.1.6-0+deb12u1', 'libavcodec59'],
        ['ffmpeg', '7:5.1.6-0+deb12u1', 'ffmpeg'],
        ['x264', '2:0.164.3095+gitbaee400-3', 'libx264-164'],
        ['glibc', '2.36-9+deb12u10', 'libc6'],
        ['glibc', '2.36-9+deb12u10', 'libc-bin'],
      ]
        .map((row) => row.join('\\t'))
        .join('\\n')

      const run = (list: string): Ran =>
        runStep(
          script,
          {
            IMAGE_REF: `${REGISTRY_IMAGE}@sha256:abc`,
            VERSION: '3.0.0',
            PACKAGES: `${list}\\n`,
          },
          { stubs: { docker }, files: { Dockerfile: dockerfile } },
        )

      it('has one line per source package, with every binary package built from it', () => {
        const ran = run(packages)
        const listing = ran.read('image-sources-3.0.0.txt')

        expect(ran.status, ran.stderr + ran.stdout).toBe(0)
        expect(listing).toContain('ffmpeg 7:5.1.6-0+deb12u1 (ffmpeg, libavcodec59)')
        expect(listing).toContain('x264 2:0.164.3095+gitbaee400-3 (libx264-164)')
        expect(listing).toContain('glibc 2.36-9+deb12u10 (libc-bin, libc6)')
      })

      it('says which base image it was built on and what libvips reports', () => {
        const listing = run(packages).read('image-sources-3.0.0.txt')

        expect(listing).toContain(`FROM node:24-bookworm-slim@sha256:${'a'.repeat(64)}`)
        expect(listing).toContain('Debian release: 12.8')
        expect(listing).toContain('Node.js: v24.9.0')
        expect(listing).toContain('"vips": "8.17.2"')
      })

      it('fails when ffmpeg is not in the image, because a list without it is not the offer', () => {
        const ran = run(['glibc', '2.36-9', 'libc6'].join('\\t'))

        expect(ran.status).toBe(1)
        expect(ran.stdout).toContain('ffmpeg is not in the list of source packages')
      })
    })

    describe('the GitHub release', () => {
      const script = runOf(
        jobOf(release, 'release'),
        'Create the release, or add to the one release-please made',
      )
      const gh = [
        'echo "gh $*" >> "$CALLS"',
        'case "$*" in',
        '  "release view"*"--json"*) printf "%s\\n" "$GH_BODY" ;;',
        '  "release view"*) exit "${GH_EXISTS:-1}" ;;',
        'esac',
      ].join('\n')
      const files = {
        'docs/IMAGE-SOURCES.md': '# Image sources\n',
        'CHANGELOG.md':
          '# Changelog\n\n## [3.0.0] - 2026-10-02\n\nThe notes of 3.0.0.\n\n## [2.1.0] - 2026-09-01\n\nOlder.\n',
      }
      const env = {
        GH_TOKEN: 'unused',
        TAG: 'v3.0.0',
        VERSION: '3.0.0',
        PRERELEASE: 'false',
        DIGEST: 'sha256:abc',
        TAGS: `${REGISTRY_IMAGE}:3.0.0\n${REGISTRY_IMAGE}:3.0\n${REGISTRY_IMAGE}:3`,
        REGISTRY_IMAGE,
      }

      it('creates it against the existing tag, with the notes of this version, the digest and the assets', () => {
        const ran = runStep(script, env, { stubs: { gh }, files })

        expect(ran.status, ran.stderr + ran.stdout).toBe(0)
        expect(ran.calls).toMatch(
          /^gh release create v3\.0\.0 --verify-tag --title v3\.0\.0 --notes-file notes\.md eventslide-3\.0\.0\.spdx\.json image-sources-3\.0\.0\.txt IMAGE-SOURCES\.md$/m,
        )
        expect(ran.calls).not.toContain('--prerelease')
      })

      it('marks a release candidate as a pre-release, and a final one never', () => {
        const candidate = runStep(
          script,
          { ...env, TAG: 'v3.0.0-rc.1', VERSION: '3.0.0-rc.1', PRERELEASE: 'true' },
          { stubs: { gh }, files },
        )

        expect(candidate.calls).toMatch(
          /gh release create v3\.0\.0-rc\.1 --verify-tag .*--prerelease /,
        )
      })

      it('puts in its notes only the entry of the version being released, and the digest', () => {
        // The stub records the notes file the script wrote, because it is gone with the directory.
        const keep = `${gh}\ncase "$*" in "release create"*) cp notes.md "$CALLS.notes" ;; esac`
        const ran = runStep(script, env, { stubs: { gh: keep }, files })

        expect(ran.status, ran.stderr + ran.stdout).toBe(0)
        const notes = ran.read('notes.md')
        expect(notes).toContain('The notes of 3.0.0.')
        expect(notes).not.toContain('Older.')
        expect(notes).toContain(`${REGISTRY_IMAGE}@sha256:abc`)
        expect(notes).toContain(`- \`${REGISTRY_IMAGE}:3\``)
      })

      it('adds to a release that release-please already made instead of creating another', () => {
        const ran = runStep(
          script,
          { ...env, GH_EXISTS: '0', GH_BODY: 'Generated notes.' },
          { stubs: { gh }, files },
        )

        expect(ran.status, ran.stderr + ran.stdout).toBe(0)
        expect(ran.calls).toContain('gh release upload v3.0.0 eventslide-3.0.0.spdx.json')
        expect(ran.calls).toContain('--clobber')
        expect(ran.calls).toContain('gh release edit v3.0.0 --notes-file notes.md')
        expect(ran.calls).not.toContain('gh release create')
        expect(ran.read('notes.md')).toContain('Generated notes.')
      })

      it('does not add its notes twice when it is run again', () => {
        const ran = runStep(
          script,
          { ...env, GH_EXISTS: '0', GH_BODY: 'Notes with sha256:abc in them.' },
          { stubs: { gh }, files },
        )

        expect(ran.status, ran.stderr + ran.stdout).toBe(0)
        expect(ran.calls).toContain('gh release upload')
        expect(ran.calls).not.toContain('gh release edit')
      })
    })
  },
)

describe.skipIf(!bashAvailable)('a version is published once, to the end', () => {
  const script = runOf(jobOf(release, 'resolve'), 'The release is not already complete')
  const gh = [
    'echo "gh $*" >> "$CALLS"',
    'case "$*" in "release view"*) [ -n "$GH_ASSETS" ] && printf "%s\\n" $GH_ASSETS; exit "${GH_EXISTS:-0}" ;; esac',
  ].join('\n')
  const check = (env: Record<string, string>): Ran =>
    runStep(
      script,
      { GH_TOKEN: 'unused', TAG: 'v3.0.0', VERSION: '3.0.0', GH_ASSETS: '', ...env },
      { stubs: { gh } },
    )

  it('refuses a release whose last job has run, which is the one that attaches the list of sources', () => {
    const ran = check({
      GH_ASSETS: 'eventslide-3.0.0.spdx.json image-sources-3.0.0.txt IMAGE-SOURCES.md',
    })

    expect(ran.status).toBe(1)
    expect(ran.stdout).toContain('::error::v3.0.0 is already released')
  })

  it('lets a release that failed half way run again, with or without a GitHub release', () => {
    expect(check({ GH_EXISTS: '1' }).status, 'no release at all').toBe(0)
    expect(check({ GH_ASSETS: '' }).status, 'a release with no assets yet').toBe(0)
    expect(
      check({ GH_ASSETS: 'image-sources-3.0.1.txt IMAGE-SOURCES.md' }).status,
      'the assets of another version',
    ).toBe(0)
  })

  it('looks at the release of this repository, by its tag', () => {
    expect(check({}).calls).toContain(
      'gh release view v3.0.0 --repo Irony42/EventSlide --json assets',
    )
  })
})

describe('the weekly scan', () => {
  const scanJob = jobOf(scan, 'scan')
  const on = mapAt(scan, 'on')

  it('runs on a schedule and by hand, and never on a push or a pull request', () => {
    expect(Object.keys(on).sort()).toEqual(['schedule', 'workflow_dispatch'])
    expect(valueAt(on, 'schedule')).toHaveLength(1)
  })

  it('only reads the image, and may open an issue', () => {
    expect(scan['permissions']).toEqual({})
    expect(scanJob['permissions']).toEqual({ contents: 'read', packages: 'read', issues: 'write' })
  })

  it('pushes, signs and releases nothing', () => {
    const text = read('.github', 'workflows', 'image-scan.yml')

    expect(text).not.toMatch(/push:\s*true|docker push|cosign|gh release (create|upload|edit)/)
  })

  it('reports what the scan finds and lets the next step decide, looking at fixable findings only', () => {
    const step = stepOf(scanJob, 'scan')

    expect(step['with']).toMatchObject({
      'fail-build': 'false',
      'only-fixed': 'true',
      'output-format': 'json',
    })
  })

  describe.skipIf(!bashAvailable)('by running its steps with a stubbed gh', () => {
    const find = runOf(scanJob, 'Find the latest release')
    const open = runOf(scanJob, 'Open an issue for each new critical finding')
    const gh = [
      'echo "gh $*" >> "$CALLS"',
      'case "$1 $2" in',
      '  "release list") printf "%s" "$GH_RELEASE_TAG" ;;',
      '  "issue list") for id in $GH_KNOWN_IDS; do case "$*" in *"\\"$id\\""*) echo 1; exit 0 ;; esac; done; echo 0 ;;',
      '  "issue create") { echo "ISSUE: $*"; cat; } >> "$CALLS" ;;',
      'esac',
    ].join('\n')

    it('succeeds, and scans nothing, before the first release exists', () => {
      const ran = runStep(find, { GH_TOKEN: 'unused', GH_RELEASE_TAG: '' }, { stubs: { gh } })

      expect(ran.status, ran.stderr).toBe(0)
      expect(ran.outputs).toEqual({ found: 'false' })
    })

    it('scans the latest release once there is one', () => {
      const ran = runStep(find, { GH_TOKEN: 'unused', GH_RELEASE_TAG: 'v3.0.0' }, { stubs: { gh } })

      expect(ran.outputs).toEqual({ found: 'true', version: '3.0.0' })
      expect(ran.calls).toContain('--exclude-pre-releases')
    })

    const finding = (id: string, severity: string, fixed: string[] | undefined): unknown => ({
      vulnerability: { id, severity, ...(fixed === undefined ? {} : { fix: { versions: fixed } }) },
      artifact: { name: `package-of-${id}`, version: '1.0' },
    })
    const report = (...matches: unknown[]): string => JSON.stringify({ matches })
    const env = {
      GH_TOKEN: 'unused',
      IMAGE_REF: `${REGISTRY_IMAGE}@sha256:abc`,
      VERSION: '3.0.0',
      GH_KNOWN_IDS: '',
    }

    const scanWith = (json: string, extra: Record<string, string> = {}): Ran => {
      // The report is written into the step's own directory, so that `REPORT` can name it.
      const wrapped = `printf '%s' '${json.replaceAll("'", "'\\''")}' > report.json\nREPORT="$PWD/report.json"\nexport REPORT\n${open}`
      return runStep(wrapped, { ...env, ...extra }, { stubs: { gh } })
    }

    it('opens nothing, and passes, when the findings are not critical', () => {
      const ran = scanWith(report(finding('CVE-1', 'High', ['2']), finding('CVE-2', 'Low', ['2'])))

      expect(ran.status, ran.stderr + ran.stdout).toBe(0)
      expect(ran.calls).not.toContain('issue create')
      expect(ran.summary).toContain('**0 critical**, 1 high')
    })

    it('opens one issue per distinct critical finding, labelled, and fails the run while they stand', () => {
      const ran = scanWith(
        report(
          finding('CVE-1', 'Critical', ['7:5.1.7']),
          finding('CVE-1', 'Critical', ['7:5.1.7']),
          finding('CVE-2', 'Critical', []),
          finding('CVE-3', 'High', ['2']),
        ),
      )

      expect(ran.status, ran.stderr).toBe(1)
      const created = ran.calls.split('\n').filter((line) => line.startsWith('ISSUE: '))
      expect(created).toHaveLength(2)
      expect(created[0]).toContain('--label image-scan')
      expect(created[0]).toContain('--title Critical CVE-1 in package-of-CVE-1 1.0 (image 3.0.0)')
      expect(ran.calls).toContain('- Fixed in: 7:5.1.7')
      expect(ran.calls).toContain('- Fixed in: unknown')
      expect(ran.calls).toContain('gh label create image-scan')
      expect(ran.stdout).toContain('::error::')
      expect(ran.summary).toContain('**2 critical**, 1 high')
    })

    it('does not open a second issue for a finding that has one, open or closed, and still fails', () => {
      const ran = scanWith(
        report(finding('CVE-1', 'Critical', ['2']), finding('CVE-2', 'Critical', ['3'])),
        {
          GH_KNOWN_IDS: 'CVE-1',
        },
      )

      expect(ran.status).toBe(1)
      const created = ran.calls.split('\n').filter((line) => line.startsWith('ISSUE: '))
      expect(created).toHaveLength(1)
      expect(created[0]).toContain('CVE-2')
      expect(ran.calls).toContain('--state all')
      expect(ran.stdout).toContain('CVE-1 already has an issue')
    })
  })
})

describe('release-please, which is configured and switched off', () => {
  const workflow = parseWorkflow(read('.github', 'workflows', 'release-please.yml'))
  const config: unknown = JSON.parse(read('release-please-config.json'))
  const manifest: unknown = JSON.parse(read('.release-please-manifest.json'))

  /** A value of a parsed JSON file, by a path of keys. */
  const jsonAt = (root: unknown, ...path: string[]): unknown =>
    path.reduce<unknown>(
      (value, key) =>
        typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined,
      root,
    )

  it('does not run on a push, a pull request or a schedule: only when somebody presses the button', () => {
    // Release-please opens and refreshes a pull request on every run. On a push to main that
    // is a pull request after every merge, and the maintainer did not ask for it: the CHANGELOG
    // is hand-written until he decides otherwise (CHANGELOG.md, its first paragraph).
    expect(Object.keys(mapAt(workflow, 'on'))).toEqual(['workflow_dispatch'])
  })

  it('may open a pull request, write the tag and the release, and start the release workflow, and no more', () => {
    expect(workflow['permissions']).toEqual({})
    expect(jobOf(workflow, 'release-please')['permissions']).toEqual({
      contents: 'write',
      'pull-requests': 'write',
      actions: 'write',
    })
  })

  it('starts release.yml for the tag it creates, because a tag made with the run token starts nothing', () => {
    const start = runOf(
      jobOf(workflow, 'release-please'),
      'Start the release workflow for the tag that was just created',
    )

    expect(start).toBe(
      'gh workflow run release.yml --repo "$GITHUB_REPOSITORY" --ref main --field tag="$TAG" --field publish=true',
    )
    expect(
      stepOf(
        jobOf(workflow, 'release-please'),
        'Start the release workflow for the tag that was just created',
      )['if'],
    ).toBe("steps.release.outputs.release_created == 'true'")
  })

  it('measures from the commit that v2.1.0 and gpl-final are, the last under the GPL', () => {
    expect(jsonAt(config, 'bootstrap-sha')).toBe(read('.github', 'gpl-boundary').trim())
  })

  it('writes tags like v3.0.1, with no package name in them, because release.yml reads vX.Y.Z', () => {
    expect(jsonAt(config, 'include-v-in-tag')).toBe(true)
    expect(jsonAt(config, 'include-component-in-tag')).toBe(false)
    expect(jsonAt(config, 'packages', '.', 'release-type')).toBe('node')
  })

  it('moves the image tag of both compose files with the release, and each one carries the marker', () => {
    expect(jsonAt(config, 'packages', '.', 'extra-files')).toEqual([
      { type: 'generic', path: 'compose.yaml' },
      { type: 'generic', path: 'compose.build.yaml' },
    ])
    for (const file of ['compose.yaml', 'compose.build.yaml']) {
      expect(read(file), file).toMatch(/^ {4}image: \S+ # x-release-please-version$/m)
    }
  })

  it('knows the version package.json declares, because the first release it makes is the one after', () => {
    expect(jsonAt(manifest, '.')).toBe(packageVersion())
  })
})

describe('SECURITY.md and the corrective release', () => {
  const security = read('docs', 'SECURITY.md').replace(/\s+/g, ' ')

  it('states a best-effort goal of seven days for the decoders and the runtime, and no commitment', () => {
    expect(security).toContain('best effort')
    expect(security).toMatch(/seven days|7 days/)
    for (const component of ['ffmpeg', 'libvips', 'Node', 'openssl']) {
      expect(security, component).toContain(component)
    }
    // The 72 h + 24 h commitment of the paid plan, which a maintainer with a day job and no
    // on-call cannot keep, and which this one does not make.
    expect(security).not.toMatch(/72\s*(h|hours)/i)
    expect(security).not.toMatch(/24\s*(h|hours)\b[^.]*redeploy/i)
  })
})
