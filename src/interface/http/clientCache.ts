import { relative, resolve, sep } from 'node:path'

/**
 * What the build names its output files, and so what may be cached for good.
 *
 * Vite's default for every file it emits under `assets/` (entry, chunk, stylesheet and
 * anything a stylesheet imports) is `assets/[name]-[hash][extname]`, and `web/vite.config.ts`
 * does not change it. The hash is **eight base64url characters** — `A-Z a-z 0-9 _ -`, so it
 * can contain, and end in, the separator itself: `index-Bm0-ak5a.js`, `index-Bp3_lgP8.css`,
 * `ClientSpacePage-DDFGgAb-.js` are real names. It is derived from the file's content, so a
 * name that exists never changes what it holds, which is the whole condition for `immutable`.
 * `sourcemap: true` adds `<that name>.map` beside each script.
 *
 * Three things keep this from being looser than the build:
 *
 * - **Under `assets/` and nowhere else.** The client directory's root holds names a person
 *   chose and reused with new content at each deploy: `index.html`, `sw.js`,
 *   `manifest.webmanifest`, `favicon.svg`, `icons/`. One of them, `third-party-licenses.txt`,
 *   ends `-<eight characters>.txt` and would pass a pattern that only looked at the shape of
 *   the name.
 * - **Exactly eight characters, flat.** A shorter or longer tail, or a file in a
 *   sub-directory, is not something the build emitted.
 * - **Relative to the client directory.** `setHeaders` is given the file's absolute path, in
 *   the operating system's separators; a box that keeps the client directory under a folder
 *   called `assets` would otherwise promote the files in its root.
 *
 * A Vite upgrade that changes the naming turns this rule off without anyone noticing — every
 * chunk goes back to being revalidated at each page load, over venue Wi-Fi — which is why
 * `clientCache.test.ts` is fed the build's own names.
 */
const CONTENT_HASHED_ASSET = /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+(?:\.map)?$/

/**
 * Whether `file` (the absolute path `express.static` serves) is one the build names after
 * its own content, so that it may be sent `Cache-Control: immutable`.
 */
export const isContentHashedAsset = (clientDir: string, file: string): boolean =>
  CONTENT_HASHED_ASSET.test(relative(resolve(clientDir), file).split(sep).join('/'))
