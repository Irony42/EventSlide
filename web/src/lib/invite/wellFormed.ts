/**
 * The text with every lone surrogate (half of a pair that lost the other) replaced by U+FFFD.
 * `encodeURIComponent` throws a `URIError` on one, and a host's word, a stored message, can carry
 * one (a cut emoji pasted from elsewhere): a link built while the page renders must not crash it.
 */
export const wellFormed = (text: string): string => {
  const native = (text as { toWellFormed?: () => string }).toWellFormed
  if (typeof native === 'function') return native.call(text)
  return text.replace(LONE_SURROGATE, '\ufffd')
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
