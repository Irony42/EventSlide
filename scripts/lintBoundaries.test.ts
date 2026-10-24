import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * The import boundaries `eslint.config.mjs` states, asserted by asking ESLint to lint a
 * line of source as if it lived in each layer — the same method as `lintCoverage.test.ts`,
 * for the same reason: a pattern that looks right and matches nothing is silent.
 *
 * The first block pins `nodemailer` (G2-07 / P3-08), the first dependency whose reach is
 * meant to be **one folder**: the SMTP adapter in `src/infrastructure/mail/`. A use case
 * that imported it could not be tested without a relay, and a domain rule that did could
 * not be called pure.
 *
 * Domain, application and the HTTP layer are the three layers that are forbidden it. Other
 * folders of `src/infrastructure/` and the composition root are not, and nothing here says
 * they are: the rule is "nothing that should not know about e-mail transport", which is
 * those three, and the adapter is where it lives.
 *
 * The blocks after it pin the rest of what the config says (review of the infrastructure
 * layer, I-04 and I-05): the import table of every layer, `process.env` in every spelling in
 * every layer, and where the bans on ambient time and randomness apply. Until then only
 * `nodemailer` was asserted, so emptying `DOMAIN_FORBIDDEN`, or a layer block whose `files`
 * glob stopped matching (CLAUDE.md §9 trap 9), failed nothing: no violating import exists,
 * so lint and every other test stayed green.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: ROOT })

const restrictedImports = async (filePath: string, source: string): Promise<readonly string[]> => {
  const [result] = await eslint.lintText(`import { x } from '${source}'\nvoid x\n`, {
    filePath: join(ROOT, filePath),
  })
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
      ['a route in the HTTP layer', 'src/interface/http/routes/example.ts'],
    ])('refuses it in %s', async (_name, filePath) => {
      expect(await restrictedImports(filePath, 'nodemailer')).toHaveLength(1)
    })

    it.each([
      ['a domain rule', 'src/domain/mail/example.ts'],
      ['a use case', 'src/application/usecases/auth/example.ts'],
      ['a route in the HTTP layer', 'src/interface/http/routes/example.ts'],
    ])('refuses a deep import of it in %s too', async (_name, filePath) => {
      expect(await restrictedImports(filePath, 'nodemailer/lib/addressparser')).toHaveLength(1)
    })

    it('allows it in the adapter that implements the port', async () => {
      expect(await restrictedImports('src/infrastructure/mail/example.ts', 'nodemailer')).toEqual(
        [],
      )
    })
  },
)

/* -------------------------------------------------------------------------- *
 * The rest of the architecture: the layer import table, `process.env` in every
 * spelling, and the two bans on ambient time and randomness.
 * -------------------------------------------------------------------------- */

const messagesOf = async (
  ruleId: string,
  filePath: string,
  source: string,
): Promise<readonly string[]> => {
  const [result] = await eslint.lintText(source, { filePath: join(ROOT, filePath) })
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === ruleId)
    .map((message) => message.message)
}

/** A representative path in each layer: ESLint picks the config block from the path alone. */
const IN = {
  domain: 'src/domain/events/example.ts',
  application: 'src/application/usecases/photos/example.ts',
  port: 'src/application/ports/example.ts',
  applicationDouble: 'src/application/testing/example.ts',
  infrastructure: 'src/infrastructure/db/example.ts',
  interface: 'src/interface/http/routes/example.ts',
  interfaceDouble: 'src/interface/http/testing/example.ts',
  main: 'src/main/example.ts',
  web: 'web/src/features/wall/example.tsx',
} as const

describe('the import boundary of each layer', { timeout: 60_000 }, () => {
  it.each([
    // The domain is pure: no outer layer, no framework, no I/O.
    ['domain', 'express'],
    ['domain', 'better-sqlite3'],
    ['domain', 'sharp'],
    ['domain', 'zod'],
    ['domain', 'react'],
    ['domain', 'fs'],
    ['domain', 'node:crypto'],
    ['domain', '../../application/ports/clock'],
    ['domain', '../../infrastructure/db/connection'],
    ['domain', '../../interface/http/server'],
    ['domain', '../../main/container'],
    // The application reaches ports and the domain, never an adapter or the HTTP layer.
    ['application', 'express'],
    ['application', 'better-sqlite3'],
    ['application', 'bcrypt'],
    ['application', 'pino'],
    ['application', 'fs'],
    ['application', 'node:crypto'],
    ['application', '../../../infrastructure/db/connection'],
    ['application', '../../../interface/http/server'],
    ['application', '../../../main/container'],
    ['port', '../../infrastructure/db/connection'],
    // Its doubles are held to the same rule: a fake that reaches for an adapter tests nothing.
    ['applicationDouble', '../../infrastructure/db/connection'],
    ['applicationDouble', 'better-sqlite3'],
    // An adapter implements a port: it does not know about HTTP or the composition root.
    ['infrastructure', '../../interface/http/server'],
    ['infrastructure', '../../main/container'],
    // The HTTP layer receives its dependencies; it never reaches an adapter or a mail library.
    ['interface', '../../../infrastructure/db/connection'],
    ['interface', '../../../main/container'],
    ['interface', 'nodemailer'],
    // The web app talks to the server over HTTP and shares no source with it.
    ['web', '../../../../src/domain/events/event'],
    ['web', '../../../../src/application/ports/clock'],
    ['web', '../../../../src/infrastructure/db/connection'],
  ] as const)('refuses %s importing %s', async (layer, source) => {
    expect(await restrictedImports(IN[layer], source)).toHaveLength(1)
  })

  it.each([
    ['domain', '../shared/result'],
    ['application', '../../../domain/events/event'],
    ['application', '../../ports/clock'],
    ['infrastructure', '../../application/ports/clock'],
    ['infrastructure', '../../domain/events/event'],
    ['infrastructure', 'better-sqlite3'],
    ['interface', '../../../application/ports/clock'],
    ['interface', '../../../domain/shared/result'],
    ['interface', 'express'],
    // The composition root and a harness that composes adapters for a test are the two
    // places an adapter may be named.
    ['main', '../infrastructure/db/connection'],
    ['main', 'express'],
    ['interfaceDouble', '../../../infrastructure/db/connection'],
  ] as const)('allows %s importing %s', async (layer, source) => {
    expect(await restrictedImports(IN[layer], source)).toEqual([])
  })
})

