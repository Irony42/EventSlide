import { render, type RenderResult } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactElement, ReactNode } from 'react'
import { vi } from 'vitest'
import { ApiProvider } from '../app/ApiProvider'
import { ToastProvider } from '../design-system/components/ToastProvider'
import { DEFAULT_EVENT_THEME } from '../design-system/eventTheme'
import { LocaleProvider } from '../lib/i18n/LocaleProvider'
import { installDialogStub } from './dialogStub'
import type { Api, ModeratorInviteResponse } from '../lib/api/client'
import type { Locale } from '../lib/i18n/locale'
import type {
  ClipJobDto,
  EventDto,
  EventSettingsDto,
  GalleryDto,
  GalleryPhotoDto,
  GuestPhotoDto,
  GuestMissionDto,
  JoinResponse,
  MissionDto,
  ModerationPhotoDto,
  PrivacyNoticeDto,
  PrivacyNoticeState,
  PublicEventDto,
  SessionResponse,
  SessionUserDto,
  ShareLinkDto,
  WallItemDto,
  WallMissionDto,
  WallResponse,
} from '../lib/api/dto'

/**
 * The component-test harness.
 *
 * Two jobs: hand a component the providers it would have in the real app, and hand the
 * test a complete fake `Api` it can assert against. No test stubs `fetch`, and no test
 * imports the real `api` singleton — that is what makes a component test a statement
 * about the component rather than about the transport.
 */

installDialogStub()

/** Fixed, because a snapshot of "now" is a test that fails at midnight. */
const CREATED_AT = '2026-06-20T21:04:11.031Z'

export const aPublicEvent = (overrides: Partial<PublicEventDto> = {}): PublicEventDto => ({
  slug: 'camille-et-sacha',
  name: 'Camille & Sacha',
  allowCaptions: true,
  allowReactions: true,
  maxUploadBytes: 25_000_000,
  maxFilesPerUpload: 20,
  // Video on by default in tests, because the interesting cases are the ones where a
  // guest can actually send one; a screen that hides the control is one assertion away
  // with `allowClips: false`.
  allowClips: true,
  maxClipBytes: 80_000_000,
  maxClipSeconds: 15,
  // The default theme, so a component test asserts the product's own look unless it
  // says otherwise — the same starting point an event that chose nothing has.
  theme: DEFAULT_EVENT_THEME,
  ...overrides,
})

/** An open shared gallery, as a guest holding its link is shown it (roadmap §4.1). */
export const aGallery = (overrides: Partial<GalleryDto> = {}): GalleryDto => ({
  eventName: 'Camille & Sacha',
  theme: DEFAULT_EVENT_THEME,
  photoCount: 2,
  expiresAt: '2026-07-20T21:00:00.000Z',
  archiveUrl: '/api/gallery-media/link-1/album.zip?e=1&s=signature',
  ...overrides,
})

/** One tile of the gallery. The URLs name their rendition, so a test can tell them apart. */
export const aGalleryPhoto = (overrides: Partial<GalleryPhotoDto> = {}): GalleryPhotoDto => {
  const id = overrides.id ?? 'photo-1'
  return {
    id,
    kind: 'photo',
    width: 4032,
    height: 3024,
    caption: null,
    previewUrl: `/api/gallery-media/link-1/${id}/thumb?e=1&s=a`,
    viewUrl: `/api/gallery-media/link-1/${id}/display?e=1&s=b`,
    downloadUrl: `/api/gallery-media/link-1/${id}/original?e=1&s=c`,
    ...overrides,
  }
}

/** The host's current link, open, with no password. */
export const aShareLink = (overrides: Partial<ShareLinkDto> = {}): ShareLinkDto => ({
  id: 'link-1',
  createdAt: CREATED_AT,
  expiresAt: '2026-07-20T21:04:11.031Z',
  hasPassword: false,
  available: true,
  ...overrides,
})

/** One of the host's prompts, as the room sees it. Unanswered by default. */
export const aWallMission = (overrides: Partial<WallMissionDto> = {}): WallMissionDto => ({
  id: 'mission-1',
  prompt: 'un selfie avec les mariés',
  scope: 'guest',
  achieved: false,
  completedByGuests: 0,
  ...overrides,
})

