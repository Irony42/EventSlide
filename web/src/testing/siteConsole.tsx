import { vi } from 'vitest'
import { AppRoutes } from '../app/router'
import type { Api } from '../lib/api/client'
import type { CurrentUserDto, SessionResponse } from '../lib/api/dto'
import { ApiError } from '../lib/http'
import { anAbout, aSessionUser, fakeApi, renderWithProviders } from './renderWithProviders'

/**
 * The operator's console, mounted the way the app mounts it: the whole route table, over a fake
 * `Api`, for an account that operates a box that has a console.
 *
 * Through the routes and not the page on its own, because what a console screen is — its gate, its
 * layout, the confirmation prompt every write can open, the shared session — is what the router
 * puts around it, and a page mounted bare would be a test of a page nobody sees.
 */

/** The second factor as a hosted box has it: required, enrolled, and passed by this session. */
export const PASSED_FACTOR = {
  available: true,
  enrolled: true,
  verified: true,
  required: true,
} satisfies CurrentUserDto['secondFactor']

/** An account that operates the box, signed in. */
export const operatorSession = (overrides: Partial<CurrentUserDto> = {}): SessionResponse => ({
  authenticated: true,
  user: aSessionUser({
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'pierre@example.com',
    canOperateSite: true,
    secondFactor: PASSED_FACTOR,
    ...overrides,
  }),
})

/** A fake `Api` for a box with `SITE_ADMIN=on`, signed in as the operator. */
export const consoleApi = (overrides: Partial<Api> = {}): Api =>
  fakeApi({
    session: vi.fn(async () => operatorSession()),
    about: vi.fn(async () => anAbout({ features: { siteAdmin: true, forgotPassword: false } })),
    ...overrides,
  })

/**
 * Mounts the route table at `route`. `session: false` because `HostLayout` provides the session
 * here, as in the app, and a layout that forgot to would fail loudly instead of being served.
 */
export const openConsole = (route: string, api: Api = consoleApi()) =>
  renderWithProviders(<AppRoutes />, { api, route, session: false })

/** What the server answers a write that has not been confirmed in the last five minutes. */
export const stepUpRequired = (): ApiError => new ApiError(403, 'auth.stepUpRequired')

/** What the server answers an account that does not operate the box. */
export const notTheOperator = (): ApiError =>
  new ApiError(403, 'auth.forbidden', { required: 'operator' })

/**
 * Every method of the fake `Api` that is not the operator's own namespace, the session or the
 * second factor: **what the console must never ask for**. The ones that read a client's events by
 * slug, its photographs, its gallery or its wall are all here, and a test of the whole console
 * asserts none of them was called.
 */
export const NEVER_FROM_THE_CONSOLE: readonly (keyof Api)[] = [
  'wall',
  'uploadPhotos',
  'myPhotos',
  'listEvents',
  'getEvent',
  'listGuests',
  'listModerators',
  'listMissions',
  'moderationQueue',
  'topPhotos',
  'shareLink',
  'gallery',
  'galleryPhotos',
  'clientAudit',
  'pendingInvitations',
]
