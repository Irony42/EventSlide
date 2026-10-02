import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The files a self-hoster copies, held to the promise the operator keys make (roadmap
 * G2-17 / P3-18): **`OPERATOR_NAME`, `OPERATOR_CONTACT_EMAIL`, `LEGAL_TERMS_URL`,
 * `LEGAL_PRIVACY_URL`, `LEGAL_NOTICE_URL`, `SUPPORT_URL` and `REPORT_URL` are empty unless the
 * operator sets them**, so a box that never named an operator names none, links to nothing,
 * and shows its guests the notice they have always been shown.
 *
 * `env.test.ts` proves the schema has no default and `container.test.ts` proves a booted box
 * publishes nothing. Neither reads these files, and a self-hoster never sees the schema: they
 * see `compose.yaml` and `.env.example`. A default of `OPERATOR_NAME: EventSlide` in either
 * one would put a name in every guest's privacy notice and make every guest of every
 * installation read it again — with every ring green. `supportLinks.test.ts` is the sibling
 * for the donation links.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

/** Lines that are code: no blank lines, no whole-line comments. */
const codeLines = (text: string): readonly string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

const VARIABLES = [
  'OPERATOR_NAME',
  'OPERATOR_CONTACT_EMAIL',
  'LEGAL_TERMS_URL',
  'LEGAL_PRIVACY_URL',
  'LEGAL_NOTICE_URL',
  'SUPPORT_URL',
  'REPORT_URL',
] as const

describe('the deployment files and the operator keys', () => {
  it.each(VARIABLES)('compose.yaml passes %s through, blank when unset', (name) => {
    // `:-` renders an empty string, which `env.ts` reads as absent. Any text after it
    // would be a default every `docker compose up` inherits.
    expect(codeLines(read('compose.yaml'))).toContain(`${name}: \${${name}:-}`)
  })

  it('compose.yaml has no other way to set any of them', () => {
    const lines = codeLines(read('compose.yaml')).filter((line) =>
      VARIABLES.some((name) => line.startsWith(`${name}:`)),
    )

    expect(lines.sort()).toEqual(VARIABLES.map((name) => `${name}: \${${name}:-}`).sort())
  })

  it.each(VARIABLES)('.env.example documents %s and sets nothing', (name) => {
    // Commented out: a copied `.env.example` must not pin a placeholder name or page on an
    // instance that never had an operator.
    const example = read('.env.example')

    expect(example).toMatch(new RegExp(`^# ${name}=`, 'm'))
    expect(example.split('\n').filter((line) => line.startsWith(`${name}=`))).toEqual([])
  })

  it('the Dockerfile bakes none of them into the image', () => {
    // An `ENV OPERATOR_NAME=...` would name an operator on every box that runs the published
    // image, whatever the operator's compose file says.
    const dockerfile = read('Dockerfile')

    for (const name of VARIABLES) expect(dockerfile).not.toContain(name)
  })
})

describe('the documents and the promise that an empty box changes nothing', () => {
  const squashed = (text: string): string => text.replace(/\n(?:#|>)?\s*/g, ' ')

  it('.env.example says they are empty by default and that an empty box changes in no way', () => {
    const prose = squashed(read('.env.example'))

    expect(prose).toContain('they are empty unless you set them')
    expect(prose).toContain('your screens change in no way')
  })

  it('.env.example says a path on the site is allowed and what is refused', () => {
    const prose = squashed(read('.env.example'))

    expect(prose).toContain('a path on your own site')
    expect(prose).toContain('are refused at boot')
  })

  it('docs/API.md says the same, and that the keys are absent rather than null', () => {
    const prose = squashed(read('docs', 'API.md'))

    expect(prose).toContain('**empty by default**')
    expect(prose).toContain('**The key is absent**')
    expect(prose).toContain('exactly what it answered before')
  })

  it('the README names all seven keys in one line, with the same promise', () => {
    const line = read('README.md')
      .split('\n')
      .find((candidate) => candidate.includes('OPERATOR_NAME'))

    for (const name of VARIABLES) expect(line).toContain(name)
    expect(line).toContain('exactly as before')
  })
})
