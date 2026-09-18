import { describe, expect, it } from 'vitest'
import {
  afterVerdict,
  affords,
  budgetFloorFor,
  frameRateOf,
  FRAME_WINDOW,
  INTERACTION_BUDGET_MS,
  interactionsHold,
  frameIntervalOf,
  STOPPED_PAINTING_MS,
  MIN_FRAMES_PER_SECOND,
  SHED_ORDER,
  shedOne,
  STRIKES_BEFORE_SHEDDING,
  wallBudgetProps,
  windowHolds,
  type BudgetLevel,
} from './budget'

/**
 * What is switched off first when a machine cannot afford the interface — roadmap 11.3.
 *
 * The roadmap asks for "a written rule for what is switched off first", and a rule written
 * only in a document is the exact defect a 55-mutation audit found surviving everywhere in
 * this repository. So the order is a list here, every consequence is derived from it, and
 * the tests below are what fails when somebody reorders it.
 */
describe('the order things are given up in', () => {
  it('is glass, then the zoom, then the fade — and nothing else is in it', () => {
    // The whole rule as one assertion. Reordering it is a decision about what a room sees
    // when the machine driving it runs out, and it should cost a red test.
    expect(SHED_ORDER).toEqual(['glass', 'ken-burns', 'crossfade'])
  })

  it('affords every cost at the top of the ladder, where nothing has been given up', () => {
    for (const cost of SHED_ORDER) expect(affords(0, cost)).toBe(true)
  })

  it('affords none of them at the bottom, where everything has', () => {
    for (const cost of SHED_ORDER) expect(affords(3, cost)).toBe(false)
  })

  it('gives up the blur before it gives up any motion', () => {
    // The direction roadmap 11.3 fixes. Glass is decoration and Ken Burns is what the room
    // is looking at, so a machine in trouble loses the decoration first — on every surface,
    // which is why there is one ladder and not one per audience.
    expect(affords(1, 'glass')).toBe(false)
    expect(affords(1, 'ken-burns')).toBe(true)
    expect(affords(1, 'crossfade')).toBe(true)
  })

  it('gives up the zoom before it gives up the fade', () => {
    // Ken Burns runs on every frame of every slide; the crossfade runs for one second in
    // eight. Giving up the continuous one first buys more and costs less to look at.
    expect(affords(2, 'ken-burns')).toBe(false)
    expect(affords(2, 'crossfade')).toBe(true)
  })

  it('sheds one rung at a time and stops at the bottom', () => {
    expect(shedOne(0)).toBe(1)
    expect(shedOne(1)).toBe(2)
    expect(shedOne(2)).toBe(3)
    // There is nothing under the last rung: what is left is the photograph, which is the
    // product. A ladder that ran off its own end would be one that could switch the wall off.
    expect(shedOne(3)).toBe(3)
  })
})

describe('where each surface starts', () => {
  it('starts the room one rung down, because the room can never afford a blur', () => {
    // Decided in advance rather than discovered at a wedding, and expressed as the floor of
    // the ladder rather than as a second rule beside it: the wall is crossfading, running
    // Ken Burns and possibly decoding a clip, so its backdrop changes every frame and a
    // filter over it is recomputed every frame at full screen.
    expect(budgetFloorFor('wall')).toBe(1)
    expect(affords(budgetFloorFor('wall'), 'glass')).toBe(false)
  })

  it.each(['guest', 'host'] as const)(
    'starts %s with nothing given up yet, so it can still afford everything',
    (surface) => {
      // The other half of the pair, and the half worth having. "The wall gets the opaque
      // fallback and the guest surfaces keep the blur" is one decision, so a test that only
      // checked the wall would pass just as well if the material had been switched off
      // everywhere.
      expect(budgetFloorFor(surface)).toBe(0)
      expect(affords(budgetFloorFor(surface), 'glass')).toBe(true)
    },
  )
})

describe('the marker the wall renders its rungs as', () => {
  it('spreads nothing while the wall still has its motion', () => {
    // The same promise `glassSurfaceProps` makes: a wall that is holding its frame rate
    // renders the DOM it rendered before any of this existed, which is what lets the
    // committed visual baselines stay committed.
    expect(wallBudgetProps(1)).toEqual({})
  })

  it('marks a wall that has given up the zoom, and then the fade', () => {
    expect(wallBudgetProps(2)).toEqual({ 'data-wall-budget': 'still' })
    expect(wallBudgetProps(3)).toEqual({ 'data-wall-budget': 'cut' })
  })

  it('never claims a rung the room has not reached', () => {
    // Level 0 cannot happen on the wall — the floor is 1 — but the function is total, and
    // answering "still" for a surface that has shed nothing would stop the wall's Ken Burns
    // on a machine that is perfectly happy.
    expect(wallBudgetProps(0)).toEqual({})
  })
})

