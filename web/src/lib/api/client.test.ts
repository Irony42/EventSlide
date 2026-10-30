import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, createApi, type Api } from './client'
import { ApiError, type Transport, type UploadProgress } from '../http'

/**
 * One test per endpoint would be thirty-four near-identical tests, so this pins the
 * contract once per shape instead: the verb and the path of every method, the response
 * coming back as the DTO, and a refusal arriving as an `ApiError`.
 *
 * The verb-and-path table is the direct guard against the defect that ran through the
 * whole of 1.0: the QR page emitted `?partyname=` while the upload page read `?party`,
 * so every guest uploaded to the default event and nobody noticed for a year. A path
 * nobody asserts is a path that can drift.
 */

type Verb = 'get' | 'post' | 'put' | 'patch' | 'del' | 'upload'

interface RecordedCall {
  readonly verb: Verb
  readonly path: string
  readonly body?: unknown
  readonly query?: Readonly<Record<string, string | number | undefined>>
  readonly form?: FormData
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: UploadProgress) => void
}

const calls: RecordedCall[] = []

/** What every method resolves to unless a test says otherwise. */
let reply: unknown = {}

/**
 * A recording `Transport`.
 *
 * Not a mock of a module: `createApi` takes the transport as a parameter precisely so
 * the seam is a constructor argument. `http.test.ts` covers the real one.
 */
const recorder: Transport = {
  get: async <T>(
    path: string,
    query?: Readonly<Record<string, string | number | undefined>>,
    signal?: AbortSignal,
  ): Promise<T> => {
    calls.push({ verb: 'get', path, ...(query ? { query } : {}), ...(signal ? { signal } : {}) })
    return reply as T
  },
  post: async <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    calls.push({ verb: 'post', path, body, ...(signal ? { signal } : {}) })
    return reply as T
  },
  put: async <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    calls.push({ verb: 'put', path, body, ...(signal ? { signal } : {}) })
    return reply as T
  },
  patch: async <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    calls.push({ verb: 'patch', path, body, ...(signal ? { signal } : {}) })
    return reply as T
  },
  del: async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    calls.push({ verb: 'del', path, ...(signal ? { signal } : {}) })
    return reply as T
  },
  upload: async <T>(
    path: string,
    form: FormData,
    handlers?: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal },
  ): Promise<T> => {
    calls.push({
      verb: 'upload',
      path,
      form,
      ...(handlers?.onProgress ? { onProgress: handlers.onProgress } : {}),
      ...(handlers?.signal ? { signal: handlers.signal } : {}),
    })
    return reply as T
  },
}

const refuses = (error: ApiError): Transport => ({
  get: () => Promise.reject(error),
  post: () => Promise.reject(error),
  put: () => Promise.reject(error),
  patch: () => Promise.reject(error),
  del: () => Promise.reject(error),
  upload: () => Promise.reject(error),
})

const only = (): RecordedCall => {
  const [call, ...rest] = calls
  if (call === undefined) throw new Error('the method reached no endpoint at all')
  if (rest.length > 0) throw new Error('one call was expected, several were made')
  return call
}

const subject = (): Api => createApi(recorder)

const SLUG = 'camille-et-sacha'
const PHOTO = 'photo-1'

beforeEach(() => {
  calls.length = 0
  reply = {}
})

// ===========================================================================

interface EndpointCase {
  readonly name: string
  readonly verb: Verb
  readonly path: string
  readonly invoke: (client: Api) => Promise<unknown>
}

/** Every path here is transcribed from docs/API.md, not from `client.ts`. */
/** A token-shaped value: 43 base64url characters, as the server mints them. */
const GALLERY_TOKEN = 'Q'.repeat(43)

/** Ids as the server mints them (`z.guid()`), for the operator's console. */
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACCOUNT = '11111111-1111-4111-8111-111111111111'

