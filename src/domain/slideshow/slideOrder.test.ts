import { describe, expect, it } from 'vitest'
import {
  EMPTY_CURSOR,
  MAX_FRESH_RUN,
  MAX_SHOWN,
  nextSlide,
  settleCursor,
  startCursor,
  stepSlide,
  upcomingSlides,
  waitForFirst,
  type SlideCandidate,
  type SlideCursor,
} from './slideOrder'
import { WALL_LAYOUTS, wallLayoutSpec } from './wallLayout'

/** A playlist, newest first, as `buildPlaylist` hands it over. Each photo is "id@author". */
const list = (...specs: readonly string[]): readonly SlideCandidate[] =>
  specs.map((spec) => {
    const [id = '', author = ''] = spec.split('@')
    return { id, author: author === '' ? null : author }
  })

const ids = (items: readonly SlideCandidate[]): readonly string[] => items.map((item) => item.id)

/** What the wall puts on screen over `count` automatic steps, with nothing new arriving. */
const play = (
  items: readonly SlideCandidate[],
  from: SlideCursor,
  count: number,
): readonly string[] => {
  const played: string[] = []
  let cursor = from
  for (let step = 0; step < count; step += 1) {
    const move = nextSlide(items, cursor)
    if (move === null) break
    played.push(move.slide.id)
    cursor = move.cursor
  }
  return played
}

/** The wall as it is after an automatic step. */
const stepped = (items: readonly SlideCandidate[], cursor: SlideCursor): SlideCursor => {
  const move = nextSlide(items, cursor)
  if (move === null) throw new Error('expected a slide')
  return move.cursor
}

describe('where a wall starts', () => {
  it('has nothing to show for an empty playlist', () => {
    expect(startCursor([])).toBe(EMPTY_CURSOR)
  })

  it('opens on the newest photo and counts the whole list as already known', () => {
    const cursor = startCursor(list('c', 'b', 'a'))
    expect(cursor.shown).toEqual([{ id: 'c', fresh: false }])
    expect([...cursor.seen].sort()).toEqual(['a', 'b', 'c'])
    expect(cursor.rotationId).toBe('c')
  })
})

describe('the first photo of an evening', () => {
  it('opens a wall that was read empty on its first photo, fresh', () => {
    const cursor = settleCursor(list('a'), waitForFirst(EMPTY_CURSOR))

    expect(cursor.shown).toEqual([{ id: 'a', fresh: true }])
    expect(cursor.awaitingFirst).toBe(false)
  })

  it('opens on the oldest arrival, fresh, and accounts for the others when several come at once', () => {
    const items = list('c', 'b', 'a')
    const cursor = settleCursor(items, waitForFirst(EMPTY_CURSOR))

    expect(cursor.shown).toEqual([{ id: 'a', fresh: true }])
    expect([...cursor.seen].sort()).toEqual(['a', 'b', 'c'])
    expect(nextSlide(items, cursor)?.slide.fresh).toBe(false)
  })

  it('keeps a single arrival as it always was: fresh, with the rotation not started', () => {
    const cursor = settleCursor(list('a'), waitForFirst(EMPTY_CURSOR))

    expect(cursor.rotationId).toBeNull()
    expect(cursor.ahead).toEqual([])
    expect(cursor.run).toBe(1)
    expect([...cursor.seen]).toEqual(['a'])
  })

  it('plays a backlog of forty photos published at once through the rotation, not the fresh lane', () => {
    const items = list(
      ...Array.from({ length: 40 }, (_, i) => `p${String(39 - i).padStart(2, '0')}`),
    )
    let cursor = settleCursor(items, waitForFirst(EMPTY_CURSOR))
    expect(cursor.shown).toEqual([{ id: 'p00', fresh: true }])

    const slides: boolean[] = []
    for (let step = 0; step < 12; step += 1) {
      const move = nextSlide(items, cursor)
      if (move === null) throw new Error('expected a slide')
      slides.push(move.slide.fresh)
      cursor = move.cursor
    }
    expect(slides).toEqual(Array.from({ length: 12 }, () => false))
  })

  it('shows the same photo as a wall opened on the populated list from the second slide on', () => {
    const items = list(
      ...Array.from({ length: 40 }, (_, i) => `p${String(39 - i).padStart(2, '0')}`),
    )
    const arrivals = settleCursor(items, waitForFirst(EMPTY_CURSOR))
    const populated = startCursor(items)
    // The first slides differ: the evening's first photo against the newest.
    expect(arrivals.shown[0]?.id).toBe('p00')
    expect(populated.shown[0]?.id).toBe('p39')

    const seenByArrivals = [arrivals.shown[0]?.id, ...play(items, arrivals, 20)]
    const seenByPopulated = [populated.shown[0]?.id, ...play(items, populated, 20)]
    expect(seenByArrivals.slice(1)).toEqual(seenByPopulated.slice(1))
  })

  it('does not call a photo new on a page load, which has not read an empty list', () => {
    expect(settleCursor(list('b', 'a'), EMPTY_CURSOR).shown).toEqual([{ id: 'b', fresh: false }])
  })

  it('leaves a wall that already shows a photo alone, whatever it reads', () => {
    const cursor = startCursor(list('a'))
    expect(waitForFirst(cursor)).toBe(cursor)
  })

  it('waits once: reading the empty list again changes nothing', () => {
    const waiting = waitForFirst(EMPTY_CURSOR)
    expect(waitForFirst(waiting)).toBe(waiting)
  })

  it('is the same answer for two walls that read the same lists', () => {
    const items = list('b', 'a')
    expect(settleCursor(items, waitForFirst(EMPTY_CURSOR))).toEqual(
      settleCursor(items, waitForFirst(EMPTY_CURSOR)),
    )
  })
})