/** One of the host's prompts, on the host's console. */
export const aMission = (overrides: Partial<MissionDto> = {}): MissionDto => ({
  id: 'mission-1',
  prompt: 'un selfie avec les mariés',
  scope: 'guest',
  achieved: false,
  publishedPhotos: 0,
  completedByGuests: 0,
  ...overrides,
})

/** One row of the guest's checklist. Still to do by default. */
export const aGuestMission = (overrides: Partial<GuestMissionDto> = {}): GuestMissionDto => ({
  id: 'mission-1',
  prompt: 'un selfie avec les mariés',
  scope: 'guest',
  done: false,
  ...overrides,
})

/**
 * What the product's default event tells a guest (roadmap §5.1): moderated, kept until the
 * host deletes it, fifteen minutes to take a photo back. The revision is whatever the
 * server would have minted; a test that cares about one sets it.
 */
export const aPrivacyNotice = (overrides: Partial<PrivacyNoticeDto> = {}): PrivacyNoticeDto => ({
  revision: 'publication=afterReview;audiences=wall+organisers;retention=none;selfRemoval=900',
  publication: 'afterReview',
  audiences: ['wall', 'organisers'],
  retentionDays: null,
  selfRemovalSeconds: 900,
  ...overrides,
})

/**
 * A notice and where the device stands with it. **Already read, by default** — the
 * standing of every guest a screen test is not about, so the picker is on screen for
 * the tests that exercise it. A test about the notice says `none` or `outdated`.
 */
export const aPrivacyNoticeState = (
  overrides: Partial<PrivacyNoticeState> = {},
): PrivacyNoticeState => ({
  notice: aPrivacyNotice(),
  acknowledgement: 'current',
  ...overrides,
})

export const aJoinResponse = (overrides: Partial<JoinResponse> = {}): JoinResponse => ({
  guestId: 'guest-1',
  displayName: 'Léa',
  event: aPublicEvent(),
  // Unread: a join is where a new device arrives, and that is the realistic answer.
  privacyNotice: aPrivacyNoticeState({ acknowledgement: 'none' }),
  ...overrides,
})

export const aWallItem = (overrides: Partial<WallItemDto> = {}): WallItemDto => ({
  id: 'photo-1',
  displayUrl: '/api/events/camille-et-sacha/photos/photo-1/display',
  thumbUrl: '/api/events/camille-et-sacha/photos/photo-1/thumb',
  width: 2560,
  height: 1707,
  caption: 'Les confettis',
  authorName: 'Léa',
  createdAt: CREATED_AT,
  // A photograph unless a test says otherwise. The clip facet is `null`-valued rather
  // than absent on the wire, so no surface tests for a missing key.
  kind: 'photo',
  videoUrl: null,
  durationMs: null,
  ...overrides,
})

/**
 * A clip, as every surface that can hold one receives it.
 *
 * `thumbUrl` and `displayUrl` point at the **poster**, exactly as the server presents
 * them — which is what lets the four layouts that do not play video render one with no
 * branch of their own, and what a test would quietly lose by inventing its own row.
 */
export const aWallClip = (overrides: Partial<WallItemDto> = {}): WallItemDto =>
  aWallItem({
    id: 'clip-1',
    displayUrl: '/api/events/camille-et-sacha/photos/clip-1/poster',
    thumbUrl: '/api/events/camille-et-sacha/photos/clip-1/poster',
    kind: 'clip',
    videoUrl: '/api/events/camille-et-sacha/photos/clip-1/video',
    durationMs: 8_000,
    ...overrides,
  })

