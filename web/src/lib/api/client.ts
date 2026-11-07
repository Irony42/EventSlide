import { http, type Transport } from '../http'
import { accountApi } from './client/account'
import { galleryApi } from './client/gallery'
import { guestApi } from './client/guest'
import { hostApi } from './client/host'
import { siteApi } from './client/site'

/**
 * One typed function per endpoint in docs/API.md.
 *
 * Built over an injectable `Transport` so a component test can pass a fake and never
 * touch `fetch`. `api` is the real instance the app uses; `createApi(fake)` is what
 * tests use.
 *
 * The endpoints live in `./client/`, one file per audience (guest, account, site, host,
 * gallery), and this barrel composes them so `Api` stays one type and every import of
 * `lib/api/client` keeps working. The request shapes are re-exported from here too.
 */
export type { UploadInput, ClipUploadInput } from './client/guest'
export type { InvitationAcceptance } from './client/account'
export type { SiteProvisionInput, SiteInvitationInput, SiteResetInput } from './client/site'
export type {
  AlbumBookInput,
  ChallengeInput,
  CreateEventInput,
  EventScheduleInput,
  EventSettingsPatch,
  MissionInput,
  ModeratorInvitationInput,
  ShareLinkInput,
} from './client/host'

export const createApi = (transport: Transport) => ({
  ...guestApi(transport),
  ...accountApi(transport),
  ...siteApi(transport),
  ...hostApi(transport),
  ...galleryApi(transport),
})

export type Api = ReturnType<typeof createApi>

export const api: Api = createApi(http)
