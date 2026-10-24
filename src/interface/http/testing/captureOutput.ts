/**
 * The harness moved to `src/infrastructure/logging/testing/captureOutput.ts`, beside the adapter
 * whose output it reads, so that a test of an adapter can use it too. This re-export keeps the
 * canaries that import it from here working; they can import it from there directly.
 */
export { captureAllOutputWhile } from '../../../infrastructure/logging/testing/captureOutput'