const ENDPOINTS: readonly EndpointCase[] = [
  // public
  {
    name: 'about',
    verb: 'get',
    path: '/api/about',
    invoke: (client) => client.about(),
  },
  {
    name: 'join',
    verb: 'post',
    path: '/api/join',
    invoke: (client) => client.join('H7K2QM', 'Léa'),
  },
  {
    name: 'wall',
    verb: 'get',
    path: `/api/events/${SLUG}/wall`,
    invoke: (client) => client.wall(SLUG),
  },

  // guest
  {
    name: 'uploadPhotos',
    verb: 'upload',
    path: `/api/events/${SLUG}/photos`,
    invoke: (client) => client.uploadPhotos(SLUG, { files: [] }),
  },
  {
    name: 'uploadClip',
    verb: 'upload',
    path: `/api/events/${SLUG}/clips`,
    invoke: (client) =>
      client.uploadClip(SLUG, { file: new File(['bytes'], 'danse.mp4', { type: 'video/mp4' }) }),
  },
  {
    name: 'clipJob',
    verb: 'get',
    path: `/api/events/${SLUG}/clips/job-1`,
    invoke: (client) => client.clipJob(SLUG, 'job-1'),
  },
  {
    name: 'myPhotos',
    verb: 'get',
    path: `/api/events/${SLUG}/photos/mine`,
    invoke: (client) => client.myPhotos(SLUG),
  },
  {
    name: 'privacyNotice',
    verb: 'get',
    path: `/api/events/${SLUG}/privacy-notice`,
    invoke: (client) => client.privacyNotice(SLUG),
  },
  {
    name: 'acknowledgePrivacyNotice',
    verb: 'post',
    path: `/api/events/${SLUG}/privacy-notice/acknowledgement`,
    invoke: (client) => client.acknowledgePrivacyNotice(SLUG, 'r1'),
  },
  {
    name: 'deleteMyPhoto',
    verb: 'del',
    path: `/api/events/${SLUG}/photos/${PHOTO}`,
    invoke: (client) => client.deleteMyPhoto(SLUG, PHOTO),
  },
  {
    name: 'eraseMyContribution',
    verb: 'del',
    path: `/api/events/${SLUG}/guests/me`,
    invoke: (client) => client.eraseMyContribution(SLUG),
  },
  {
    name: 'react',
    verb: 'post',
    path: `/api/events/${SLUG}/photos/${PHOTO}/reactions`,
    invoke: (client) => client.react(SLUG, PHOTO, 'love'),
  },
  {
    name: 'withdrawReaction',
    verb: 'del',
    path: `/api/events/${SLUG}/photos/${PHOTO}/reactions/love`,
    invoke: (client) => client.withdrawReaction(SLUG, PHOTO, 'love'),
  },
  {
    name: 'reactions',
    verb: 'get',
    path: `/api/events/${SLUG}/photos/${PHOTO}/reactions`,
    invoke: (client) => client.reactions(SLUG, PHOTO),
  },

  // auth
  {
    name: 'login',
    verb: 'post',
    path: '/api/auth/login',
    invoke: (client) => client.login('camille@example.com', 'un-mot-de-passe'),
  },
  { name: 'logout', verb: 'post', path: '/api/auth/logout', invoke: (client) => client.logout() },
  { name: 'session', verb: 'get', path: '/api/auth/me', invoke: (client) => client.session() },
  {
    name: 'changePassword',
    verb: 'post',
    path: '/api/auth/password',
    invoke: (client) => client.changePassword('ancien', 'nouveau'),
  },
  {
    name: 'deleteOwnAccount',
    verb: 'post',
    path: '/api/auth/account/delete',
    invoke: (client) => client.deleteOwnAccount('un-mot-de-passe'),
  },
  {
    name: 'loginSecondFactor',
    verb: 'post',
    path: '/api/auth/login/2fa',
    invoke: (client) => client.loginSecondFactor({ code: '123456' }),
  },
  {
    name: 'enrollSecondFactor',
    verb: 'post',
    path: '/api/auth/2fa/enroll',
    invoke: (client) => client.enrollSecondFactor('un-mot-de-passe'),
  },
  {
    name: 'confirmSecondFactor',
    verb: 'post',
    path: '/api/auth/2fa/confirm',
    invoke: (client) => client.confirmSecondFactor('123456'),
  },
  {
    name: 'stepUp',
    verb: 'post',
    path: '/api/auth/step-up',
    invoke: (client) => client.stepUp('un-mot-de-passe', { code: '123456' }),
  },
  {
    name: 'regenerateRecoveryCodes',
    verb: 'post',
    path: '/api/auth/2fa/recovery-codes',
    invoke: (client) => client.regenerateRecoveryCodes(),
  },
  {
    name: 'disableSecondFactor',
    verb: 'post',
    path: '/api/auth/2fa/disable',
    invoke: (client) => client.disableSecondFactor(),
  },

  // events
  { name: 'listEvents', verb: 'get', path: '/api/events', invoke: (client) => client.listEvents() },
  {
    name: 'createEvent',
    verb: 'post',
    path: '/api/events',
    invoke: (client) => client.createEvent({ name: 'Camille & Sacha' }),
  },
  {
    name: 'getEvent',
    verb: 'get',
    path: `/api/events/${SLUG}`,
    invoke: (client) => client.getEvent(SLUG),
  },
  {
    name: 'updateSettings',
    verb: 'patch',
    path: `/api/events/${SLUG}/settings`,
    invoke: (client) => client.updateSettings(SLUG, { allowCaptions: false }),
  },
  {
    name: 'putVenuePhoto',
    verb: 'put',
    path: `/api/events/${SLUG}/venue-photo`,
    invoke: (client) => client.putVenuePhoto(SLUG, new File(['x'], 'lieu.jpg')),
  },
  {
    name: 'removeVenuePhoto',
    verb: 'del',
    path: `/api/events/${SLUG}/venue-photo`,
    invoke: (client) => client.removeVenuePhoto(SLUG),
  },
  {
    name: 'setEventStatus',
    verb: 'post',
    path: `/api/events/${SLUG}/status`,
    invoke: (client) => client.setEventStatus(SLUG, 'live'),
  },
  {
    name: 'setSchedule',
    verb: 'patch',
    path: `/api/events/${SLUG}/schedule`,
    invoke: (client) =>
      client.setSchedule(SLUG, {
        scheduledOpenAt: '2026-06-20T16:00:00.000Z',
        scheduledCloseAt: null,
      }),
  },
  {
    name: 'rotateJoinCode',
    verb: 'post',
    path: `/api/events/${SLUG}/join-code`,
    invoke: (client) => client.rotateJoinCode(SLUG),
  },
  {
    name: 'purgeEvent',
    verb: 'del',
    path: `/api/events/${SLUG}`,
    invoke: (client) => client.purgeEvent(SLUG),
  },

  // moderation
  {
    name: 'moderationQueue',
    verb: 'get',
    path: `/api/events/${SLUG}/moderation`,
    invoke: (client) => client.moderationQueue(SLUG),
  },
  {
    name: 'moderate',
    verb: 'patch',
    path: `/api/events/${SLUG}/photos/${PHOTO}/status`,
    invoke: (client) => client.moderate(SLUG, PHOTO, 'publish'),
  },
  {
    name: 'moderateBulk',
    verb: 'post',
    path: `/api/events/${SLUG}/moderation/bulk`,
    invoke: (client) => client.moderateBulk(SLUG, [PHOTO], 'reject'),
  },
  {
    name: 'topPhotos',
    verb: 'get',
    path: `/api/events/${SLUG}/top-photos`,
    invoke: (client) => client.topPhotos(SLUG),
  },

  // guests
  {
    name: 'listGuests',
    verb: 'get',
    path: `/api/events/${SLUG}/guests`,
    invoke: (client) => client.listGuests(SLUG),
  },
  {
    name: 'revokeGuest',
    verb: 'post',
    path: `/api/events/${SLUG}/guests/guest-1/revoke`,
    invoke: (client) => client.revokeGuest(SLUG, 'guest-1'),
  },

  // account tokens: the reset and "sign out everywhere" (G2-08), the invitation (G2-09)
  {
    name: 'requestPasswordReset',
    verb: 'post',
    path: '/api/auth/password-reset/request',
    invoke: (client) => client.requestPasswordReset('camille@example.com', 'fr'),
  },
  {
    name: 'confirmPasswordReset',
    verb: 'post',
    path: '/api/auth/password-reset/confirm',
    invoke: (client) => client.confirmPasswordReset(GALLERY_TOKEN, 'une-phrase-de-passe-longue'),
  },
  {
    name: 'revokeOtherSessions',
    verb: 'post',
    path: '/api/auth/sessions/revoke-others',
    invoke: (client) => client.revokeOtherSessions(),
  },
  {
    name: 'invitation',
    verb: 'get',
    path: `/api/invitations/${GALLERY_TOKEN}`,
    invoke: (client) => client.invitation(GALLERY_TOKEN),
  },
  {
    name: 'acceptInvitation',
    verb: 'post',
    path: `/api/invitations/${GALLERY_TOKEN}/accept`,
    invoke: (client) => client.acceptInvitation(GALLERY_TOKEN, { kind: 'signedInAccount' }),
  },

  // moderators
  {
    name: 'myLimits',
    verb: 'get',
    path: '/api/me/limits',
    invoke: (client) => client.myLimits(),
  },
  {
    name: 'clientAudit',
    verb: 'get',
    path: '/api/client/audit',
    invoke: (client) => client.clientAudit({ clientId: 'client-1', before: 7, limit: 20 }),
  },
  {
    name: 'pendingInvitations',
    verb: 'get',
    path: '/api/client/invitations',
    invoke: (client) => client.pendingInvitations('client-1'),
  },
  {
    name: 'approveInvitation',
    verb: 'post',
    path: '/api/client/invitations/inv-1/approve',
    invoke: (client) => client.approveInvitation('inv-1'),
  },
  {
    name: 'listModerators',
    verb: 'get',
    path: `/api/events/${SLUG}/moderators`,
    invoke: (client) => client.listModerators(SLUG),
  },
  {
    name: 'inviteModerator',
    verb: 'post',
    path: `/api/events/${SLUG}/moderators`,
    invoke: (client) =>
      client.inviteModerator(SLUG, { email: 'moderateur@example.com', locale: 'fr' }),
  },
  {
    name: 'revokeModerator',
    verb: 'del',
    path: `/api/events/${SLUG}/moderators/user-2`,
    invoke: (client) => client.revokeModerator(SLUG, 'user-2'),
  },
  {
    name: 'myMissions',
    verb: 'get',
    path: `/api/events/${SLUG}/missions/mine`,
    invoke: (client) => client.myMissions(SLUG),
  },
  {
    name: 'listMissions',
    verb: 'get',
    path: `/api/events/${SLUG}/missions`,
    invoke: (client) => client.listMissions(SLUG),
  },
  {
    name: 'createMission',
    verb: 'post',
    path: `/api/events/${SLUG}/missions`,
    invoke: (client) => client.createMission(SLUG, { prompt: 'un selfie', scope: 'guest' }),
  },
  {
    name: 'updateMission',
    verb: 'patch',
    path: `/api/events/${SLUG}/missions/mission-1`,
    invoke: (client) =>
      client.updateMission(SLUG, 'mission-1', { prompt: 'un selfie', scope: 'event' }),
  },
  {
    name: 'deleteMission',
    verb: 'del',
    path: `/api/events/${SLUG}/missions/mission-1`,
    invoke: (client) => client.deleteMission(SLUG, 'mission-1'),
  },
  {
    name: 'shareLink',
    verb: 'get',
    path: `/api/events/${SLUG}/share-link`,
    invoke: (client) => client.shareLink(SLUG),
  },
  {
    name: 'createShareLink',
    verb: 'post',
    path: `/api/events/${SLUG}/share-link`,
    invoke: (client) => client.createShareLink(SLUG, { expiresInDays: 30 }),
  },
  {
    name: 'revokeShareLink',
    verb: 'del',
    path: `/api/events/${SLUG}/share-link`,
    invoke: (client) => client.revokeShareLink(SLUG),
  },
  {
    name: 'gallery',
    verb: 'get',
    path: `/api/gallery/${GALLERY_TOKEN}`,
    invoke: (client) => client.gallery(GALLERY_TOKEN),
  },
  {
    name: 'unlockGallery',
    verb: 'post',
    path: `/api/gallery/${GALLERY_TOKEN}/unlock`,
    invoke: (client) => client.unlockGallery(GALLERY_TOKEN, 'une phrase de passe'),
  },
  {
    name: 'galleryPhotos',
    verb: 'get',
    path: `/api/gallery/${GALLERY_TOKEN}/photos`,
    invoke: (client) => client.galleryPhotos(GALLERY_TOKEN, null),
  },
  {
    name: 'siteClients',
    verb: 'get',
    path: '/api/site/clients',
    invoke: (client) => client.siteClients(),
  },
  {
    name: 'siteClientEvents',
    verb: 'get',
    path: `/api/site/clients/${CLIENT}/events`,
    invoke: (client) => client.siteClientEvents(CLIENT),
  },
  {
    name: 'siteAccounts',
    verb: 'get',
    path: '/api/site/accounts',
    invoke: (client) => client.siteAccounts(),
  },
  {
    name: 'siteAudit',
    verb: 'get',
    path: '/api/site/audit',
    invoke: (client) => client.siteAudit(),
  },
  {
    name: 'siteLookupEvents',
    verb: 'get',
    path: '/api/site/events/lookup',
    invoke: (client) => client.siteLookupEvents('mariage-de-camille'),
  },
  {
    name: 'siteEventState',
    verb: 'get',
    path: `/api/site/events/${CLIENT}`,
    invoke: (client) => client.siteEventState(CLIENT),
  },
  {
    name: 'sitePhotoState',
    verb: 'get',
    path: `/api/site/photos/${CLIENT}`,
    invoke: (client) => client.sitePhotoState(CLIENT),
  },
  ...(
    [
      ['siteTakeDownPhoto', 'photos', 'take-down'],
      ['siteRestorePhoto', 'photos', 'restore'],
      ['siteTakeDownEvent', 'events', 'take-down'],
      ['siteRestoreEvent', 'events', 'restore'],
      ['siteHoldEventPurge', 'events', 'purge-hold'],
      ['siteReleaseEventPurge', 'events', 'purge-release'],
    ] as const
  ).map(([name, noun, verb]): EndpointCase => ({
    name,
    verb: 'post',
    path: `/api/site/${noun}/${CLIENT}/${verb}`,
    invoke: (client) => client[name](CLIENT, 'Signalement reçu'),
  })),
  {
    name: 'siteClientDefaults',
    verb: 'get',
    path: '/api/site/client-defaults',
    invoke: (client) => client.siteClientDefaults(),
  },
  {
    name: 'siteProvisionClient',
    verb: 'post',
    path: '/api/site/clients',
    invoke: (client) =>
      client.siteProvisionClient({
        clientName: 'Atelier Alpha',
        ownerEmail: 'camille@example.com',
        locale: 'fr',
      }),
  },
  {
    name: 'siteRenameClient',
    verb: 'patch',
    path: `/api/site/clients/${CLIENT}`,
    invoke: (client) => client.siteRenameClient(CLIENT, 'Atelier Beta'),
  },
  {
    name: 'siteSetCeilings',
    verb: 'put',
    path: `/api/site/clients/${CLIENT}/ceilings`,
    invoke: (client) => client.siteSetCeilings(CLIENT, { maxEvents: 3 }, 'Forfait mis à jour'),
  },
  {
    name: 'siteSuspendClient',
    verb: 'post',
    path: `/api/site/clients/${CLIENT}/suspend`,
    invoke: (client) => client.siteSuspendClient(CLIENT),
  },
  {
    name: 'siteResumeClient',
    verb: 'post',
    path: `/api/site/clients/${CLIENT}/resume`,
    invoke: (client) => client.siteResumeClient(CLIENT),
  },
  {
    name: 'siteInviteToClient',
    verb: 'post',
    path: `/api/site/clients/${CLIENT}/invitations`,
    invoke: (client) =>
      client.siteInviteToClient(CLIENT, {
        email: 'sacha@example.com',
        role: 'member',
        locale: 'fr',
      }),
  },
  {
    name: 'siteOffboardClient',
    verb: 'post',
    path: `/api/site/clients/${CLIENT}/offboard`,
    invoke: (client) => client.siteOffboardClient(CLIENT, 30),
  },
  {
    name: 'siteDisableAccount',
    verb: 'post',
    path: `/api/site/accounts/${ACCOUNT}/disable`,
    invoke: (client) => client.siteDisableAccount(ACCOUNT),
  },
  {
    name: 'siteEnableAccount',
    verb: 'post',
    path: `/api/site/accounts/${ACCOUNT}/enable`,
    invoke: (client) => client.siteEnableAccount(ACCOUNT),
  },
  {
    name: 'siteDeleteAccount',
    verb: 'del',
    path: `/api/site/accounts/${ACCOUNT}`,
    invoke: (client) => client.siteDeleteAccount(ACCOUNT),
  },
  {
    name: 'siteResetPassword',
    verb: 'post',
    path: `/api/site/accounts/${ACCOUNT}/password-reset`,
    invoke: (client) => client.siteResetPassword(ACCOUNT, { locale: 'fr' }),
  },
]

