/**
 * How many guesses one half-finished sign-in has spent at its second factor.
 *
 * A sign-in that has typed the password and not yet the code is allowed
 * `MAX_SECOND_FACTOR_ATTEMPTS` guesses before it is thrown away and the password has to be
 * typed again. The count is a port, and not a number saved in the session, for one reason: a
 * session is copied into each request that carries it, and a copy cannot count what the other
 * copies are doing. Ten requests sent at once each read "no failures yet" and each save "one",
 * so the cap held for a caller who waits for each answer and for nobody else. The count has to
 * live where every request meets it.
 *
 * ## One call, made before anything is awaited
 *
 * `begin` is **synchronous**, and the use case calls it before its first `await`. That is what
 * makes the count exact on a single thread: two attempts cannot both read the same number,
 * because the number is taken and moved on in one step. An implementation that needs to wait
 * for anything (a shared store, one day) has to keep that property, or it has stopped being the
 * port.
 *
 * ## An attempt is reserved when it starts
 *
 * The guess is counted when it is made, **not when it is found wrong**. Counted afterwards, the
 * hundred codes a caller sends at once would all be judged before the first answer came back,
 * and the cap would only change what they were told. Reserved first, the sixth and every later
 * attempt is refused without being judged at all.
 */
export interface SignInAttempts {
  /**
   * Takes one attempt for this sign-in and says which one it is: `1` for the first, `2` for the
   * second, and so on. Synchronous, so no two callers are ever given the same number.
   */
  begin(attemptId: string): number

  /**
   * Gives one attempt back: the request that took it did not test a guess (the sign-in had
   * ended, or the box could not check a code), so it must not cost the person one of theirs.
   * Never takes the count below zero, and does nothing for a sign-in it has not heard of.
   */
  release(attemptId: string): void
}
