import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import { ApiError } from '../../lib/http'
import type { Api } from '../../lib/api/client'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { notTheOperator, operatorSession, stepUpRequired } from '../../testing/siteConsole'
import { useOperatorAction, type OperatorResult } from './hooks/useOperatorAction'
import { StepUpProvider } from './StepUpProvider'

/**
 * The confirmation every write of the operator's console can be asked for.
 *
 * Every `/api/site` route that changes something answers `403 auth.stepUpRequired` unless the
 * session confirmed the person in the last five minutes, and answers it **before the body is
 * read**, so a refused write has done nothing and is safe to send again. What the console owes is
 * the other half: ask, and carry on with the very write that was refused, once, on a confirmation
 * and on nothing else.
 */

/** A button that runs the write it is given and prints how it came out. */
function Write({
  label,
  action,
}: {
  readonly label: string
  readonly action: () => Promise<string>
}) {
  const operator = useOperatorAction(action)
  const [result, setResult] = useState<OperatorResult<string> | null>(null)
  return (
    <>
      <button type="button" onClick={() => void operator.run(label).then(setResult)}>
        {label}
      </button>
      <output aria-label={`${label} result`}>
        {result === null
          ? 'waiting'
          : result.ok
            ? `ok:${result.value}`
            : `refused:${result.message ?? 'cancelled'}`}
      </output>
    </>
  )
}

const aWrite = (...answers: readonly (string | Error)[]) => {
  const queue = [...answers]
  return vi.fn(async () => {
    const next = queue.shift() ?? 'done'
    if (next instanceof Error) throw next
    return next
  })
}

const mount = (
  writes: readonly { readonly label: string; readonly action: () => Promise<string> }[],
  options: { readonly enrolled?: boolean; readonly stepUp?: Api['stepUp'] } = {},
) => {
  const enrolled = options.enrolled ?? true
  const api = fakeApi({
    session: vi.fn(async () =>
      operatorSession({
        secondFactor: { available: true, enrolled, verified: true, required: true },
      }),
    ),
    ...(options.stepUp === undefined ? {} : { stepUp: options.stepUp }),
  })
  renderWithProviders(
    <StepUpProvider>
      {writes.map((write) => (
        <Write key={write.label} {...write} />
      ))}
    </StepUpProvider>,
    { api },
  )
  return api
}

const prompt = () => screen.findByRole('dialog', { name: fr.site.stepUpTitle })

const confirmWith = async (code: string) => {
  const dialog = await prompt()
  await userEvent.type(within(dialog).getByLabelText(fr.auth.password), 'le mot de passe')
  await userEvent.type(within(dialog).getByLabelText(fr.auth.secondFactorCode), code)
  await userEvent.click(within(dialog).getByRole('button', { name: fr.auth.stepUpSubmit }))
}