describe('every endpoint addresses the documented method and path', () => {
  it.each(ENDPOINTS)('$name → $verb $path', async ({ verb, path, invoke }) => {
    await invoke(subject())

    expect(only()).toMatchObject({ verb, path })
  })

  it('covers every method the client exposes', () => {
    // A method added without a row here would ship unpinned, which is how the 1.0 QR
    // parameter drifted in the first place.
    const named = new Set(ENDPOINTS.map((endpoint) => endpoint.name))
    const missing = Object.entries(subject())
      .filter(([name, value]) => typeof value === 'function' && !named.has(name))
      .map(([name]) => name)
      .sort()

    // The link builders return a string rather than making a request, so they are
    // pinned in their own block below instead.
    expect(missing).toEqual(['albumUrl', 'moderationStreamUrl', 'streamUrl'])
  })
})

describe('event scoping', () => {
  it('escapes a slug that contains a path separator', async () => {
    await subject().wall('gala/autre')

    expect(only().path).toBe('/api/events/gala%2Fautre/wall')
  })

  it('escapes a photo id that contains a path separator', async () => {
    await subject().moderate('gala', '../p1', 'publish')

    expect(only().path).toBe('/api/events/gala/photos/..%2Fp1/status')
  })
})

describe('what comes back', () => {
  it('returns the server’s DTO to the caller unchanged', async () => {
    reply = { id: 'event-1', slug: SLUG, name: 'Camille & Sacha' }

    await expect(subject().getEvent(SLUG)).resolves.toEqual(reply)
  })

  it('propagates a refusal as the ApiError the transport raised', async () => {
    // The console branches on `code` and `isClientFault`. A client that wrapped or
    // swallowed the error would leave it with nothing to branch on.
    const refusal = new ApiError(409, 'photo.illegalTransition')

    const failure = await createApi(refuses(refusal))
      .moderate(SLUG, PHOTO, 'publish')
      .catch((cause: unknown) => cause)

    expect(failure).toBe(refusal)
  })
})

