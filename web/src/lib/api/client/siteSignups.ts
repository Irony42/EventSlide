import type { Transport } from '../../http'
import type {
  ProvisionedClientDto,
  SiteSignupApproveInput,
  SiteSignupPageDto,
  SiteSignupStatus,
} from '../dto'
import { encode } from './shared'

/**
 * The operator's signup requests (spec 31, §5), on a box with `SITE_ADMIN=on` and `SIGNUP` not
 * `off`. Every write is behind a fresh step-up, like the rest of `/api/site`.
 */
export const siteSignupsApi = (transport: Transport) => ({
  /** `limit` (the server caps it at 100) and `before`, the opaque `next` of the previous page. */
  siteSignups: (
    status: SiteSignupStatus,
    query: { readonly limit?: number; readonly before?: string } = {},
    signal?: AbortSignal,
  ): Promise<SiteSignupPageDto> =>
    transport.get(
      '/api/site/signups',
      { status, limit: query.limit, before: query.before },
      signal,
    ),

  /** Opens the client and sends the owner's invitation: answers like `POST /api/site/clients`. */
  siteApproveSignup: (
    id: string,
    input: SiteSignupApproveInput = {},
  ): Promise<ProvisionedClientDto> =>
    transport.post(`/api/site/signups/${encode(id)}/approve`, { ceilings: input.ceilings }),

  /** `notify`: whether the person is told, without a reason. */
  siteRefuseSignup: (id: string, notify: boolean): Promise<void> =>
    transport.post(`/api/site/signups/${encode(id)}/refuse`, { notify }),
})
