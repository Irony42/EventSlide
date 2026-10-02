import { createHash } from 'node:crypto'
import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit'
import type { Request, RequestHandler } from 'express'
import { DomainError } from '../../../domain/shared/errors'
import { Slug } from '../../../domain/shared/slug'
import {
  SECOND_FACTOR_FAILURES_PER_ACCOUNT,
  SECOND_FACTOR_FAILURE_WINDOW_MS,
} from '../../../domain/users/secondFactor'
import { errorBody } from '../presenters/send'
import type { SessionPayload } from '../types'

/**
 * Per-IP limits on the endpoints an outsider can reach.
 *
 * 1.0 had none, and `/api/upload` was fully public with the event name in a query
 * parameter, so a single script could fill the disk and create a directory per
 * request. The byte quota per event is the other half of that control; this half stops
 * the request volume.
 *
 * `trust proxy` must be set correctly for these to mean anything. Behind one reverse
 * proxy with it unset, every request appears to come from the proxy and one guest's
 * burst locks out the whole venue; set too high, a client can spoof
 * `X-Forwarded-For` and bypass the limit entirely. Hence `TRUST_PROXY_HOPS` is
 * explicit configuration rather than a guess.
 */

/**
 * The client's address, collapsed to a /56 for IPv6.
 *
 * A raw IPv6 address is not a usable rate-limit key: a residential allocation is
 * routinely a /64, so one client has 2^64 addresses and a per-address limit is no limit
 * at all. `ipKeyGenerator` collapses the address to its subnet, which is what makes the
 * bucket mean "this client" rather than "this address this second".
 *
 * express-rate-limit warns at startup (`ERR_ERL_KEY_GEN_IPV6`) when a custom key
 * generator uses `req.ip` without it — the warning is how this was caught.
 */
export const clientKey = (req: Request): string => ipKeyGenerator(req.ip ?? 'unknown')

/** The bucket for a request with no event in its path — and for one whose event is not a slug. */
const NO_EVENT = 'none'

/**
 * The event half of an upload or reaction key, **parsed** rather than interpolated.
 *
 * Both limiters are mounted before `requireGuest`, deliberately: a flood has to be
 * refused before it costs an HMAC verification and two repository reads. The price is
 * that nothing has looked at `:eventSlug` yet when the key is built, so interpolated
 * raw it is whatever the caller typed — a path segment bounded only by the server's URL
 * limit, and a different one on every request. Each distinct value mints its own entry
 * in the in-memory store, so the caller chose both how many keys existed and how large
 * each one was. The window resets every minute, which is why this was never unbounded;
 * it was still a memory amplification factor of several thousand per request.
 *
 * `Slug.create` is the same parse `requireGuest` runs a moment later, so a key can only
 * ever contain something that could name a real event — at most `Slug.maxLength`
 * characters — and everything that could not collapses into the one `'none'` bucket
 * that already covered a route with no event in its path. A client spraying invented
 * slugs now spends a single bucket and gets limited on it, instead of buying a fresh
 * one with every request.
 */
const eventKey = (req: Request): string => {
  const slug = Slug.create(req.params['eventSlug'])
  return slug.ok ? slug.value.value : NO_EVENT
}

const limiter = (perMinute: number, code: string, keyBy?: (req: Request) => string) =>
  rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyBy ? { keyGenerator: keyBy } : {}),
    handler: (_req, res) => {
      res.status(429).json(errorBody(DomainError.rateLimited(code)))
    },
  })

/**
 * The join endpoint is the one an attacker would enumerate, so it is limited hardest
 * relative to its legitimate use: a guest joins once.
 */
export const joinLimiter = (perMinute: number): RateLimitRequestHandler =>
  limiter(perMinute, 'rate.limited')

/** Login. Combined with bcrypt's cost, this puts online guessing out of reach. */
export const loginLimiter = (perMinute: number): RateLimitRequestHandler =>
  limiter(perMinute, 'rate.limited')

/**
 * The two unauthenticated endpoints of a password reset: asking for a link and spending one.
 *
 * The sign-in budget (`LOGIN_RATE_LIMIT_PER_MINUTE`) on purpose and not a number of its own:
 * all three are doors an anonymous stranger can knock on, they are guarded by the same
 * client address, and an operator who tuned one for their venue meant them all. **One
 * limiter per route**, each built by its own call — `express-rate-limit` gives every call
 * its own store, so asking for a link cannot spend the allowance for using one.
 *
 * What this does not bound is *whom* a stranger asks about: a hundred addresses a minute from
 * a hundred networks. That is the per-address cap inside `requestPasswordReset`, which counts
 * what was actually issued rather than what was attempted.
 */
export const passwordResetLimiter = (perMinute: number): RateLimitRequestHandler =>
  limiter(perMinute, 'rate.limited')

