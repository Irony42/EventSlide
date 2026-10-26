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
 * Every account of the box, by address, and the acts the console offers on it: a password reset that
 * goes to the account's own address, and (below) switching it off, on and away.
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

/**
 * Switching an account off, on, and away. Each is a write, so each can ask for a confirmation;
 * the two that end or suspend are asked for in words first. What the server refuses (an operator's
 * account, an account that still owns an event, wrote media, reviewed a photograph, or is the last
 * owner of a client) is its own to say, and the console shows its sentence and changes nothing.
 */

const SWITCHED_OFF_AT = '2026-06-22T08:00:00.000Z'
const ADDRESS = 'camille@example.com'

const press = (name: string) => userEvent.click(screen.getByRole('button', { name }))

const confirmDialog = async (title: string, label: string) => {
  const dialog = await screen.findByRole('dialog', { name: title })
  await userEvent.click(within(dialog).getByRole('button', { name: label }))
}

describe('the console’s accounts: what is offered on one', () => {
  it('offers to reset, to switch off and to delete an account that is on, and nothing to switch it on', async () => {
    open(withAccounts([aSiteAccount()]))

    await screen.findByRole('table')

    expect(screen.getByRole('button', { name: fr.site.resetPassword })).toBeVisible()
    expect(screen.getByRole('button', { name: fr.site.disableAccount })).toBeVisible()
    expect(screen.getByRole('button', { name: fr.site.deleteAccount })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.site.enableAccount })).toBeNull()
  })

  it('offers to switch an account that is off back on, and to delete it, but not to reset it or switch it off again', async () => {
    open(withAccounts([aSiteAccount({ disabledAt: SWITCHED_OFF_AT })]))

    await screen.findByRole('table')

    expect(screen.getByRole('button', { name: fr.site.enableAccount })).toBeVisible()
    expect(screen.getByRole('button', { name: fr.site.deleteAccount })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.site.disableAccount })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.site.resetPassword })).toBeNull()
  })

  it('offers neither to switch off nor to delete an operator’s account, which the server refuses', async () => {
    open(withAccounts([aSiteAccount({ id: OPERATOR_ID, siteRole: 'operator' })]))

    await screen.findByRole('table')

    expect(screen.queryByRole('button', { name: fr.site.disableAccount })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.site.enableAccount })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.site.deleteAccount })).toBeNull()
    expect(screen.getByRole('button', { name: fr.site.resetPassword })).toBeVisible()
  })
})

