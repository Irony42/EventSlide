import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `.env.example`, asserted against the schema it claims to document rather than
 * described from memory.
 *
 * `LOGIN_RATE_LIMIT_PER_MINUTE` and `REACTION_RATE_LIMIT_PER_MINUTE` are both defined in
 * `src/infrastructure/config/env.ts` and were simply absent from `.env.example` until
 * this test existed to say so: an operator reading the file to learn what they could
 * configure had no way to discover either knob, and nothing failed, because nothing
 * checked. That is the same shape of silent drift CLAUDE.md §9 records about a tsconfig
 * `include` entry that matches nothing — the fix there was the same as the fix here, a
 * test that fails by naming the thing that went missing.
 *
 * Parsed by hand, like `dependabotConfig.test.ts`: both files are small, flat and
 * hand-written, and a line scan is honest about being one rather than reaching for a
 * `.env` parser this project has no other use for.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_TS_PATH = join(ROOT, 'src', 'infrastructure', 'config', 'env.ts')
const ENV_EXAMPLE_PATH = join(ROOT, '.env.example')

/**
 * Every variable `buildSchema`'s zod object declares, read off its own source rather
 * than re-typed here — a second list would be a second place for a new key to be added
 * to one and not the other, which is exactly the drift this file exists to catch.
 *
 * The schema's fields are indented six spaces, two levels inside `buildSchema`'s
 * `z.object({` — stable because every field in that object, old or new, is written the
 * same way; see the full list this prints if that ever changes.
 */
const schemaKeys = (): readonly string[] => {
  const source = readFileSync(ENV_TS_PATH, 'utf8')
  const matches = [...source.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)]
  return matches.map((match) => match[1] as string)
}

/**
 * The operating system's own variables, which the schema reads and `.env.example` does not
 * document: `PATH` and `PATHEXT` for the binary resolver, and `SYSTEMROOT`, `WINDIR`,
 * `TEMP` and `TMP`, the Windows-only part of the environment whitelist a spawned ffmpeg
 * child is given (`minimalChildEnv`). The schema reads them because that module is the only
 * one allowed to touch `process.env` at all, and the consumers need them as values — but
 * they describe the machine the process runs on, not a setting an operator chooses, and
 * `.env.example` says so nowhere because there is nothing to say. Documenting them as if they
 * were configuration would invite an operator to override the host's own `PATH`.
 *
 * An entry here is a claim that a key is the host's rather than the operator's. A genuine
 * setting added to the schema and left off this list is exactly what the test below is for.
 */
const NOT_ENV_EXAMPLE_CONFIGURATION = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
])

/** Every all-caps, underscore-joined token in the file, comments and values alike. */
const tokensIn = (contents: string): ReadonlySet<string> =>
  new Set(contents.split(/[^A-Z0-9_]+/).filter((token) => token.length > 0))

describe('.env.example', () => {
  const keys = schemaKeys().filter((key) => !NOT_ENV_EXAMPLE_CONFIGURATION.has(key))
  const example = readFileSync(ENV_EXAMPLE_PATH, 'utf8')
  const documented = tokensIn(example)

  it('declares at least as many keys as it did when this test was written', () => {
    // A floor rather than an exact count: the point is to catch a key silently
    // disappearing from the schema scan, not to make this test the place a new key's
    // count is bumped by hand every time one is added below.
    expect(keys.length).toBeGreaterThanOrEqual(41)
  })

  it.each(keys)('documents %s, active or commented, so an operator can find it', (key) => {
    // A commented-out line (`# SESSION_COOKIE_SECURE=false`) still counts: several
    // defaults are deliberately left for `NODE_ENV` to choose, and "mentioned, with an
    // explanation of why it is not set" is exactly as discoverable as an active line.
    // `NODE_ENV` itself is the extreme of that case — never a `KEY=` line at all,
    // explained in prose instead — and it passes here because the word appears in that
    // prose, which is the bar this test holds every key to.
    expect(documented.has(key), `${key} appears nowhere in .env.example`).toBe(true)
  })

  it('still omits NODE_ENV as a live assignment, because silence is the point', () => {
    // The one key whose entire documentation is an explanation of why there is no
    // `NODE_ENV=` line. If this test ever has to start passing a value for it, something
    // put the line back and quietly reversed the default this file argues for above.
    const activeAssignments = example
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
    expect(activeAssignments.some((line) => line.startsWith('NODE_ENV='))).toBe(false)
  })
})