describe('the shared gallery’s requests', () => {
  it('posts the gallery password in a body, never in the address', async () => {
    await subject().unlockGallery(GALLERY_TOKEN, 'une phrase de passe')

    expect(only().path).not.toContain('phrase')
    expect(only().body).toEqual({ password: 'une phrase de passe' })
  })

  it('sends only the choices the host made for a new link', async () => {
    await subject().createShareLink(SLUG, { expiresInDays: 7, password: '' })

    // An empty password field is "no password", not a 400 for a string too short.
    expect(only().body).toEqual({ expiresInDays: 7 })
  })

  it('sends a password the host did type', async () => {
    await subject().createShareLink(SLUG, { password: 'une phrase de passe' })

    expect(only().body).toEqual({ password: 'une phrase de passe' })
  })

  it('asks for the next page with the cursor the server sealed, and the first without one', async () => {
    await subject().galleryPhotos(GALLERY_TOKEN, 'scellé.1')
    await subject().galleryPhotos(GALLERY_TOKEN, null)

    expect(calls.map((call) => call.query)).toEqual([{ cursor: 'scellé.1' }, undefined])
  })
})

describe('request bodies', () => {
  it('sends the join code and the chosen display name', async () => {
    await subject().join('H7K2QM', 'Léa')

    expect(only().body).toEqual({ joinCode: 'H7K2QM', displayName: 'Léa' })
  })

  it('sends a null display name for a guest who stays anonymous', async () => {
    // Omitting the field would make "anonymous" indistinguishable from "not asked",
    // and the server's schema treats the two differently.
    await subject().join('H7K2QM', null)

    expect(only().body).toEqual({ joinCode: 'H7K2QM', displayName: null })
  })

  it('sends the decision the moderator pressed', async () => {
    await subject().moderate(SLUG, PHOTO, 'hide')

    expect(only().body).toEqual({ decision: 'hide' })
  })

  it('sends the whole selection in one bulk decision', async () => {
    await subject().moderateBulk(SLUG, ['photo-1', 'photo-2'], 'publish')

    expect(only().body).toEqual({ photoIds: ['photo-1', 'photo-2'], decision: 'publish' })
  })

  it('sends only the settings the host changed', async () => {
    // A partial PATCH: sending the untouched fields back would overwrite a change made
    // from another device in the meantime.
    await subject().updateSettings(SLUG, { moderation: 'auto' })

    expect(only().body).toEqual({ moderation: 'auto' })
  })

  it('sends the venue photograph as one multipart part named photo', async () => {
    const file = new File(['bytes'], 'lieu.jpg', { type: 'image/jpeg' })

    await subject().putVenuePhoto(SLUG, file)

    const body = only().body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('photo')).toBe(file)
    expect([...(body as FormData).keys()]).toEqual(['photo'])
  })

  it('sends the address and the page language with an invitation, and no password', async () => {
    // The body that shipped in 2.x carried a temporary password, and `moderatorInvitationBody`
    // is `.strict()`: since 3.0 it refuses one. The invitation is a link the invitee accepts,
    // and the form sends an address and the language of the page, nothing else.
    await subject().inviteModerator(SLUG, { email: 'sacha@example.com', locale: 'en' })

    expect(only().body).toEqual({ email: 'sacha@example.com', locale: 'en' })
  })
})

