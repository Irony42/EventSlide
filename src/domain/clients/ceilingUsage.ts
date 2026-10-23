import type { ClientCeilings } from './clientCeilings'

/**
 * How close a client is to one of its ceilings (roadmap §10.5, G2-16 / P3-17), decided once
 * so the number a client reads in its own space and the banner built from it cannot disagree.
 *
 * Three levels and no more:
 *
 * - `ok`: below {@link CEILING_WARNING_PERCENT} per cent. Nothing is shown, because a banner
 *   that is always on is a banner nobody reads.
 * - `warning`: from that per cent up to, but not including, the ceiling. There is still room,
 *   and the client is told while it can still do something about it.
 * - `reached`: at the ceiling or past it. Past it is possible and is not an error: an operator
 *   can lower a ceiling under what a client already holds, and the downgrade rule is that new
 *   writes are refused, never that data is deleted.
 *
 * **Whole-number arithmetic**, `used * 100 >= max * 90`, and not `used / max >= 0.9`: a division
 * can land on the wrong side of the line for an exact ninety per cent (and a byte count is
 * far inside the safe-integer range for the product, which stays under 9e15 up to 90 TB).
 */

export const CEILING_WARNING_PERCENT = 90

export type CeilingLevel = 'ok' | 'warning' | 'reached'

/** What a client can run out of, as a meter has it: a count of events, or a number of bytes. */
export type CeilingKind = 'events' | 'eventsPerPeriod' | 'storage'

export interface CeilingMeter {
  readonly kind: CeilingKind
  readonly used: number
  readonly max: number
  readonly level: CeilingLevel
}

export interface CeilingUsage {
  /** Events the client has now, in every status. */
  readonly events: number
  /** Events it created since its period started: a counter that never goes down. */
  readonly eventsCreatedInPeriod: number
  /** The admission figure: photographs of every status and the staged source of each clip. */
  readonly usedBytes: number
}

const PERCENT_DENOMINATOR = 100

/**
 * The level of `used` against `max`. A `max` that is not a positive number cannot be a
 * ceiling (the schema refuses it), and is read as a ceiling already reached rather than as
 * room that is not there.
 */
export const ceilingLevel = (used: number, max: number): CeilingLevel => {
  if (!(max > 0) || used >= max) return 'reached'
  return used * PERCENT_DENOMINATOR >= max * CEILING_WARNING_PERCENT ? 'warning' : 'ok'
}

/**
 * The meters of a client: one for each ceiling that has a bound **and** something to count
 * against it. A ceiling that is `null` ("no ceiling") has no meter, which is what keeps a
 * client without limits from being shown a bar against nothing.
 */
export const ceilingMeters = (
  ceilings: ClientCeilings,
  usage: CeilingUsage,
): readonly CeilingMeter[] => {
  const meters: CeilingMeter[] = []
  const add = (kind: CeilingKind, used: number, max: number | null): void => {
    if (max !== null) meters.push({ kind, used, max, level: ceilingLevel(used, max) })
  }
  add('events', usage.events, ceilings.maxEvents)
  add('eventsPerPeriod', usage.eventsCreatedInPeriod, ceilings.maxEventsPerPeriod)
  add('storage', usage.usedBytes, ceilings.maxTotalBytes)
  return meters
}
