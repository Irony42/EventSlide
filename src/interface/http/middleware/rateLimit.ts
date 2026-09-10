import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit'
import type { Request } from 'express'
import { DomainError } from '../../../domain/shared/errors'
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
  limiter(
    perMinute,
    'rate.limited',
    (req) => `${clientKey(req)}:${req.params['eventSlug'] ?? 'none'}`,
  )

/** Reactions are cheap but tappable at speed; the domain budget is the finer control. */
export const reactionLimiter = (perMinute: number): RateLimitRequestHandler =>
  limiter(
    perMinute,
    'reaction.rateLimited',
    (req) => `${clientKey(req)}:${req.params['eventSlug'] ?? 'none'}`,
  )