/**
 * The verdict reducer, which is where the hysteresis lives.
 *
 * Both monitors — frames on the wall, interactions on a phone — produce a stream of
 * verdicts, and both feed this. One bad window is a garbage collection, a video keyframe or
 * a photograph being decoded; it is not a machine that cannot afford the interface, and
 * switching Ken Burns off in front of a hundred people because of one of them would be a
 * worse bug than the one this exists to prevent.
 */
describe('how a verdict turns into a rung', () => {
  const start: { level: BudgetLevel; strikes: number } = { level: 0, strikes: 0 }

  it('gives nothing up for a single bad window', () => {
    expect(afterVerdict(start, false)).toEqual({ level: 0, strikes: 1 })
  })

  it('gives one thing up for two in a row', () => {
    expect(afterVerdict({ level: 0, strikes: 1 }, false)).toEqual({ level: 1, strikes: 0 })
  })

  it('forgets a bad window as soon as a good one follows it', () => {
    // Consecutive, not cumulative. A wall that drops one frame an hour for eight hours is a
    // wall that is working, and a counter that only went up would strip it bare by midnight.
    expect(afterVerdict({ level: 0, strikes: 1 }, true)).toEqual({ level: 0, strikes: 0 })
  })

  it('never climbs back, whatever the machine does afterwards', () => {
    // One-way on purpose. Giving an effect back means the wall can oscillate — blur on,
    // blur off, blur on — in front of a room, and the thing that made the frames come back
    // may well be the effect being off. An evening is short and a reload is free.
    const degraded = { level: 2 as BudgetLevel, strikes: 0 }

    expect(afterVerdict(degraded, true)).toEqual(degraded)
    expect(afterVerdict(afterVerdict(degraded, true), true)).toEqual(degraded)
  })

  it('stops counting once there is nothing left to give up', () => {
    // The monitor stops sampling at the bottom of the ladder, and this is what makes that
    // safe rather than a behaviour of the hook: a strike recorded there would be a strike
    // that can never be spent.
    expect(afterVerdict({ level: 3, strikes: 0 }, false)).toEqual({ level: 3, strikes: 0 })
  })

  it('takes two strikes, and the number is the one the constant says', () => {
    expect(STRIKES_BEFORE_SHEDDING).toBe(2)
  })
})

/**
 * The frame verdict, and why it is the plainest number of the three that were tried.
 *
 * A frame-rate floor has an honest problem: a threshold in milliseconds is a statement about
 * the machine that chose it, and a venue mini-PC may drive a projector at 60 Hz, at 50, or at
 * 30 over a long cable. Two cleverer rules were written to get around that — a count of
 * dropped frames, and the share of the display's frames the wall delivered — and
 * `tests/e2e/journeys/frame-budget.spec.ts` measured real walls against both. `budget.ts`
 * has the table; the short version is that a healthy wall on a busy machine drops a third of
 * its frames, and a wall deliberately held to every other frame delivers a *higher* share
 * than a healthy contended one. Neither rule separated the cases it existed to separate.
 *
 * Frames a second does, and it needs no threshold about the display: 24 is below every panel
 * a venue can plug in, so no display is mistaken for a machine in trouble.
 */
