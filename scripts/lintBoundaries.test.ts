import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * The import boundaries `eslint.config.mjs` states, asserted by asking ESLint to lint a
 * line of source as if it lived in each layer — the same method as `lintCoverage.test.ts`,
 * for the same reason: a pattern that looks right and matches nothing is silent.
 *
 * Only the claims added with the mailer (G2-07 / P3-08) are pinned here. `nodemailer` is
 * the first dependency whose reach is meant to be **one folder**: the SMTP adapter in
 * `src/infrastructure/mail/`. A use case that imported it could not be tested without a
 * relay, and a domain rule that did could not be called pure.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: ROOT })

const importOf = async (filePath: string): Promise<readonly string[]> => {
  const [result] = await eslint.lintText(
    "import { createTransport } from 'nodemailer'\nvoid createTransport\n",
    {
      filePath: join(ROOT, filePath),
    },
  )
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message)
}

// The first lint of a run loads the TypeScript parser and every rule, which takes seconds.
describe(
  'nodemailer may be imported by the SMTP adapter and by nothing inner',
  { timeout: 60_000 },
  () => {
    it.each([
      ['a domain rule', 'src/domain/mail/example.ts'],
      ['a use case', 'src/application/usecases/auth/example.ts'],
      ['a port', 'src/application/ports/example.ts'],
    ])('refuses it in %s', async (_name, filePath) => {
      expect(await importOf(filePath)).toHaveLength(1)
    })

    it('allows it in the adapter that implements the port', async () => {
      expect(await importOf('src/infrastructure/mail/example.ts')).toEqual([])
    })
  },
)
