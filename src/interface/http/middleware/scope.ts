import type { Request, RequestHandler, Response } from 'express'
import type { Event } from '../../../domain/events/event'
import type { EventRole } from '../../../domain/events/eventRole'
import type { Guest } from '../../../domain/guests/guest'
import type { PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import type { RequestContext, UserPrincipal } from '../types'
import { asyncHandler } from './asyncHandler'

/**
 * What a handler may read of the request, once the middleware in front of it has run.
 *
 * `authz.ts` decides who the caller is and fills `req.context`; a handler wants the same
 * thing narrowed to a type it can use without `!`. That narrowing is written **here and
 * nowhere else**, so there is one answer to "the middleware did not run" instead of one
 * per route module.
 *
 * ## The one answer
 *
 * Every helper below throws the same `DomainError.unexpected('server.unexpected')`, which
 * the error handler logs against the request id and answers as an opaque 500. Not a 401
 * or a 404: reaching one of these means a route was mounted **without** its authorization
 * decision, which is a wiring bug and not something the caller did, and answering it as
 * a refusal would let a missing middleware pass for a working one. Not a fallback
 * principal either: inventing an anonymous caller would turn the mis-wiring into a silent
 * authorization hole, which is the 1.0 failure mode this layer exists to prevent. And not
 * a `!`, which the strict settings forbid and which would turn the same bug into a
 * `TypeError` on a guest's phone mid-upload.
 *
 * What was missing goes to the log, never to the client; the body carries no details at
 * all, which is also how a test tells this deliberate refusal from a dereference of
 * `undefined` (the error handler stamps a `requestId` into anything it did not expect).
 */

/** The only part of the request these helpers read. Lets a test pass a bare context. */
export type ScopeSource = Pick<Request, 'context'>

const wiringFailure = (context: RequestContext, missing: string): DomainError => {
  context.logger.error('route mounted without its authorization middleware', {
    missing,
    requestId: context.requestId,
  })
  return DomainError.unexpected('server.unexpected')
}

/** The signed-in account `requireUser` or `requireRole` established. */
export const userOf = ({ context }: ScopeSource): UserPrincipal => {
  const { user } = context
  if (user === undefined) throw wiringFailure(context, 'user')
  return user
}

/** What `requireRole` resolved: the caller, the event in the path, and their role in it. */
export interface HostScope {
  readonly user: UserPrincipal
  readonly event: Event
  readonly role: EventRole
}

export const hostScopeOf = (source: ScopeSource): HostScope => {
  const user = userOf(source)
  const { event, role } = source.context
  if (event === undefined || role === undefined) throw wiringFailure(source.context, 'event')
  return { user, event, role }
}

/** What `requireGuest` resolved: the event the token names and the guest behind it. */
export interface GuestScope {
  readonly event: Event
  readonly guest: Guest
}

export const guestScopeOf = ({ context }: ScopeSource): GuestScope => {
  const { event, guest } = context
  if (event === undefined || guest === undefined) throw wiringFailure(context, 'guest')
  return { event, guest: guest.guest }
}

/** What a moderation route needs of `requireRole`: the event, and the host acting on it. */
export interface ModeratorScope {
  readonly eventId: EventId
  /**
   * The event's canonical slug, taken from the resolved event rather than from the
   * path, so the media links in a response cannot differ from the ones the wall and
   * the printed card use.
   */
  readonly slug: string
  readonly actor: PhotoActor
}

export const moderatorScopeOf = (source: ScopeSource): ModeratorScope => {
  const { user, event } = hostScopeOf(source)
  return { eventId: event.id, slug: event.slug.value, actor: { kind: 'host', userId: user.userId } }
}

/** The event `resolvePublicEvent` (or any `requireRole`) left behind. */
export const publicEventOf = ({ context }: ScopeSource): Event => {
  const { event } = context
  if (event === undefined) throw wiringFailure(context, 'event')
  return event
}

type Handler<Scope> = (scope: Scope, req: Request, res: Response) => Promise<void>

/**
 * `asyncHandler` plus the narrowing each kind of route would otherwise repeat: the three
 * wrappers below. Exported so the guard can be exercised without a route in front of it,
 * which is what `scope.test.ts` does.
 *
 * `cleanup` runs after the handler on **every** exit: the answer, the refusal, the thrown
 * error. The clip route's disk storage is why it exists: every path out of a handler owns
 * a file, and "cleanup on every exit path" is exactly what 1.0 leaked.
 */
export interface GuestWrapperOptions {
  readonly cleanup?: (req: Request) => Promise<void>
}

export const withGuest = (
  handler: Handler<GuestScope>,
  { cleanup }: GuestWrapperOptions = {},
): RequestHandler =>
  asyncHandler(async (req, res) => {
    try {
      await handler(guestScopeOf(req), req, res)
    } finally {
      await cleanup?.(req)
    }
  })

export const withModerator = (handler: Handler<ModeratorScope>): RequestHandler =>
  asyncHandler(async (req, res) => {
    await handler(moderatorScopeOf(req), req, res)
  })

export const withPublicEvent = (
  handler: (event: Event, req: Request, res: Response) => Promise<void>,
): RequestHandler =>
  asyncHandler(async (req, res) => {
    await handler(publicEventOf(req), req, res)
  })