describe('whether a window of frames held', () => {
  const steady = (ms: number, count = FRAME_WINDOW): number[] =>
    Array.from({ length: count }, () => ms)

  it('holds a machine running cleanly at 60 Hz', () => {
    expect(windowHolds(steady(16.7))).toBe(true)
  })

  it('holds a projector running cleanly at 30 Hz, which is not a stutter', () => {
    // The reason the floor is 24 rather than something nearer the display's own rate. A
    // venue's long HDMI cable negotiates what it negotiates, and a wall doing exactly what
    // its display asked of it must not be read as a wall in trouble.
    expect(windowHolds(steady(33.4))).toBe(true)
    expect(frameRateOf(steady(33.4))).toBeCloseTo(29.9, 1)
  })

  it('holds the slowest healthy wall that has actually been measured', () => {
    // 35.7 frames a second, which is what the wall as shipped produced with eight browsers
    // running beside it — a machine under absurd load and a room that looked fine. The
    // threshold pinned here is the one that keeps that wall's Ken Burns, and a change that
    // quietly tightened it would take motion away from a room that was coping.
    const contended = steady(1_000 / 35.7)

    expect(frameRateOf(contended)).toBeCloseTo(35.7, 1)
    expect(windowHolds(contended)).toBe(true)
  })

  it('refuses a wall the room is watching in steps', () => {
    // 12.2 frames a second, which is what a wall with every frame held back for 80 ms
    // actually produced. Nothing at that rate reads as motion from the back of a room.
    const stepping = steady(1_000 / 12.2)

    expect(frameRateOf(stepping)).toBeCloseTo(12.2, 1)
    expect(windowHolds(stepping)).toBe(false)
  })

  it('refuses a uniformly slow machine, which the two discarded rules could not see', () => {
    // The case that killed both cleverer versions: when every frame is equally late, none of
    // them is late *relative to the others* and the wall is delivering every frame it was
    // offered. An average over the window sees it immediately.
    expect(windowHolds(steady(1_000 / MIN_FRAMES_PER_SECOND + 1))).toBe(false)
  })

  it('holds a window with one long stall in it, because one stall is a decode', () => {
    // A slide's photograph being decoded, a clip's keyframe, a collection. The wall does
    // this all evening and the room does not see it — which is what an average over ninety
    // frames survives and a count of bad frames does not.
    expect(windowHolds([...steady(16.7, FRAME_WINDOW - 1), 900])).toBe(true)
  })

  it('says nothing about a window it has not filled', () => {
    // Evidence, not a guess. Degrading on three frames of startup — the first paint, the
    // first decode, React mounting — is the failure mode a short window would have.
    expect(windowHolds(steady(200, 3))).toBe(true)
  })

  it('bounds a gap where the browser stopped painting instead of discarding it', () => {
    // `requestAnimationFrame` stops firing on a hidden tab, and a closed lid between two
    // courses of a dinner produces one interval of minutes. Clamped rather than thrown away:
    // discarding took the whole window with it, so the machine bad enough to stall past the
    // ceiling was the one machine that could never assemble a window and therefore never
    // degraded — the wall that needed the budget most was the one guaranteed not to get it.
    expect(frameIntervalOf(16.7)).toBeCloseTo(16.7, 5)
    expect(frameIntervalOf(400)).toBeCloseTo(400, 5)
    expect(frameIntervalOf(600_000)).toBe(STOPPED_PAINTING_MS)
    expect(frameIntervalOf(0)).toBeNull()
  })

  it('keeps the window a lid-closed gap lands in, and still refuses one full of stalls', () => {
    // Both halves of the clamp, as windows. One gap in ninety otherwise perfect frames is a
    // tab that came back and must not cost the room its motion; a stall every few frames is a
    // machine that genuinely cannot paint and must.
    const cameBack = [...steady(16.7, FRAME_WINDOW - 1), frameIntervalOf(600_000) ?? 0]
    expect(windowHolds(cameBack)).toBe(true)

    const stalling = Array.from({ length: FRAME_WINDOW }, (_unused, at) =>
      at % 5 === 0 ? (frameIntervalOf(1_500) ?? 0) : 16.7,
    )
    expect(windowHolds(stalling)).toBe(false)
  })

  it('is cinema’s floor and not a number somebody liked', () => {
    expect(MIN_FRAMES_PER_SECOND).toBe(24)
  })
})

/**
 * The guest's verdict, which is not a frame rate.
 *
 * Roadmap 11.3 asks for "a first-interaction budget on the guest surface", and a frame rate
 * is the wrong measurement for it: the upload screen is still between taps, so its frames
 * are perfect right up until the moment a guest touches it. What a guest on a saturated
 * venue Wi-Fi mid-encode actually experiences is the tap that takes a second to do anything,
 * and that has a published number — 200 ms is the INP threshold for a "good" interaction.
 */
describe('whether the guest surface answered the hand in time', () => {
  it('holds an interaction inside the budget', () => {
    expect(interactionsHold([INTERACTION_BUDGET_MS])).toBe(true)
  })

  it('refuses one outside it', () => {
    expect(interactionsHold([INTERACTION_BUDGET_MS + 1])).toBe(false)
  })

  it('takes the worst of a batch, because a guest remembers the slow one', () => {
    expect(interactionsHold([8, 16, INTERACTION_BUDGET_MS + 1, 24])).toBe(false)
  })

  it('says nothing about a batch with nothing in it', () => {
    // No interaction is not a slow interaction. A guest reading the screen must not cost
    // the screen its material.
    expect(interactionsHold([])).toBe(true)
  })

  it('is the published threshold and not a number somebody liked', () => {
    expect(INTERACTION_BUDGET_MS).toBe(200)
  })
})