describe('the ban on reading process.env', { timeout: 60_000 }, () => {
  // Every way a program can read the environment without writing `process.env.NAME`. The
  // selector used to be `process.env.<anything>`, so the usual spelling, a destructuring,
  // went unnoticed; and a layer block that set its own `no-restricted-syntax` replaced the
  // rule outright, so domain and application were not held to it at all.
  const SPELLINGS: readonly (readonly [string, string])[] = [
    ['a property read', `const value = process.env.SECRET\nvoid value\n`],
    ['a bracket read', `const value = process.env['SECRET']\nvoid value\n`],
    ['a destructuring', `const { SECRET } = process.env\nvoid SECRET\n`],
    ['a spread', `const copy = { ...process.env }\nvoid copy\n`],
    ['a bare reference', `const env = process.env\nvoid env\n`],
    ['an enumeration', `const names = Object.keys(process.env)\nvoid names\n`],
    ['a bracket on process', `const value = process['env'].SECRET\nvoid value\n`],
    ['env pulled out of process', `const { env } = process\nvoid env\n`],
    ['a read through globalThis', `const value = globalThis.process.env.SECRET\nvoid value\n`],
    ['a named import of env', `import { env } from 'node:process'\nvoid env\n`],
  ]

  const GUARDED = [
    IN.main,
    IN.domain,
    IN.application,
    IN.port,
    IN.infrastructure,
    IN.interface,
    'src/infrastructure/config/schema.ts',
    'scripts/example.ts',
  ]

  it.each(SPELLINGS)(
    'refuses %s in every layer of the server and in scripts',
    async (_name, code) => {
      const unguarded: string[] = []
      for (const filePath of GUARDED) {
        if ((await messagesOf('no-restricted-syntax', filePath, code)).length === 0) {
          unguarded.push(filePath)
        }
      }

      expect(unguarded).toEqual([])
    },
  )

  it('says why, and where the one reader is', async () => {
    const [message] = await messagesOf('no-restricted-syntax', IN.main, SPELLINGS[0]?.[1] ?? '')

    expect(message).toContain('src/infrastructure/config/env.ts')
  })

  it.each(SPELLINGS)('lets env.ts, the one reader, use %s', async (_name, code) => {
    expect(
      await messagesOf('no-restricted-syntax', 'src/infrastructure/config/env.ts', code),
    ).toEqual([])
  })

  it.each([
    ['a test beside the code', 'src/main/example.test.ts'],
    ['a test double', IN.applicationDouble],
    ['an end-to-end fixture', 'tests/e2e/fixtures/example.ts'],
  ])('lets %s read the environment', async (_name, filePath) => {
    expect(await messagesOf('no-restricted-syntax', filePath, SPELLINGS[2]?.[1] ?? '')).toEqual([])
  })
})

describe('the ban on ambient time and randomness', { timeout: 60_000 }, () => {
  const AMBIENT: readonly (readonly [string, string])[] = [
    ['new Date()', `const at = new Date()\nvoid at\n`],
    ['Date.now()', `const at = Date.now()\nvoid at\n`],
    ['Math.random()', `const roll = Math.random()\nvoid roll\n`],
  ]

  it.each(AMBIENT)('refuses %s in the domain and in the application', async (_name, code) => {
    for (const filePath of [IN.domain, IN.application, IN.port]) {
      expect(
        await messagesOf('no-restricted-syntax', filePath, code),
        `${filePath} accepts it`,
      ).toHaveLength(1)
    }
  })

  it.each(AMBIENT)(
    'does not hold the adapters, the composition root or a test to it: %s',
    async (_name, code) => {
      // Where the rule applies is the point: an adapter is where the clock and the random
      // source are meant to be reached, and `Clock` and `IdGenerator` are the ports that
      // hand them to everything inward.
      for (const filePath of [
        IN.infrastructure,
        IN.main,
        IN.interface,
        IN.applicationDouble,
        'src/application/usecases/photos/example.test.ts',
      ]) {
        expect(await messagesOf('no-restricted-syntax', filePath, code), filePath).toEqual([])
      }
    },
  )

  it('still holds the domain to the process.env ban beside it', async () => {
    // The two lists share one rule name, and a block that names the rule replaces what an
    // earlier block said, so both bans are written into the domain and application blocks.
    const messages = await messagesOf(
      'no-restricted-syntax',
      IN.domain,
      `const at = new Date()\nconst value = process.env.SECRET\nvoid at\nvoid value\n`,
    )

    expect(messages).toHaveLength(2)
  })
})
