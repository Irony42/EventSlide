import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'

/**
 * The page size every listing of the operator's namespace takes (`/api/site`, G2-14).
 *
 * Validated here and not trusted to the adapter, for the reason `listClients` gives: it is bound
 * into a `LIMIT`, and `SiteOverview` throws a `RangeError` for anything but a positive safe
 * integer because SQLite reads **everything** for `LIMIT -1`. A caller who could choose how much
 * of a table one request reads would be choosing it for the whole box, so the bound is one
 * number, here, for the four listings. The route's own schema is the first line (a `400` before
 * a use case is reached); this is the line that holds when something else calls them.
 */
export const DEFAULT_SITE_PAGE_SIZE = 50
export const MAX_SITE_PAGE_SIZE = 200

export const parseSitePageLimit = (limit: number | undefined): Result<number, DomainError> => {
  const chosen = limit ?? DEFAULT_SITE_PAGE_SIZE
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > MAX_SITE_PAGE_SIZE) {
    return err(DomainError.invalid('site.pageLimitInvalid', { max: MAX_SITE_PAGE_SIZE }))
  }
  return ok(chosen)
}