describe('keeping the cursor consistent with the playlist', () => {
  it('leaves a cursor alone when the list is empty', () => {
    const cursor = startCursor(list('a'))
    expect(settleCursor([], cursor)).toBe(cursor)
  })

  it('starts a wall that had shown nothing as soon as there is a photo', () => {
    expect(settleCursor(list('b', 'a'), EMPTY_CURSOR).shown).toEqual([{ id: 'b', fresh: false }])
  })

  it('returns the very same cursor when nothing changed, so the caller can bail out', () => {
    const items = list('b', 'a')
    const cursor = startCursor(items)
    expect(settleCursor(items, cursor)).toBe(cursor)
  })

  it('keeps a new photo waiting rather than counting it as seen', () => {
    const cursor = startCursor(list('b', 'a'))
    expect(settleCursor(list('c', 'b', 'a'), cursor)).toBe(cursor)
    expect(cursor.seen.has('c')).toBe(false)
  })

  it('falls back to the newest photo when the one on screen leaves the list', () => {
    const cursor = stepped(list('c', 'b', 'a'), startCursor(list('c', 'b', 'a')))
    expect(cursor.shown[0]?.id).toBe('b')

    const settled = settleCursor(list('d', 'c', 'a'), cursor)
    expect(settled.shown.map((slide) => slide.id)).toEqual(['d', 'c'])
    expect(settled.rotationId).toBe('d')
    expect(settled.seen.has('d')).toBe(true)
  })

  it('forgets photos that left the list, so one published again is new again', () => {
    const items = list('c', 'b', 'a')
    const cursor = startCursor(items)

    const withoutA = settleCursor(list('c', 'b'), cursor)
    expect(withoutA.seen.has('a')).toBe(false)
    expect(withoutA.shown).toBe(cursor.shown)

    const republished = settleCursor(items, withoutA)
    expect(nextSlide(items, republished)?.slide).toEqual({ id: 'a', fresh: true })
  })
})

