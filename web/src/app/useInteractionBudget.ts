import { useEffect, useRef, useState } from 'react'
import {
  afterVerdict,
  affords,
  budgetFloorFor,
  interactionsHold,
  type BudgetLevel,
  type BudgetState,
} from '../design-system/budget'
import type { GlassSurface } from '../design-system/glass'

/**
 * The guest's half of the budget — roadmap 11.3.
 *
 * "A mid-range Android phone on saturated wifi, mid-upload. Blur is GPU work competing with
 * an encode and a request. **The upload screen staying responsive outranks how it looks.**"
 *
 * ## Why this is not a frame rate
 *
 * The wall is measured on frames because the wall is always painting. A phone is not: the
 * upload screen is perfectly still between taps, so its frame rate is flawless right up to
 * the moment somebody touches it and stays flawless if the tap does nothing for a second.
 * What a guest on a venue's Wi-Fi actually meets is the tap that does not answer, and that
 * is what the browser's own event timing reports.
 *
 * It also means the number does not have to be invented. `INTERACTION_BUDGET_MS` is the
 * published threshold at which an interaction stops counting as good in Interaction to Next
 * Paint, rather than a figure this repository picked and would have had to defend.
 *
 * ## Why it lives in `app/` rather than in the design system
 *
 * It is the shell's decision to make, because the shell is what carries `data-glass`: the
 * tier has to be decided by something that renders in the same paint as the surface it
 * marks, and `AppShell` is the one component every screen goes through. The design system
 * holds the rule (`budget.ts`) and knows nothing about who applies it — the same split
 * `glassBackdrop.ts` makes for the other input.
 *
 * ## Where it fails towards
 *
 * Up. A browser with no `PerformanceObserver`, or one that refuses the `event` entry type,
 * measures nothing and keeps the material. That is the opposite of the tint floor's safe
 * direction and deliberately so: an unmeasured phone is not a slow phone, and the machines
 * that genuinely cannot paint the material are already caught by `tokens.css`'s `@supports`
 * fallback. Stripping every browser that cannot self-report would be punishing the wrong
 * ones.
 */
/**
 * `PerformanceObserverInit` plus the field TypeScript's DOM library has not caught up with.
 *
 * `durationThreshold` is part of the Event Timing specification and Chromium implements it.
 */
interface EventTimingInit extends PerformanceObserverInit {
  readonly durationThreshold?: number
}

/**
 * **The threshold is the whole of this declaration, and leaving it out was a real defect.**
 *
 * The default is 104 ms, so an observer that does not ask for anything lower is told only
 * about interactions that were *already* over budget — and then `afterVerdict`'s "two
 * consecutive bad verdicts" degenerates into "two bad verdicts ever", because the quick taps
 * that should clear a strike never reach the callback to clear it. The hysteresis this rule
 * is built on would have existed in `budget.ts` and nowhere else, on the one surface where a
 * single slow tap is genuinely ordinary: a phone choosing a photograph out of its library.
 *
 * 16 ms is the lowest the specification allows, which is one frame, which is the point: what
 * is wanted here is every interaction the screen answered, fast ones included.
 *
 * **And no `buffered`.** It was here and it imported the wrong screen's history: the entry
 * buffer belongs to the page, not to the route, so the guest's tap on the join screen was
 * replayed into the upload screen's first verdict. What this budget judges is the surface it
 * is mounted on, from the moment it is mounted.
 */
const WATCHING_EVERY_INTERACTION: EventTimingInit = { type: 'event', durationThreshold: 16 }

export const useInteractionBudget = (surface: GlassSurface): BudgetLevel => {
  const floor = budgetFloorFor(surface)
  const [level, setLevel] = useState<BudgetLevel>(floor)

  /**
   * Strikes decide nothing on their own, so they stay out of React (see `useFrameBudget`) —
   * and they are stamped with the surface they were counted against.
   *
   * **A shell that changes which surface it is starts again from that surface's floor.**
   * Today no shell does: `router.tsx` gives the guest, host and wall layouts an `AppShell`
   * each, with a constant `surface`. So this is latent rather than a bug on the branch, and
   * it is here because the alternative is a rule that holds by accident — the floor was read
   * once at mount and the effect did not depend on it, so the day one shell renders two
   * surfaces, a verdict measured on somebody's phone would follow the projector.
   */
  const state = useRef<BudgetState & { surface: GlassSurface }>({
    surface,
    level: floor,
    strikes: 0,
  })

  const [measuring, setMeasuring] = useState<GlassSurface>(surface)
  if (measuring !== surface) {
    // React's own pattern for a prop that has to reset state, rather than an effect that
    // lands a frame late — which is the flash of the wrong material `eventTheme.ts` argues
    // out at length. The ref is stamped in the effect below, where writing one is allowed.
    setMeasuring(surface)
    setLevel(floor)
  }

  /**
   * There is exactly one rung this surface can decide, and it is the blur.
   *
   * Below it the ladder is the wall's — a phone has no Ken Burns and no crossfade — and the
   * guest's critical path is not on the ladder at all. So once the blur is gone there is
   * nothing left for a measurement to decide and the observer is disconnected, rather than
   * left listening on a phone that is mid-upload.
   *
   * **This is also what excludes the room, and deliberately not a `surface === 'wall'`
   * clause beside it.** That clause was written first and a mutation proved it dead: the
   * wall's floor has already spent this rung before it renders a frame, so the wall is
   * `spent` on arrival for exactly the reason it has no glass. One spelling of the rule,
   * which is the whole argument for `budget.ts` holding the ladder.
   */
  const spent = !affords(level, 'glass')

  useEffect(() => {
    // Strikes counted against another surface are not evidence about this one.
    if (state.current.surface !== surface) state.current = { surface, level: floor, strikes: 0 }

    if (spent) return undefined
    if (typeof PerformanceObserver === 'undefined') return undefined

    const observer = new PerformanceObserver((list) => {
      const durations = list.getEntries().map((entry) => entry.duration)
      const before = state.current.level
      state.current = { surface, ...afterVerdict(state.current, interactionsHold(durations)) }
      if (state.current.level !== before) setLevel(state.current.level)
    })

    try {
      observer.observe(WATCHING_EVERY_INTERACTION)
    } catch {
      // A browser that does not implement the `event` entry type throws rather than
      // reporting nothing. Nothing to disconnect and nothing to measure.
      return undefined
    }

    return () => observer.disconnect()
  }, [floor, spent, surface])

  return level
}
