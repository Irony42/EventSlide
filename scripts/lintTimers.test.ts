import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * Every timer the server starts goes through `backgroundTimers.ts`, which unrefs it.
 *
 * A timer that is not unref'd holds the process open: `docker stop` waits out the whole
 * interval before Node's event loop empties. The call was written beside twelve `setInterval`
 * and `setTimeout` calls and asserted at two, so dropping it anywhere else failed nothing.
 * Asked of ESLint itself, as `lintBoundaries.test.ts` does, because a glob that matches
 * nothing is silent.
 *
 * The scope is `src/main` and `src/infrastructure`. The SSE heartbeat in
 * `src/interface/http/routes/streamRoutes.ts` keeps its own `unref()` and is not covered.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: ROOT })

const messagesOf = async (filePath: string, source: string): Promise<readonly string[]> => {
  const [result] = await eslint.lintText(source, { filePath: join(ROOT, filePath) })
  return (result?.messages ?? [])
    .filter(
      (message) =>
        message.ruleId === 'no-restricted-globals' || message.ruleId === 'no-restricted-properties',
    )
    .map((message) => message.message)
}

const RAW = [
  ['setInterval', `const timer = setInterval(() => undefined, 1_000)\nclearInterval(timer)\n`],
  ['setTimeout', `const timer = setTimeout(() => undefined, 1_000)\nclearTimeout(timer)\n`],
  [
    'globalThis.setTimeout',
    `const timer = globalThis.setTimeout(() => undefined, 1_000)\nclearTimeout(timer)\n`,
  ],
  [
    'global.setInterval',
    `const timer = global.setInterval(() => undefined, 1_000)\nclearInterval(timer)\n`,
  ],
] as const

describe('raw timers in the server', { timeout: 60_000 }, () => {
  it.each(RAW)(
    'refuses a raw %s in the composition root and in every adapter',
    async (_name, code) => {
      for (const filePath of [
        'src/main/example.ts',
        'src/infrastructure/db/example.ts',
        'src/infrastructure/media/example.ts',
        'src/infrastructure/mail/example.ts',
        'src/infrastructure/time/example.ts',
      ]) {
        expect(await messagesOf(filePath, code), filePath).toHaveLength(1)
      }
    },
  )

  it.each(RAW)('says which helper to use instead of a raw %s', async (name, code) => {
    const [message] = await messagesOf('src/main/example.ts', code)

    expect(message).toContain('src/infrastructure/time/backgroundTimers.ts')
    expect(message).toContain(
      name === 'setInterval' ? 'setBackgroundInterval' : 'setBackgroundTimeout',
    )
  })

  it.each(RAW)(
    'lets the helper itself call a raw %s, and a test or a test double',
    async (_name, code) => {
      for (const filePath of [
        'src/infrastructure/time/backgroundTimers.ts',
        'src/main/example.test.ts',
        'src/infrastructure/media/example.test.ts',
        'src/infrastructure/db/testing/example.ts',
      ]) {
        expect(await messagesOf(filePath, code), filePath).toEqual([])
      }
    },
  )
})
