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
 * What a console screen may ask the server for: the operator's own namespace (`site*`), and the
 * four things every host screen asks, the session, the box's answer, the confirmation prompt and
 * signing out, plus the account menu's read of the caller's own limits.
 *
 * **An allowlist, and that is the point.** A list of forbidden methods says what somebody thought
 * of: a console that began to purge an event, moderate a photograph or revoke a guest would pass it
 * until the day the list was extended. Anything the console calls that is not named here is a
 * request outside `/api/site`, whatever it is called.
 */
const MAY_BE_ASKED = new Set<string>(['session', 'about', 'stepUp', 'logout', 'myLimits'])

/** The methods of the fake `Api` that were called and that a console screen has no business calling. */
export const callsOutsideTheConsole = (api: Api): readonly string[] =>
  Object.entries(api)
    .filter(
      ([name, method]) =>
        vi.isMockFunction(method) &&
        method.mock.calls.length > 0 &&
        !name.startsWith('site') &&
        !MAY_BE_ASKED.has(name),
    )
    .map(([name]) => name)
