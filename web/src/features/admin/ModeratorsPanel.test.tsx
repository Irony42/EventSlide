import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModeratorsPanel } from './ModeratorsPanel'
import { PASSWORD_MIN_LENGTH } from '../auth/passwordPolicy'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { ModeratorDto } from '../../lib/api/dto'

/** The harness has no membership factory: `GET /:slug/moderators` answers with these. */
const aModerator = (overrides: Partial<ModeratorDto> = {}): ModeratorDto => ({
  userId: 'user-1',
  email: 'camille@example.com',
  displayName: 'Camille',
  role: 'owner',
  grantedAt: '2026-06-01T10:00:00.000Z',
  ...overrides,
})

const A_SECOND_OWNER = aModerator({ userId: 'user-3', email: 'sacha@example.com' })
const A_MODERATOR = aModerator({
  userId: 'user-2',
  email: 'moderateur@example.com',
  displayName: null,
  role: 'moderator',
})

const renderPanel = (api: Api) =>
  renderWithProviders(<ModeratorsPanel slug="camille-et-sacha" />, {
    api,
    route: '/admin/events/camille-et-sacha',
  })

const listOf = (...items: readonly ModeratorDto[]) => vi.fn(async () => ({ items }))

/** Long enough for the policy the server enforces, and obviously a fixture. */
const A_TEMPORARY_PASSWORD = 'phrase-de-passe-temporaire'

/** The invitation form, both fields, as a host fills it. */
const fillInvitation = async (email: string, temporaryPassword: string): Promise<void> => {
  await userEvent.type(await screen.findByLabelText(fr.admin.moderatorEmail), email)
  await userEvent.type(screen.getByLabelText(fr.admin.moderatorPassword), temporaryPassword)
}

/**
 * The confirmation's own button, which carries the same label as the row's.
 *
 * `noUncheckedIndexedAccess`: an empty list here would be a broken test rather than a
 * component fault, so it fails loudly instead of clicking `undefined`.
 */
const lastRevokeButton = (): HTMLElement => {
  const buttons = screen.getAllByRole('button', { name: fr.admin.revokeModerator })
  const last = buttons[buttons.length - 1]
  if (last === undefined) throw new Error('no revoke button')
  return last
}

