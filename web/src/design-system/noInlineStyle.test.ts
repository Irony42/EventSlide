import { describe, expect, it } from 'vitest'

/**
 * Nothing in the web app writes an inline style in a way the production CSP refuses.
 *
 * The server sends `style-src 'self'` in production (docs/SECURITY.md section 8). That is
 * safe because React applies a `style={{}}` prop through the CSSOM, which `style-src` does
 * not govern; what it governs is a `<style>` element and an HTML `style=""` attribute. Both
 * are easy to introduce by hand and **neither fails anywhere in CI**: the end-to-end and
 * visual jobs run with `NODE_ENV=test`, which keeps `'unsafe-inline'`, so the first person to
 * see the damage would be a guest in production, on an unstyled page.
 *
 * So the premise is a sweep of the source, as the glass material's rules are: a file added
 * tomorrow is in it the moment it exists. A hit is not always wrong, but it is always a
 * decision, and this is the place to make it out loud.
 */

const SOURCES = import.meta.glob<string>('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** What writes markup or a style attribute outside the CSSOM. */
const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['innerHTML / outerHTML', /\.(inner|outer)HTML\b/],
  ['insertAdjacentHTML', /insertAdjacentHTML/],
  ['setAttribute("style", ...)', /setAttribute\(\s*['"]style['"]/],
  ['style.cssText', /\.cssText\b/],
  ['a <style> element in JSX', /<style[\s>]/],
  ['createElement("style")', /createElement\(\s*['"]style['"]/],
  ['a constructed stylesheet', /adoptedStyleSheets|new CSSStyleSheet/],
]

const production = Object.entries(SOURCES).filter(([path]) => !/\.test\.tsx?$/.test(path))

describe('the web app and the production style-src', () => {
  it('sweeps the real sources, not an empty glob', () => {
    expect(production.length).toBeGreaterThan(100)
  })

  it.each(FORBIDDEN)('writes no inline style through %s', (_name, pattern) => {
    const hits = production.filter(([, source]) => pattern.test(source)).map(([path]) => path)

    expect(hits).toEqual([])
  })
})