describe('a write of the operator’s console that needs a confirmation', () => {
  it('is sent once, with no prompt, when the session has confirmed the person already', async () => {
    const save = aWrite('saved')
    mount([{ label: 'save', action: save }])

    await userEvent.click(screen.getByRole('button', { name: 'save' }))

    expect(await screen.findByText('ok:saved')).toBeVisible()
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks for the password and the code, and sends the same write again once they are taken', async () => {
    const save = aWrite(stepUpRequired(), 'saved')
    const api = mount([{ label: 'save', action: save }])

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    await confirmWith('123456')

    expect(await screen.findByText('ok:saved')).toBeVisible()
    expect(api.stepUp).toHaveBeenCalledWith('le mot de passe', { code: '123456' })
    expect(save).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog', { name: fr.site.stepUpTitle })).toBeNull()
  })

  it('does not send the write again before the person has confirmed', async () => {
    const save = aWrite(stepUpRequired(), 'saved')
    mount([{ label: 'save', action: save }])

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    await prompt()

    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByText('waiting')).toBeVisible()
  })

  it('asks an account with no authenticator for its password alone', async () => {
    const save = aWrite(stepUpRequired(), 'saved')
    const api = mount([{ label: 'save', action: save }], { enrolled: false })

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    const dialog = await prompt()
    expect(within(dialog).queryByLabelText(fr.auth.secondFactorCode)).toBeNull()
    await userEvent.type(within(dialog).getByLabelText(fr.auth.password), 'le mot de passe')
    await userEvent.click(within(dialog).getByRole('button', { name: fr.auth.stepUpSubmit }))

    expect(await screen.findByText('ok:saved')).toBeVisible()
    expect(api.stepUp).toHaveBeenCalledWith('le mot de passe', undefined)
  })

  it('takes a recovery code in place of the app’s code, behind a toggle', async () => {
    const save = aWrite(stepUpRequired(), 'saved')
    const api = mount([{ label: 'save', action: save }])

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    const dialog = await prompt()
    await userEvent.type(within(dialog).getByLabelText(fr.auth.password), 'le mot de passe')
    await userEvent.click(
      within(dialog).getByRole('button', { name: fr.auth.secondFactorRecoveryToggle }),
    )
    await userEvent.type(within(dialog).getByLabelText(fr.auth.recoveryCode), 'K7QM-2XTR-9PHD-4VNB')
    await userEvent.click(within(dialog).getByRole('button', { name: fr.auth.stepUpSubmit }))

    expect(await screen.findByText('ok:saved')).toBeVisible()
    expect(api.stepUp).toHaveBeenCalledWith('le mot de passe', {
      recoveryCode: 'K7QM-2XTR-9PHD-4VNB',
    })
  })

  it('does not send the write when the person gives up, and says nothing about it', async () => {
    const save = aWrite(stepUpRequired(), 'saved')
    const api = mount([{ label: 'save', action: save }])

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    const dialog = await prompt()
    await userEvent.click(within(dialog).getByRole('button', { name: fr.app.cancel }))

    expect(await screen.findByText('refused:cancelled')).toBeVisible()
    expect(save).toHaveBeenCalledTimes(1)
    expect(api.stepUp).not.toHaveBeenCalled()
  })

  it('sends nothing, and thanks nobody, when the person gives up while the server is still answering', async () => {
    const save = aWrite(stepUpRequired(), 'saved')
    let answer: () => void = () => undefined
    const stepUp = vi.fn<Api['stepUp']>(() => new Promise<void>((resolve) => (answer = resolve)))
    mount([{ label: 'save', action: save }], { stepUp })

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    await confirmWith('123456')
    const dialog = await prompt()
    await userEvent.click(within(dialog).getByRole('button', { name: fr.app.cancel }))
    expect(await screen.findByText('refused:cancelled')).toBeVisible()

    answer()

    await waitFor(() => expect(stepUp).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(fr.auth.stepUpDone)).toBeNull()
  })

  it('says the password is wrong, not the address or the password, when the prompt refuses it', async () => {
    // The prompt has no address field: it is the person already signed in confirming themselves.
    const save = aWrite(stepUpRequired(), 'saved')
    const stepUp = vi
      .fn<Api['stepUp']>()
      .mockRejectedValue(new ApiError(401, 'auth.invalidCredentials'))
    mount([{ label: 'save', action: save }], { stepUp })

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    await confirmWith('000000')

    const alert = await within(await prompt()).findByRole('alert')
    expect(alert).toHaveTextContent(fr.auth.passwordIncorrect)
    expect(alert).not.toHaveTextContent(fr.errors['auth.invalidCredentials'])
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps the prompt open on a wrong code, with the server’s sentence, and sends nothing', async () => {
    const save = aWrite(stepUpRequired(), 'saved')
    const stepUp = vi
      .fn<Api['stepUp']>()
      .mockRejectedValueOnce(new ApiError(401, 'auth.invalidSecondFactor'))
      .mockResolvedValue(undefined)
    mount([{ label: 'save', action: save }], { stepUp })

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    await confirmWith('000000')

    const dialog = await prompt()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      fr.errors['auth.invalidSecondFactor'],
    )
    expect(save).toHaveBeenCalledTimes(1)

    // The right code, in the same prompt, is what lets the write through.
    await userEvent.clear(within(dialog).getByLabelText(fr.auth.secondFactorCode))
    await userEvent.type(within(dialog).getByLabelText(fr.auth.secondFactorCode), '654321')
    await userEvent.click(within(dialog).getByRole('button', { name: fr.auth.stepUpSubmit }))

    expect(await screen.findByText('ok:saved')).toBeVisible()
  })

  it('reports a second refusal as the answer and does not try a third time', async () => {
    // A clock that disagrees must not loop: one confirmation buys one more attempt.
    const save = aWrite(stepUpRequired(), stepUpRequired(), 'saved')
    mount([{ label: 'save', action: save }])

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    await confirmWith('123456')

    expect(await screen.findByText(`refused:${fr.errors['auth.stepUpRequired']}`)).toBeVisible()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('does not open the prompt for any other refusal, and says what the server said', async () => {
    const save = aWrite(notTheOperator())
    mount([{ label: 'save', action: save }])

    await userEvent.click(screen.getByRole('button', { name: 'save' }))

    expect(await screen.findByText(`refused:${fr.errors['auth.forbidden']}`)).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('asks once for two writes that were refused together, and sends both on that one confirmation', async () => {
    const first = aWrite(stepUpRequired(), 'first done')
    const second = aWrite(stepUpRequired(), 'second done')
    const api = mount([
      { label: 'first', action: first },
      { label: 'second', action: second },
    ])

    await userEvent.click(screen.getByRole('button', { name: 'first' }))
    await userEvent.click(screen.getByRole('button', { name: 'second' }))
    await prompt()
    expect(screen.getAllByRole('dialog', { name: fr.site.stepUpTitle })).toHaveLength(1)
    await confirmWith('123456')

    expect(await screen.findByText('ok:first done')).toBeVisible()
    expect(await screen.findByText('ok:second done')).toBeVisible()
    expect(api.stepUp).toHaveBeenCalledTimes(1)
  })

  it('opens with an empty form every time, so a password typed once is not waiting for the next write', async () => {
    const save = aWrite(stepUpRequired(), 'saved', stepUpRequired(), 'saved again')
    mount([{ label: 'save', action: save }])

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    await confirmWith('123456')
    await screen.findByText('ok:saved')

    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    const dialog = await prompt()

    await waitFor(() => expect(within(dialog).getByLabelText(fr.auth.password)).toHaveValue(''))
  })
})
