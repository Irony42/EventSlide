import type { NextFunction, Request, RequestHandler, Response } from 'express'

/**
 * Forwards a rejected promise to the error middleware.
 *
 * Express 4 does not await a handler, so an unhandled rejection inside a bare `async`
 * handler becomes a process-level `unhandledRejection` — which under Node's default
 * behaviour terminates the process. A single failed database read would take the wall
 * down mid-event.
 *
 * Every async route is wrapped in this. Writing `router.get('/x', async (req, res) =>
 * …)` directly is a review blocker.
 */
export const asyncHandler =
  (
    handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next)
  }