describe('a rotation photo hidden while it is not on screen', () => {
  /** Thirty photos, p30 the newest, as the playlist hands them over. */
  const thirty = list(...Array.from({ length: 30 }, (_, at) => `p${30 - at}`))
  const without = (...hidden: readonly string[]): readonly SlideCandidate[] =>
    thirty.filter((item) => !hidden.includes(item.id))

  /** The rotation has walked fourteen photos down the list, then a new photo took a slide. */
  const duringAFreshRun = () => {
    let cursor = startCursor(thirty)
    for (let step = 0; step < 14; step += 1) cursor = stepped(thirty, cursor)
    expect(cursor.rotationId).toBe('p16')
    const withNew = [{ id: 'n', author: null }, ...thirty]
    cursor = stepped(withNew, cursor)
    expect(cursor.shown[0]).toEqual({ id: 'n', fresh: true })
    return { cursor, withNew }
  }

  it('resumes with the next older photo, and does not go back to the newest', () => {
    const { cursor, withNew } = duringAFreshRun()
    const hidden = withNew.filter((item) => item.id !== 'p16')

    const settled = settleCursor(hidden, cursor)

    expect(nextSlide(hidden, settled)?.slide).toEqual({ id: 'p15', fresh: false })
  })

  it('goes on to the nearest older photo that is still there when its neighbours are hidden too', () => {
    const { cursor, withNew } = duringAFreshRun()
    const hidden = withNew.filter((item) => !['p16', 'p15', 'p14'].includes(item.id))

    const settled = settleCursor(hidden, cursor)

    expect(nextSlide(hidden, settled)?.slide.id).toBe('p13')
  })

  it('wraps to the newest photo when nothing older is left', () => {
    let cursor = startCursor(without('p29'))
    const items = without('p29')
    for (let step = 0; step < 28; step += 1) cursor = stepped(items, cursor)
    expect(cursor.rotationId).toBe('p1')
    const withNew = [{ id: 'n', author: null }, ...items]
    cursor = stepped(withNew, cursor)
    const hidden = withNew.filter((item) => item.id !== 'p1')

    const settled = settleCursor(hidden, cursor)

    expect(nextSlide(hidden, settled)?.slide.id).toBe('p30')
  })

  it('leaves the cursor alone while the rotation photo is still in the list', () => {
    const { cursor, withNew } = duringAFreshRun()
    expect(settleCursor(withNew, cursor)).toBe(cursor)
  })
})

describe('the rotation', () => {
  it('walks towards older photos and starts over after the oldest', () => {
    const items = list('d', 'c', 'b', 'a')
    expect(play(items, startCursor(items), 6)).toEqual(['c', 'b', 'a', 'd', 'c', 'b'])
  })

  it.each([2, 3, 5, 12, 13, 40])(
    'shows every photo once per lap with no new arrivals, for %i photos',
    (count) => {
      const items = list(...Array.from({ length: count }, (_, at) => `p${count - at}`))
      const lap = play(items, startCursor(items), count)
      expect(new Set(lap).size).toBe(count)
      expect(play(items, startCursor(items), 2 * count).slice(count)).toEqual(lap)
    },
  )

  it('keeps one photo on screen when it is the only one', () => {
    const items = list('a')
    expect(play(items, startCursor(items), 3)).toEqual(['a', 'a', 'a'])
  })

  it('says there is nothing to show for an empty list', () => {
    expect(nextSlide([], EMPTY_CURSOR)).toBeNull()
  })

  it('restarts from the newest when the photo it was resuming from is gone', () => {
    const cursor = stepped(list('c', 'b', 'a'), startCursor(list('c', 'b', 'a')))
    const items = list('c', 'a')
    expect(nextSlide(items, { ...cursor, rotationId: 'b' })?.slide.id).toBe('c')
  })

  it('does not put the same face on a short wall twice at once', () => {
    // Three photos, a layout that holds all three: after a fresh photo the rotation must not
    // come straight back round to it.
    const before = list('b', 'a')
    const cursor = startCursor(before)
    const items = list('x', 'b', 'a')
    const afterFresh = stepped(items, cursor)
    expect(afterFresh.shown[0]).toEqual({ id: 'x', fresh: true })
    const recent = play(items, afterFresh, 2)
    expect(new Set([...recent, 'x']).size).toBe(3)
  })

  it('goes to the other photo when a fresh one is shown on a two-photo wall', () => {
    const cursor = startCursor(list('a'))
    const items = list('x', 'a')
    expect(play(items, cursor, 3)).toEqual(['x', 'a', 'x'])
  })
})

