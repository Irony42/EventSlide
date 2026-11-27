import { http, type Transport } from '../http'
import { accountApi } from './client/account'
import { galleryApi } from './client/gallery'
import { guestApi } from './client/guest'
import { hostApi } from './client/host'
import { guestInviteApi } from './client/invite'
import { signupApi } from './client/signup'
import { siteApi } from './client/site'
import { siteSignupsApi } from './client/siteSignups'

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
export type { GuestInviteInput } from './client/invite'
export type { SignupInput } from './client/signup'
export type { SiteProvisionInput, SiteInvitationInput, SiteResetInput } from './client/site'
export type {
  AlbumBookInput,
  AlbumBookPreviewInput,
  AnnouncementInput,
  AnnouncementPatchInput,
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
  ...siteSignupsApi(transport),
  ...hostApi(transport),
  ...galleryApi(transport),
  ...guestInviteApi(transport),
  ...signupApi(transport),
})

export type Api = ReturnType<typeof createApi>

export const api: Api = createApi(http)
