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
  siteSignups: (status: SiteSignupStatus, signal?: AbortSignal): Promise<SiteSignupPageDto> =>
    transport.get('/api/site/signups', { status }, signal),

  /** Opens the client and sends the owner's invitation: answers like `POST /api/site/clients`. */
  siteApproveSignup: (
    id: string,
    input: SiteSignupApproveInput = {},
  ): Promise<ProvisionedClientDto> =>
    transport.post(`/api/site/signups/${encode(id)}/approve`, input),

  /** `notify`: whether the person is told, without a reason. */
  siteRefuseSignup: (id: string, notify: boolean): Promise<void> =>
    transport.post(`/api/site/signups/${encode(id)}/refuse`, { notify }),
})