describe('the account-token requests', () => {
  it('sends the address and the language of the page with a reset request', async () => {
    // The language is the one the mail is written in; the server's body is `.strict()`.
    await subject().requestPasswordReset('camille@example.com', 'de')

    expect(only().body).toEqual({ email: 'camille@example.com', locale: 'de' })
  })

  it('sends the token in the body of a reset, never in a URL the client builds', async () => {
    await subject().confirmPasswordReset(GALLERY_TOKEN, 'une-phrase-de-passe-longue')

    expect(only()).toMatchObject({
      path: '/api/auth/password-reset/confirm',
      body: { token: GALLERY_TOKEN, password: 'une-phrase-de-passe-longue' },
    })
  })

  it('sends a name and a password to create an account, and nothing that names one', async () => {
    // `acceptInvitationBody` is `.strict()`: no field can name the account an acceptance
    // attaches, so the client has no way to send one.
    await subject().acceptInvitation(GALLERY_TOKEN, {
      kind: 'newAccount',
      displayName: 'Camille',
      password: 'une-phrase-de-passe-longue',
    })

    expect(only().body).toEqual({ displayName: 'Camille', password: 'une-phrase-de-passe-longue' })
  })

  it('sends an empty body for the account that is already signed in', async () => {
    await subject().acceptInvitation(GALLERY_TOKEN, { kind: 'signedInAccount' })

    expect(only().body).toEqual({})
  })

  it('carries the tick of the terms of use when the page has one to send, for either form (G2-20)', async () => {
    await subject().acceptInvitation(GALLERY_TOKEN, {
      kind: 'newAccount',
      displayName: 'Camille',
      password: 'une-phrase-de-passe-longue',
      acceptTerms: true,
    })
    expect(only().body).toEqual({
      displayName: 'Camille',
      password: 'une-phrase-de-passe-longue',
      acceptTerms: true,
    })
  })

  it('carries the tick alone for the account that is already signed in (G2-20)', async () => {
    await subject().acceptInvitation(GALLERY_TOKEN, { kind: 'signedInAccount', acceptTerms: true })

    expect(only().body).toEqual({ acceptTerms: true })
  })

  it('escapes a token before it becomes a path segment', async () => {
    // The token comes out of the address bar, which is whatever somebody typed.
    await subject().invitation('a/b?c')

    expect(only().path).toBe('/api/invitations/a%2Fb%3Fc')
  })
})

