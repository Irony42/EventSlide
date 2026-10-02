import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The CLA gate (G1-03 / P1-04), asserted rather than described.
 *
 * Every property checked here is one a person could undo with a one-line edit and a green
 * build, which is the shape of the `.github/dependabot.yml` typo (see
 * `scripts/dependabotConfig.test.ts`): a workflow that is still there, still runs, and
 * has quietly stopped gating anything.
 *
 *   - an action pinned to a tag instead of a commit SHA hands a third party the write
 *     token of a workflow that runs with the repository's secrets;
 *   - an allowlist missing `dependabot[bot]` blocks every dependency pull request behind
 *     a signature a bot cannot give, one missing `Irony42` blocks the maintainer, and one
 *     with a wildcard in it exempts everybody;
 *   - a workflow with no `permissions:` block inherits the repository default, which is a
 *     setting somebody can change from the web without a diff;
 *   - a `pull_request_target` workflow that checks out the pull request is the textbook
 *     way to hand a stranger the repository's write token (docs/SECURITY.md §17).
 *
 * Each of those is a RULE below, and every rule ships with the one-line edit that breaks
 * it. The second `describe` applies that edit to a copy of the real workflow and demands
 * the rule report a problem, so a rule that has gone vacuous (a regex that matches
 * nothing, a parse that returns an empty list) fails here by name instead of passing
 * forever. A mutation whose target text has been reworded throws, rather than silently
 * becoming a no-op.
 *
 * The rules that guard against an attacker are written as allowlists, not denylists: the
 * workflow has exactly two steps, interpolates exactly one expression and uses exactly one
 * action. A denylist (`actions/checkout` is forbidden) lets `gh pr checkout` through, and
 * the review of this file found exactly that.
 *
 * YAML is read by hand because this repository has no YAML dependency, and adding one to
 * read a hundred-line workflow would cost more than it protects. The file is small and
 * hand-written; a line scan is enough and is honest about being one.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

const REPOSITORY_URL = 'https://github.com/Irony42/EventSlide'
const CLA_ACTION = 'contributor-assistant/github-action'
/**
 * The commit of v2.6.1 whose source the permissions were read from. Pinned in the test as
 * well as the workflow so that moving the pin is a deliberate act that sends the author
 * back to the action's source, not a one-line change nothing notices.
 */
const AUDITED_SHA = 'ca4a40a7d1004f18d9960b404b97e5f30a505a08'
/** The comment the action accepts, the job gate waits for, and docs/CLA.md tells people to post. */
const SIGN_PHRASE = 'I have read the CLA Document and I hereby sign the CLA'
const BOOTSTRAP_STEP = 'Create the signatures branch if it does not exist'
/** Everything the action does through the API, and nothing else. See cla.yml for the audit. */
const EXPECTED_PERMISSIONS = { actions: 'write', contents: 'write', 'pull-requests': 'write' }
const EXPECTED_GATE =
  "github.repository == 'Irony42/EventSlide' && " +
  "(github.event_name == 'pull_request_target' || " +
  '(github.event.issue.pull_request && ' +
  "(github.event.comment.body == 'recheck' || " +
  `github.event.comment.body == '${SIGN_PHRASE}')))`

/* ------------------------------------------------------------ reading the YAML -- */

/** Whole-line comments dropped, so prose in a comment cannot satisfy or trip a rule. */
const codeOf = (yaml: string): string =>
  yaml
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')

const unquote = (value: string): string =>
  value
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')

const indentOf = (line: string): number => line.search(/\S/)

/**
 * The direct children of a top-level key (`on`, `permissions`), as key to value.
 * `inline` is what follows the colon on the key's own line (`permissions: write-all`).
 * Undefined when the key is absent.
 */
const topLevel = (
  yaml: string,
  key: string,
): { inline: string; entries: Record<string, string> } | undefined => {
  const lines = codeOf(yaml).split('\n')
  const at = lines.findIndex((line) => line.startsWith(`${key}:`))
  if (at === -1) return undefined
  const inline = unquote((lines[at] ?? '').slice(key.length + 1))
  const entries: Record<string, string> = {}
  let childIndent = -1
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') continue
    const indent = indentOf(line)
    if (indent === 0) break
    if (childIndent === -1) childIndent = indent
    if (indent !== childIndent) continue
    const match = /^\s+([\w-]+):(.*)$/.exec(line)
    if (match) entries[match[1] ?? ''] = unquote(match[2] ?? '')
  }
  return { inline, entries }
}

/** The `types: [a, b]` list under one trigger of `on:`. Undefined when there is none. */
const triggerTypes = (yaml: string, trigger: string): string[] | undefined => {
  const lines = codeOf(yaml).split('\n')
  const at = lines.findIndex((line) => line === `  ${trigger}:`)
  if (at === -1) return undefined
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') continue
    if (indentOf(line) <= 2) break
    const match = /^\s+types:\s*\[(.*)\]\s*$/.exec(line)
    if (match) {
      return (match[1] ?? '')
        .split(',')
        .map((type) => type.trim())
        .filter((type) => type !== '')
    }
  }
  return undefined
}

