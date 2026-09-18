import { useState } from 'react'

/**
 * Which photos are new since the console last settled — roadmap 11.2.
 *
 * The moment this exists for: a guest sends a photo, the stream says so, the queue
 * refetches, and a tile the host has not seen appears among thirty they have. Motion there
 * carries meaning — *this* one is the new one, and it came from the top — and it is the one
 * arrival in this product a host cannot otherwise tell apart from a re-render.
 *
 * ## What it refuses to mark, which is most of it
 *
 * "Not motion on everything. A list that animates every row on every render is slower to
 * read, and a moderator working a queue at 23:00 is reading, not admiring." So the answer
 * is not an entrance animation on `.cell`: that would run for all thirty tiles on the first
 * load, again on every filter change, and again on any remount — three times when it means
 * nothing, for every once it means something.
 *
 * Four rules, and each of them is a thing that would otherwise animate:
 *
 * - **The first settled list is never new.** Arriving at a console holding a queue is not
 *   thirty arrivals; it is a screen. `settled` is what says the list is a list rather than
 *   a loading state, so the seeding happens once the data is real.
 * - **A filter change re-seeds.** `setFilter` empties the queue and reloads it, so every
 *   photo in the new tab is unseen — and none of them arrived. Dropping back to unsettled
 *   is what makes the next list a first list again.
 * - **A list that lost a photo marks nothing at all.** This is the rule a first draft of
 *   this hook did not have, and the queue it was tested against was too short to show it.
 *   The console asks for no `limit`, so the server's default of 60 applies
 *   (`requestSchemas.ts`), and the pending tab is served **oldest-first**
 *   (`moderationQueue.ts`, so a guest beside the projector is not starved by the ten who
 *   uploaded after them). On a 200-guest evening the queue backs up past 60 and those two
 *   facts combine into the exact opposite of this feature: a host publishes forty, the page
 *   refills from row 61 with photos that have been waiting all night, none of their ids
 *   were in the previous page — and forty tiles fade and rise at once, on the screen whose
 *   job at 23:00 is to be read. So the test is not "which ids are new" but "did the list
 *   only grow": if a single id the console was showing is gone, the page was re-paginated
 *   and newness is not attributable. Nothing is marked, and that is the right direction to
 *   fail in — a missed animation is invisible, a spurious one is a distraction.
 * - **A decision is therefore not an arrival**, whether or not it backfills. That also
 *   means an unrelated render — a selection, a keyboard move, a lightbox opening — returns
 *   the same set rather than clearing it out from under an animation that is still running.
 *
 * What this cannot do, stated rather than hidden: on a queue already past 60, a photo a
 * guest sends **is** invisible, because oldest-first puts it on a page the console never
 * requests. That is a paging gap and not a motion one, and motion must not paper over it
 * by animating whatever the cap happened to reveal.
 *
 * ## Why state adjusted during render, rather than a ref or an effect
 *
 * This is React's documented shape for "derive something from a prop that changed", and
 * both alternatives are worse here. A ref written during render is what the first draft
 * did, and `react-hooks/refs` fails the build on it — correctly, because a value the
 * render depends on is state by definition. An effect would mark the arrival one paint
 * late, which is a frame in which the new tile is already at rest and then starts moving.
 */

const NOTHING: ReadonlySet<string> = new Set()

interface Arrivals {
  /** The list this was computed from, or `null` before it has ever settled. */
  readonly list: readonly string[] | null
  readonly known: ReadonlySet<string>
  readonly arrived: ReadonlySet<string>
}

const SEEDED: Arrivals = { list: null, known: NOTHING, arrived: NOTHING }

/** Same ids in the same order. Order matters: the queue is sorted, and a move is not news. */
const sameList = (a: readonly string[] | null, b: readonly string[] | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.length === b.length && a.every((id, at) => id === b[at]))

/**
 * @param photoIds the queue in the order it is rendered
 * @param settled whether the queue is showing data rather than loading it
 */
export const useArrivals = (photoIds: readonly string[], settled: boolean): ReadonlySet<string> => {
  const [state, setState] = useState<Arrivals>(SEEDED)

  // A reload with an emptied list: whatever comes back is a new screen, not an arrival.
  const list = settled ? photoIds : null

  if (sameList(state.list, list)) return state.arrived

  const known = list === null ? NOTHING : new Set(list)

  /**
   * Only a list that kept everything it was showing can say what is new.
   *
   * A photo leaving means a decision, a deletion or a re-paginated page — and under the
   * server's 60-row cap on an oldest-first queue, what refills it is the oldest photos
   * still waiting rather than anything that arrived. Their ids are new to this page and
   * new to nothing else, which is why "new id" is not the test and "the list only grew" is.
   */
  const onlyGrew = state.list !== null && state.list.every((id) => known.has(id))

  const next: Arrivals =
    list === null
      ? SEEDED
      : {
          list,
          known,
          arrived: onlyGrew ? new Set(list.filter((id) => !state.known.has(id))) : NOTHING,
        }

  // Set *and* return, rather than set and read next time round: React re-renders with this
  // before it paints, and returning the old answer here would be a frame of the wrong one.
  setState(next)
  return next.arrived
}
