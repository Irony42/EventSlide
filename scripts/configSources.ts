import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The source of the configuration module, as one string.
 *
 * `src/infrastructure/config/env.ts` used to hold the whole schema, and four tests read it as text
 * to pin a claim about a variable (a default, the `NODE_ENV` posture, the keys `.env.example` must
 * list, the text of a boot warning). The module is several files now (`schema.ts`, the field
 * files, `load.ts`, `env.ts`), and what those tests mean is "the configuration module says this",
 * not "this file does", so they read all of it: moving a declaration between two of its files
 * does not move a claim out of their sight.
 *
 * Test files are left out: the claims are about what the server does.
 */
const CONFIG_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'infrastructure',
  'config',
)

export const configSources = (): string =>
  readdirSync(CONFIG_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
    .map((name) => readFileSync(join(CONFIG_DIR, name), 'utf8'))
    .join('\n')
