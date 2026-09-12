import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit'
import type { Request, RequestHandler } from 'express'
import { DomainError } from '../../../domain/shared/errors'
import { Slug } from '../../../domain/shared/slug'
import { errorBody } from '../presenters/send'

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
const clientKey = (req: Request): string => ipKeyGenerator(req.ip ?? 'unknown')

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
 * Both bounds are constants rather than configuration because `HttpConfig` carries
 * nothing that means "connections", and deriving a concurrency ceiling from a
 * requests-per-minute figure would be numerology wearing a config key's clothes. They
 * are parameters so a test can reach them in two connections instead of five hundred.
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