describe('the operator’s console requests', () => {
  it('sends the reason with the ceilings, in one body, as a PUT', async () => {
    await subject().siteSetCeilings(
      CLIENT,
      { maxEvents: 3, maxTotalBytes: null },
      'Forfait mis à jour',
    )

    expect(only()).toMatchObject({
      verb: 'put',
      body: { ceilings: { maxEvents: 3, maxTotalBytes: null }, reason: 'Forfait mis à jour' },
    })
  })

  it('keeps an explicit null in a ceilings patch, because null is how a ceiling is removed', async () => {
    await subject().siteSetCeilings(CLIENT, { maxRetentionDays: null }, 'Plus de limite')

    expect(JSON.stringify(only().body)).toContain('"maxRetentionDays":null')
  })

  it('sends the owner’s language with the invitation, which is the language it is mailed in', async () => {
    await subject().siteProvisionClient({
      clientName: 'Atelier Alpha',
      ownerEmail: 'camille@example.com',
      locale: 'de',
      ceilings: { maxEvents: 1 },
    })

    expect(only().body).toEqual({
      clientName: 'Atelier Alpha',
      ownerEmail: 'camille@example.com',
      locale: 'de',
      ceilings: { maxEvents: 1 },
    })
  })

  it('sends the window of an offboarding as whole days in one key, and nothing else', async () => {
    await subject().siteOffboardClient(CLIENT, 30)

    expect(only().body).toEqual({ graceDays: 30 })
  })

  it('deletes an account by its id alone, with no body', async () => {
    await subject().siteDeleteAccount(ACCOUNT)

    expect(only()).toMatchObject({ verb: 'del', path: `/api/site/accounts/${ACCOUNT}` })
  })

  it('names the client in the path and nothing else for a suspension, which has no body', async () => {
    await subject().siteSuspendClient(CLIENT)

    expect(only().body).toBeUndefined()
  })

  it('asks for the audit older than a line, for one client, in one page size', async () => {
    await subject().siteAudit({ clientId: CLIENT, before: 17, limit: 50 })

    expect(only().query).toEqual({ clientId: CLIENT, before: 17, limit: 50 })
  })

  it('sends the reason of a takedown, and nothing else, as the body', async () => {
    await subject().siteTakeDownEvent(CLIENT, 'Signalement reçu')

    expect(only().body).toEqual({ reason: 'Signalement reçu' })
  })

  it('sends the lookup as one query parameter, which is what the operator typed', async () => {
    await subject().siteLookupEvents('mariage de camille')

    expect(only().query).toEqual({ q: 'mariage de camille' })
  })

  it('escapes an id before it becomes a path segment', async () => {
    await subject().siteSuspendClient('a/b')

    expect(only().path).toBe('/api/site/clients/a%2Fb/suspend')
  })
})

