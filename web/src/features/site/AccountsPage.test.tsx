import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import { ApiError } from '../../lib/http'
import type { Api } from '../../lib/api/client'
import type { SiteAccountDto } from '../../lib/api/dto'
import { ACCOUNT_ID, aSiteAccount, OPERATOR_ID } from '../../testing/siteFixtures'
import {
  consoleApi,
  callsOutsideTheConsole,
  notTheOperator,
  openConsole,
  stepUpRequired,
} from '../../testing/siteConsole'

/**
 * Every account of the box, by address, and the one act the console offers on it: a password reset
 * that goes to the account's own address.
 *
 * Ring 5, through the route table. The operator guard's R2 is what these tests hold from the
 * screen's side: where a mailer delivers the console is never shown the link, and where none can
 * it is handed the one link the server returns, once, in a box the operator closes.
 */

const withAccounts = (accounts: readonly SiteAccountDto[], extra: Partial<Api> = {}) =>
  consoleApi({ siteAccounts: vi.fn(async () => ({ items: accounts, next: null })), ...extra })

const open = (api: Api) => openConsole('/admin/site/accounts', api)

const pressReset = async () => {
  await userEvent.click(await screen.findByRole('button', { name: fr.site.resetPassword }))
  const dialog = await screen.findByRole('dialog', { name: fr.site.resetTitle })
  await userEvent.click(within(dialog).getByRole('button', { name: fr.site.resetPassword }))
}