/**
 * Uploads, keyed by IP **and** event.
 *
 * A whole table of guests at a wedding shares one access point and therefore one
 * public IP, so a per-IP-only limit would throttle the venue rather than an abuser.
 * Including the event keeps a burst on one event from affecting another on the same
 * box, and the byte quota is what actually bounds a determined guest.
 */
export const uploadLimiter = (perMinute: number): RateLimitRequestHandler =>
  limiter(perMinute, 'rate.limited', (req) => `${clientKey(req)}:${eventKey(req)}`)

/** Reactions are cheap but tappable at speed; the domain budget is the finer control. */
export const reactionLimiter = (perMinute: number): RateLimitRequestHandler =>
  limiter(perMinute, 'reaction.rateLimited', (req) => `${clientKey(req)}:${eventKey(req)}`)

// -------------------------------------------------------------- event creation --

/**
 * The account that created the request, as a rate-limit key.
 *
 * `requireUser` runs ahead of this limiter on `POST /events` and leaves
 * `req.context.user` set, so the account is on the request by the time this reads it.
 * The fallback to {@link clientKey} is defensive only — reached if this were ever
 * mounted ahead of `requireUser` by mistake — and keeps the limiter a limiter rather
 * than a crash, the same way `eventKey` collapses an unparseable slug into one bucket
 * instead of refusing to key the request at all.
 */
const accountKey = (req: Request): string => req.context.user?.userId ?? clientKey(req)

/**
 * How many events one **account** may create per hour (P4-09 / D-14).
 *
 * Keyed by account rather than address, unlike every other limiter in this file: an
 * office, a venue's guest Wi-Fi, or a shared office address is one IP behind which many
 * hosts work, and a host who already created six events today must not spend an
 * allowance a colleague on the same router never touched — nor must one host's burst
 * leave a colleague locked out. The flip side of `uploadLimiter`'s reasoning for keying
 * on **event**: there the shared address is the attack surface to protect against, here
 * it is the legitimate case the key must not punish.
 *
 * An hour, not a minute: event creation is the one write here that is rare by nature —
 * a host opens one event per occasion — so the window this limiter resets on is sized
 * to the behaviour it is bounding, same as the gallery unlock's fifteen minutes is.
 */
export const eventCreationLimiter = (perHour: number): RateLimitRequestHandler =>
  rateLimit({
    windowMs: 60 * 60_000,
    limit: perHour,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: (_req, res) => {
      res.status(429).json(errorBody(DomainError.rateLimited('event.creationRateLimited')))
    },
  })

// ------------------------------------------------------------ second factor --

/**
 * The second step of a sign-in, a step-up and the start of an enrolment, per client address.
 *
 * The sign-in budget (`LOGIN_RATE_LIMIT_PER_MINUTE`) on purpose, for the reason
 * {@link passwordResetLimiter} gives, and **one limiter per route** — each built by its own
 * call, because `express-rate-limit` gives every call its own store and a code guessed at one
 * door must not spend the allowance of another.
 */
export const secondFactorLimiter = (perMinute: number): RateLimitRequestHandler =>
  limiter(perMinute, 'rate.limited')

/**
 * The account a second-factor request is about, as a key: the signed-in account, or the one a
 * half-finished sign-in is for. Both come from the server-side session, never from the body —
 * a caller cannot choose a key, and cannot point the budget of another account at themselves.
 * Falls back to the address for a request with neither, which the handler refuses anyway.
 */
const secondFactorAccountKey = (req: Request): string => {
  const session = req.session as unknown as SessionPayload | undefined
  const who = req.context.user?.userId ?? session?.pendingSecondFactor?.userId
  return who === undefined ? clientKey(req) : `account:${who}`
}

/**
 * Wrong attempts per **account**, from every address together
 * ({@link SECOND_FACTOR_FAILURES_PER_ACCOUNT} per quarter of an hour), counting failures only.
 *
 * The control that makes six digits a defensible secret against a distributed guesser: the
 * per-address limiter and the five-try cap of one half-finished sign-in each stop one source,
 * and each member of a botnet stays under both. Keyed by account, they all spend one budget.
 * Failures only (`skipSuccessfulRequests`), so the owner who types their code correctly spends
 * nothing and cannot be locked out by an attacker's volume of *successes* — there are none —
 * only by their failures, which then cost the attacker the same quarter of an hour.
 */
export const secondFactorAccountLimiter = (): RateLimitRequestHandler =>
  rateLimit({
    windowMs: SECOND_FACTOR_FAILURE_WINDOW_MS,
    limit: SECOND_FACTOR_FAILURES_PER_ACCOUNT,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: secondFactorAccountKey,
    handler: (_req, res) => {
      res.status(429).json(errorBody(DomainError.rateLimited('auth.tooManySecondFactorAttempts')))
    },
  })

