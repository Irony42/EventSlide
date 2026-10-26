import { describe, expect, it } from 'vitest'
import { withoutComments } from '../testing/withoutComments'

/**
 * There is one "read on mount" hook, and a screen does not write its own — the source, read.
 *
 * `useLoader` is that hook: an `AbortController` per request, a tag that says which request an
 * answer belongs to, and an abort on cleanup that is not reported as a failure. Ten effects
 * spelled that out by hand for as long as the hook lived inside `features/admin`, with three
 * different ideas of what to do after unmount, and the copies are not harmless: a stale
 * answer that lands last, or an abort reported as a failure, is invisible in the markup and
 * looks exactly like a server that lost the change.
 *
 * What is refused is the shape those ten had in common, and nothing wider: **an effect that
 * creates an `AbortController`, hands its `signal` to a call, and sets state.** An effect that
 * registers a listener with `{ signal }`, one that creates a controller for an upload inside a
 * handler, and one that sets state without asking a server anything are different questions
 * and are not matched.
 *
 * **What it does not see**, so that nobody takes its silence for more than it says: a controller
 * created in a `useCallback` that an effect then calls, an effect that reads with no controller
 * at all, a `fetch` of its own, a signal passed under another name, a custom effect hook, and
 * anything under `lib/` or `design-system/`. None exists in the tree today (measured when this was
 * written); each is a different shape, and widening the detector to all of them would start to
 * match effects that are not reads. The review that finds one adds it here.
 *
 * A reader that really differs says so in {@link BESPOKE}, with the reason. The count is
 * exact and an entry that no longer matches fails, so the list shrinks when a reader is
 * adopted and cannot quietly excuse a second one.
 *
 * Read as text rather than imported, for the reason `glassBackdrop.test.ts` is: no behaviour
 * tells the copies apart until one of them drifts.
 */

