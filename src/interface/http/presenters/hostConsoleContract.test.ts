import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  allowedTransitionsFrom as allowedEventTransitions,
  allowsModeration,
  canTransition as canTransitionEvent,
  EVENT_STATUSES,
  isMutable,
  servesWall,
  type EventStatus,
} from '../../../domain/events/eventStatus'
import { canManageEvent, EVENT_ROLES } from '../../../domain/events/eventRole'
import {
  inverseOf,
  MODERATION_DECISIONS,
  targetStatusFor,
  type ModerationDecision,
} from '../../../domain/moderation/moderationDecision'
import {
  canTransition as canTransitionPhoto,
  PHOTO_STATUSES,
  type PhotoStatus,
} from '../../../domain/photos/photoStatus'

/**
 * The host console's copies of two domain rules, run on the same cases as the rules
 * themselves (WEB-HOST-15).
 *
 * The console cannot import `src/domain` (the architecture rule, `eslint.config.mjs`), so it
 * carries small copies: the lifecycle predicates the buttons are drawn from
 * (`web/src/lib/eventLifecycle.ts`) and the table that says which decision takes another back
 * (`web/src/features/moderation/lib/restoringDecision.ts`). Each had web unit tests only. If
 * the domain changed `inverseOf` or a status predicate, the console would offer a button the
 * server refuses (409, or `skipped` in a bulk answer) or hide one it accepts, and no test in
 * either half would notice.
 *
 * Unlike the source-comparing contracts beside this one, the copies are **executed**: each web
 * file is transpiled and evaluated here (both hold type-only imports, which transpiling erases,
 * so the evaluation needs nothing else), and every status, role and decision is put to both
 * sides. Reading a path is not an import: nothing couples the server build to the web app.
 */

interface LifecycleModule {
  readonly allowsModeration: (status: EventStatus) => boolean
  readonly servesWall: (status: EventStatus) => boolean
  readonly isMutable: (status: EventStatus) => boolean
  readonly canManageEvent: (role: 'owner' | 'moderator') => boolean
  readonly lifecycleActions: (
    from: EventStatus,
    text: unknown,
  ) => readonly { readonly to: EventStatus; readonly primary: boolean }[]
}

interface RestoringModule {
  readonly TARGET_STATUS: Readonly<Record<ModerationDecision, PhotoStatus>>
  readonly restoringDecision: (
    previous: PhotoStatus,
    current: PhotoStatus,
  ) => { readonly decision: ModerationDecision | null; readonly exact: boolean }
}

/** Transpile a web file that has only type imports, and run it. */
const loadWebModule = <T>(relative: string): T => {
  const source = readFileSync(join(process.cwd(), relative), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  // A value import would survive transpiling as a `require`; the copies are meant to need none.
  if (/\brequire\(/.test(outputText)) throw new Error(`${relative} imports a value`)
  const module = { exports: {} as Record<string, unknown> }
  new Function('module', 'exports', outputText)(module, module.exports)
  return module.exports as T
}

/** Any `text.section.key` is its own name: the copy is not under test, the structure is. */
const echoText: unknown = new Proxy(
  {},
  { get: () => new Proxy({}, { get: (_target, key) => String(key) }) },
)

const lifecycle = loadWebModule<LifecycleModule>('web/src/lib/eventLifecycle.ts')
const restoring = loadWebModule<RestoringModule>(
  'web/src/features/moderation/lib/restoringDecision.ts',
)

describe('the event lifecycle the console draws its buttons from', () => {
  it('loaded the console copy and sees every status', () => {
    expect(EVENT_STATUSES).toHaveLength(4)
    expect(typeof lifecycle.lifecycleActions).toBe('function')
  })

  it.each(EVENT_STATUSES)('answers the status predicates of the domain for %s', (status) => {
    expect(lifecycle.allowsModeration(status)).toBe(allowsModeration(status))
    expect(lifecycle.servesWall(status)).toBe(servesWall(status))
    expect(lifecycle.isMutable(status)).toBe(isMutable(status))
  })

  it.each(EVENT_ROLES)('answers canManageEvent of the domain for %s', (role) => {
    expect(lifecycle.canManageEvent(role)).toBe(canManageEvent(role))
  })

  it.each(EVENT_STATUSES)('offers from %s only moves the domain allows', (from) => {
    for (const action of lifecycle.lifecycleActions(from, echoText)) {
      expect(canTransitionEvent(from, action.to)).toBe(true)
    }
  })

  it.each(EVENT_STATUSES)('offers at most one primary action from %s', (from) => {
    const primaries = lifecycle.lifecycleActions(from, echoText).filter((action) => action.primary)
    expect(primaries.length).toBeLessThanOrEqual(1)
  })

  it('offers nothing from a status the domain cannot leave', () => {
    for (const from of EVENT_STATUSES) {
      if (allowedEventTransitions(from).length === 0) {
        expect(lifecycle.lifecycleActions(from, echoText)).toEqual([])
      }
    }
  })

  it('offers a way to the first move of the evening from the draft', () => {
    expect(lifecycle.lifecycleActions('draft', echoText).map((action) => action.to)).toContain(
      'live',
    )
  })
})

describe('the moderation decisions the console puts on a tile', () => {
  it.each(MODERATION_DECISIONS)('projects %s to the status the domain gives it', (decision) => {
    expect(restoring.TARGET_STATUS[decision]).toBe(targetStatusFor(decision))
  })

  const legalMoves = PHOTO_STATUSES.flatMap((previous) =>
    PHOTO_STATUSES.filter(
      (current) => current !== previous && canTransitionPhoto(previous, current),
    ).map((current) => [previous, current] as const),
  )

  it('has legal moves to check', () => {
    expect(legalMoves.length).toBeGreaterThan(5)
  })

  it.each(legalMoves)(
    'offers to take back %s -> %s only with a decision the server will accept',
    (previous, current) => {
      const restore = restoring.restoringDecision(previous, current)
      if (restore.decision === null) return
      // The server skips a move the photo's status machine does not allow from where it is now.
      expect(canTransitionPhoto(current, targetStatusFor(restore.decision))).toBe(true)
      // `exact` is a claim about the result: the photo lands where it was.
      expect(targetStatusFor(restore.decision) === previous).toBe(restore.exact)
    },
  )

  it.each(legalMoves)(
    'never offers to put %s -> %s back into the queue or onto the wall unapproved',
    (previous, current) => {
      const restore = restoring.restoringDecision(previous, current)
      if (previous === 'pending' && restore.decision !== null) {
        // From the queue the only way back that cannot reach the projector is `hide`.
        expect(targetStatusFor(restore.decision)).toBe('hidden')
      }
    },
  )

  it.each(MODERATION_DECISIONS)(
    'agrees with the domain when %s has a single possible predecessor',
    (decision) => {
      const inverse = inverseOf(decision)
      const target = targetStatusFor(decision)
      const predecessors = PHOTO_STATUSES.filter(
        (status) => status !== target && canTransitionPhoto(status, target),
      )
      if (inverse === null || predecessors.length !== 1) return
      const [only] = predecessors
      if (only === undefined) return
      expect(restoring.restoringDecision(only, target)).toEqual({ decision: inverse, exact: true })
    },
  )

  it('knows the one decision the domain offers an inverse for', () => {
    // Guards the test above against a domain table that stopped having one: it would pass
    // vacuously with every inverse null.
    expect(MODERATION_DECISIONS.filter((decision) => inverseOf(decision) !== null)).toEqual([
      'hide',
    ])
  })
})