describe('the console’s accounts: switching one off', () => {
  it('says what it does before it is sent, and sends nothing when it is declined', async () => {
    const api = withAccounts([aSiteAccount()])
    open(api)
    await screen.findByRole('table')

    await press(fr.site.disableAccount)
    const dialog = await screen.findByRole('dialog', { name: fr.site.disableTitle(ADDRESS) })
    expect(dialog).toHaveAccessibleDescription(fr.site.disableBody)
    await userEvent.click(within(dialog).getByRole('button', { name: fr.app.cancel }))

    expect(api.siteDisableAccount).not.toHaveBeenCalled()
  })

  it('switches the account off on a confirmation, says so, and reads the accounts again', async () => {
    const siteAccounts = vi
      .fn<Api['siteAccounts']>()
      .mockResolvedValueOnce({ items: [aSiteAccount()], next: null })
      .mockResolvedValue({ items: [aSiteAccount({ disabledAt: SWITCHED_OFF_AT })], next: null })
    const api = withAccounts([], { siteAccounts })
    open(api)
    await screen.findByRole('table')

    await press(fr.site.disableAccount)
    await confirmDialog(fr.site.disableTitle(ADDRESS), fr.site.disableAccount)

    await waitFor(() => expect(api.siteDisableAccount).toHaveBeenCalledWith(ACCOUNT_ID))
    expect(await screen.findByText(fr.site.accountDisabledDone)).toBeVisible()
    expect(await screen.findByRole('button', { name: fr.site.enableAccount })).toBeVisible()
  })

  it('does not reuse the button that switched the account off for the one that would switch it back on', async () => {
    // A held Enter on the button that was just pressed must not fire the opposite act, unasked: the
    // two are different elements, so the keyboard is not left on a control that now says another thing.
    const siteAccounts = vi
      .fn<Api['siteAccounts']>()
      .mockResolvedValueOnce({ items: [aSiteAccount()], next: null })
      .mockResolvedValue({ items: [aSiteAccount({ disabledAt: SWITCHED_OFF_AT })], next: null })
    open(withAccounts([], { siteAccounts }))
    await screen.findByRole('table')
    const switchOff = screen.getByRole('button', { name: fr.site.disableAccount })

    await userEvent.click(switchOff)
    await confirmDialog(fr.site.disableTitle(ADDRESS), fr.site.disableAccount)

    const switchOn = await screen.findByRole('button', { name: fr.site.enableAccount })
    expect(switchOn).not.toBe(switchOff)
  })

  it('asks the operator to confirm themselves when the server says so, and switches off on that confirmation', async () => {
    const siteDisableAccount = vi
      .fn<Api['siteDisableAccount']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue(undefined)
    const api = withAccounts([aSiteAccount()], { siteDisableAccount })
    open(api)
    await screen.findByRole('table')

    await press(fr.site.disableAccount)
    await confirmDialog(fr.site.disableTitle(ADDRESS), fr.site.disableAccount)
    const prompt = await screen.findByRole('dialog', { name: fr.site.stepUpTitle })
    await userEvent.type(within(prompt).getByLabelText(fr.auth.password), 'le mot de passe')
    await userEvent.type(within(prompt).getByLabelText(fr.auth.secondFactorCode), '123456')
    await userEvent.click(within(prompt).getByRole('button', { name: fr.auth.stepUpSubmit }))

    expect(await screen.findByText(fr.site.accountDisabledDone)).toBeVisible()
    expect(siteDisableAccount).toHaveBeenCalledTimes(2)
  })

  it('says what the server said when it refuses an operator’s account, and leaves the account as it was', async () => {
    const siteDisableAccount = vi
      .fn<Api['siteDisableAccount']>()
      .mockRejectedValue(new ApiError(403, 'account.operatorProtected'))
    const api = withAccounts([aSiteAccount()], { siteDisableAccount })
    open(api)
    await screen.findByRole('table')

    await press(fr.site.disableAccount)
    await confirmDialog(fr.site.disableTitle(ADDRESS), fr.site.disableAccount)

    expect(await screen.findByText(fr.errors['account.operatorProtected'])).toBeVisible()
    expect(screen.getByText(fr.site.accountActive)).toBeVisible()
    // A refusal changed nothing, so nothing is read again.
    expect(api.siteAccounts).toHaveBeenCalledTimes(1)
  })
})

describe('the console’s accounts: while an act is running', () => {
  it('lets no other button of the row fire until the act has answered', async () => {
    let answer: () => void = () => undefined
    const siteDisableAccount = vi.fn<Api['siteDisableAccount']>(
      () => new Promise<void>((resolve) => (answer = resolve)),
    )
    open(withAccounts([aSiteAccount()], { siteDisableAccount }))
    await screen.findByRole('table')

    await press(fr.site.disableAccount)
    await confirmDialog(fr.site.disableTitle(ADDRESS), fr.site.disableAccount)

    await waitFor(() => expect(siteDisableAccount).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: fr.site.resetPassword })).toBeDisabled()
    expect(screen.getByRole('button', { name: fr.site.deleteAccount })).toBeDisabled()
    // Two buttons carry this name while the question is still open: the row's and the question's.
    for (const button of screen.getAllByRole('button', { name: fr.site.disableAccount })) {
      expect(button).toBeDisabled()
    }

    answer()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: fr.site.deleteAccount })).toBeEnabled(),
    )
  })

  it('puts the account’s address in the question, so an erasure rests on what is read', async () => {
    open(
      withAccounts([aSiteAccount(), aSiteAccount({ id: OPERATOR_ID, email: 'sacha@example.com' })]),
    )
    await screen.findByRole('table')

    await userEvent.click(
      within(screen.getByRole('row', { name: /sacha@example.com/ })).getByRole('button', {
        name: fr.site.deleteAccount,
      }),
    )

    expect(
      await screen.findByRole('dialog', { name: fr.site.deleteTitle('sacha@example.com') }),
    ).toBeVisible()
  })
})

