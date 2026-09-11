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

type Verb = 'get' | 'post' | 'patch' | 'del' | 'upload'

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
const ENDPOINTS: readonly EndpointCase[] = [
  // public
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
    name: 'myPhotos',
    verb: 'get',
    path: `/api/events/${SLUG}/photos/mine`,
    invoke: (client) => client.myPhotos(SLUG),
  },
  {
    name: 'deleteMyPhoto',
    verb: 'del',
    path: `/api/events/${SLUG}/photos/${PHOTO}`,
    invoke: (client) => client.deleteMyPhoto(SLUG, PHOTO),
  },
  {
    name: 'setCaption',
    verb: 'patch',
    path: `/api/events/${SLUG}/photos/${PHOTO}/caption`,
    invoke: (client) => client.setCaption(SLUG, PHOTO, 'Les confettis'),
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
    name: 'renameEvent',
    verb: 'patch',
    path: `/api/events/${SLUG}`,
    invoke: (client) => client.renameEvent(SLUG, 'Camille et Sacha'),
  },
  {
    name: 'updateSettings',
    verb: 'patch',
    path: `/api/events/${SLUG}/settings`,
    invoke: (client) => client.updateSettings(SLUG, { allowCaptions: false }),
  },
  {
    name: 'setEventStatus',
    verb: 'post',
    path: `/api/events/${SLUG}/status`,
    invoke: (client) => client.setEventStatus(SLUG, 'live'),
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
    name: 'deletePhoto',
    verb: 'del',
    path: `/api/events/${SLUG}/photos/${PHOTO}`,
    invoke: (client) => client.deletePhoto(SLUG, PHOTO),
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

  // moderators
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
    invoke: (client) => client.inviteModerator(SLUG, 'moderateur@example.com'),
  },
  {
    name: 'revokeModerator',
    verb: 'del',
    path: `/api/events/${SLUG}/moderators/user-2`,
    invoke: (client) => client.revokeModerator(SLUG, 'user-2'),
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

    // The two link builders return a string rather than making a request, so they are
    // pinned in their own block below instead.
    expect(missing).toEqual(['albumUrl', 'streamUrl'])
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

  it('sends a null caption to clear one, rather than omitting the field', async () => {
    await subject().setCaption(SLUG, PHOTO, null)

    expect(only().body).toEqual({ caption: null })
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
})

describe('the moderation queue query', () => {
  it('asks for nothing but the endpoint when no filter is set', async () => {
    await subject().moderationQueue(SLUG)

    expect(only().query).toEqual({})
  })

  it('carries the filter, the cursor and the page size when they are set', async () => {
    await subject().moderationQueue(SLUG, { status: 'pending', cursor: 'c1', limit: 50 })

    expect(only().query).toEqual({ status: 'pending', cursor: 'c1', limit: 50 })
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

describe('links the app builds rather than requests', () => {
  it('points the album download at the documented ZIP endpoint', () => {
    expect(subject().albumUrl(SLUG)).toBe(`/api/events/${SLUG}/album.zip`)
  })

  it('points the stream at the documented SSE endpoint', () => {
    // `useEventStream` hands this straight to `EventSource`; a wrong path shows as a
    // wall that never updates rather than as an error anybody sees.
    expect(subject().streamUrl(SLUG)).toBe(`/api/events/${SLUG}/stream`)
  })

  it.each(['albumUrl', 'streamUrl'] as const)('escapes a slug in %s too', (method) => {
    expect(subject()[method]('gala/autre')).toContain('gala%2Fautre')
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