// ----------------------------------------------------------- shared gallery --

/**
 * The gallery's pages, per client (roadmap §4.1).
 *
 * Its own bucket rather than a share of another, because it is the one surface a stranger
 * reaches with nothing but a URL: a link forwarded to a group chat is opened by people
 * this box has never seen, and none of them should spend a wedding guest's upload
 * allowance or be spent by it. Per client and not per link, so a crawler walking a leaked
 * link cannot also walk every other link from the same address on a fresh budget.
 */
export const galleryLimiter = (perMinute: number): RateLimitRequestHandler =>
  limiter(perMinute, 'rate.limited', clientKey)

/**
 * The gallery's bytes, per client, on a separate and larger budget.
 *
 * A grid of sixty thumbnails is sixty requests the moment it renders, so a limit sized for
 * pages would starve the grid, and one sized for the grid would let the pages be walked at
 * sixty times the speed they need to be.
 */
export const galleryMediaLimiter = (perMinute: number): RateLimitRequestHandler =>
  limiter(perMinute, 'rate.limited', clientKey)

/** A quarter of an hour: long enough to stop a guesser, short enough to forgive a typo. */
const UNLOCK_WINDOW_MS = 15 * 60_000

/**
 * The link a password attempt is for, as a key — digested, so the limiter's own memory
 * never holds a gallery's token, and collapsed to one bucket for anything that is not
 * token-shaped so a sprayer of invented links spends one allowance, not one each.
 */
const galleryLinkKey = (req: Request): string => {
  const token = req.params['token']
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return `link:${NO_EVENT}`
  return `link:${createHash('sha256').update(token).digest('hex')}`
}

export interface GalleryUnlockLimits {
  /** Failed attempts one client may make, across every link, per window. */
  readonly perClient: number
  /** Failed attempts one link may take, from every client together, per window. */
  readonly perLink: number
}

/**
 * Password attempts, limited **per client and per link**, and counting failures only.
 *
 * Two limits because each closes what the other leaves open. Per client alone, a botnet
 * gets a fresh allowance per address against one link; per link alone, one address can
 * spend a link's whole allowance and lock its family out. Together, a guesser gets a few
 * tries from anywhere and a few dozen in total, per quarter hour, against a password the
 * account policy already made twelve characters long.
 *
 * **Failures only** (`skipSuccessfulRequests`): thirty relatives unlocking the same album
 * on the morning after spend nothing, so the per-link limit is a ceiling on guessing
 * rather than on the family. A dead link's answer is a failure too, so this is also the
 * limit on probing for tokens through the unlock route.
 */
export const galleryUnlockLimiters = ({
  perClient,
  perLink,
}: GalleryUnlockLimits): readonly RequestHandler[] =>
  [
    { limit: perClient, keyGenerator: clientKey },
    { limit: perLink, keyGenerator: galleryLinkKey },
  ].map(({ limit, keyGenerator }) =>
    rateLimit({
      windowMs: UNLOCK_WINDOW_MS,
      limit,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator,
      handler: (_req, res) => {
        res.status(429).json(errorBody(DomainError.rateLimited('gallery.tooManyAttempts')))
      },
    }),
  )

/**
 * How many event streams one client key may hold **open at the same time**.
 *
 * Twelve is several times the legitimate load and still nowhere near a denial of
 * service. Only two screens in the product open a stream — the projected wall and the
 * moderation console — and guests hold none, so one venue behind one public address is
 * a projector, a host's laptop and a moderator or two. The headroom is for a reload,
 * where the replacement connection can briefly overlap the one it replaces.
 */
const MAX_STREAMS_PER_CLIENT = 12

/**
 * How many event streams the process serves at once, across every client and event.
 *
 * The backstop for the case the per-client limit cannot see: a botnet, or simply a
 * conference with more screens than anyone planned for. Five hundred idle sockets is
 * far inside a default file-descriptor budget and far above any single venue, so this
 * bounds the failure without being reachable by honest use.
 */
const MAX_STREAMS_TOTAL = 500

export interface StreamConnectionLimits {
  readonly perClient?: number
  readonly total?: number
}

