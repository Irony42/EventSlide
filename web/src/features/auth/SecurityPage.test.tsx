import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import type { SecondFactorStatusDto, SessionResponse } from '../../lib/api/dto'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aSessionUser, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import { SecurityPage } from './SecurityPage'

const status = (overrides: Partial<SecondFactorStatusDto> = {}): SecondFactorStatusDto => ({
  available: true,
  enrolled: false,
  verified: false,
  required: false,
  ...overrides,
})

const signedIn = (secondFactor: SecondFactorStatusDto): SessionResponse => ({
  authenticated: true,
  user: aSessionUser({ canOperateSite: true, secondFactor }),
})

const render = (api: Api) => renderWithProviders(<SecurityPage />, { api })

const CODE = 'K7QM-2XTR-9PHD-4VNB'

describe('SecurityPage', () => {
  it('says so, and offers nothing, on a box with no key', async () => {
    render(fakeApi({ session: vi.fn(async () => signedIn(status({ available: false }))) }))

    expect(await screen.findByText(fr.auth.securityUnavailable)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.auth.setupStart })).toBeNull()
  })

  it('waits for the session instead of guessing which state the account is in', () => {
    render(fakeApi({ session: vi.fn(() => new Promise<SessionResponse>(() => {})) }))

    expect(screen.queryByRole('button', { name: fr.auth.setupStart })).toBeNull()
    expect(screen.queryByText(fr.auth.securityUnavailable)).toBeNull()
  })

  describe('enrolling', () => {
    const enrolling = (overrides: Partial<Api> = {}) =>
      fakeApi({ session: vi.fn(async () => signedIn(status())), ...overrides })

    const start = async (password = 'un-mot-de-passe-long') => {
      await userEvent.type(await screen.findByLabelText(fr.auth.password), password)
      await userEvent.click(screen.getByRole('button', { name: fr.auth.setupStart }))
    }

    it('asks for the password first, and sends it to start', async () => {
      const api = enrolling()
      render(api)

      await start()

      expect(api.enrollSecondFactor).toHaveBeenCalledWith('un-mot-de-passe-long')
    })

    it('draws the secret as a QR code and as a key to type, and never writes the URI as text', async () => {
      render(enrolling())

      await start()

      const qr = await screen.findByRole('img', { name: fr.auth.setupQrLabel })
      expect(qr.querySelector('svg')).not.toBeNull()
      expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeVisible()
      expect(document.body.textContent).not.toContain('otpauth://')
    })

    it('says the password is wrong and stays on the first step', async () => {
      render(
        enrolling({
          enrollSecondFactor: vi.fn(() =>
            Promise.reject(new ApiError(401, 'auth.invalidCredentials')),
          ),
        }),
      )

      await start('mauvais')

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(fr.auth.passwordIncorrect)
      expect(alert).not.toHaveTextContent(fr.errors['auth.invalidCredentials'])
      expect(screen.queryByRole('img', { name: fr.auth.setupQrLabel })).toBeNull()
    })

    it('confirms with the app’s code and shows the recovery codes until they are saved', async () => {
      const api = enrolling({
        confirmSecondFactor: vi.fn(async () => ({ recoveryCodes: [CODE, 'ABCD-EFGH-JKMN-PQRS'] })),
      })
      render(api)
      await start()

      await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '123456')
      await userEvent.click(screen.getByRole('button', { name: fr.auth.setupConfirm }))

      expect(api.confirmSecondFactor).toHaveBeenCalledWith('123456')
      const list = await screen.findByRole('list')
      expect(within(list).getByText(CODE)).toBeVisible()
      expect(within(list).getByText('ABCD-EFGH-JKMN-PQRS')).toBeVisible()
      expect(screen.getByText(fr.auth.recoveryCodesIntro)).toBeVisible()
      // The section is named by its own heading, so a screen reader announces where it is.
      expect(screen.getByRole('region', { name: fr.auth.recoveryCodesTitle })).toBeVisible()
    })

    it('keeps the codes on screen across a refresh of the session, and clears them only when saved', async () => {
      const api = enrolling()
      render(api)
      await start()
      await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '123456')
      await userEvent.click(screen.getByRole('button', { name: fr.auth.setupConfirm }))
      await screen.findByText(CODE)

      vi.mocked(api.session).mockResolvedValue(signedIn(status({ enrolled: true, verified: true })))
      await userEvent.click(screen.getByRole('button', { name: fr.auth.recoveryCodesSaved }))

      expect(screen.queryByText(CODE)).toBeNull()
      expect(await screen.findByLabelText(fr.auth.password)).toBeVisible()
      expect(screen.getByText(new RegExp(fr.auth.securityEnabled))).toBeVisible()
    })

    it('says the code is wrong and keeps the QR code so the person can try again', async () => {
      render(
        enrolling({
          confirmSecondFactor: vi.fn(() =>
            Promise.reject(new ApiError(401, 'auth.invalidSecondFactor')),
          ),
        }),
      )
      await start()

      await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '000000')
      await userEvent.click(screen.getByRole('button', { name: fr.auth.setupConfirm }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        fr.errors['auth.invalidSecondFactor'],
      )
      expect(screen.getByRole('img', { name: fr.auth.setupQrLabel })).toBeVisible()
    })

    it('copies the codes to the clipboard when asked', async () => {
      const writeText = vi.fn(async () => undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      render(enrolling())
      await start()
      await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '123456')
      await userEvent.click(screen.getByRole('button', { name: fr.auth.setupConfirm }))
      await screen.findByText(CODE)

      await userEvent.click(screen.getByRole('button', { name: fr.auth.recoveryCodesCopy }))

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE))
    })
  })

  describe('an account that has an authenticator', () => {
    const enrolled = (overrides: Partial<Api> = {}) =>
      fakeApi({
        session: vi.fn(async () => signedIn(status({ enrolled: true, verified: true }))),
        ...overrides,
      })

    const stepUp = async (code = '123456') => {
      await userEvent.type(await screen.findByLabelText(fr.auth.password), 'un-mot-de-passe-long')
      await userEvent.type(screen.getByLabelText(fr.auth.secondFactorCode), code)
      await userEvent.click(screen.getByRole('button', { name: fr.auth.stepUpSubmit }))
    }

    it('keeps the actions behind a step-up, and offers none before it', async () => {
      render(enrolled())

      expect(await screen.findByLabelText(fr.auth.password)).toBeVisible()
      expect(screen.queryByRole('button', { name: fr.auth.recoveryCodesRegenerate })).toBeNull()
      expect(screen.queryByRole('button', { name: fr.auth.secondFactorDisable })).toBeNull()
    })

    it('sends the password and the code to confirm, then offers the two actions', async () => {
      const api = enrolled()
      render(api)

      await stepUp()

      expect(api.stepUp).toHaveBeenCalledWith('un-mot-de-passe-long', { code: '123456' })
      expect(
        await screen.findByRole('button', { name: fr.auth.recoveryCodesRegenerate }),
      ).toBeVisible()
      expect(screen.getByRole('button', { name: fr.auth.secondFactorDisable })).toBeVisible()
      expect(screen.getByRole('region', { name: fr.auth.securityTitle })).toBeVisible()
    })

    it('confirms with a recovery code instead when the phone is gone', async () => {
      const api = enrolled()
      render(api)
      await userEvent.type(await screen.findByLabelText(fr.auth.password), 'un-mot-de-passe-long')
      await userEvent.click(
        screen.getByRole('button', { name: fr.auth.secondFactorRecoveryToggle }),
      )

      await userEvent.type(screen.getByLabelText(fr.auth.recoveryCode), CODE)
      await userEvent.click(screen.getByRole('button', { name: fr.auth.stepUpSubmit }))

      expect(api.stepUp).toHaveBeenCalledWith('un-mot-de-passe-long', { recoveryCode: CODE })
    })

    it('stays on the step-up, with the sentence, when the code is wrong', async () => {
      const api = enrolled({
        stepUp: vi.fn(() => Promise.reject(new ApiError(401, 'auth.invalidSecondFactor'))),
      })
      render(api)

      await stepUp('000000')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        fr.errors['auth.invalidSecondFactor'],
      )
      expect(screen.queryByRole('button', { name: fr.auth.secondFactorDisable })).toBeNull()
    })

    it('shows new recovery codes once the step-up is done', async () => {
      const api = enrolled({
        regenerateRecoveryCodes: vi.fn(async () => ({ recoveryCodes: ['WXYZ-2345-6789-ABCD'] })),
      })
      render(api)
      await stepUp()

      await userEvent.click(
        await screen.findByRole('button', { name: fr.auth.recoveryCodesRegenerate }),
      )

      expect(api.regenerateRecoveryCodes).toHaveBeenCalledOnce()
      expect(await screen.findByText('WXYZ-2345-6789-ABCD')).toBeVisible()
    })

    it('switches the authenticator off and asks the session again', async () => {
      const api = enrolled()
      render(api)
      await stepUp()
      const calls = vi.mocked(api.session).mock.calls.length
      vi.mocked(api.session).mockResolvedValue(signedIn(status({ enrolled: false })))

      await userEvent.click(
        await screen.findByRole('button', { name: fr.auth.secondFactorDisable }),
      )

      expect(api.disableSecondFactor).toHaveBeenCalledOnce()
      await waitFor(() => expect(vi.mocked(api.session).mock.calls.length).toBeGreaterThan(calls))
      expect(await screen.findByRole('button', { name: fr.auth.setupStart })).toBeVisible()
    })

    it('tells the person their step-up has run out when the server refuses the action', async () => {
      const api = enrolled({
        disableSecondFactor: vi.fn(() => Promise.reject(new ApiError(403, 'auth.stepUpRequired'))),
      })
      render(api)
      await stepUp()

      await userEvent.click(
        await screen.findByRole('button', { name: fr.auth.secondFactorDisable }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['auth.stepUpRequired'])
    })

    it('brings the confirmation form back when it ran out, so the person is not left on a page that refuses everything', async () => {
      const api = enrolled({
        regenerateRecoveryCodes: vi
          .fn()
          .mockRejectedValueOnce(new ApiError(403, 'auth.stepUpRequired')),
      })
      render(api)
      await stepUp()

      await userEvent.click(
        await screen.findByRole('button', { name: fr.auth.recoveryCodesRegenerate }),
      )

      expect(await screen.findByLabelText(fr.auth.password)).toBeVisible()
      expect(screen.getByRole('alert')).toHaveTextContent(fr.errors['auth.stepUpRequired'])
      expect(screen.queryByRole('button', { name: fr.auth.secondFactorDisable })).toBeNull()
    })

    it('forgets the lapse once the person has confirmed again', async () => {
      const api = enrolled({
        regenerateRecoveryCodes: vi
          .fn()
          .mockRejectedValueOnce(new ApiError(403, 'auth.stepUpRequired')),
      })
      render(api)
      await stepUp()
      await userEvent.click(
        await screen.findByRole('button', { name: fr.auth.recoveryCodesRegenerate }),
      )
      await screen.findByRole('alert')

      await userEvent.clear(screen.getByLabelText(fr.auth.password))
      await stepUp()

      expect(
        await screen.findByRole('button', { name: fr.auth.recoveryCodesRegenerate }),
      ).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
})

/**
 * Navigation pass, batch D (H7, H8): the page leads back, finishing the enrolment returns the
 * person to where they were, and the recovery codes are not lost by leaving.
 */
describe('SecurityPage: coming and going', () => {
  const ELSEWHERE = 'Ailleurs'
  const AUDIT = 'Journal'

  /** The page entered with a `from`, as the account menu and the console's gate enter it. */
  const enter = (api: Api, state?: unknown) =>
    renderWithProviders(
      <Routes>
        <Route path="/depart" element={<Navigate to="/admin/security" replace state={state} />} />
        <Route
          path="/admin/security"
          element={
            <>
              <SecurityPage />
              <Link to="/admin/elsewhere">{ELSEWHERE}</Link>
            </>
          }
        />
        <Route path="/admin/site/audit" element={<p>{AUDIT}</p>} />
        <Route path="/admin/elsewhere" element={<p>{ELSEWHERE} atteint</p>} />
        <Route path="/admin" element={<p>Tableau de bord</p>} />
      </Routes>,
      { api, route: '/depart' },
    )

  /** An account that enrols, and is enrolled from the moment the code is accepted. */
  const enrolling = (overrides: Partial<Api> = {}) => {
    let enrolled = false
    return fakeApi({
      session: vi.fn(async () => signedIn(status({ enrolled }))),
      confirmSecondFactor: vi.fn(async () => {
        enrolled = true
        return { recoveryCodes: [CODE] }
      }),
      ...overrides,
    })
  }

  const enrol = async () => {
    await userEvent.type(await screen.findByLabelText(fr.auth.password), 'un-mot-de-passe-long')
    await userEvent.click(screen.getByRole('button', { name: fr.auth.setupStart }))
    await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '123456')
    await userEvent.click(screen.getByRole('button', { name: fr.auth.setupConfirm }))
    await screen.findByText(CODE)
  }

  const prompt = () => screen.findByRole('dialog', { name: fr.auth.recoveryCodesLeaveTitle })

  describe('the way back', () => {
    it('leads to the page the person came from', async () => {
      enter(enrolling(), { from: '/admin/site/audit?clientId=c-1' })

      expect(await screen.findByRole('link', { name: fr.auth.securityBack })).toHaveAttribute(
        'href',
        '/admin/site/audit?clientId=c-1',
      )
    })

    it('leads to the list of events when the address was typed', async () => {
      enter(enrolling())

      expect(await screen.findByRole('link', { name: fr.auth.securityBack })).toHaveAttribute(
        'href',
        '/admin',
      )
    })

    it('is there on a box with no key as well, where the page is a dead end otherwise', async () => {
      enter(fakeApi({ session: vi.fn(async () => signedIn(status({ available: false }))) }))

      expect(await screen.findByRole('link', { name: fr.auth.securityBack })).toBeVisible()
    })
  })

  describe('finishing the enrolment', () => {
    it('takes the person back to the page they were sent from, once the codes are noted', async () => {
      enter(enrolling(), { from: '/admin/site/audit?clientId=c-1' })
      await enrol()

      await userEvent.click(screen.getByRole('button', { name: fr.auth.recoveryCodesSaved }))

      expect(await screen.findByText(AUDIT)).toBeVisible()
    })

    it('leaves them on the page, now showing their authenticator, when no page sent them', async () => {
      enter(enrolling())
      await enrol()

      await userEvent.click(screen.getByRole('button', { name: fr.auth.recoveryCodesSaved }))

      expect(await screen.findByText(fr.auth.securityEnabled, { exact: false })).toBeVisible()
      expect(screen.queryByText(AUDIT)).toBeNull()
    })

    it('does not send anybody away after renewing the codes of an account that already has them', async () => {
      const api = fakeApi({
        session: vi.fn(async () => signedIn(status({ enrolled: true, verified: true }))),
      })
      enter(api, { from: '/admin/site/audit' })
      await userEvent.type(await screen.findByLabelText(fr.auth.password), 'un-mot-de-passe-long')
      await userEvent.type(screen.getByLabelText(fr.auth.secondFactorCode), '123456')
      await userEvent.click(screen.getByRole('button', { name: fr.auth.stepUpSubmit }))
      await userEvent.click(
        await screen.findByRole('button', { name: fr.auth.recoveryCodesRegenerate }),
      )
      await screen.findByText(CODE)

      await userEvent.click(screen.getByRole('button', { name: fr.auth.recoveryCodesSaved }))

      // Still on the page: its own confirmation is asked again, which is how it has always ended.
      expect(await screen.findByRole('button', { name: fr.auth.stepUpSubmit })).toBeVisible()
      expect(screen.queryByText(AUDIT)).toBeNull()
    })
  })

  describe('leaving while the codes are on screen', () => {
    it('asks before following a link inside the app, and says what is lost', async () => {
      enter(enrolling())
      await enrol()

      await userEvent.click(screen.getByRole('link', { name: ELSEWHERE }))

      const dialog = await prompt()
      expect(within(dialog).getByText(fr.auth.recoveryCodesLeaveHint)).toBeVisible()
      expect(screen.queryByText(`${ELSEWHERE} atteint`)).toBeNull()
    })

    it('keeps the codes, and the page, when the person stays', async () => {
      enter(enrolling())
      await enrol()
      await userEvent.click(screen.getByRole('link', { name: ELSEWHERE }))

      await userEvent.click(
        within(await prompt()).getByRole('button', { name: fr.auth.recoveryCodesLeaveStay }),
      )

      expect(screen.getByText(CODE)).toBeVisible()
      expect(screen.queryByText(`${ELSEWHERE} atteint`)).toBeNull()
    })

    it('goes where the link led when the person leaves anyway', async () => {
      enter(enrolling())
      await enrol()
      await userEvent.click(screen.getByRole('link', { name: ELSEWHERE }))

      await userEvent.click(
        within(await prompt()).getByRole('button', { name: fr.auth.recoveryCodesLeaveGo }),
      )

      expect(await screen.findByText(`${ELSEWHERE} atteint`)).toBeVisible()
    })

    it('asks nothing once the codes are noted', async () => {
      enter(enrolling())
      await enrol()
      await userEvent.click(screen.getByRole('button', { name: fr.auth.recoveryCodesSaved }))

      await userEvent.click(await screen.findByRole('link', { name: ELSEWHERE }))

      expect(await screen.findByText(`${ELSEWHERE} atteint`)).toBeVisible()
    })

    it('asks nothing before the codes exist', async () => {
      enter(enrolling())

      await userEvent.click(await screen.findByRole('link', { name: ELSEWHERE }))

      expect(await screen.findByText(`${ELSEWHERE} atteint`)).toBeVisible()
    })

    it('has the browser ask as well when the tab is closed or reloaded', async () => {
      enter(enrolling())
      await enrol()

      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
    })

    it('does not have the browser ask once the codes are noted', async () => {
      enter(enrolling())
      await enrol()
      await userEvent.click(screen.getByRole('button', { name: fr.auth.recoveryCodesSaved }))
      await screen.findByText(fr.auth.securityEnabled, { exact: false })

      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(false)
    })
  })
})