describe('the console’s accounts: switching one back on', () => {
  it('switches it on without a question, says so, and reads the accounts again', async () => {
    const siteAccounts = vi
      .fn<Api['siteAccounts']>()
      .mockResolvedValueOnce({
        items: [aSiteAccount({ disabledAt: SWITCHED_OFF_AT })],
        next: null,
      })
      .mockResolvedValue({ items: [aSiteAccount()], next: null })
    const api = withAccounts([], { siteAccounts })
    open(api)
    await screen.findByRole('table')

    await press(fr.site.enableAccount)

    await waitFor(() => expect(api.siteEnableAccount).toHaveBeenCalledWith(ACCOUNT_ID))
    expect(await screen.findByText(fr.site.accountEnabledDone)).toBeVisible()
    expect(await screen.findByRole('button', { name: fr.site.disableAccount })).toBeVisible()
  })

  it('asks the operator to confirm themselves when the server says so, and switches on on that confirmation', async () => {
    const siteEnableAccount = vi
      .fn<Api['siteEnableAccount']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue(undefined)
    open(withAccounts([aSiteAccount({ disabledAt: SWITCHED_OFF_AT })], { siteEnableAccount }))
    await screen.findByRole('table')

    await press(fr.site.enableAccount)
    const prompt = await screen.findByRole('dialog', { name: fr.site.stepUpTitle })
    await userEvent.type(within(prompt).getByLabelText(fr.auth.password), 'le mot de passe')
    await userEvent.type(within(prompt).getByLabelText(fr.auth.secondFactorCode), '123456')
    await userEvent.click(within(prompt).getByRole('button', { name: fr.auth.stepUpSubmit }))

    expect(await screen.findByText(fr.site.accountEnabledDone)).toBeVisible()
    expect(siteEnableAccount).toHaveBeenCalledTimes(2)
  })

  it('says what the server said when it refuses, and leaves the account off', async () => {
    const siteEnableAccount = vi
      .fn<Api['siteEnableAccount']>()
      .mockRejectedValue(new ApiError(404, 'user.notFound'))
    open(withAccounts([aSiteAccount({ disabledAt: SWITCHED_OFF_AT })], { siteEnableAccount }))
    await screen.findByRole('table')

    await press(fr.site.enableAccount)

    expect(await screen.findByText(fr.errors['user.notFound'])).toBeVisible()
    expect(screen.getByText(fr.site.accountDisabled)).toBeVisible()
  })
})

