/**
 * Every sentence a copy table can produce, flattened.
 *
 * Two tests need this and they need the same thing from it: `translations.test.ts` asks
 * whether a string is worth rendering, `orthography.test.ts` asks whether it is spelled
 * correctly. Neither can do its job on the table as written, because a third of the
 * entries are functions and a sentence only exists once one has been called.
 *
 * It lives under `testing/` for the same reason `src/application/testing/` does: it is a
 * harness, it is excluded from coverage, and nothing in the running app imports it.
 */

/**
 * The arguments each phrase is called with.
 *
 * Numbers, and a spread of them, because the interesting thing about a counted phrase is
 * that it has more than one form: `0` and `1` are singular in French and plural in the
 * other four, `11` is the German *keine Ausnahme* that people expect to be special and
 * is not, and `1000` is where the thousands separator appears — a narrow no-break space
 * in French, a full stop in German and Italian. Every one of those is a different string
 * with different characters in it, and each has to be checked.
 *
 * A phrase that takes a name rather than a count gets a number too. What is being
 * checked is the words around the hole, not what goes in it.
 *
 * Each probe is wrapped in a **one-element array**, which is not a flourish: `wall`
 * carries one phrase that takes a list of layout names and calls `.join` on it, and
 * `[2]` is the one value that satisfies every parameter in the tables — it interpolates
 * as "2", `Intl` formats it as 2, `Intl.PluralRules` selects on 2, and it has `.join`.
 * The alternative is a per-phrase table of arguments, which is a second copy of the
 * table for somebody to forget to update.
 */
const PROBES: readonly (readonly [number])[] = [[0], [1], [2], [11], [1000]]

/** One rendered sentence, and enough of a path to find it again when it fails. */
export interface Rendered {
  readonly path: string
  readonly text: string
}

/**
 * Read one property of a value whose shape is not known statically.
 *
 * `Reflect.get` behind an `unknown` return, which is the idiom `guestSession.ts` already
 * uses for the same reason: `Object.entries` on a bare `object` hands back `any`, and
 * this repository does not have `any` in it.
 */
const field = (source: object, key: string): unknown => Reflect.get(source, key)

/** A phrase, once it is known to be callable. Tables only ever build strings. */
type Phrase = (...args: readonly (readonly [number])[]) => string

export const walkTable = (table: object, prefix = ''): readonly Rendered[] => {
  const found: Rendered[] = []

  for (const key of Object.keys(table)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    const value = field(table, key)

    if (typeof value === 'string') {
      found.push({ path, text: value })
      continue
    }

    if (typeof value === 'function') {
      const phrase = value as Phrase
      // `Function.length` is the declared arity, so a two-argument phrase gets two
      // probes and never renders "undefined" into the middle of a sentence.
      const arity = Math.max(phrase.length, 1)
      for (const probe of PROBES) {
        // Each position gets its own value — `[1000]`, `[1001]`, … — rather than the
        // same one repeated. A phrase given the same number twice renders a sentence in
        // which the two holes are indistinguishable, which is a sentence no caller will
        // ever produce; `clipHint` handed (0, 0) reads plausibly whichever way round its
        // arguments are. The first position keeps the plural boundary.
        const values = Array.from({ length: arity }, (_, at): readonly [number] => [probe[0] + at])
        found.push({ path: `${path}(${probe[0]})`, text: phrase(...values) })
      }
      continue
    }

    if (typeof value === 'object' && value !== null) {
      found.push(...walkTable(value, path))
    }
  }

  return found
}
