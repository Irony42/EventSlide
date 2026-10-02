/**
 * The build-time half of the AGPL source offer (roadmap G1-04 / P1-05).
 *
 * The guest chunk is the first thing a phone loads, and the footer's "Code source" link is
 * on every screen in it, so the link cannot wait for a round trip: Vite injects the version
 * and the upstream address of **this build's** source as `__APP_VERSION__` and
 * `__SOURCE_URL__`, and the footer shows them from its first paint. `GET /api/about` is
 * asked for afterwards and, when it answers, replaces them — that answer is the one the
 * operator controls (`SOURCE_CODE_URL`), and the only one that can describe a deployment
 * built from somewhere other than upstream.
 *
 * This is a **second copy** of `resolveSourceUrl` in `src/infrastructure/config/env.ts`:
 * the web app may not import the server, and a config file is not worth a package of its
 * own. `scripts/aboutBuildInfo.test.ts` compares the two over every shape of input, so the
 * copy cannot drift. Plain TypeScript with no Node imports, which is what lets that test
 * import it.
 */

const UPSTREAM_REPOSITORY = 'https://github.com/Irony42/EventSlide'

/** The same shape `SOURCE_REF` is held to at boot. See `sourceRef` in `env.ts`. */
const SOURCE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

/**
 * The compile-time constants for a given `package.json` version and the `SOURCE_REF` the
 * Dockerfile's build argument set, if any. A ref that is not a git ref fails the **build**,
 * where a wrong value would otherwise be baked into every bundle the image ever serves.
 */
export const buildDefines = (
  version: string,
  sourceRef: string | undefined,
): Record<'__APP_VERSION__' | '__SOURCE_URL__', string> => {
  const ref = sourceRef?.trim() ?? ''
  if (ref !== '' && (!SOURCE_REF.test(ref) || ref.includes('..'))) {
    throw new Error(`SOURCE_REF is not a git tag, branch or commit: ${JSON.stringify(ref)}`)
  }
  const tree = ref === '' ? `v${version}` : ref
  return {
    __APP_VERSION__: JSON.stringify(version),
    __SOURCE_URL__: JSON.stringify(`${UPSTREAM_REPOSITORY}/tree/${tree}`),
  }
}