describe('the console’s accounts: deleting one', () => {
  it('says that it answers an erasure request, and that it cannot be undone, and sends nothing when declined', async () => {
    const api = withAccounts([aSiteAccount()])
    open(api)
    await screen.findByRole('table')

    await press(fr.site.deleteAccount)
    const dialog = await screen.findByRole('dialog', { name: fr.site.deleteTitle(ADDRESS) })
    expect(dialog).toHaveAccessibleDescription(fr.site.deleteBody)
    await userEvent.click(within(dialog).getByRole('button', { name: fr.app.cancel }))

    expect(api.siteDeleteAccount).not.toHaveBeenCalled()
  })

  it('deletes the account on a confirmation, says so, and reads the accounts again without it', async () => {
    const siteAccounts = vi
      .fn<Api['siteAccounts']>()
      .mockResolvedValueOnce({ items: [aSiteAccount()], next: null })
      .mockResolvedValue({ items: [], next: null })
    const api = withAccounts([], { siteAccounts })
    open(api)
    await screen.findByRole('table')

    await press(fr.site.deleteAccount)
    await confirmDialog(fr.site.deleteTitle(ADDRESS), fr.site.deleteAccount)

    await waitFor(() => expect(api.siteDeleteAccount).toHaveBeenCalledWith(ACCOUNT_ID))
    expect(await screen.findByText(fr.site.accountDeletedDone)).toBeVisible()
    expect(await screen.findByRole('heading', { name: fr.site.accountsEmpty })).toBeVisible()
  })

  it.each([
    'account.holdsEvents',
    'account.holdsMedia',
    'account.holdsReviews',
    'account.lastClientOwner',
    'account.operatorProtected',
  ] as const)(
    'says what the server said when it refuses with %s, and keeps the account',
    async (code) => {
      const siteDeleteAccount = vi
        .fn<Api['siteDeleteAccount']>()
        .mockRejectedValue(new ApiError(code === 'account.operatorProtected' ? 403 : 409, code))
      const api = withAccounts([aSiteAccount()], { siteDeleteAccount })
      open(api)
      await screen.findByRole('table')

      await press(fr.site.deleteAccount)
      await confirmDialog(fr.site.deleteTitle(ADDRESS), fr.site.deleteAccount)

      expect(await screen.findByText(fr.errors[code])).toBeVisible()
      expect(screen.getByRole('rowheader', { name: 'camille@example.com' })).toBeVisible()
      expect(api.siteAccounts).toHaveBeenCalledTimes(1)
    },
  )

  it('shows the newest refusal and takes the earlier one off the screen', async () => {
    // A refusal stays until it is dismissed, because one of them carries a thing to do. That
    // is what made two refused deletes in a row read as two problems, the first about an
    // account the operator has already moved on from.
    const siteDeleteAccount = vi
      .fn<Api['siteDeleteAccount']>()
      .mockRejectedValueOnce(new ApiError(409, 'account.holdsEvents'))
      .mockRejectedValueOnce(new ApiError(409, 'account.holdsReviews'))
    const second = aSiteAccount({ id: 'user-second', email: 'moderatrice@example.com' })
    open(withAccounts([aSiteAccount(), second], { siteDeleteAccount }))
    await screen.findByRole('table')

    await userEvent.click(screen.getAllByRole('button', { name: fr.site.deleteAccount })[0]!)
    await confirmDialog(fr.site.deleteTitle(ADDRESS), fr.site.deleteAccount)
    expect(await screen.findByText(fr.errors['account.holdsEvents'])).toBeVisible()

    await userEvent.click(screen.getAllByRole('button', { name: fr.site.deleteAccount })[1]!)
    await confirmDialog(fr.site.deleteTitle('moderatrice@example.com'), fr.site.deleteAccount)

    expect(await screen.findByText(fr.errors['account.holdsReviews'])).toBeVisible()
    expect(screen.queryByText(fr.errors['account.holdsEvents'])).toBeNull()
  })

  it('shows the newest refusal of a switch-off over an earlier refusal of a deletion', async () => {
    // The same rule across the four acts the page offers, because the toast is shared.
    const siteDeleteAccount = vi
      .fn<Api['siteDeleteAccount']>()
      .mockRejectedValue(new ApiError(409, 'account.holdsEvents'))
    const siteDisableAccount = vi
      .fn<Api['siteDisableAccount']>()
      .mockRejectedValue(new ApiError(403, 'account.operatorProtected'))
    open(withAccounts([aSiteAccount()], { siteDeleteAccount, siteDisableAccount }))
    await screen.findByRole('table')

    await press(fr.site.deleteAccount)
    await confirmDialog(fr.site.deleteTitle(ADDRESS), fr.site.deleteAccount)
    expect(await screen.findByText(fr.errors['account.holdsEvents'])).toBeVisible()
    await press(fr.site.disableAccount)
    await confirmDialog(fr.site.disableTitle(ADDRESS), fr.site.disableAccount)

    expect(await screen.findByText(fr.errors['account.operatorProtected'])).toBeVisible()
    expect(screen.queryByText(fr.errors['account.holdsEvents'])).toBeNull()
  })

  it('asks the operator to confirm themselves when the server says so, and deletes on that confirmation', async () => {
    const siteDeleteAccount = vi
      .fn<Api['siteDeleteAccount']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue(undefined)
    open(withAccounts([aSiteAccount()], { siteDeleteAccount }))
    await screen.findByRole('table')

    await press(fr.site.deleteAccount)
    await confirmDialog(fr.site.deleteTitle(ADDRESS), fr.site.deleteAccount)
    const prompt = await screen.findByRole('dialog', { name: fr.site.stepUpTitle })
    await userEvent.type(within(prompt).getByLabelText(fr.auth.password), 'le mot de passe')
    await userEvent.type(within(prompt).getByLabelText(fr.auth.secondFactorCode), '123456')
    await userEvent.click(within(prompt).getByRole('button', { name: fr.auth.stepUpSubmit }))

    expect(await screen.findByText(fr.site.accountDeletedDone)).toBeVisible()
    expect(siteDeleteAccount).toHaveBeenCalledTimes(2)
  })

  it('sends nothing when the operator walks away from the prompt, and does not scold', async () => {
    const siteDeleteAccount = vi.fn<Api['siteDeleteAccount']>().mockRejectedValue(stepUpRequired())
    open(withAccounts([aSiteAccount()], { siteDeleteAccount }))
    await screen.findByRole('table')

    await press(fr.site.deleteAccount)
    await confirmDialog(fr.site.deleteTitle(ADDRESS), fr.site.deleteAccount)
    const prompt = await screen.findByRole('dialog', { name: fr.site.stepUpTitle })
    await userEvent.click(within(prompt).getByRole('button', { name: fr.app.cancel }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(siteDeleteAccount).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(fr.errors['auth.stepUpRequired'])).toBeNull()
    expect(screen.queryByText(fr.site.accountDeletedDone)).toBeNull()
  })
})
