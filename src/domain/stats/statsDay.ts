/**
 * The key a counter is stored under: the UTC day, `YYYY-MM-DD`.
 *
 * UTC because the event has no time zone of its own (the product does not model one), and a
 * counter that moved with the reader's clock would be two numbers for one evening.
 */
export const statsDayOf = (instant: Date): string => instant.toISOString().slice(0, 10)