export const aWallResponse = (overrides: Partial<WallResponse> = {}): WallResponse => ({
  event: { slug: 'camille-et-sacha', name: 'Camille & Sacha' },
  // Present, because a real server presents it, and because the field is optional on the
  // DTO: an omitted key is invisible to the `Object.keys` walk in
  // `useWallPlaylist.settings.test.ts`, which would exempt it from the very enumeration
  // written to stop a settings field going uncompared. The same code as `anEventDto`
  // below, so a test that renders both reads one value.
  //
  // It also makes the wall's invitation real by default — the empty state carries the QR
  // and the code, and a wall with items reserves its bottom-right corner for the join
  // card. A test that wants the server build which presents no code has to delete the
  // key, not override it: `exactOptionalPropertyTypes` rejects `joinCode: undefined`
  // against an optional-but-not-nullable field. `WallPage.test.tsx` spells that out once,
  // as `withoutJoinCode`.
  joinCode: 'H7K2QM',
  // The link the QR encodes, as the server builds it from `PUBLIC_URL`. A different origin
  // from the jsdom page's on purpose: the wall must render *this* value, and a fixture that
  // matched `window.location.origin` would keep passing if the browser went back to
  // inventing the URL itself.
  joinUrl: 'https://photos.example/join/H7K2QM',
  revision: 'rev-1',
  items: [],
  slideIntervalMs: 8_000,
  // `interval + CROSSFADE_MS`, which is 800 — not 520. The wrong pair sat here and in
  // `docs/API.md` while three arguments in this change rest on that arithmetic.
  kenBurnsDurationMs: 8_800,
  layout: 'spotlight',
  reactionsEnabled: true,
  // The product's own look, which spreads no attribute at all — so a wall built from this
  // renders the DOM it rendered before theming existed, and every negative assertion about
  // that DOM still means what it says. It is here rather than omitted because `theme` is
  // optional on the response, and an omitted key is invisible to
  // `useWallPlaylist.settings.test.ts`, which enumerates what a real server sends: the
  // staleness guard had never once been asked about the theme.
  theme: DEFAULT_EVENT_THEME,
  // Empty, which is what nearly every event sends: a wall with no prompts draws no panel,
  // and the committed visual baselines are of exactly that wall. Present rather than
  // omitted for the reason `theme` is — an omitted key is invisible to the enumeration in
  // `useWallPlaylist.settings.test.ts`.
  missions: [],
  // The language the room's screen speaks. Present rather than omitted for the reason
  // `theme` and `missions` above are: the field is optional on the response, and an
  // omitted key is invisible to the `Object.keys` walk in
  // `useWallPlaylist.settings.test.ts` — which is the enumeration written precisely so a
  // settings field cannot go uncompared. A test that wants the server build which
  // predates the field deletes the key rather than overriding it.
  wallLanguage: 'fr',
  ...overrides,
})

export const aGuestPhoto = (overrides: Partial<GuestPhotoDto> = {}): GuestPhotoDto => ({
  id: 'photo-1',
  status: 'pending',
  thumbUrl: '/api/events/camille-et-sacha/photos/photo-1/thumb',
  caption: null,
  createdAt: CREATED_AT,
  // The server computes this from the grace window and the status. A component must
  // never recompute it: that divergence is why 1.0 offered a delete button that 403'd.
  canDelete: true,
  kind: 'photo',
  videoUrl: null,
  durationMs: null,
  ...overrides,
})

export const aModerationPhoto = (
  overrides: Partial<ModerationPhotoDto> = {},
): ModerationPhotoDto => ({
  id: 'photo-1',
  status: 'pending',
  thumbUrl: '/api/events/camille-et-sacha/photos/photo-1/thumb',
  displayUrl: '/api/events/camille-et-sacha/photos/photo-1/display',
  width: 2560,
  height: 1707,
  caption: null,
  authorName: 'Léa',
  createdAt: CREATED_AT,
  kind: 'photo',
  videoUrl: null,
  durationMs: null,
  ...overrides,
})

/** The same row when it is fifteen seconds of video the host has to watch. */
export const aModerationClip = (overrides: Partial<ModerationPhotoDto> = {}): ModerationPhotoDto =>
  aModerationPhoto({
    id: 'clip-1',
    thumbUrl: '/api/events/camille-et-sacha/photos/clip-1/poster',
    displayUrl: '/api/events/camille-et-sacha/photos/clip-1/poster',
    kind: 'clip',
    videoUrl: '/api/events/camille-et-sacha/photos/clip-1/video',
    durationMs: 8_000,
    ...overrides,
  })

export const eventSettings = (overrides: Partial<EventSettingsDto> = {}): EventSettingsDto => ({
  moderation: 'manual',
  allowCaptions: true,
  allowReactions: true,
  allowClips: true,
  allowGuestSelfDelete: true,
  guestSelfDeleteGraceSeconds: 300,
  retentionDays: null,
  maxPhotosPerGuest: null,
  theme: DEFAULT_EVENT_THEME,
  // French, which is what an event created before this setting existed reads back as —
  // and what a host who has not touched the control still has. A test that wants the
  // projector in another language overrides it.
  wallLanguage: 'fr',
  ...overrides,
})

