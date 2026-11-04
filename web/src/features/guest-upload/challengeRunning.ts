import { remainingMs } from '../../lib/serverClock'
import type { GuestChallengeDto } from '../../lib/api/dto'

/** Whether the challenge is still running on the server's clock, as this phone reckons it. */
export const isChallengeRunning = (
  challenge: GuestChallengeDto | null,
  offsetMs: number,
  localNowMs: number,
): boolean =>
  challenge !== null &&
  challenge.state === 'running' &&
  remainingMs(Date.parse(challenge.endsAt), localNowMs, offsetMs) > 0
