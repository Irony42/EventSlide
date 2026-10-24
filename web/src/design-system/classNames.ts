/**
 * Joins class names: the one spelling of it in the app.
 *
 * A CSS Module is typed as an index signature, so under `noUncheckedIndexedAccess` every
 * `styles['x']` is `string | undefined`. Three workarounds grew around that, and each
 * had a fault of its own: a template literal prints the word "undefined" into the
 * attribute when a class is missing from the stylesheet, `?? ''` leaves an empty
 * `class` attribute behind, and `[...].filter(Boolean).join(' ')` was copied into
 * twenty-odd components. This takes the `undefined` as an argument instead, so the
 * caller never has to coax a class into a `string` first.
 *
 * Falsy parts are dropped (`false` is what `condition && styles['x']` evaluates to),
 * the order is the order given, and the parts are joined by exactly one space. An empty
 * result is `''`, never `undefined`: a caller that needs "no class" passes the lone
 * `styles['x']` itself.
 *
 * The primitives' own `className` props are typed `string | undefined` for the same
 * reason (`exactOptionalPropertyTypes` makes an explicit `undefined` a different thing
 * from an absent prop), so `className={styles['x']}` goes straight through.
 * `classNames.guard.test.ts` keeps the three old spellings out.
 */
export const cx = (...parts: readonly (string | false | null | undefined)[]): string =>
  parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