/** Every `uses:` reference in the workflow. */
const usesOf = (yaml: string): string[] =>
  codeOf(yaml)
    .split('\n')
    .map((line) => /^[\s-]*uses:\s*(\S+)/.exec(line)?.[1])
    .filter((ref): ref is string => ref !== undefined)

/** The `with:` inputs of the CLA action step. */
const actionInputs = (yaml: string): Record<string, string> => {
  const lines = codeOf(yaml).split('\n')
  const at = lines.findIndex((line) => line.includes(`uses: ${CLA_ACTION}@`))
  if (at === -1) return {}
  const withAt = lines.findIndex((line, i) => i > at && line.trim() === 'with:')
  if (withAt === -1) return {}
  const indent = indentOf(lines[withAt] ?? '') + 2
  const inputs: Record<string, string> = {}
  for (const line of lines.slice(withAt + 1)) {
    if (line.trim() === '') continue
    if (indentOf(line) < indent) break
    const match = /^\s+([\w-]+):\s*(.*)$/.exec(line)
    if (match) inputs[match[1] ?? ''] = unquote(match[2] ?? '')
  }
  return inputs
}

/** The steps of the (single) job, each as its own block of lines. */
const stepsOf = (yaml: string): string[] => {
  const lines = codeOf(yaml).split('\n')
  const at = lines.findIndex((line) => line.trim() === 'steps:')
  if (at === -1) return []
  const stepIndent = indentOf(lines[at] ?? '') + 2
  const steps: string[][] = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') continue
    if (indentOf(line) < stepIndent) break
    if (indentOf(line) === stepIndent && line.trimStart().startsWith('- ')) steps.push([])
    steps[steps.length - 1]?.push(line)
  }
  return steps.map((step) => step.join('\n'))
}

/** The job's `if:` gate, folded scalar or single line, whitespace-normalised. */
const jobGate = (yaml: string): string => {
  const lines = codeOf(yaml).split('\n')
  const at = lines.findIndex((line) => /^ {4}if:/.test(line))
  if (at === -1) return ''
  const first = (lines[at] ?? '').replace(/^ {4}if:\s*>?-?\s*/, '')
  const parts = first === '' ? [] : [first]
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') continue
    if (indentOf(line) <= 4) break
    parts.push(line.trim())
  }
  return parts.join(' ')
}

