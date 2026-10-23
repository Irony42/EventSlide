import type { NextFunction, Request, RequestHandler, Response } from 'express'

/**
 * Forwards a rejected promise to the error middleware.
 *
 * Express 4 does not await a handler, so an unhandled rejection inside a bare `async`
 * handler became a process-level `unhandledRejection` — which under Node's default
 * behaviour terminates the process. A single failed database read would take the wall
 * down mid-event. Express 5 forwards a rejected promise to `next(err)` itself, so that
 * outage is closed twice now; `errorHandler.test.ts` pins the framework's half.
 *
 * Every async route is still wrapped in this. Writing `router.get('/x', async (req, res) =>
 * …)` directly is a review blocker: the wrapper says which handlers are async at a glance,
 * and removing it from sixty routes is a refactor of its own, not part of an upgrade.
 */
export const asyncHandler =
  (
    handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next)
  }
