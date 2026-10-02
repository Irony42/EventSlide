/**
 * What this bundle was built from, before the server has been asked anything.
 *
 * Replaced at build time by Vite's `define` (`web/vite.config.ts`, from `web/buildInfo.ts`)
 * and, under test, by the fixed values in `vitest.config.ts` — so a test is about the
 * component, not about whichever version `package.json` happens to carry that week.
 */
declare const __APP_VERSION__: string
declare const __SOURCE_URL__: string

export const BUILD_VERSION: string = __APP_VERSION__

/**
 * The upstream tag of this build's source — right for the published image unmodified, and
 * only a default: `GET /api/about` carries the address the operator actually offers.
 */
export const BUILD_SOURCE_URL: string = __SOURCE_URL__