describe('ModeratorsPanel', () => {
  it('says it is working while the memberships load', () => {
    const api = fakeApi({
      listModerators: vi.fn(() => new Promise<{ items: readonly ModeratorDto[] }>(() => {})),
    })

    renderPanel(api)

    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
  })

  it('explains an empty list rather than showing nothing', async () => {
    renderPanel(fakeApi())

    expect(await screen.findByText(fr.admin.moderatorsEmpty)).toBeVisible()
  })

  it('names the failure and offers a retry', async () => {
    const listModerators = listOf(aModerator())
    listModerators.mockRejectedValueOnce(ApiError.network())
    const api = fakeApi({ listModerators })

    renderPanel(api)

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByText('camille@example.com')).toBeVisible()
  })

  it('lists each membership with its role', async () => {
    const api = fakeApi({ listModerators: listOf(aModerator(), A_MODERATOR) })

    renderPanel(api)

    expect(await screen.findByText('camille@example.com')).toBeVisible()
    expect(screen.getByText('moderateur@example.com')).toBeVisible()
    expect(screen.getByText(fr.admin.roleOwner)).toBeVisible()
    expect(screen.getByText(fr.admin.roleModerator)).toBeVisible()
  })

  it('never offers to revoke the last owner', async () => {
    // An event with no owner can never be settled again: its settings, its join code
    // and its purge all require one.
    const api = fakeApi({ listModerators: listOf(aModerator(), A_MODERATOR) })

    renderPanel(api)

    expect(await screen.findByText(fr.admin.lastOwnerHint)).toBeVisible()
    // Exactly one revoke button: the moderator's.
    expect(screen.getAllByRole('button', { name: fr.admin.revokeModerator })).toHaveLength(1)
  })

  it('offers to revoke an owner once there is a second one', async () => {
    const api = fakeApi({ listModerators: listOf(aModerator(), A_SECOND_OWNER) })

    renderPanel(api)

    expect(await screen.findByText('sacha@example.com')).toBeVisible()
    expect(screen.queryByText(fr.admin.lastOwnerHint)).toBeNull()
    expect(screen.getAllByRole('button', { name: fr.admin.revokeModerator })).toHaveLength(2)
  })

  it('invites a moderator with an address and a temporary password, then clears both', async () => {
    // Both fields, because the server requires both: `moderatorInvitationBody` is
    // `.strict()` and `temporaryPassword` is not optional. The panel that shipped had
    // only the address, so every invitation came back `400 request.invalid`.
    const api = fakeApi({ listModerators: listOf(aModerator()) })

    renderPanel(api)
    await fillInvitation('sacha@example.com', A_TEMPORARY_PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: fr.admin.inviteSubmit }))

    expect(api.inviteModerator).toHaveBeenCalledWith('camille-et-sacha', {
      email: 'sacha@example.com',
      temporaryPassword: A_TEMPORARY_PASSWORD,
    })
    expect(await screen.findByText(fr.admin.moderatorInvited('sacha@example.com'))).toBeVisible()
    expect(screen.getByLabelText(fr.admin.moderatorEmail)).toHaveValue('')
    expect(screen.getByLabelText(fr.admin.moderatorPassword)).toHaveValue('')
  })

  it('tells the host to read the password out when an account was created', async () => {
    const api = fakeApi({ listModerators: listOf(aModerator()) })

    renderPanel(api)
    await fillInvitation('sacha@example.com', A_TEMPORARY_PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: fr.admin.inviteSubmit }))

    expect(await screen.findByText(fr.admin.moderatorInvited('sacha@example.com'))).toBeVisible()
  })

  it('says the password was not used when the address already had an account', async () => {
    // An existing account keeps its own password — an invitation that reset it would let
    // one host take over a colleague's account. A host told otherwise would read out a
    // credential that does not work and blame the product.
    const api = fakeApi({
      listModerators: listOf(aModerator()),
      inviteModerator: vi.fn(async () => ({ userId: 'user-9', created: false })),
    })

    renderPanel(api)
    await fillInvitation('sacha@example.com', A_TEMPORARY_PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: fr.admin.inviteSubmit }))

    expect(
      await screen.findByText(fr.admin.moderatorInvitedExisting('sacha@example.com')),
    ).toBeVisible()
    expect(screen.queryByText(fr.admin.moderatorInvited('sacha@example.com'))).toBeNull()
  })

  it('says how long the temporary password has to be, before the host types one', async () => {
    // The server is the only judge of a password, but a host who learns the rule from a
    // refused invitation has already read the wrong one out loud.
    renderPanel(fakeApi())

    expect(
      await screen.findByText(fr.admin.moderatorPasswordHint(PASSWORD_MIN_LENGTH)),
    ).toBeVisible()
  })

  it('says why an invitation was refused, next to the field', async () => {
    const api = fakeApi({
      listModerators: listOf(aModerator()),
      inviteModerator: vi.fn(() => Promise.reject(new ApiError(404, 'user.notFound'))),
    })

    renderPanel(api)
    await fillInvitation('inconnu@example.com', A_TEMPORARY_PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: fr.admin.inviteSubmit }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['user.notFound'])
    // Both entries stay, so the host can correct a typo rather than retype the pair.
    expect(screen.getByLabelText(fr.admin.moderatorEmail)).toHaveValue('inconnu@example.com')
    expect(screen.getByLabelText(fr.admin.moderatorPassword)).toHaveValue(A_TEMPORARY_PASSWORD)
  })

  it('asks before revoking, and says what the person keeps', async () => {
    const api = fakeApi({ listModerators: listOf(aModerator(), A_MODERATOR) })

    renderPanel(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.revokeModerator }))

    expect(screen.getByText(fr.admin.revokeModeratorTitle)).toBeVisible()
    expect(screen.getByText(fr.admin.revokeModeratorHint)).toBeVisible()
    expect(api.revokeModerator).not.toHaveBeenCalled()

    await userEvent.click(lastRevokeButton())

    expect(api.revokeModerator).toHaveBeenCalledWith('camille-et-sacha', 'user-2')
    expect(await screen.findByText(fr.admin.moderatorRevoked)).toBeVisible()
  })

  it('leaves the membership in place when the confirmation is cancelled', async () => {
    const api = fakeApi({ listModerators: listOf(aModerator(), A_MODERATOR) })

    renderPanel(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.revokeModerator }))
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.revokeModerator).not.toHaveBeenCalled()
    expect(screen.queryByText(fr.admin.revokeModeratorTitle)).toBeNull()
    expect(screen.getByText('moderateur@example.com')).toBeVisible()
  })

  it('reports a refused revoke instead of leaving the panel looking changed', async () => {
    // The list is not refetched on a refusal, so the row the host tried to remove is
    // still there — and they have to be told, or they believe it is gone.
    const api = fakeApi({
      listModerators: listOf(aModerator(), A_MODERATOR),
      revokeModerator: vi.fn(() => Promise.reject(new ApiError(403, 'auth.forbidden'))),
    })

    renderPanel(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.revokeModerator }))
    await userEvent.click(lastRevokeButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['auth.forbidden'])
    expect(screen.getByText('moderateur@example.com')).toBeVisible()
  })
})