const MODULES = import.meta.glob<string>('../{features,app}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Glob keys arrive relative to this file: `../app/x` is `app/x`. */
const named = (path: string): string => path.replace(/^\.\.\//, '')

/** Production modules only: a test may read however it likes. */
const production = Object.entries(MODULES)
  .map(([path, source]) => [named(path), source] as const)
  .filter(([path]) => !/\.test\.tsx?$/.test(path))

const EFFECT = /\buse(?:Layout)?Effect\(/g
const CREATES_CONTROLLER = /\bnew\s+AbortController\(/
/**
 * A signal handed over as an argument: `api.x(slug, controller.signal)`, `read(1, signal)` on
 * the line below. `{ signal: controller.signal }` is a property and is not one — that is how a
 * listener is registered, and `addEventListener` is not a read.
 */
const PASSES_SIGNAL = /[(,]\s*[\w.]+\.signal\b/
/**
 * A `useState` setter by the name every one in this tree has, called or handed over as it is
 * (`.then(setRows)`), or a reducer's `dispatch`. Timers are not setters: `setTimeout` starts
 * with the same letters.
 */
const SETS_STATE = /\bset(?!Timeout|Interval|Immediate)[A-Z]\w*\b|\bdispatch\b/

/**
 * The index of the parenthesis that closes the one at `open`, skipping what is inside a
 * string. Throws rather than guessing: a scan that ran off the end would read as "no effect
 * here", which is the direction that hides a defect.
 */
const closeOf = (source: string, open: number): number => {
  let depth = 0
  let quote: string | null = null
  for (let index = open; index < source.length; index += 1) {
    const char = source.charAt(index)
    if (quote !== null) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  throw new Error(`unbalanced parenthesis at ${open}`)
}

/** The body of every effect in a source, comments stripped. */
const effectsIn = (source: string): readonly string[] => {
  const code = withoutComments(source)
  return [...code.matchAll(EFFECT)].map((match) => {
    const open = match.index + match[0].length - 1
    return code.slice(open, closeOf(code, open) + 1)
  })
}

/** How many effects in a source are a hand-rolled read. */
const handRolledReads = (source: string): number =>
  effectsIn(source).filter(
    (body) => CREATES_CONTROLLER.test(body) && PASSES_SIGNAL.test(body) && SETS_STATE.test(body),
  ).length

/**
 * The readers that stay by hand, and why: file, how many such effects it holds, and what its
 * semantics are that `useLoader` does not have. Each one is a decision and not an omission.
 */
const BESPOKE: ReadonlyMap<string, { readonly count: number; readonly reason: string }> = new Map([
  [
    'app/SessionProvider.tsx',
    {
      count: 1,
      reason:
        'A lazy request (nothing is asked until a screen needs the session), `forget` and a ' +
        'shared store for every caller: the read is gated and its answer is dropped on sign-out.',
    },
  ],
  [
    'features/guest-upload/hooks/useMyPhotos.ts',
    {
      count: 1,
      reason:
        'A failed read blanks the list and says one fixed sentence, a refresh clears the error ' +
        'at once, and a deletion refusal shares the error slot: `useLoader` ' +
        'keeps the previous answer through a failure.',
    },
  ],
  [
    'features/guest-upload/hooks/usePrivacyNotice.ts',
    {
      count: 1,
      reason:
        'The answer folds into state that also starts from the session, is changed by the ' +
        'tap of the guest, and is guarded by a generation counter so that a read sent ' +
        'before the tap cannot land after it; a lost tap is replayed from the read.',
    },
  ],
  [
    'features/guest-feed/hooks/usePhotoReactions.ts',
    {
      count: 1,
      reason:
        'The answer is the base of an overlay the guest’s own taps change, and a re-read may only ' +
        'start once no tap is in the air — a snapshot older than a request still on its way would ' +
        'take that tap off the screen — so it is started by the settling of a request, and the ' +
        'buttons must rest from the failure until it answers: while the taps drain, the read has ' +
        'not been asked yet, which `useLoader`’s derived `loading` does not say.',
    },
  ],
  [
    'features/gallery/hooks/useGallery.ts',
    {
      count: 1,
      reason:
        'Several requests per read (the summary, then pages), a failure classified as locked or ' +
        'unavailable or failed, a timer that re-reads what is on screen, and a "load more" that ' +
        'appends to it.',
    },
  ],
  [
    'features/moderation/hooks/useModerationQueue.ts',
    {
      count: 1,
      reason:
        'A silent revalidation next to the refresh that shows a spinner, a filter that drops the ' +
        'grid at once, and a pending count that comes with the items.',
    },
  ],
  [
    'features/wall/hooks/useWallPlaylist.ts',
    {
      count: 1,
      reason:
        'The projector keeps the identical playlist object when the revision has not moved, so ' +
        'the slideshow does not restart, and re-asks on its own after a failure: no spinner, ever.',
    },
  ],
])

describe('a screen reads through useLoader and does not write its own read effect', () => {
  it('has something to read, rather than an empty glob', () => {
    expect(production.length).toBeGreaterThan(100)
    expect(production.map(([path]) => path)).toContain('features/admin/hooks/useEventData.ts')
  })

  it('recognises the hand-rolled read, in the shapes this tree has had and the ones it could gain', () => {
    // The detector pointed at known positives: without this, "no offenders" below is as
    // green for a broken pattern as for a clean tree.
    const afterUnmount = [
      'useEffect(() => {',
      '  const controller = new AbortController()',
      '  let current = true',
      '  api.myMissions(slug, controller.signal).then((response) => {',
      '    if (current) setMissions(response.items)',
      '  })',
      '  return () => {',
      '    current = false',
      '    controller.abort()',
      '  }',
      '}, [api, slug])',
    ].join('\n')
    const layout = afterUnmount.replace('useEffect', 'useLayoutEffect')
    const reducer = afterUnmount.replace('setMissions(response.items)', 'dispatch(response)')
    const signalOnItsOwnLine = afterUnmount.replace(
      'api.myMissions(slug, controller.signal)',
      'api.myMissions(\n    slug,\n    controller.signal,\n  )',
    )
    const aliasedSignal = afterUnmount.replace('controller.signal', 'signal')
    // The setter handed over as it is: no parenthesis after its name, and still a read.
    const byReference = [
      'useEffect(() => {',
      '  const controller = new AbortController()',
      '  api.myMissions(slug, controller.signal).then(setMissions)',
      '  return () => controller.abort()',
      '}, [api, slug])',
    ].join('\n')

    expect(handRolledReads(afterUnmount)).toBe(1)
    expect(handRolledReads(byReference)).toBe(1)
    expect(handRolledReads(layout)).toBe(1)
    expect(handRolledReads(reducer)).toBe(1)
    expect(handRolledReads(signalOnItsOwnLine)).toBe(1)
    // `signal` alone is not `x.signal`: an aliased signal is the one spelling this misses, and
    // none in the tree uses it. Pinned so that changing it is a decision.
    expect(handRolledReads(aliasedSignal)).toBe(0)
    expect(handRolledReads(`${afterUnmount}\n${afterUnmount}`)).toBe(2)
  })

  it('does not take an effect that is not a read for one', () => {
    const listener = [
      'useEffect(() => {',
      '  const controller = new AbortController()',
      "  window.addEventListener('online', () => setOnline(true), { signal: controller.signal })",
      '  return () => controller.abort()',
      '}, [])',
    ].join('\n')
    const noState = [
      'useEffect(() => {',
      '  const controller = new AbortController()',
      '  void warm(controller.signal)',
      '  return () => controller.abort()',
      '}, [])',
    ].join('\n')
    // A timer starts with the letters of a setter and sets nothing.
    const timerOnly = [
      'useEffect(() => {',
      '  const controller = new AbortController()',
      '  void warm(controller.signal)',
      '  const timer = setTimeout(() => warmAgain(controller.signal), 5000)',
      '  return () => clearTimeout(timer)',
      '}, [])',
    ].join('\n')
    const noController = [
      'useEffect(() => {',
      '  api.about(signal).then((about) => setAbout(about))',
      '}, [api])',
    ].join('\n')
    const inAHandler = [
      'const send = useCallback(() => {',
      '  const controller = new AbortController()',
      '  upload(file, controller.signal).then(() => setSent(true))',
      '}, [])',
      'useEffect(() => { setReady(true) }, [])',
    ].join('\n')
    const inAComment = [
      'useEffect(() => {',
      '  // was: const controller = new AbortController(); api.x(controller.signal); setX(1)',
      '  setReady(true)',
      '}, [])',
    ].join('\n')

    expect(handRolledReads(timerOnly)).toBe(0)
    expect(handRolledReads(listener)).toBe(0)
    expect(handRolledReads(noState)).toBe(0)
    expect(handRolledReads(noController)).toBe(0)
    expect(handRolledReads(inAHandler)).toBe(0)
    expect(handRolledReads(inAComment)).toBe(0)
  })

  it('reads an effect whose body holds strings and nested calls to its own closing parenthesis', () => {
    const body = [
      'useEffect(() => {',
      "  const note = ') ( \"'",
      '  const controller = new AbortController()',
      '  api.x(slug, controller.signal).then((r) => setX(r))',
      '}, [slug])',
      'const after = useCallback(() => setY(1), [])',
    ].join('\n')

    expect(effectsIn(body)).toHaveLength(1)
    expect(handRolledReads(body)).toBe(1)
    expect(() => effectsIn('useEffect(() => {')).toThrow('unbalanced')
  })

  it.each(production)('%s holds only the read effects it is excused for', (path, source) => {
    const excused = BESPOKE.get(path)?.count ?? 0

    expect(handRolledReads(source)).toBe(excused)
  })

  it('excuses no file that has gone, and gives every excuse a reason', () => {
    const paths = new Set(production.map(([path]) => path))

    for (const [path, { count, reason }] of BESPOKE) {
      expect(paths.has(path), `${path} is excused but does not exist`).toBe(true)
      expect(count).toBeGreaterThan(0)
      expect(reason.length, `${path} has no reason`).toBeGreaterThan(40)
    }
  })
})
