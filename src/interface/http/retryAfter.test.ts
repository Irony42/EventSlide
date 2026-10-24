import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every 429 is built with a wait in it, or by the one place that sets the header itself
 * (HTTP-M-04): docs/API.md section 1 says "`Retry-After` is set" for every `rateLimited`, and
 * `sendError` writes the header from `details.retryAfterSeconds` and only from there.
 *
 * Three use cases built a 429 without it, and the header was missing from the wire until a
 * review walked the table. The wire is checked where each of them is answered; what this file
 * adds is the sentence that stops the next one: a `DomainError.rateLimited(...)` written
 * anywhere in `src` carries `retryAfterSeconds`, except the one in `windowLimiter` (`rateLimit.ts`),
 * whose header `express-rate-limit` has already set on the response when it calls the handler
 * (`rateLimit.test.ts` walks every limiter for it).
 *
 * Read as source because the property is about how a value is *built*; the behaviour is the
 * route and limiter tests'.
 */

const SRC = join(process.cwd(), 'src')

const sourceFiles = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })

/** The text between the parentheses of the call that opens at `open`, balanced. */
const argumentsAt = (text: string, open: number): string => {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1
    if (text[index] === ')') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, index)
    }
  }
  throw new Error('an unbalanced call')
}

interface Call {
  readonly where: string
  readonly args: string
}

const callsToRateLimited = (): readonly Call[] =>
  sourceFiles(SRC).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    const calls: Call[] = []
    for (const match of text.matchAll(/DomainError\.rateLimited\(/g)) {
      const open = match.index + match[0].length - 1
      calls.push({
        where: relative(SRC, file).replaceAll('\\', '/'),
        args: argumentsAt(text, open),
      })
    }
    return calls
  })

describe('every 429 is built with a Retry-After', () => {
  it('finds the calls it is about, so an empty result is not a pass', () => {
    const where = callsToRateLimited().map((call) => call.where)

    expect(where).toEqual(
      expect.arrayContaining([
        'application/usecases/auth/issueInvitation.ts',
        'application/usecases/auth/issuePasswordResetForAccount.ts',
        'application/usecases/reactions/reactToPhoto.ts',
        'interface/http/middleware/rateLimit.ts',
        'interface/http/middleware/signInThrottle.ts',
      ]),
    )
  })

  it('never writes a 429 by hand, which is how a header goes missing', () => {
    const byHand = sourceFiles(SRC)
      .filter((file) => /status\(\s*429\s*\)/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).replaceAll('\\', '/'))

    expect(byHand).toEqual([])
  })

  it('writes retryAfterSeconds into every DomainError.rateLimited, but the one that express-rate-limit has already answered for', () => {
    const missing = callsToRateLimited()
      .filter((call) => !call.args.includes('retryAfterSeconds'))
      .filter(
        (call) =>
          !(call.where === 'interface/http/middleware/rateLimit.ts' && call.args.trim() === 'code'),
      )

    expect(missing).toEqual([])
  })
})
