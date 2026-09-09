/**
 * The only source of time in the application.
 *
 * Domain code takes a `Date` parameter; use cases get it from here. Nothing calls
 * `new Date()` — lint forbids it in `src/domain` and `src/application` — because a test
 * that depends on the wall clock is flaky, and half of this product's rules are about
 * time: the guest self-delete grace window, retention deadlines, idle guest counts,
 * slide intervals.
 */
export interface Clock {
  now(): Date
}