export const anEventDto = (overrides: Partial<EventDto> = {}): EventDto => ({
  id: 'event-1',
  slug: 'camille-et-sacha',
  name: 'Camille & Sacha',
  status: 'live',
  photoCount: 0,
  pendingCount: 0,
  guestCount: 0,
  usedBytes: 0,
  createdAt: CREATED_AT,
  joinCode: 'H7K2QM',
  joinUrl: 'https://photos.example/join/H7K2QM',
  quotaBytes: 5_000_000_000,
  settings: eventSettings(),
  startsAt: null,
  closedAt: null,
  scheduledOpenAt: null,
  scheduledCloseAt: null,
  scheduleDiscardedAt: null,
  role: 'owner',
  ...overrides,
})

/**
 * A clip job, as `POST .../clips` and `GET .../clips/:id` both answer it.
 *
 * `queued` by default, because that is what a fresh upload actually returns — the bytes
 * have landed and the worker has not taken them yet. Defaulting to `done` would let every
 * test skip the window this surface exists for.
 */
export const aClipJob = (overrides: Partial<ClipJobDto> = {}): ClipJobDto => ({
  clipJobId: 'clip-job-1',
  status: 'queued',
  photoId: 'clip-1',
  failureCode: null,
  ...overrides,
})

export const aSessionUser = (overrides: Partial<SessionUserDto> = {}): SessionUserDto => ({
  userId: 'user-1',
  email: 'organisation@example.com',
  displayName: 'Camille',
  mustChangePassword: false,
  ...overrides,
})

/**
 * A complete fake `Api`.
 *
 * Every method resolves to an empty-but-valid DTO, so a test states only the responses
 * it cares about. Every method is a `vi.fn()`, so a test can assert what the component
 * asked the server to do — `expect(api.moderate).toHaveBeenCalledWith(slug, id, 'publish')`.
 *
 * Empty-but-valid, not empty-or-missing: a fake that returned `undefined` for a list
 * would make the loading and empty states indistinguishable, and those two are the
 * states people actually hit at an event.
 */