describe('a photo that was just published', () => {
  const before = list('f', 'e', 'd', 'c', 'b', 'a@z')

  it('takes the very next slide instead of waiting for a lap', () => {
    const cursor = startCursor(before)
    const items = list('new@l', ...ids(before).map((id) => id))
    const plain = ids(items)
    expect(plain[0]).toBe('new')
    expect(nextSlide(items, cursor)?.slide).toEqual({ id: 'new', fresh: true })
  })

  it('never takes the slide away from the photo on screen', () => {
    // Nothing in the rule can interrupt: the answer is only ever for the next step, and the
    // photo on screen is excluded from the waiting ones.
    const items = list('new@l', 'f', 'e')
    const cursor = settleCursor(items, startCursor(list('f', 'e')))
    expect(cursor.shown[0]?.id).toBe('f')
    expect(nextSlide(items, cursor)?.slide.id).toBe('new')
    expect(cursor.shown[0]?.id).toBe('f')
  })

  it('lets the rotation resume where it stopped', () => {
    const items = list('new@l', 'f', 'e', 'd', 'c', 'b', 'a')
    const cursor = startCursor(list('f', 'e', 'd', 'c', 'b', 'a'))
    const inRotation = stepped(list('f', 'e', 'd', 'c', 'b', 'a'), cursor)
    expect(inRotation.shown[0]?.id).toBe('e')

    expect(play(items, inRotation, 4)).toEqual(['new', 'd', 'c', 'b'])
  })

  it('does not come round to it again straight after showing it', () => {
    const items = list('new@l', 'f', 'e')
    const afterNew = stepped(items, startCursor(list('f', 'e')))
    expect(play(items, afterNew, 2)).toEqual(['e', 'f'])
  })

  it('plays several in the order they arrived', () => {
    const items = list('n3@a', 'n2@b', 'n1@c', 'f', 'e')
    expect(play(items, startCursor(list('f', 'e')), 3)).toEqual(['n1', 'n2', 'n3'])
  })

  it('lets at most three in a row go by before one photo of the rotation', () => {
    expect(MAX_FRESH_RUN).toBe(3)
    const items = list('n5@a', 'n4@b', 'n3@c', 'n2@d', 'n1@e', 'f', 'e', 'd')
    const plan = play(items, startCursor(list('f', 'e', 'd')), 7)
    expect(plan).toEqual(['n1', 'n2', 'n3', 'e', 'n4', 'n5', 'd'])
  })

  it('shows a late photo from the middle of the list as new', () => {
    // Approved long after it was taken: it sits in the middle of the list by upload time.
    const items = list('f', 'e', 'late@l', 'd', 'c')
    const cursor = startCursor(list('f', 'e', 'd', 'c'))
    expect(nextSlide(items, cursor)?.slide).toEqual({ id: 'late', fresh: true })
  })

  it('counts a photo the rotation reaches first as shown, not as new', () => {
    const items = list('new@l', 'f', 'e', 'd')
    const cursor = { ...startCursor(list('f', 'e', 'd')), run: MAX_FRESH_RUN }
    const walked = play(items, cursor, 4)
    expect(walked.filter((id) => id === 'new')).toHaveLength(1)
  })
})

describe('a burst from one table', () => {
  it('lets the others in between instead of playing the burst end to end', () => {
    const burst = Array.from({ length: 6 }, (_, at) => `t${6 - at}@table`)
    const items = list('guest@other', ...burst, 'f', 'e')
    const plan = play(items, startCursor(list('f', 'e')), 6)
    expect(plan.slice(0, 3)).toEqual(['t1', 'guest', 't2'])
    expect(plan).toEqual(['t1', 'guest', 't2', 'e', 't3', 't4'])
  })

  it('goes oldest first when one author is the only one waiting', () => {
    const items = list('b2@a', 'b1@a', 'f@z', 'e@z')
    expect(play(items, startCursor(list('f@z', 'e@z')), 2)).toEqual(['b1', 'b2'])
  })

  it('treats every anonymous photo as one author', () => {
    const items = list('named@lea', 'a3', 'a2', 'a1', 'f@z')
    const cursor = startCursor(list('f@z'))
    const plan = play(items, cursor, 4)
    expect(plan.slice(0, 2)).toEqual(['a1', 'named'])
  })

  it('gives an unknown author on screen no advantage', () => {
    const items = list('n@a', 'g@b')
    const cursor: SlideCursor = {
      ...EMPTY_CURSOR,
      shown: [{ id: 'gone', fresh: false }],
      seen: new Set(['gone']),
    }
    expect(nextSlide(items, cursor)?.slide.id).toBe('g')
  })
})