describe('the moderation queue query', () => {
  it('asks for nothing but the endpoint when no filter is set', async () => {
    await subject().moderationQueue(SLUG)

    expect(only().query).toEqual({})
  })

  it('carries the filter and the page size when they are set', async () => {
    await subject().moderationQueue(SLUG, { status: 'pending', limit: 50 })

    expect(only().query).toEqual({ status: 'pending', limit: 50 })
  })

  it('omits a page size of zero rather than asking for an empty page', async () => {
    await subject().moderationQueue(SLUG, { limit: 0 })

    expect(only().query).toEqual({})
  })

  it('passes the caller’s cancellation through on a read', async () => {
    // Every admin loader aborts on unmount. A signal dropped here leaves a fetch
    // running against a screen that is gone.
    const controller = new AbortController()

    await subject().moderationQueue(SLUG, {}, controller.signal)

    expect(only().signal).toBe(controller.signal)
  })
})

describe('the multipart upload', () => {
  const aFile = (name: string): File => new File(['bytes'], name, { type: 'image/jpeg' })

  it('sends every chosen file under the photos field', async () => {
    await subject().uploadPhotos(SLUG, { files: [aFile('un.jpg'), aFile('deux.jpg')] })

    const names = only()
      .form?.getAll('photos')
      .map((part) => (part instanceof File ? part.name : ''))
    expect(names).toEqual(['un.jpg', 'deux.jpg'])
  })

  it('sends the caption the guest wrote', async () => {
    await subject().uploadPhotos(SLUG, { files: [aFile('un.jpg')], caption: 'Les confettis' })

    expect(only().form?.get('caption')).toBe('Les confettis')
  })

  it.each([
    ['an untouched field', ''],
    ['a field the guest cleared', null],
  ])('omits the caption for %s, rather than failing validation', async (_case, caption) => {
    // The server distinguishes "no caption" from an invalid one, so an empty string
    // would turn a guest who never opened the field into a 400.
    await subject().uploadPhotos(SLUG, { files: [aFile('un.jpg')], caption })

    expect(only().form?.has('caption')).toBe(false)
  })

  it('forwards the progress handler, so the guest sees the bytes move', async () => {
    const seen: number[] = []

    await subject().uploadPhotos(SLUG, {
      files: [aFile('un.jpg')],
      onProgress: (progress) => seen.push(progress.percent),
    })
    only().onProgress?.({ loaded: 1, total: 4, percent: 25 })

    expect(seen).toEqual([25])
  })

  it('forwards the cancellation signal, so a removed row stops uploading', async () => {
    const controller = new AbortController()

    await subject().uploadPhotos(SLUG, { files: [aFile('un.jpg')], signal: controller.signal })

    expect(only().signal).toBe(controller.signal)
  })
})

