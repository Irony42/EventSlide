import { describe, expect, it } from 'vitest'
import { withoutComments } from '../testing/withoutComments'

/**
 * Three one-line questions about a thrown value are answered in one place each — the source,
 * read.
 *
 * - **Is it an abort?** `isAbortError`, in `lib/http.ts`. Ten catches spelled it
 *   `cause instanceof DOMException && cause.name === 'AbortError'` for as long as there was
 *   no helper, and the copies are not harmless: the test is load-bearing (an unfiltered abort
 *   from an effect's own cleanup is reported to a host as a failure), and a copy that drifted
 *   — an `instanceof Error`, a missing `name` — would report it in one hook and not in the
 *   others.
 * - **Is it an `Error`?** `asError`, in the same file, where a hook's state wants one.
 * - **What does it say to the reader?** `messageForError`, beside `messageForCode` in
 *   `lib/i18n/translations.ts`. Eight places spelled the `ApiError` branch and the generic
 *   fallback, two of them as byte-identical files that argued for the duplication.
 *
 * Read as text rather than imported, because what is asserted is how the code is spelled: no
 * behaviour tells the copies apart until one of them drifts.
 */

const MODULES = import.meta.glob<string>('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Glob keys arrive relative to this file: a sibling as `./x`, a cousin as `../app/x`. */
const named = (path: string): string => path.replace(/^\.\//, 'lib/').replace(/^\.\.\//, '')

/** Production modules only: a test may spell a thrown value however it likes. */
const production = Object.entries(MODULES)
  .map(([path, source]) => [named(path), source] as const)
  .filter(([path]) => !/\.test\.tsx?$/.test(path))

/**
 * A name compared with the browser's abort, in either order, with `===` or `!==`, with any
 * quotes — and whatever came before it: `instanceof DOMException`, `instanceof Error`, a bare
 * `error?.name`. What is looked for is the comparison and not one author's way of guarding it,
 * so a line break after the `&&` or a reversed operand does not slip past. `new
 * DOMException('…', 'AbortError')`, which *makes* an abort, is not a comparison.
 */
const ABORT_TEST =
  /\.name\s*[!=]==?\s*['"]AbortError['"]|['"]AbortError['"]\s*[!=]==?\s*[\w.?]+\.name/g

/** A thrown value made an `Error` by hand: `new Error(String(x))` or `new Error(`${x}`)`. */
const WRAP_IN_ERROR = /new\s+Error\(\s*(?:String\(|`\$\{)/g

/**
 * An `ApiError` branch and its generic fallback, spelled by hand: the ternary with
 * `errors.unknown` after it, and the one that picks the code before asking for the sentence.
 * A fallback that is a different sentence (`text.wall.errorTitle`) is a different question
 * and is not matched.
 */
const SENTENCE_FOR_ERROR =
  /instanceof\s+ApiError\s*\?\s*messageForCode\([^)]*\)\s*:\s*\w+\.errors\.unknown|messageForCode\(\s*[\w.]+\s+instanceof\s+ApiError\s*\?/g

const count = (pattern: RegExp, source: string): number =>
  [...withoutComments(source).matchAll(pattern)].length

/**
 * Each spelling, the helper that replaces it, and the one module allowed to spell it: that
 * helper. The count is exact rather than "at most", so a helper that stopped spelling it —
 * and left its allowance behind to excuse the next copy — fails too.
 */
const RULES = [
  {
    spelling: "a name compared with 'AbortError'",
    helper: 'isAbortError',
    pattern: ABORT_TEST,
    home: 'lib/http.ts',
  },
  {
    spelling: 'new Error(String(…)) by hand',
    helper: 'asError',
    pattern: WRAP_IN_ERROR,
    home: 'lib/http.ts',
  },
  {
    spelling: 'an ApiError branch with errors.unknown after it',
    helper: 'messageForError',
    pattern: SENTENCE_FOR_ERROR,
    home: 'lib/i18n/translations.ts',
  },
] as const

describe('a thrown value is asked the same three questions in one place each', () => {
  it('has something to read, rather than an empty glob', () => {
    expect(production.length).toBeGreaterThan(100)
    expect(production.map(([path]) => path)).toContain('lib/http.ts')
  })

  it('finds each spelling, in the shapes this tree has had and the ones it could gain', () => {
    // The detector pointed at known positives: without this, "no offenders" below is as
    // green for a broken regex as for a clean product. A guard on spellings, not a proof: it
    // stops the copies the tree has had and the obvious neighbours of them.
    expect(
      count(ABORT_TEST, "if (cause instanceof DOMException && cause.name === 'AbortError') return"),
    ).toBe(1)
    expect(count(ABORT_TEST, 'x instanceof DOMException && x.name === "AbortError"')).toBe(1)
    expect(
      count(ABORT_TEST, "cause instanceof DOMException &&\n cause.name === 'AbortError'"),
    ).toBe(1)
    expect(count(ABORT_TEST, "cause.name === 'AbortError' && cause instanceof DOMException")).toBe(
      1,
    )
    expect(count(ABORT_TEST, "'AbortError' === cause.name")).toBe(1)
    expect(count(ABORT_TEST, "cause instanceof Error && cause.name === 'AbortError'")).toBe(1)
    expect(count(ABORT_TEST, "(error as Error).name !== 'AbortError'")).toBe(1)
    expect(count(WRAP_IN_ERROR, 'cause instanceof Error ? cause : new Error(String(cause))')).toBe(
      1,
    )
    expect(count(WRAP_IN_ERROR, 'new Error(`${cause}`)')).toBe(1)
    expect(
      count(
        SENTENCE_FOR_ERROR,
        'cause instanceof ApiError ? messageForCode(cause.code, text) : text.errors.unknown',
      ),
    ).toBe(1)
    expect(
      count(
        SENTENCE_FOR_ERROR,
        'cause instanceof ApiError ? messageForCode(cause.code, t) : t.errors.unknown',
      ),
    ).toBe(1)
    expect(
      count(
        SENTENCE_FOR_ERROR,
        'messageForCode(cause instanceof ApiError ? cause.code : undefined, t)',
      ),
    ).toBe(1)
  })

  it('leaves alone what is a different question', () => {
    // `NotAllowedError` is a refusal, a different fallback is a different sentence, making an
    // abort is not testing for one, and a comment is prose.
    expect(
      count(ABORT_TEST, "!(cause instanceof DOMException) || cause.name !== 'NotAllowedError'"),
    ).toBe(0)
    expect(count(ABORT_TEST, "reject(new DOMException('Upload aborted', 'AbortError'))")).toBe(0)
    expect(
      count(
        SENTENCE_FOR_ERROR,
        'error instanceof ApiError ? messageForCode(error.code, text) : text.wall.errorTitle',
      ),
    ).toBe(0)
    expect(count(ABORT_TEST, "// was: x instanceof DOMException && x.name === 'AbortError'")).toBe(
      0,
    )
  })

  it.each(RULES)('spells $spelling only in $helper, in $home', ({ pattern, home }) => {
    const offenders = production
      .map(([path, source]) => [path, count(pattern, source)] as const)
      .filter(([, found]) => found > 0)

    expect(offenders).toEqual([[home, 1]])
  })

  it('keeps the two per-feature errorMessage copies deleted', () => {
    expect(
      production.map(([path]) => path).filter((path) => /(^|\/)errorMessage\.ts$/.test(path)),
    ).toEqual([])
  })
})
