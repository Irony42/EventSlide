import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import { SecondFactorPage } from './SecondFactorPage'

const render = (
  api: Api,
  handlers: { onSignedIn?: () => void; onRestart?: (r: string | null) => void } = {},
) =>
  renderWithProviders(
    <SecondFactorPage
      onSignedIn={handlers.onSignedIn ?? vi.fn()}
      onRestart={handlers.onRestart ?? vi.fn()}
    />,
    { api },
  )

const submit = () =>
  userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorSubmit }))

describe('SecondFactorPage', () => {
  it('sends the six digits and hands the sign-in back to the page that asked', async () => {
    const api = fakeApi()
    const onSignedIn = vi.fn()
    render(api, { onSignedIn })

    await userEvent.type(screen.getByLabelText(fr.auth.secondFactorCode), '123456')
    await submit()

    expect(api.loginSecondFactor).toHaveBeenCalledWith({ code: '123456' })
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce())
  })

  it('trims what was pasted around the code', async () => {
    const api = fakeApi()
    render(api)

    await userEvent.type(screen.getByLabelText(fr.auth.secondFactorCode), '  654321 ')
    await submit()

    expect(api.loginSecondFactor).toHaveBeenCalledWith({ code: '654321' })
  })

  it('asks for the code in the way a phone and a password manager understand', () => {
    render(fakeApi())

    const input = screen.getByLabelText(fr.auth.secondFactorCode)
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
    expect(input).toHaveAttribute('inputmode', 'numeric')
  })

  it('switches to a recovery code on request, and sends it as one', async () => {
    const api = fakeApi()
    render(api)

    await userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorRecoveryToggle }))
    const input = screen.getByLabelText(fr.auth.recoveryCode)
    expect(input).toHaveAttribute('autocomplete', 'off')
    await userEvent.type(input, 'K7QM-2XTR-9PHD-4VNB')
    await submit()

    expect(api.loginSecondFactor).toHaveBeenCalledWith({ recoveryCode: 'K7QM-2XTR-9PHD-4VNB' })
  })

  it('switches back to the app’s code, and forgets what was typed for the other', async () => {
    render(fakeApi())
    await userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorRecoveryToggle }))
    await userEvent.type(screen.getByLabelText(fr.auth.recoveryCode), 'K7QM')

    await userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorAppToggle }))

    expect(screen.getByLabelText(fr.auth.secondFactorCode)).toHaveValue('')
  })

  it('says a wrong code is wrong, keeps it in the box, and stays on the step', async () => {
    const api = fakeApi({
      loginSecondFactor: vi.fn(async () => {
        throw new ApiError(401, 'auth.invalidSecondFactor')
      }),
    })
    const onRestart = vi.fn()
    render(api, { onRestart })

    await userEvent.type(screen.getByLabelText(fr.auth.secondFactorCode), '000000')
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.errors['auth.invalidSecondFactor'],
    )
    expect(screen.getByLabelText(fr.auth.secondFactorCode)).toHaveValue('000000')
    expect(onRestart).not.toHaveBeenCalled()
  })

  it('sends the person back to the password with the sentence when the sign-in is over', async () => {
    const api = fakeApi({
      loginSecondFactor: vi.fn(async () => {
        throw new ApiError(401, 'auth.secondFactorExpired')
      }),
    })
    const onRestart = vi.fn()
    render(api, { onRestart })

    await userEvent.type(screen.getByLabelText(fr.auth.secondFactorCode), '000000')
    await submit()

    await waitFor(() =>
      expect(onRestart).toHaveBeenCalledWith(fr.errors['auth.secondFactorExpired']),
    )
  })

  it('stays on the step when the account has spent its budget: the sign-in is not over, and retyping the password would only cost a hash', async () => {
    const api = fakeApi({
      loginSecondFactor: vi.fn(async () => {
        throw new ApiError(429, 'auth.tooManySecondFactorAttempts')
      }),
    })
    const onRestart = vi.fn()
    render(api, { onRestart })

    await userEvent.type(screen.getByLabelText(fr.auth.secondFactorCode), '000000')
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.errors['auth.tooManySecondFactorAttempts'],
    )
    expect(onRestart).not.toHaveBeenCalled()
  })

  it('lets the person start again from the password on purpose, with no reason given', async () => {
    const onRestart = vi.fn()
    render(fakeApi(), { onRestart })

    await userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorRestart }))

    expect(onRestart).toHaveBeenCalledWith(null)
  })
})