describe('the clip upload', () => {
  const aClip = (name: string): File => new File(['bytes'], name, { type: 'video/mp4' })

  it('sends the recording under the clip field, which is the only one multer accepts', async () => {
    // `photos` here is `LIMIT_UNEXPECTED_FILE` before a line of our code runs, and the
    // guest would see a generic failure after pushing eighty megabytes.
    await subject().uploadClip(SLUG, { file: aClip('premiere-danse.mp4') })

    const part = only().form?.get('clip')
    expect(part instanceof File ? part.name : null).toBe('premiere-danse.mp4')
    expect(only().form?.has('photos')).toBe(false)
  })

  it('sends the caption the guest wrote', async () => {
    await subject().uploadClip(SLUG, { file: aClip('un.mp4'), caption: 'La première danse' })

    expect(only().form?.get('caption')).toBe('La première danse')
  })

  it.each([
    ['an untouched field', ''],
    ['a field the guest cleared', null],
  ])('omits the caption for %s, rather than failing validation', async (_case, caption) => {
    await subject().uploadClip(SLUG, { file: aClip('un.mp4'), caption })

    expect(only().form?.has('caption')).toBe(false)
  })

  it('forwards the progress handler, because a clip is a minute of venue Wi-Fi', async () => {
    const seen: number[] = []

    await subject().uploadClip(SLUG, {
      file: aClip('un.mp4'),
      onProgress: (progress) => seen.push(progress.percent),
    })
    only().onProgress?.({ loaded: 1, total: 4, percent: 25 })

    expect(seen).toEqual([25])
  })

  it('forwards the cancellation signal', async () => {
    const controller = new AbortController()

    await subject().uploadClip(SLUG, { file: aClip('un.mp4'), signal: controller.signal })

    expect(only().signal).toBe(controller.signal)
  })

  it('encodes a job id into the path rather than into the query', async () => {
    await subject().clipJob(SLUG, 'a/b')

    expect(only().path).toBe(`/api/events/${SLUG}/clips/a%2Fb`)
  })
})

describe('links the app builds rather than requests', () => {
  it('points the album download at the documented ZIP endpoint', () => {
    expect(subject().albumUrl(SLUG)).toBe(`/api/events/${SLUG}/album.zip`)
  })

  it('points the stream at the documented SSE endpoint', () => {
    // `useEventStream` hands this straight to `EventSource`; a wrong path shows as a
    // wall that never updates rather than as an error anybody sees.
    expect(subject().streamUrl(SLUG)).toBe(`/api/events/${SLUG}/stream`)
  })

  it('points the console at the authorised channel, not at the public one', () => {
    // The console used to open `streamUrl`. Nothing looked broken — the frames are
    // identical — so the only thing that can keep these apart is an assertion that they
    // are different addresses.
    expect(subject().moderationStreamUrl(SLUG)).toBe(`/api/events/${SLUG}/moderation/stream`)
    expect(subject().moderationStreamUrl(SLUG)).not.toBe(subject().streamUrl(SLUG))
  })

  it.each(['albumUrl', 'streamUrl', 'moderationStreamUrl'] as const)(
    'escapes a slug in %s too',
    (method) => {
      expect(subject()[method]('gala/autre')).toContain('gala%2Fautre')
    },
  )
})

describe('the session answer', () => {
  it('is typed with the operator verdict that GET /api/auth/me sends', async () => {
    reply = {
      authenticated: true,
      user: {
        userId: 'user-1',
        email: 'ops@example.test',
        displayName: null,
        mustChangePassword: false,
        canOperateSite: true,
      },
    }

    const session = await createApi(recorder).session()

    // The assignment compiles only while the web type carries the field the server sends:
    // nothing reads it yet, so without this the type could lose it and no build would say so
    // until the account menu is written. `dtoContract.test.ts` holds the two declarations
    // of the user to each other; this holds the one `session()` answers with to the user.
    const canOperate: boolean | undefined = session.authenticated
      ? session.user.canOperateSite
      : undefined
    expect(canOperate).toBe(true)
  })
})

describe('the instance the app uses', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is wired to the real transport, not to a double left behind', async () => {
    // The app imports `api`, never `createApi`. Comparing its shape to a client built
    // over the recorder would prove only that one factory returns one shape; what has
    // to hold is that a call on `api` reaches the network.
    const urls: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(url)
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    await api.session()

    expect(urls).toEqual(['/api/auth/me'])
  })
})
