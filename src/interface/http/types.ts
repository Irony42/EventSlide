import type { Event } from '../../domain/events/event'
import type { EventRole } from '../../domain/events/eventRole'
import type { Guest } from '../../domain/guests/guest'
import type { EventId, UserId } from '../../domain/shared/ids'
import type { Clock } from '../../application/ports/clock'
import type { Logger } from '../../application/ports/logger'
import type { EventBus } from '../../application/ports/eventBus'
import type { EventRepository } from '../../application/ports/eventRepository'
import type { GuestRepository } from '../../application/ports/guestRepository'
import type { MembershipRepository, UserRepository } from '../../application/ports/userRepository'
import type { GuestTokenService } from '../../application/ports/guestTokenService'

/**
 * The two principals, and nothing in between.
 *
 * A request carries at most one. There is deliberately no "logged in" principal without
 * a role: authorization is always answered against the event in the URL, never against
 * the mere existence of a session. 1.0 had a single `isAuthenticated` check and a
 * `partyId` column on the user row, so every authenticated user was implicitly
 * authorized for their one party and there was no notion of a role at all.
 */
export interface UserPrincipal {
  readonly kind: 'user'
  readonly userId: UserId
  readonly email: string
  readonly mustChangePassword: boolean
}

export interface GuestPrincipal {
  readonly kind: 'guest'
  readonly guest: Guest
  readonly eventId: EventId
}

export type Principal = UserPrincipal | GuestPrincipal

/**
 * Everything the authorization middleware resolved, attached to the request.
 *
 * `event` and `role` are populated by `requireRole`/`requireGuest` after they have
 * looked the event up — so a handler never repeats the lookup, and never has to
 * remember to scope a query by an id it read from the path itself.
 */
export interface RequestContext {
  readonly requestId: string
  readonly logger: Logger
  user?: UserPrincipal
  guest?: GuestPrincipal
  event?: Event
  role?: EventRole
}

/** What the HTTP layer is given. Ports and use cases only — never an adapter. */
export interface HttpDeps {
  readonly clock: Clock
  readonly logger: Logger
  readonly bus: EventBus
  readonly events: EventRepository
  readonly guests: GuestRepository
  readonly memberships: MembershipRepository
  /**
   * One method, deliberately: what the caller may do on the box.
   *
   * `requireOperator` is the only thing here that asks, and it has no business being able
   * to read an account's hash, rename it or delete it. `SqliteUserRepository` satisfies
   * this structurally, so the composition root passes the whole adapter and the HTTP
   * layer still cannot reach the rest of it.
   */
  readonly users: Pick<UserRepository, 'siteRoleFor'>
  readonly guestTokens: GuestTokenService
  readonly config: HttpConfig
}

/**
 * The slice of configuration the HTTP layer needs. A narrow view rather than the whole
 * `AppConfig`, so a route cannot quietly start depending on a database path.
 */
export interface HttpConfig {
  readonly isProduction: boolean
  readonly publicUrl: string
  readonly trustProxyHops: number
  readonly sessionSecret: string
  readonly secureCookie: boolean
  readonly e2eHooks: boolean
  readonly uploads: {
    readonly maxBytes: number
    readonly maxFiles: number
  }
  /**
   * The clip half, deliberately separate from `uploads`.
   *
   * `guestRoutes.ts` derives the heap a single photo request may hold from
   * `uploads.maxBytes`, and `compose.yaml`'s memory limit was reasoned against that
   * number — so a clip's much larger ceiling cannot share the field without silently
   * raising one somebody else calculated.
   */
  readonly clips: {
    readonly maxBytes: number
    /**
     * `MAX_CLIP_SECONDS`, in seconds.
     *
     * Enforced by the domain rather than here — `ClipDuration.create` refuses a longer
     * source — so the only thing the HTTP layer does with it is **tell the guest**, in
     * `PublicEventDto`. That is worth the field: a phone can read a recording's duration
     * before it sends it, and a refusal that arrives before eighty megabytes do is the
     * difference between a guest filming a shorter one and a guest giving up.
     */
    readonly maxSeconds: number
    /**
     * Whether this box has a video encoder at all, decided once at boot.
     *
     * Here for the same reason `maxSeconds` is: the HTTP layer enforces nothing with it
     * — `uploadClip` does — and only **tells the guest**, through `PublicEventDto`. That
     * is worth the field, because the refusal it prevents costs a full upload.
     */
    readonly supported: boolean
    /** Where multer writes a clip before it is staged. Under `MEDIA_ROOT`. */
    readonly uploadTempDir: string
  }
  readonly rateLimits: {
    readonly uploadPerMinute: number
    readonly joinPerMinute: number
    readonly loginPerMinute: number
    readonly reactionPerMinute: number
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- how Express is extended
  namespace Express {
    interface Request {
      /**
       * Present on every request from the first middleware onwards. Typed as
       * non-optional deliberately: a handler that reads it before the context
       * middleware ran is a wiring bug, and making it optional would push a `?.` into
       * every handler to hide that.
       */
      context: RequestContext
    }
  }
}

/** The session payload. Kept minimal: a user id, and nothing worth stealing. */
export interface SessionPayload {
  userId?: string
  email?: string
  mustChangePassword?: boolean
}