describe('the console’s accounts: reading them', () => {
  it('waits, saying so, while the first page is on its way', async () => {
    open(consoleApi({ siteAccounts: vi.fn(() => new Promise<never>(() => {})) }))

    await screen.findByRole('heading', { name: fr.site.accountsTitle })
    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
  })

  it('says there is no account yet rather than showing an empty table', async () => {
    open(withAccounts([]))

    expect(await screen.findByRole('heading', { name: fr.site.accountsEmpty })).toBeVisible()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says it could not read the accounts, with a retry that reads them again', async () => {
    const siteAccounts = vi
      .fn<Api['siteAccounts']>()
      .mockRejectedValueOnce(new ApiError(500, 'server.unexpected'))
      .mockResolvedValue({ items: [aSiteAccount()], next: null })
    open(consoleApi({ siteAccounts }))

    const failure = await screen.findByRole('alert')
    await userEvent.click(within(failure).getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('rowheader', { name: 'camille@example.com' })).toBeVisible()
  })

  it('shows the server’s refusal, and no table, to an account the server does not let in', async () => {
    open(consoleApi({ siteAccounts: vi.fn(async () => Promise.reject(notTheOperator())) }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['auth.forbidden'])
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('lists each account by address with its role, its standing and what it holds', async () => {
    open(
      withAccounts([
        aSiteAccount({ mustChangePassword: true, clients: [] }),
        aSiteAccount({
          id: OPERATOR_ID,
          email: 'pierre@example.com',
          siteRole: 'operator',
          lastLoginAt: null,
          ownedEventCount: 0,
        }),
        aSiteAccount({
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          email: 'parti@example.com',
          disabledAt: '2026-06-22T08:00:00.000Z',
        }),
      ]),
    )

    const table = await screen.findByRole('table', { name: fr.site.accountsTableLabel })

    const camille = within(within(table).getByRole('row', { name: /camille@example.com/ }))
    expect(camille.getByText(fr.site.accountActive)).toBeVisible()
    expect(camille.getByText(fr.site.mustChange)).toBeVisible()

    const pierre = within(within(table).getByRole('row', { name: /pierre@example.com/ }))
    expect(pierre.getByText(fr.site.siteRoleOperator)).toBeVisible()
    expect(pierre.getByText(fr.site.neverSignedIn)).toBeVisible()

    const parti = within(within(table).getByRole('row', { name: /parti@example.com/ }))
    expect(parti.getByText(fr.site.accountDisabled)).toBeVisible()
  })

  it('offers no reset for an account that is switched off, which the server would refuse', async () => {
    open(withAccounts([aSiteAccount({ disabledAt: '2026-06-22T08:00:00.000Z' })]))

    await screen.findByRole('table')

    expect(screen.queryByRole('button', { name: fr.site.resetPassword })).toBeNull()
  })

  it('prints an address and nothing else a person made, whatever else an answer carries', async () => {
    const planted = {
      ...aSiteAccount(),
      displayName: 'PLANTED-NAME',
      passwordHash: 'PLANTED-HASH',
      token: 'PLANTED-TOKEN',
      contactEmail: 'planted@contact.example',
    }
    open(withAccounts([planted]))

    await screen.findByRole('table')

    expect(document.body).not.toHaveTextContent(/PLANTED/)
    expect(document.body).not.toHaveTextContent('planted@contact.example')
  })

  it('draws no photograph and asks for nothing outside the operator’s namespace', async () => {
    const api = withAccounts([aSiteAccount()])

    const { container } = open(api)
    await screen.findByRole('table')

    expect(container.querySelectorAll('img, video, picture, canvas, audio')).toHaveLength(0)
    expect(callsOutsideTheConsole(api)).toEqual([])
  })

  it('reads the next page with the cursor the server gave', async () => {
    const siteAccounts = vi
      .fn<Api['siteAccounts']>()
      .mockResolvedValueOnce({ items: [aSiteAccount()], next: ACCOUNT_ID })
      .mockResolvedValueOnce({
        items: [aSiteAccount({ id: OPERATOR_ID, email: 'pierre@example.com' })],
        next: null,
      })
    open(consoleApi({ siteAccounts }))

    await userEvent.click(await screen.findByRole('button', { name: fr.site.more }))

    expect(await screen.findByRole('rowheader', { name: 'pierre@example.com' })).toBeVisible()
    expect(siteAccounts).toHaveBeenLastCalledWith({ after: ACCOUNT_ID }, undefined)
  })
})

describe('the console’s accounts: resetting a password', () => {
  it('says what a reset does before it is sent', async () => {
    open(withAccounts([aSiteAccount()]))

    await userEvent.click(await screen.findByRole('button', { name: fr.site.resetPassword }))

    expect(
      await screen.findByRole('dialog', { name: fr.site.resetTitle }),
    ).toHaveAccessibleDescription(fr.site.resetBody)
  })

  it('sends nothing when the confirmation is declined', async () => {
    const api = withAccounts([aSiteAccount()])
    open(api)

    await userEvent.click(await screen.findByRole('button', { name: fr.site.resetPassword }))
    const dialog = await screen.findByRole('dialog', { name: fr.site.resetTitle })
    await userEvent.click(within(dialog).getByRole('button', { name: fr.app.cancel }))

    expect(api.siteResetPassword).not.toHaveBeenCalled()
  })

  it('asks for the reset in the language of the console, and says it went to the account’s own address', async () => {
    const api = withAccounts([aSiteAccount()])
    open(api)

    await pressReset()

    await waitFor(() =>
      expect(api.siteResetPassword).toHaveBeenCalledWith(ACCOUNT_ID, { locale: 'fr' }),
    )
    expect(await screen.findByText(fr.site.resetSent)).toBeVisible()
  })

  it('shows no link and no box where the server says the mail went out, because it holds none', async () => {
    open(withAccounts([aSiteAccount()]))

    await pressReset()
    await screen.findByText(fr.site.resetSent)

    expect(screen.queryByText(fr.site.resetLinkTitle)).toBeNull()
    expect(screen.queryByText(fr.site.resetPending)).toBeNull()
    expect(document.body).not.toHaveTextContent(/https?:\/\//)
  })

  it('says the request is waiting for another owner, and fetches the link once it is approved', async () => {
    const siteResetPassword = vi
      .fn<Api['siteResetPassword']>()
      .mockResolvedValueOnce({
        delivery: 'pendingApproval',
        approvalId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expiresAt: '2026-06-20T22:00:00.000Z',
      })
      .mockResolvedValueOnce({
        delivery: 'link',
        link: 'https://photos.example.test/password/reset/UN-JETON',
        expiresAt: '2026-06-20T22:00:00.000Z',
      })
    const api = withAccounts([aSiteAccount()], { siteResetPassword })
    open(api)

    await pressReset()
    expect(await screen.findByText(fr.site.resetPending)).toBeVisible()
    expect(screen.getByText(fr.site.resetPendingBody)).toBeVisible()
    expect(screen.queryByText(/password\/reset/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: fr.site.resetFetch }))

    expect(
      await screen.findByText('https://photos.example.test/password/reset/UN-JETON'),
    ).toBeVisible()
    expect(siteResetPassword).toHaveBeenLastCalledWith(ACCOUNT_ID, {
      locale: 'fr',
      approvalId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    })
  })

  it('asks again with the id of the request it is showing, not of an earlier one for the same account', async () => {
    const siteResetPassword = vi
      .fn<Api['siteResetPassword']>()
      .mockResolvedValueOnce({
        delivery: 'pendingApproval',
        approvalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        expiresAt: '2026-06-20T22:00:00.000Z',
      })
      .mockResolvedValueOnce({
        delivery: 'pendingApproval',
        approvalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        expiresAt: '2026-06-20T22:00:00.000Z',
      })
      .mockResolvedValue({
        delivery: 'link',
        link: 'https://photos.example.test/password/reset/UN-JETON',
        expiresAt: '2026-06-20T22:00:00.000Z',
      })
    open(withAccounts([aSiteAccount()], { siteResetPassword }))

    await pressReset()
    await screen.findByText(fr.site.resetPending)
    await pressReset()
    await waitFor(() => expect(siteResetPassword).toHaveBeenCalledTimes(2))
    await userEvent.click(await screen.findByRole('button', { name: fr.site.resetFetch }))

    await waitFor(() => expect(siteResetPassword).toHaveBeenCalledTimes(3))
    expect(siteResetPassword).toHaveBeenLastCalledWith(ACCOUNT_ID, {
      locale: 'fr',
      approvalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    })
  })

  it('says what the server said when the request has not been approved yet, and keeps waiting', async () => {
    const siteResetPassword = vi
      .fn<Api['siteResetPassword']>()
      .mockResolvedValueOnce({
        delivery: 'pendingApproval',
        approvalId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expiresAt: '2026-06-20T22:00:00.000Z',
      })
      .mockRejectedValueOnce(new ApiError(404, 'reset.requestNotFound'))
    open(withAccounts([aSiteAccount()], { siteResetPassword }))

    await pressReset()
    await userEvent.click(await screen.findByRole('button', { name: fr.site.resetFetch }))

    expect(await screen.findByText(fr.errors['reset.requestNotFound'])).toBeVisible()
    expect(screen.getByRole('button', { name: fr.site.resetFetch })).toBeVisible()
  })

  it('hands the operator the link, and closes the box on request, where there is no mail and a link is returned', async () => {
    const siteResetPassword = vi.fn<Api['siteResetPassword']>().mockResolvedValue({
      delivery: 'link',
      link: 'https://photos.example.test/password/reset/UN-JETON',
      expiresAt: '2026-06-20T22:00:00.000Z',
    })
    open(withAccounts([aSiteAccount()], { siteResetPassword }))

    await pressReset()

    expect(
      await screen.findByText('https://photos.example.test/password/reset/UN-JETON'),
    ).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: fr.app.close }))
    expect(screen.queryByText(/password\/reset/)).toBeNull()
  })

  it('says what the server said when there is no mailer, and shows no link', async () => {
    const siteResetPassword = vi
      .fn<Api['siteResetPassword']>()
      .mockRejectedValue(new ApiError(409, 'reset.mailerRequired'))
    open(withAccounts([aSiteAccount()], { siteResetPassword }))

    await pressReset()

    expect(await screen.findByText(fr.errors['reset.mailerRequired'])).toBeVisible()
    expect(screen.queryByText(fr.site.resetLinkTitle)).toBeNull()
  })

  it('asks the operator to confirm themselves when the server says so, and resets on that confirmation', async () => {
    const siteResetPassword = vi
      .fn<Api['siteResetPassword']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue({ delivery: 'mail', expiresAt: '2026-06-20T22:00:00.000Z' })
    const api = withAccounts([aSiteAccount()], { siteResetPassword })
    open(api)

    await pressReset()
    const prompt = await screen.findByRole('dialog', { name: fr.site.stepUpTitle })
    await userEvent.type(within(prompt).getByLabelText(fr.auth.password), 'le mot de passe')
    await userEvent.type(within(prompt).getByLabelText(fr.auth.secondFactorCode), '123456')
    await userEvent.click(within(prompt).getByRole('button', { name: fr.auth.stepUpSubmit }))

    expect(await screen.findByText(fr.site.resetSent)).toBeVisible()
    expect(siteResetPassword).toHaveBeenCalledTimes(2)
  })
})
