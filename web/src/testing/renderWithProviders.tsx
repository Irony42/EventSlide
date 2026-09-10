import { render, type RenderResult } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactElement, ReactNode } from 'react'
import { vi } from 'vitest'
import { ApiProvider } from '../app/ApiProvider'
import { ToastProvider } from '../design-system/components/ToastProvider'
import { installDialogStub } from './dialogStub'
import type { Api } from '../lib/api/client'
import type {
  EventDto,
  EventSettingsDto,
  GuestPhotoDto,
  JoinResponse,
  ModerationPhotoDto,
  ModeratorDto,
  PublicEventDto,
  SessionResponse,
  SessionUserDto,
  WallItemDto,
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
  ...overrides,
})

export const aJoinResponse = (overrides: Partial<JoinResponse> = {}): JoinResponse => ({
  guestId: 'guest-1',
  displayName: 'Léa',
  event: aPublicEvent(),
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
  ...overrides,
})

export const aWallResponse = (overrides: Partial<WallResponse> = {}): WallResponse => ({
  event: { slug: 'camille-et-sacha', name: 'Camille & Sacha' },
  revision: 'rev-1',
  items: [],
  slideIntervalMs: 8_000,
  kenBurnsDurationMs: 8_520,
  layout: 'spotlight',
  reactionsEnabled: true,
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
  byteSize: 2_400_000,
  createdAt: CREATED_AT,
  ...overrides,
})

export const eventSettings = (overrides: Partial<EventSettingsDto> = {}): EventSettingsDto => ({
  moderation: 'manual',
  allowCaptions: true,
  allowReactions: true,
  allowGuestSelfDelete: true,
  guestSelfDeleteGraceSeconds: 300,
  retentionDays: null,
  maxPhotosPerGuest: null,
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
  role: 'owner',
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
  myPhotos: vi.fn(async () => ({ items: [] })),
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
  inviteModerator: vi.fn(
    async (): Promise<ModeratorDto> => ({
      userId: 'user-2',
      email: 'moderateur@example.com',
      displayName: null,
      role: 'moderator',
      grantedAt: CREATED_AT,
    }),
  ),
  revokeModerator: vi.fn(async () => undefined),

  albumUrl: vi.fn((slug: string) => `/api/events/${slug}/album.zip`),
  streamUrl: vi.fn((slug: string) => `/api/events/${slug}/stream`),

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

  const Providers = ({ children }: { readonly children: ReactNode }) => (
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
  )

  return { ...render(ui, { wrapper: Providers }), api }
}