/** The `run: |` script of the named step, dedented. Empty when the step is absent. */
const stepScript = (yaml: string, stepName: string): string => {
  const lines = yaml.split('\n')
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`)
  const runAt = start === -1 ? -1 : lines.findIndex((l, i) => i > start && l.trim() === 'run: |')
  if (runAt === -1) return ''
  const indent = indentOf(lines[runAt] ?? '') + 2
  const block: string[] = []
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== '' && indentOf(line) < indent) break
    block.push(line.slice(indent))
  }
  return block.join('\n')
}

/** Every `NAME: value` line in the workflow, for the two constants the bootstrap step reads. */
const envValue = (yaml: string, name: string): string | undefined =>
  codeOf(yaml)
    .split('\n')
    .map((line) => new RegExp(`^\\s+${name}:\\s*(.*)$`).exec(line)?.[1])
    .find((value): value is string => value !== undefined)
    ?.replace(/\s+#.*$/, '')
    .trim()

/* ----------------------------------------------------------------------- rules -- */

interface Rule {
  readonly name: string
  /** The problems this rule finds in a workflow. Empty means the rule holds. */
  readonly check: (workflow: string) => string[]
  /** The edit a future maintainer would plausibly make, described. */
  readonly mutation: string
  readonly mutate: (workflow: string) => string
}

/** Replace the first occurrence, or throw: a mutation that finds nothing proves nothing. */
const swap = (
  text: string,
  from: string | RegExp,
  to: string | ((match: string) => string),
): string => {
  const out = text.replace(from, typeof to === 'function' ? to : () => to)
  if (out === text) throw new Error(`mutation target not found in cla.yml: ${String(from)}`)
  return out
}

const allowlistOf = (workflow: string): string[] =>
  (actionInputs(workflow)['allowlist'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')

const RULES: readonly Rule[] = [
  {
    name: 'pins every action by a full 40-hex commit SHA',
    check: (workflow) => {
      const uses = usesOf(workflow)
      const problems = uses
        .filter((ref) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(ref))
        .map((ref) => `${ref} is not pinned by a 40-hex SHA`)
      if (!uses.some((ref) => ref.startsWith(`${CLA_ACTION}@`))) {
        problems.push(`${CLA_ACTION} is not used at all`)
      }
      return problems
    },
    mutation: 'the CLA action pinned to its v2.6.1 tag instead of the commit SHA',
    mutate: (workflow) => swap(workflow, /github-action@[0-9a-f]{40}/, 'github-action@v2.6.1'),
  },
  {
    name: 'pins the commit of v2.6.1 whose source the permissions were audited against',
    check: (workflow) =>
      usesOf(workflow).includes(`${CLA_ACTION}@${AUDITED_SHA}`)
        ? []
        : [`the action is not ${CLA_ACTION}@${AUDITED_SHA}`],
    mutation: 'the pin moved to another commit, so the audit no longer describes what runs',
    mutate: (workflow) => swap(workflow, AUDITED_SHA, '0123456789abcdef0123456789abcdef01234567'),
  },
  {
    name: 'allowlists the maintainer, Irony42',
    check: (workflow) => (allowlistOf(workflow).includes('Irony42') ? [] : ['Irony42 missing']),
    mutation: 'Irony42 removed from the allowlist',
    mutate: (workflow) => swap(workflow, /allowlist: Irony42,/, 'allowlist: '),
  },
  {
    name: 'allowlists dependabot[bot], which cannot sign a comment',
    check: (workflow) =>
      allowlistOf(workflow).includes('dependabot[bot]') ? [] : ['dependabot[bot] missing'],
    mutation: 'dependabot[bot] removed from the allowlist',
    mutate: (workflow) => swap(workflow, /,dependabot\[bot\]/, ''),
  },
  {
    name: 'allowlists nobody else, and no wildcard (the action turns * into .*)',
    check: (workflow) => {
      const entries = allowlistOf(workflow)
      const problems = entries
        .filter((entry) => !['Irony42', 'dependabot[bot]'].includes(entry))
        .map((entry) => `${entry} is allowlisted`)
      if (entries.some((entry) => entry.includes('*')))
        problems.push('the allowlist has a wildcard')
      return problems
    },
    mutation: 'the action README example `bot*` added, which exempts any login containing "bot"',
    mutate: (workflow) =>
      swap(
        workflow,
        'allowlist: Irony42,dependabot[bot]',
        'allowlist: Irony42,dependabot[bot],bot*',
      ),
  },
  {
    name: 'points path-to-document at docs/CLA.md in this repository',
    check: (workflow) => {
      const document = actionInputs(workflow)['path-to-document']
      return document === `${REPOSITORY_URL}/blob/main/docs/CLA.md`
        ? []
        : [`path-to-document is ${String(document)}`]
    },
    mutation: 'the document path pointed at README.md',
    mutate: (workflow) => swap(workflow, 'blob/main/docs/CLA.md', 'blob/main/README.md'),
  },
  {
    name: 'triggers on pull_request_target and issue_comment, and on nothing else',
    check: (workflow) => {
      const triggers = Object.keys(topLevel(workflow, 'on')?.entries ?? {}).sort()
      return triggers.join(',') === 'issue_comment,pull_request_target'
        ? []
        : [`triggers are ${triggers.join(',') || '(none)'}`]
    },
    mutation: 'pull_request_target downgraded to pull_request, which has no write token for forks',
    mutate: (workflow) => swap(workflow, /^ {2}pull_request_target:/m, '  pull_request:'),
  },
  {
    name: 'listens for exactly the event types it needs: new, pushed and reopened pull requests, new comments',
    check: (workflow) => {
      const problems: string[] = []
      const pullRequest = (triggerTypes(workflow, 'pull_request_target') ?? []).sort().join(',')
      const comment = (triggerTypes(workflow, 'issue_comment') ?? []).sort().join(',')
      if (pullRequest !== 'opened,reopened,synchronize') {
        problems.push(`pull_request_target types are "${pullRequest}"`)
      }
      if (comment !== 'created') problems.push(`issue_comment types are "${comment}"`)
      return problems
    },
    mutation: 'pull_request_target narrowed to [opened], so a later push is never re-checked',
    mutate: (workflow) =>
      swap(workflow, 'types: [opened, synchronize, reopened]', 'types: [opened]'),
  },
  {
    name: 'sets permissions explicitly instead of inheriting the repository default',
    check: (workflow) => {
      const permissions = topLevel(workflow, 'permissions')
      if (permissions === undefined) return ['no top-level permissions: block']
      if (permissions.inline !== '') return [`permissions is "${permissions.inline}", not a map`]
      return Object.keys(permissions.entries).length === 0 ? ['permissions: block is empty'] : []
    },
    mutation: 'the permissions block deleted, so the repository default applies',
    mutate: (workflow) => swap(workflow, /^permissions:\n(?: {2}.*\n)+/m, ''),
  },
  {
    name: 'asks for exactly the three write scopes the action needs',
    check: (workflow) => {
      const entries = topLevel(workflow, 'permissions')?.entries ?? {}
      const declared = JSON.stringify(Object.entries(entries).sort())
      const expected = JSON.stringify(Object.entries(EXPECTED_PERMISSIONS).sort())
      return declared === expected ? [] : [`permissions are ${declared}`]
    },
    mutation: 'packages: write added to the token',
    mutate: (workflow) =>
      swap(workflow, /^ {2}pull-requests: write\n/m, (m) => `${m}  packages: write\n`),
  },
  {
    name: 'declares permissions once, at the top, with no job-level override',
    check: (workflow) => {
      const keys = codeOf(workflow)
        .split('\n')
        .filter((line) => /^\s*permissions:/.test(line))
      return keys.length === 1 && keys[0]?.startsWith('permissions:') === true
        ? []
        : [`permissions: is declared ${keys.length} times`]
    },
    mutation: 'permissions: write-all added to the job, which overrides the audited block',
    mutate: (workflow) =>
      swap(workflow, /^ {4}name: CLA signed\n/m, (m) => `${m}    permissions: write-all\n`),
  },
  {
    name: 'has exactly two steps, its own bootstrap script and the CLA action, and runs nothing else',
    check: (workflow) => {
      const steps = stepsOf(workflow)
      const problems: string[] = []
      if (steps.length !== 2) problems.push(`the job has ${steps.length} steps, not 2`)
      if (!steps[0]?.includes(`- name: ${BOOTSTRAP_STEP}`) || !steps[0].includes('run: |')) {
        problems.push('the first step is not the bootstrap script')
      }
      if (!steps[1]?.includes(`uses: ${CLA_ACTION}@`) || steps[1].includes('run:')) {
        problems.push('the second step is not the bare CLA action')
      }
      const runs = codeOf(workflow)
        .split('\n')
        .filter((line) => /^\s*run:/.test(line))
      if (runs.length !== 1) problems.push(`${runs.length} run: keys, not 1`)
      return problems
    },
    mutation:
      'a third step that builds the repository, which is a checkout of a stranger by another name',
    mutate: (workflow) =>
      swap(workflow, /\n$/, '\n      - name: Build\n        run: npm ci && npm test\n'),
  },
  {
    name: 'never checks out, or reads the head of, the pull request',
    check: (workflow) => {
      const code = codeOf(workflow)
      const forbidden = [
        /actions\/checkout/,
        /pull_request\.head/,
        /github\.head_ref/,
        /\bgit (clone|fetch|checkout)\b/,
        /\bgh pr (checkout|diff)\b/,
      ]
      return forbidden.filter((pattern) => pattern.test(code)).map((p) => `matches ${String(p)}`)
    },
    mutation: 'an actions/checkout of the pull request head added ahead of the action',
    mutate: (workflow) =>
      swap(
        workflow,
        /^ {6}- name: CLA assistant\n/m,
        (m) =>
          '      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n' +
          m,
      ),
  },
  {
    name: 'interpolates nothing but the workflow token',
    check: (workflow) => {
      const expressions = [...codeOf(workflow).matchAll(/\$\{\{\s*([^}]*?)\s*\}\}/g)].map(
        (match) => match[1] ?? '',
      )
      return expressions
        .filter((expression) => expression !== 'secrets.GITHUB_TOKEN')
        .map((expression) => `\${{ ${expression} }} is interpolated`)
    },
    mutation: 'the pull request title interpolated into the bootstrap script',
    mutate: (workflow) =>
      swap(workflow, 'repo="$GITHUB_REPOSITORY"', 'repo="${{ github.event.pull_request.title }}"'),
  },
  {
    name: 'stores signatures with the workflow token alone, never a personal access token',
    check: (workflow) => {
      const code = codeOf(workflow)
      const problems: string[] = []
      if (/PERSONAL_ACCESS_TOKEN/.test(code)) problems.push('PERSONAL_ACCESS_TOKEN is referenced')
      if (/remote-(repository|organization)-name/.test(code)) {
        problems.push('signatures are sent to a remote repository, which needs a PAT')
      }
      if (!/GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/.test(code)) {
        problems.push('GITHUB_TOKEN is not passed to the action')
      }
      return problems
    },
    mutation: 'a PERSONAL_ACCESS_TOKEN secret added to the action environment',
    mutate: (workflow) =>
      swap(
        workflow,
        /^( {10}GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}\n)/m,
        (m) => `${m}          PERSONAL_ACCESS_TOKEN: \${{ secrets.PERSONAL_ACCESS_TOKEN }}\n`,
      ),
  },
  {
    name: 'keeps signatures on a dedicated branch and a versioned file, which the bootstrap step also creates',
    check: (workflow) => {
      const inputs = actionInputs(workflow)
      const problems: string[] = []
      const branch = inputs['branch'] ?? ''
      const path = inputs['path-to-signatures'] ?? ''
      if (branch === '' || ['main', 'master'].includes(branch)) {
        problems.push(`signatures branch is "${branch}", not a dedicated branch`)
      }
      if (!/^signatures\/v\d+\/cla\.json$/.test(path)) {
        problems.push(`signatures file is "${path}", not signatures/vN/cla.json`)
      }
      if (branch !== envValue(workflow, 'SIGNATURES_BRANCH')) {
        problems.push('the action and the bootstrap step name different branches')
      }
      if (path !== envValue(workflow, 'SIGNATURES_PATH')) {
        problems.push('the action and the bootstrap step name different signature files')
      }
      if (stepScript(workflow, BOOTSTRAP_STEP) === '') problems.push('no bootstrap step')
      return problems
    },
    mutation: 'the action pointed at main, where the signatures commit would be refused',
    mutate: (workflow) =>
      swap(workflow, /^ {10}branch: cla-signatures$/m, '          branch: main'),
  },
  {
    name: 'is skipped in forks, so another project is not asked to grant rights to this maintainer',
    check: (workflow) =>
      jobGate(workflow).startsWith("github.repository == 'Irony42/EventSlide' && ")
        ? []
        : ['the job gate does not start with a repository check'],
    mutation: 'the repository check deleted from the job gate',
    mutate: (workflow) =>
      swap(workflow, /^ +github\.repository == 'Irony42\/EventSlide' &&\n/m, ''),
  },
  {
    name: 'reacts only to pull request events, to `recheck` and to the sign phrase',
    check: (workflow) => {
      const gate = jobGate(workflow)
      return gate === EXPECTED_GATE ? [] : [`the job gate is "${gate}"`]
    },
    mutation: 'the pull_request_target clause deleted, so the job is skipped on every pull request',
    mutate: (workflow) =>
      swap(workflow, /^ +\(github\.event_name == 'pull_request_target' \|\|\n/m, '      (\n'),
  },
  {
    name: 'accepts exactly the sign phrase, in the job gate and in the action itself',
    check: (workflow) => {
      const problems: string[] = []
      if (actionInputs(workflow)['custom-pr-sign-comment'] !== SIGN_PHRASE) {
        problems.push('the action is not told to accept exactly the sign phrase')
      }
      if (!jobGate(workflow).includes(`github.event.comment.body == '${SIGN_PHRASE}'`)) {
        problems.push('the job gate does not wait for the sign phrase')
      }
      return problems
    },
    mutation: 'the sign phrase reworded in the job gate, so nobody can ever sign',
    mutate: (workflow) =>
      swap(
        workflow,
        `github.event.comment.body == '${SIGN_PHRASE}'`,
        "github.event.comment.body == 'I agree'",
      ),
  },
  {
    name: 'does not lock closed pull requests: the signature is the commit, not the comment',
    check: (workflow) => {
      const lock = actionInputs(workflow)['lock-pullrequest-aftermerge']
      return lock === 'false' ? [] : [`lock-pullrequest-aftermerge is ${String(lock)}`]
    },
    mutation:
      'locking switched back on, which locks every pull request the maintainer closes unmerged',
    // Anchored to the input's own line: the header comment quotes the same text.
    mutate: (workflow) =>
      swap(
        workflow,
        /^ {10}lock-pullrequest-aftermerge: 'false'$/m,
        "          lock-pullrequest-aftermerge: 'true'",
      ),
  },
]

describe('.github/workflows/cla.yml', () => {
  const workflow = read('.github', 'workflows', 'cla.yml')

  describe('holds every rule', () => {
    it.each(RULES.map((rule) => [rule.name, rule] as const))('%s', (_name, rule) => {
      expect(rule.check(workflow)).toEqual([])
    })
  })

  describe('each rule goes red under the edit that breaks it', () => {
    it.each(RULES.map((rule) => [rule.mutation, rule] as const))('%s', (_mutation, rule) => {
      const mutated = rule.mutate(workflow)

      expect(mutated).not.toBe(workflow)
      expect(rule.check(mutated), `${rule.name}: nothing noticed`).not.toEqual([])
    })
  })

  it('checks a document that exists, and that tells people to post the phrase the job waits for', () => {
    expect(existsSync(join(ROOT, 'docs', 'CLA.md'))).toBe(true)
    // The bot's comment and the job gate both quote this phrase; the document is where a
    // person reads it first. If the three drift, nobody can sign and nothing says why.
    expect(read('docs', 'CLA.md')).toContain(SIGN_PHRASE)
  })
})

/* --------------------------------------------- the bootstrap step, actually run -- */

/**
 * The action cannot create the signatures branch, and cannot create its file either:
 * `setupClaCheck` handles a missing file with `error.status === "404"`, a string
 * compared to the number Octokit throws, so on a fresh repository every run dies with
 * "Could not retrieve repository contents. Status: 404". The bootstrap step is what makes
 * the first signature possible, and it is bash inside YAML that nothing runs locally, so
 * it is run here against a stand-in `gh` that records what it was asked.
 *
 * The stand-in is a shell function defined ahead of the script, so it shadows the real
 * binary without touching PATH, which is unreliable under Git Bash on Windows. The script
 * runs under plain `bash -c`, not `bash -e`: the step's own `set -euo pipefail` is what
 * has to stop it, not a flag the harness happens to pass.
 *
 * What this cannot do is reach GitHub. The bodies and arguments are checked against the
 * REST documentation for blobs, trees, commits, refs and contents, not against the live
 * API, and the first real run is the real test (docs/SECURITY.md §17 says so).
 */
describe('the bootstrap step that creates the signatures branch', () => {
  const workflow = read('.github', 'workflows', 'cla.yml')
  const script = stepScript(workflow, BOOTSTRAP_STEP)
  const branch = envValue(workflow, 'SIGNATURES_BRANCH') ?? ''
  const signaturesPath = envValue(workflow, 'SIGNATURES_PATH') ?? ''

  const GH_STAND_IN = String.raw`
gh() {
  printf 'gh %s\n' "$*" >> "$STUB_LOG"
  case "$*" in
    *"--input -"*) printf 'body %s\n' "$(cat)" >> "$STUB_LOG" ;;
  esac
  case "$*" in
    "api repos/o/r/git/ref/heads/"*)
      case "$STUB_MODE" in
        exists|nofile) return 0 ;;
        race) grep -q 'git/refs' "$STUB_LOG" ;;
        *) return 1 ;;
      esac ;;
    "api repos/o/r/contents/"*) [ "$STUB_MODE" = exists ] ;;
    "api --method PUT repos/o/r/contents/"*) return 0 ;;
    "api repos/o/r/git/blobs"*)
      if [ "$STUB_MODE" = blobfails ]; then return 1; fi
      echo blob-sha ;;
    "api repos/o/r/git/trees"*) echo tree-sha ;;
    "api repos/o/r/git/commits"*) echo commit-sha ;;
    "api repos/o/r/git/refs"*) [ "$STUB_MODE" = missing ] ;;
    *) echo "unexpected gh call: $*" >&2; return 99 ;;
  esac
}
`

  /** exists: branch and file; nofile: branch only; missing: neither; race: lose the ref race. */
  type Mode = 'exists' | 'nofile' | 'missing' | 'race' | 'blobfails' | 'broken'

  /** Runs the step and returns what `gh` was asked. */
  const run = (mode: Mode): { status: number | null; calls: string[]; output: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'cla-bootstrap-'))
    const log = join(dir, 'gh.log').replace(/\\/g, '/')
    try {
      const result = spawnSync('bash', ['-c', GH_STAND_IN + script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REPOSITORY: 'o/r',
          SIGNATURES_BRANCH: branch,
          SIGNATURES_PATH: signaturesPath,
          STUB_LOG: log,
          STUB_MODE: mode,
        },
      })
      const calls = existsSync(join(dir, 'gh.log'))
        ? readFileSync(join(dir, 'gh.log'), 'utf8').split('\n').filter(Boolean)
        : []
      return { status: result.status, calls, output: `${result.stdout}${result.stderr}` }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /** The endpoint each `gh api` call went to, in order. */
  const endpoints = (calls: string[]): string[] =>
    calls
      .filter((call) => call.startsWith('gh api'))
      .map(
        (call) =>
          /repos\/o\/r\/(git\/(?:blobs|trees|commits|refs|ref\/heads)|contents)/.exec(call)?.[1] ??
          call,
      )

  const bodies = (calls: string[]): unknown[] =>
    calls.filter((call) => call.startsWith('body ')).map((call) => JSON.parse(call.slice(5)))

  // Where bash cannot write to a Windows temp directory (WSL's launcher shadowing Git
  // Bash, say) the probe says so and the half is skipped rather than reported as a
  // failure of the step it cannot reach. CI is Linux and always has bash.
  const canRunBash = ((): boolean => {
    const dir = mkdtempSync(join(tmpdir(), 'cla-bootstrap-probe-'))
    try {
      const log = join(dir, 'probe.log').replace(/\\/g, '/')
      const result = spawnSync('bash', ['-c', 'printf ok >> "$STUB_LOG"'], {
        env: { ...process.env, STUB_LOG: log },
      })
      return result.status === 0 && readFileSync(join(dir, 'probe.log'), 'utf8') === 'ok'
    } catch {
      return false
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })()

  it('has the step whose script the rest of this block runs', () => {
    expect(script, `the "${BOOTSTRAP_STEP}" step's run script`).not.toBe('')
    expect(branch, 'SIGNATURES_BRANCH in the step env').not.toBe('')
    expect(signaturesPath, 'SIGNATURES_PATH in the step env').not.toBe('')
  })

  describe.skipIf(!canRunBash)('run under bash with a stand-in gh', () => {
    it('does nothing when the signatures branch and its file are already there', () => {
      const { status, calls } = run('exists')

      expect(status).toBe(0)
      expect(endpoints(calls)).toEqual(['git/ref/heads', 'contents'])
      expect(calls[0]).toContain(`git/ref/heads/${branch}`)
      expect(calls[1]).toContain(`contents/${signaturesPath}?ref=${branch}`)
    })

    it('creates a parentless branch holding an empty signatures file at the path the action reads', () => {
      const { status, calls, output } = run('missing')

      expect(status, output).toBe(0)
      // The order is the dependency order: a tree needs the blob, a commit the tree, a
      // ref the commit.
      expect(endpoints(calls)).toEqual([
        'git/ref/heads',
        'git/blobs',
        'git/trees',
        'git/commits',
        'git/refs',
      ])

      const [blobCall, treeCall, commitCall, refCall] = calls.filter(
        (call) => /git\/(blobs|trees|commits|refs)(?!\/)/.test(call) && call.startsWith('gh api'),
      )
      // `--jq .sha` is what turns the API's JSON answer into the bare SHA the next call
      // needs. Without it the next body would carry a whole JSON document as a "sha".
      expect(blobCall).toContain('-f content={"signedContributors":[]}')
      expect(blobCall).toContain('-f encoding=utf-8')
      for (const call of [blobCall, treeCall, commitCall]) expect(call).toContain('--jq .sha')

      const [tree, commit] = bodies(calls)
      expect(tree).toEqual({
        tree: [{ path: signaturesPath, mode: '100644', type: 'blob', sha: 'blob-sha' }],
      })
      expect(commit).toMatchObject({ tree: 'tree-sha', parents: [] })
      expect(refCall).toContain(`ref=refs/heads/${branch}`)
      expect(refCall).toContain('sha=commit-sha')
    })

    it('adds the missing file to a branch that exists without it', () => {
      const { status, calls, output } = run('nofile')

      expect(status, output).toBe(0)
      expect(endpoints(calls)).toEqual(['git/ref/heads', 'contents', 'contents'])
      const put = calls[2] ?? ''
      expect(put).toContain('--method PUT')
      expect(put).toContain(`contents/${signaturesPath}`)
      expect(put).toContain(`-f branch=${branch}`)
      const content = /-f content=(\S+)/.exec(put)?.[1] ?? ''
      expect(Buffer.from(content, 'base64').toString()).toBe('{"signedContributors":[]}')
    })

    it('accepts losing the race to another run that created the branch first', () => {
      const { status, output } = run('race')

      expect(status, output).toBe(0)
    })

    it('fails when the branch cannot be created and is still not there', () => {
      const { status } = run('broken')

      expect(status).not.toBe(0)
    })

    it('stops at the first call that fails instead of pressing on with an empty SHA', () => {
      const { status, calls } = run('blobfails')

      expect(status).not.toBe(0)
      expect(endpoints(calls)).toEqual(['git/ref/heads', 'git/blobs'])
    })
  })
})

