import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The files a self-hoster copies, held to the promise the support links make (roadmap
 * G4-02): **`DONATION_URL` and `BUDGET_URL` are empty unless the operator sets them**, so a
 * box that was never told to ask for money asks for none.
 *
 * `env.test.ts` proves the schema has no default and `container.test.ts` proves a booted
 * box publishes no link. Neither reads these files, and a self-hoster never sees the
 * schema: they see `compose.yaml` and `.env.example`. A default of
 * `https://opencollective.com/...` in either one would put a donation link on every
 * guest-reachable `/about` of every installation, with every ring green — which is the
 * only reason this file exists. `sourceOffer.test.ts` is its sibling for `SOURCE_CODE_URL`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

/** Lines that are code: no blank lines, no whole-line comments. */
const codeLines = (text: string): readonly string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

const VARIABLES = ['DONATION_URL', 'BUDGET_URL'] as const

describe('the deployment files and the support links', () => {
  it.each(VARIABLES)('compose.yaml passes %s through, blank when unset', (name) => {
    // `:-` renders an empty string, which `env.ts` reads as absent. Any text after it
    // would be a default every `docker compose up` inherits.
    expect(codeLines(read('compose.yaml'))).toContain(`${name}: \${${name}:-}`)
  })

  it('compose.yaml has no other way to set either of them', () => {
    const lines = codeLines(read('compose.yaml')).filter((line) =>
      VARIABLES.some((name) => line.includes(name)),
    )

    expect(lines.sort()).toEqual(['BUDGET_URL: ${BUDGET_URL:-}', 'DONATION_URL: ${DONATION_URL:-}'])
  })

  it.each(VARIABLES)('.env.example documents %s and sets nothing', (name) => {
    // Commented out: a copied `.env.example` must not pin a placeholder donation page
    // on an instance that never asked for one.
    const example = read('.env.example')

    expect(example).toContain(`# ${name}=https://`)
    expect(example.split('\n').filter((line) => line.startsWith(`${name}=`))).toEqual([])
  })

  it('the Dockerfile bakes neither into the image', () => {
    // An `ENV DONATION_URL=...` would make the published image itself ask for money, on
    // every box that runs it, whatever the operator's compose file says.
    const dockerfile = read('Dockerfile')

    for (const name of VARIABLES) expect(dockerfile).not.toContain(name)
  })
})

describe('the documents and the promise that a donation unlocks nothing', () => {
  const squashed = (text: string): string => text.replace(/\n(?:#|>)?\s*/g, ' ')

  it('.env.example says they are empty by default, and that a donation unlocks nothing', () => {
    const prose = squashed(read('.env.example'))

    expect(prose).toContain('they are empty unless you set them')
    expect(prose).toContain('A donation unlocks nothing')
  })

  it('docs/API.md says the same, and where the links are never shown', () => {
    const prose = squashed(read('docs', 'API.md'))

    expect(prose).toContain('**empty by default**')
    expect(prose).toContain('**A donation unlocks nothing:**')
    expect(prose).toContain('**never** shown on the projected wall')
  })

  it('the README names both variables in one line, with the same promise', () => {
    const line = read('README.md')
      .split('\n')
      .find((candidate) => candidate.includes('DONATION_URL'))

    expect(line).toContain('BUDGET_URL')
    expect(line).toContain('a donation unlocks nothing')
  })
})