/**
 * Concurrency, not rate — the only limiter here that counts what is held rather than
 * what is spent.
 *
 * Every other public endpoint answers in milliseconds, so requests per minute bounds
 * what it costs. A stream is the opposite: `requestTimeout` is deliberately `0` for it,
 * and one connection holds a socket, a `setInterval` and a subscription for the whole
 * evening. Two hundred of them is an afternoon's work for one laptop, needs no
 * authentication, and used to be enough to silence an event's wall — so the quantity to
 * bound is how many are open, and a client that closes one immediately gets it back.
 *
 * The key is the one every other limiter uses, IPv6 collapsed to its subnet by
 * `ipKeyGenerator`: a per-address budget would be no budget at all against a residential
 * /64, and inventing a second notion of "client" for this one route is how two limits
 * end up disagreeing about who is being limited.
 *
 * Both bounds are configurable (`MAX_STREAMS_PER_CLIENT`, `MAX_STREAMS_TOTAL`, wired
 * through `HttpConfig.realtime` — deriving a concurrency ceiling from a
 * requests-per-minute figure would still be numerology wearing a config key's clothes,
 * which is why they are their own variables rather than a share of `rateLimits`. The
 * values here remain the defaults, and are also what lets a test reach the limit in two
 * connections instead of five hundred by passing its own.
 */
export const streamConnectionLimiter = ({
  perClient = MAX_STREAMS_PER_CLIENT,
  total = MAX_STREAMS_TOTAL,
}: StreamConnectionLimits = {}): RequestHandler => {
  const openPerClient = new Map<string, number>()
  let openTotal = 0

  return (req, res, next) => {
    if (openTotal >= total) {
      // The server is full, not this client: `503`, the same answer `/api/ready` gives
      // about a state that is temporary and nobody's fault.
      res.setHeader('Retry-After', '30')
      res.status(503).json(errorBody(DomainError.unexpected('service.notReady')))
      return
    }

    const key = clientKey(req)
    const held = openPerClient.get(key) ?? 0
    if (held >= perClient) {
      res.status(429).json(errorBody(DomainError.rateLimited('rate.limited')))
      return
    }

    openPerClient.set(key, held + 1)
    openTotal += 1

    let released = false
    const release = (): void => {
      // `close` can be followed by `finish` on a short response, and a double release
      // would hand out a slot that was never taken — the shape of leak that lets the
      // ceiling drift upwards over an eight-hour run.
      if (released) return
      released = true

      openTotal -= 1
      const current = openPerClient.get(key) ?? 0
      // The entry is dropped rather than left at zero, so the map holds one key per
      // client currently connected and not one per client ever seen.
      if (current <= 1) openPerClient.delete(key)
      else openPerClient.set(key, current - 1)
    }

    res.on('close', release)
    next()
  }
}

// ------------------------------------------------------- upload concurrency --

/**
 * How long a `429 upload.busy` tells the client to wait (G3-06 / P4-10).
 *
 * Short on purpose, and nothing like the clip queue's `Retry-After`: a slot held by this
 * limiter is freed the moment one of the requests ahead of it finishes buffering, which
 * is seconds, not the queue's "about a minute". A longer value would have a guest's
 * client wait out time nobody needed.
 */
const UPLOAD_BUSY_RETRY_AFTER_SECONDS = 2

/**
 * How many upload requests — photos and clips together — may be buffering at once,
 * **process-wide** (G3-06 / P4-10).
 *
 * `MAX_UPLOAD_BYTES_PER_REQUEST` in `guestRoutes.ts` bounds what **one** request may
 * hold at 150 MB; nothing before this bounded how many of those could be in flight
 * together, and the product of the two is the real ceiling on heap a deployment's memory
 * limit has to cover. Four in flight at the default is 600 MB of buffers, which is a
 * number an operator can reason about; twelve — the rate limiter's own per-minute
 * allowance — would have been 1.8 GB.
 *
 * One bucket, shared by both upload routes, for the same reason `uploadLimiter` is one
 * bucket: a guest sending a photo and a clip is one guest, and two independent ceilings
 * would silently double the real one. Counted rather than rate-limited for the same
 * reason {@link streamConnectionLimiter} is — what this bounds is concurrent memory
 * held, not a count per minute — and a slot is released when the response closes,
 * whichever way the request ended: accepted, refused downstream, or failed.
 */
export const uploadConcurrencyLimiter = (max: number): RequestHandler => {
  let inFlight = 0

  return (_req, res, next) => {
    if (inFlight >= max) {
      res.setHeader('Retry-After', String(UPLOAD_BUSY_RETRY_AFTER_SECONDS))
      res.status(429).json(errorBody(DomainError.rateLimited('upload.busy')))
      return
    }

    inFlight += 1
    let released = false
    const release = (): void => {
      // `close` is the only event wired below, and today's Express/Node fires it once
      // per response — so this guard is not live against today's wiring. It is here for
      // the same reason `streamConnectionLimiter` carries it: a second call to
      // `release` (`close` firing again, or a future change that also wires `finish`)
      // must free the slot once, not twice, or the ceiling drifts upwards over a
      // long-running process and silently admits more than `max` at once. Proven
      // directly by the "never double-releases" test below, which emits `close` twice
      // on a fake response rather than relying on a real socket to do it.
      if (released) return
      released = true
      inFlight -= 1
    }

    res.on('close', release)
    next()
  }
}
