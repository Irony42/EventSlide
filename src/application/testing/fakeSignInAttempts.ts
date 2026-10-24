import type { SignInAttempts } from '../ports/signInAttempts'

/**
 * A counter a test reads. It holds every sign-in for as long as it lives, with no expiry: a
 * test drives time through the clock of the thing under test, and what it needs from this is
 * the number, not the forgetting.
 */
export class FakeSignInAttempts implements SignInAttempts {
  private readonly taken = new Map<string, number>()

  begin(attemptId: string): number {
    const next = (this.taken.get(attemptId) ?? 0) + 1
    this.taken.set(attemptId, next)
    return next
  }

  release(attemptId: string): void {
    const held = this.taken.get(attemptId)
    if (held !== undefined && held > 0) this.taken.set(attemptId, held - 1)
  }

  /** How many attempts this sign-in is holding now, for a test that asserts on what was given back. */
  held(attemptId: string): number {
    return this.taken.get(attemptId) ?? 0
  }
}