describe('determinism', () => {
  it('gives two projectors that read the same list the same sequence', () => {
    const items = list('n2@b', 'n1@a', 'f@c', 'e@a', 'd@b', 'c@c')
    const left = startCursor(list('f@c', 'e@a', 'd@b', 'c@c'))
    const right = startCursor(list('f@c', 'e@a', 'd@b', 'c@c'))
    expect(play(items, left, 12)).toEqual(play(items, right, 12))
  })

  it('does not change the cursor it is given', () => {
    const items = list('n@a', 'f@c', 'e@a')
    const cursor = startCursor(list('f@c', 'e@a'))
    const snapshot = { shown: cursor.shown, seen: [...cursor.seen], run: cursor.run }
    nextSlide(items, cursor)
    expect({ shown: cursor.shown, seen: [...cursor.seen], run: cursor.run }).toEqual(snapshot)
  })
})

describe('the host stepping by hand', () => {
  const items = list('d', 'c', 'b', 'a')

  it('steps forward and back by one place in the list', () => {
    const cursor = startCursor(items)
    const forward = stepSlide(items, cursor, 1)
    expect(forward?.slide).toEqual({ id: 'c', fresh: false })
    const back = stepSlide(items, forward?.cursor ?? cursor, -1)
    expect(back?.slide.id).toBe('d')
  })

  it('wraps from the first photo to the last', () => {
    expect(stepSlide(items, startCursor(items), -1)?.slide.id).toBe('a')
  })

  it('ignores the fresh lane', () => {
    const withNew = list('new@l', 'd', 'c', 'b', 'a')
    const cursor = startCursor(items)
    expect(stepSlide(withNew, cursor, 1)?.slide.id).toBe('c')
  })

  it('starts from the newest when nothing is on screen', () => {
    expect(stepSlide(items, EMPTY_CURSOR, 1)?.slide.id).toBe('c')
  })

  it('has nothing to step to in an empty list', () => {
    expect(stepSlide([], EMPTY_CURSOR, 1)).toBeNull()
  })

  it('resumes the rotation from the photo it stepped to', () => {
    const moved = stepSlide(items, startCursor(items), 2)
    expect(moved?.slide.id).toBe('b')
    expect(nextSlide(items, moved?.cursor ?? EMPTY_CURSOR)?.slide.id).toBe('a')
  })
})

describe('looking ahead', () => {
  it('is the same as taking the steps', () => {
    const items = list('n@a', 'f', 'e', 'd', 'c')
    const cursor = startCursor(list('f', 'e', 'd', 'c'))
    expect(upcomingSlides(items, cursor, 4).map((slide) => slide.id)).toEqual(
      play(items, cursor, 4),
    )
  })

  it('stops at an empty list', () => {
    expect(upcomingSlides([], EMPTY_CURSOR, 5)).toEqual([])
  })

  it('shows nothing for a count of zero', () => {
    expect(upcomingSlides(list('a'), startCursor(list('a')), 0)).toEqual([])
  })
})

describe('what a cursor remembers', () => {
  it('keeps no more slides than the biggest layout holds at once', () => {
    const slots = Math.max(...WALL_LAYOUTS.map((layout) => wallLayoutSpec(layout).slotCount))
    expect(MAX_SHOWN).toBeGreaterThanOrEqual(slots)
  })

  it('forgets the oldest slide beyond that', () => {
    const items = list(...Array.from({ length: 30 }, (_, at) => `p${30 - at}`))
    let cursor = startCursor(items)
    for (let step = 0; step < 40; step += 1) cursor = stepped(items, cursor)
    expect(cursor.shown).toHaveLength(MAX_SHOWN)
  })
})
