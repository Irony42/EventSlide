import { useEffect, useState } from 'react'

/**
 * How long a lost connection is kept from the room altogether.
 *
 * A venue's network drops for thirty seconds several times an evening and the photos keep
 * turning the whole time: announcing each of those to two hundred guests makes a working
 * product look broken, and the host cannot fix a venue's Wi-Fi from the dance floor.
 */
export const OUTAGE_DOT_AFTER_MS = 60_000

/**
 * How long before the outage is worth words. By then it is no longer a blip, and somebody
 * at the reception may want to know why nothing new has appeared.
 */
export const OUTAGE_TEXT_AFTER_MS = 3 * 60_000

/** What the room is shown of a lost connection: nothing, a discreet dot, or the dot and a sentence. */
export type OutageStage = 'quiet' | 'dot' | 'text'

/**
 * Turns "the stream is down" into what the room should be told, given how long it has been.
 *
 * Time is the whole rule, so it lives here and not in the page. The clock restarts from
 * `quiet` every time the connection comes back, so a network that flaps never accumulates
 * towards the sentence.
 */
export const useOutageStage = (offline: boolean): OutageStage => {
  const [stage, setStage] = useState<OutageStage>('quiet')

  useEffect(() => {
    if (!offline) return

    const dot = window.setTimeout(() => setStage('dot'), OUTAGE_DOT_AFTER_MS)
    const text = window.setTimeout(() => setStage('text'), OUTAGE_TEXT_AFTER_MS)
    return () => {
      window.clearTimeout(dot)
      window.clearTimeout(text)
      // The next outage starts its count from nothing.
      setStage('quiet')
    }
  }, [offline])

  // Derived, so the moment the connection returns the room sees nothing, without waiting
  // for the reset above to land.
  return offline ? stage : 'quiet'
}