export const fakeApi = (overrides: Partial<Api> = {}): Api => ({
  join: vi.fn(async () => aJoinResponse()),
  wall: vi.fn(async () => aWallResponse()),

  uploadPhotos: vi.fn(async () => ({ results: [] })),
  // `queued`, which is what a fresh upload actually answers: the bytes have landed and
  // the worker has not taken them yet. `done` as a default would make every clip test
  // skip the polling this surface exists for.
  uploadClip: vi.fn(async () => aClipJob()),
  clipJob: vi.fn(async () => aClipJob()),
  myPhotos: vi.fn(async () => ({ items: [] })),
  // Empty, which is what nearly every event answers: a host who set no prompts is the
  // common case, and the checklist renders nothing at all for them.
  myMissions: vi.fn(async () => ({ items: [] })),
  // Already read, matching `aPrivacyNoticeState`: a screen test about photos must not
  // have the picker replaced by the notice the moment this answers.
  privacyNotice: vi.fn(async () => aPrivacyNoticeState()),
  acknowledgePrivacyNotice: vi.fn(async () => aPrivacyNoticeState()),
  deleteMyPhoto: vi.fn(async () => undefined),
  setCaption: vi.fn(async () => undefined),
  react: vi.fn(async () => undefined),
  withdrawReaction: vi.fn(async () => undefined),
  reactions: vi.fn(async () => ({
    counts: { love: 0, laugh: 0, wow: 0, cheers: 0, clap: 0 },
    mine: [],
  })),

  login: vi.fn(async () => aSessionUser()),
  logout: vi.fn(async () => undefined),
  // Unauthenticated by default: `/api/auth/me` answers 200 with this on a first visit,
  // so a test that forgets to log in exercises the redirect rather than a 401 branch.
  session: vi.fn(async (): Promise<SessionResponse> => ({ authenticated: false })),
  changePassword: vi.fn(async () => undefined),

  listEvents: vi.fn(async () => ({ items: [] })),
  createEvent: vi.fn(async () => anEventDto()),
  getEvent: vi.fn(async () => anEventDto()),
  renameEvent: vi.fn(async () => anEventDto()),
  updateSettings: vi.fn(async () => anEventDto()),
  setEventStatus: vi.fn(async () => anEventDto()),
  setSchedule: vi.fn(async () => anEventDto()),
  rotateJoinCode: vi.fn(async () => anEventDto()),
  purgeEvent: vi.fn(async () => undefined),

  moderationQueue: vi.fn(async () => ({ items: [], pendingCount: 0, nextCursor: null })),
  moderate: vi.fn(async () => undefined),
  moderateBulk: vi.fn(async () => ({ applied: [], skipped: [] })),
  deletePhoto: vi.fn(async () => undefined),
  topPhotos: vi.fn(async () => ({ items: [] })),

  listGuests: vi.fn(async () => ({ items: [], activeCount: 0 })),
  revokeGuest: vi.fn(async () => undefined),

  listModerators: vi.fn(async () => ({ items: [] })),
  // `{ userId, created }`, as the server answers: a 201 saying whether an account was
  // created, never a membership row. `created: true` is the interesting default — it is
  // the branch where the temporary password the host typed is live.
  inviteModerator: vi.fn(async (): Promise<ModeratorInviteResponse> => ({
    userId: 'user-2',
    created: true,
  })),
  revokeModerator: vi.fn(async () => undefined),

  listMissions: vi.fn(async () => ({ items: [] })),
  createMission: vi.fn(async (): Promise<MissionDto> => aMission()),
  updateMission: vi.fn(async () => undefined),
  deleteMission: vi.fn(async () => undefined),

  // No link by default: the panel's first state is the one a host meets first.
  shareLink: vi.fn(async () => ({ link: null })),
  createShareLink: vi.fn(async () => ({
    link: aShareLink(),
    url: 'https://photos.example.test/g/le-jeton-du-lien',
  })),
  revokeShareLink: vi.fn(async () => undefined),
  gallery: vi.fn(async () => aGallery()),
  unlockGallery: vi.fn(async () => undefined),
  galleryPhotos: vi.fn(async () => ({
    items: [aGalleryPhoto({ id: 'photo-1' }), aGalleryPhoto({ id: 'photo-2' })],
    nextCursor: null,
  })),

  albumUrl: vi.fn((slug: string) => `/api/events/${slug}/album.zip`),
  streamUrl: vi.fn((slug: string) => `/api/events/${slug}/stream`),
  moderationStreamUrl: vi.fn((slug: string) => `/api/events/${slug}/moderation/stream`),

  ...overrides,
})

export interface RenderWithProvidersOptions {
  readonly api?: Api
  /** The initial location, e.g. `/e/camille-et-sacha/upload`. */
  readonly route?: string
  /**
   * A route pattern to mount `ui` under, for a component that reads `useParams`.
   * Without it the element is rendered directly and `useParams` is empty.
   */
  readonly path?: string
  /**
   * The language to render in. **French unless a test says otherwise**, which is what
   * keeps every test written before roadmap 1.5 asserting the copy it always did.
   *
   * Passed explicitly rather than detected, so no assertion depends on the language the
   * machine running the suite happens to have configured — the same reason `CREATED_AT`
   * above is a fixed instant.
   */
  readonly locale?: Locale
}

export interface RenderWithProvidersResult extends RenderResult {
  readonly api: Api
}

/**
 * Render inside the app's providers.
 *
 * The providers live in a `wrapper`, so `rerender` from the returned result keeps them
 * — re-rendering into a fresh provider tree would reset every toast and refetch.
 */
export const renderWithProviders = (
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult => {
  const api = options.api ?? fakeApi()
  const route = options.route ?? '/'
  const path = options.path
  const locale = options.locale ?? 'fr'

  const Providers = ({ children }: { readonly children: ReactNode }) => (
    <LocaleProvider initialLocale={locale}>
      <MemoryRouter initialEntries={[route]}>
        <ApiProvider api={api}>
          <ToastProvider>
            {path === undefined ? (
              children
            ) : (
              <Routes>
                <Route path={path} element={children} />
              </Routes>
            )}
          </ToastProvider>
        </ApiProvider>
      </MemoryRouter>
    </LocaleProvider>
  )

  // `Object.assign` rather than a spread: Testing Library's `RenderResult` is an
  // intersection with a mapped type over the query helpers, and TypeScript loses the
  // mapped half when it infers the type of an object-literal spread — so a spread
  // compiles to a result with no `getByRole`.
  return Object.assign(render(ui, { wrapper: Providers }), { api })
}
