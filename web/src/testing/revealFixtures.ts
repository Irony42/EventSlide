import type { RevealDto } from '../lib/api/dto'

/** The server's clock in the reveal fixtures: a fixed instant, so a countdown is a sum. */
export const REVEAL_NOW_MS = 1_800_000_000_000

/**
 * A held disposable-camera evening by default: the mode on, not revealed, the hour in an hour.
 * `revealed: true` and `enabled: false` are the two ways an evening stops being held.
 */
export const aRevealBlock = (overrides: Partial<RevealDto> = {}): RevealDto => ({
  enabled: true,
  revealed: false,
  atMs: REVEAL_NOW_MS + 3_600_000,
  serverNowMs: REVEAL_NOW_MS,
  film: false,
  ...overrides,
})