/* ------------------------------------------------------- the CLA text itself -- */

/**
 * docs/CLA.md is prose, and prose is where a guarantee quietly disappears: somebody
 * tidies a sentence and the grant no longer says "proprietary" or "sublicense". These are
 * the claims the plan makes about it (P1-04 design details). Each is checked in the
 * section that is supposed to carry it, with whitespace collapsed so re-wrapping a
 * paragraph does not trip them: a file-wide match would pass on the wrong section, as a
 * review of this file showed ("irrevocable" in the patent grant satisfied the copyright
 * grant, "employer" in the note to the lawyer satisfied the representation).
 */
describe('docs/CLA.md', () => {
  // Read inside each test, not at collection: a missing file should fail these tests by
  // name rather than take the whole suite down.
  const squash = (value: string): string => value.replace(/\s+/g, ' ')
  const claText = (): string => squash(read('docs', 'CLA.md'))
  /** The text of `## N. ...`, up to the next `## `. */
  const section = (n: number): string =>
    squash(
      read('docs', 'CLA.md')
        .split(/^## /m)
        .find((part) => part.startsWith(`${n}. `)) ?? '',
    )

  it('opens with the note that it is not legal advice and awaits a lawyer', () => {
    const top = squash(
      read('docs', 'CLA.md')
        .split('\n')
        .slice(0, 12)
        .map((line) => line.replace(/^>\s?/, ''))
        .join(' '),
    )

    expect(top).toMatch(/not legal advice/i)
    expect(top).toMatch(/reviewed by a lawyer before the paid plan/i)
  })

  it('is a licence grant: the contributor keeps the copyright and nothing is assigned', () => {
    expect(section(2)).toMatch(/you keep the copyright/i)
    expect(section(2)).toMatch(/not an assignment/i)
    // Assignment language anywhere in the file would turn the grant into a transfer.
    expect(claText()).not.toMatch(/\bassign(?:s)?\b[^.]*\b(?:right|title|interest|copyright)\b/i)
    expect(claText()).not.toMatch(/\byou (?:hereby )?assign\b/i)
  })

  it('grants a perpetual, worldwide, irrevocable copyright licence to sublicense on any terms', () => {
    const grant = section(3)

    for (const word of ['perpetual', 'worldwide', 'irrevocable', 'sublicense']) {
      expect(grant, word).toMatch(new RegExp(word, 'i'))
    }
    expect(grant).toMatch(/any licen[cs]e terms[^.]*including[^.]*proprietary/i)
  })

  it('grants a patent licence as well as a copyright one', () => {
    const grant = section(4)

    // The grant itself, not the heading that announces it.
    expect(grant).toMatch(/perpetual, worldwide, non-exclusive, royalty-free and irrevocable/i)
    expect(grant).toMatch(/patent licen[cs]e to make, have made, use/i)
  })

  it('names the beneficiary: Pierre Tijou, his successors, and entities he controls', () => {
    const words = section(1)

    expect(words).toContain('Pierre Tijou')
    expect(words).toMatch(/successors/i)
    // Not "patent claims you own or control": the entity that runs the paid service.
    expect(words).toMatch(/entity that he controls/i)
    expect(words).toMatch(/carries on the Project/i)
  })

  it('carries the representations: entitled to grant, original work, employer rights', () => {
    const promises = section(5)

    expect(promises).toMatch(/legally entitled/i)
    expect(promises).toMatch(/original work/i)
    expect(promises).toMatch(/employer/i)
    // Third-party code may only come in under terms that leave the Maintainer free to
    // relicense it; "compatible with the AGPL" would let GPL code in.
    expect(promises).not.toMatch(/sit with AGPL/i)
    expect(promises).toMatch(/sublicens/i)
  })

  it('tells people exactly which comment to post', () => {
    expect(section(9)).toContain(SIGN_PHRASE)
  })

  it('names the branch and the versioned file where signatures are kept, at its own version', () => {
    const workflow = read('.github', 'workflows', 'cla.yml')
    const signatures = actionInputs(workflow)['path-to-signatures'] ?? ''
    const major = /^Version (\d+)\./m.exec(read('docs', 'CLA.md'))?.[1]

    expect(signatures).toBe(`signatures/v${major}/cla.json`)
    expect(claText()).toContain(`signatures/v${major}/`)
    expect(section(9)).toContain(actionInputs(workflow)['branch'] ?? '(no branch)')
  })
})

/* ---------------------------------------------- the documents around the CLA -- */

describe('the contributor documents that point at the CLA', () => {
  const squash = (value: string): string => value.replace(/\s+/g, ' ')

  it('has a CONTRIBUTING.md that states the licence, the CLA, the freeze, and keeps the migration rule', () => {
    const contributing = squash(read('CONTRIBUTING.md'))

    expect(contributing).toContain('AGPL-3.0-only')
    expect(contributing).toContain('docs/CLA.md')
    expect(contributing).toMatch(/CLA[^.]*before[^.]*merged/i)
    expect(contributing).toMatch(/external pull requests[^.]*(paused|on hold)/i)
    expect(contributing).toMatch(/lifts[^.]*CLA workflow[^.]*live/i)
    expect(contributing).toContain('CODE_OF_CONDUCT.md')
    // How to sign, and what to do when the check stays red after signing.
    expect(contributing).toContain('`CLA signed`')
    expect(contributing).toContain('recheck')
    // G2-01's rule lives in the same file and must survive this one.
    expect(contributing).toContain('## Migration numbers')
  })

  it('ships a code of conduct that credits the Contributor Covenant without being a copy of it', () => {
    const conduct = read('CODE_OF_CONDUCT.md')

    expect(conduct).toContain('https://www.contributor-covenant.org')
    // The contact is a placeholder until the maintainer fills it in; once he has, an
    // address takes its place and this stays green.
    expect(conduct).toMatch(/to be filled in|[\w.+-]+@[\w-]+\.[\w.-]+/i)
    // The Covenant's own opening pledge, which a pasted copy would carry verbatim.
    expect(conduct).not.toContain('We as members, contributors, and leaders pledge')
  })

  it('has a pull request template that names the CLA and the three audiences', () => {
    const template = read('.github', 'pull_request_template.md')

    expect(template).toMatch(/CLA/)
    for (const audience of ['Guest', 'Host', 'room']) {
      expect(template, audience).toContain(audience)
    }
  })

  it('has a pull request template whose links work from a pull request page', () => {
    // A relative link in a pull request body resolves against the pull request's own URL,
    // not the repository tree, so only absolute ones can be followed.
    expect(read('.github', 'pull_request_template.md')).not.toMatch(/\]\((?!https?:)[^)]*\)/)
  })

  it('is linked from the README, so a reader of the front page can find the CLA', () => {
    const readme = read('README.md')

    expect(readme).toContain('(docs/CLA.md)')
    expect(readme).toContain('(CODE_OF_CONDUCT.md)')
    expect(squash(readme)).toContain('licence grant, not an assignment')
  })

  it('explains the pull_request_target rules in SECURITY.md, naming the workflow and what it does not prove', () => {
    const security = squash(read('docs', 'SECURITY.md'))

    expect(security).toContain('.github/workflows/cla.yml')
    expect(security).toContain('pull_request_target')
    expect(security).toMatch(/never checks out/i)
    expect(security).toContain('What the check does not prove')
    expect(security).toMatch(/archived/i)
  })

  // Relative links in the documents this branch wrote or extended, resolved against the
  // file that contains them. A moved or misspelt target would otherwise be a dead link
  // that nothing notices until a contributor clicks it.
  it.each([
    ['CONTRIBUTING.md', () => read('CONTRIBUTING.md')],
    ['CODE_OF_CONDUCT.md', () => read('CODE_OF_CONDUCT.md')],
    ['docs/CLA.md', () => read('docs', 'CLA.md')],
    [
      'docs/SECURITY.md section 17',
      () => read('docs', 'SECURITY.md').slice(read('docs', 'SECURITY.md').indexOf('## 17. ')),
    ],
  ] as const)('has no dead relative link in %s', (file, content) => {
    const base = file.startsWith('docs/') ? join(ROOT, 'docs') : ROOT
    const targets = [...content().matchAll(/\]\(([^)\s]+)\)/g)]
      .map((match) => match[1] ?? '')
      .filter((target) => !/^(https?:|mailto:|#)/.test(target))
      .map((target) => target.replace(/#.*$/, ''))
      .filter((target) => target !== '')

    for (const target of targets) {
      expect(existsSync(join(base, target)), `${file} links to ${target}`).toBe(true)
    }
  })
})
