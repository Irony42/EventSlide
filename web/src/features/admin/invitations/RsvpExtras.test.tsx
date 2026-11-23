import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import { aRsvpSettings, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { RsvpPanel } from './RsvpPanel'
import { useRsvpSettings } from './useRsvpSettings'

/**
 * The lot 2 settings (spec 30): the companions' names, the menus and three questions, saved as they
 * are chosen. A text is sent when its field is left.
 */

const t = fr.rsvp.host

function Harness() {
  const rsvp = useRsvpSettings('mariage', 0)
  return <RsvpPanel rsvp={rsvp} archived={false} />
}

const form = (patch: Partial<ReturnType<typeof aRsvpSettings>['form']> = {}) => ({
  ...aRsvpSettings().form,
  ...patch,
})

const render = (settings = aRsvpSettings(), api: Partial<Api> = {}) =>
  renderWithProviders(<Harness />, {
    api: fakeApi({ rsvpForm: vi.fn(async () => ({ rsvpForm: settings })), ...api }),
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the companions', () => {
  it('switches the companions’ first names on and off', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render(aRsvpSettings(), { saveRsvpForm })

    await user.click(await screen.findByRole('checkbox', { name: t.companionsLabel }))

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { form: { companionNames: true } })
  })
})

describe('the menus', () => {
  it('opens the list of menus first and sends the switch with them, once there are two', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render(aRsvpSettings(), { saveRsvpForm })

    await user.click(await screen.findByRole('checkbox', { name: t.mealsLabel }))
    // Nothing is sent for a switch with no menu behind it.
    expect(saveRsvpForm).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: t.mealsLabel })).toBeChecked()

    await user.type(screen.getByLabelText(t.mealsOptionsLabel), '  Poisson{Enter}Végé  ')
    await user.tab()

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
      form: { meals: { options: ['Poisson', 'Végé'], enabled: true } },
    })
  })

  it('sends only the options while there are fewer than two, as a draft', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render(aRsvpSettings(), { saveRsvpForm })

    await user.click(await screen.findByRole('checkbox', { name: t.mealsLabel }))
    await user.type(screen.getByLabelText(t.mealsOptionsLabel), 'Poisson')
    await user.tab()

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
      form: { meals: { options: ['Poisson'] } },
    })
  })

  it('turns the saved menus on again at once, and off with one request', async () => {
    const user = userEvent.setup()
    const off = aRsvpSettings({ form: form({ meals: { enabled: false, options: ['A', 'B'] } }) })
    const on = aRsvpSettings({ form: form({ meals: { enabled: true, options: ['A', 'B'] } }) })
    const saveRsvpForm = vi
      .fn()
      .mockResolvedValueOnce({ rsvpForm: on })
      .mockResolvedValue({ rsvpForm: off })
    render(off, {
      saveRsvpForm,
    })

    await user.click(await screen.findByRole('checkbox', { name: t.mealsLabel }))
    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenLastCalledWith('mariage', { form: { meals: { enabled: true } } })
    expect(screen.getByLabelText(t.mealsOptionsLabel)).toHaveValue('A\nB')

    await user.click(screen.getByRole('checkbox', { name: t.mealsLabel }))
    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(2))
    expect(saveRsvpForm).toHaveBeenLastCalledWith('mariage', {
      form: { meals: { enabled: false } },
    })
  })

  it('closes the list without any request when the host changes their mind before saving', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render(aRsvpSettings(), { saveRsvpForm })

    await user.click(await screen.findByRole('checkbox', { name: t.mealsLabel }))
    await user.click(screen.getByRole('checkbox', { name: t.mealsLabel }))

    expect(screen.queryByLabelText(t.mealsOptionsLabel)).not.toBeInTheDocument()
    expect(saveRsvpForm).not.toHaveBeenCalled()
  })

  it('sends nothing when a field is left unchanged', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render(aRsvpSettings({ form: form({ meals: { enabled: true, options: ['A', 'B'] } }) }), {
      saveRsvpForm,
    })

    await user.click(await screen.findByLabelText(t.mealsOptionsLabel))
    await user.tab()

    expect(saveRsvpForm).not.toHaveBeenCalled()
  })
})

describe('the questions', () => {
  const asked = aRsvpSettings({
    form: form({
      questions: [
        { id: 'aaaaaaa1', label: 'Un chant ?', kind: 'text' },
        { id: 'aaaaaaa2', label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] },
      ],
    }),
  })

  it('adds a text question, sent with the ones already saved under their ids', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: asked }))
    render(
      aRsvpSettings({
        form: form({ questions: [{ id: 'aaaaaaa1', label: 'Un chant ?', kind: 'text' }] }),
      }),
      { saveRsvpForm },
    )

    await user.click(await screen.findByRole('button', { name: t.questionAdd }))
    const confirm = screen.getByRole('button', { name: t.questionConfirm })
    expect(confirm).toBeDisabled()
    await user.type(screen.getAllByLabelText(t.questionLabelLabel).at(-1)!, 'Un allergène ?')
    await user.click(confirm)

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
      form: {
        questions: [
          { id: 'aaaaaaa1', label: 'Un chant ?', kind: 'text' },
          { label: 'Un allergène ?', kind: 'text' },
        ],
      },
    })
  })

  it('adds a choice question with its options, one per line', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render(aRsvpSettings(), { saveRsvpForm })

    await user.click(await screen.findByRole('button', { name: t.questionAdd }))
    await user.type(screen.getByLabelText(t.questionLabelLabel), 'Voiture ?')
    await user.selectOptions(screen.getByLabelText(t.questionKindLabel), 'choice')
    await user.type(screen.getByLabelText(t.questionOptionsLabel), 'Oui{Enter}Non')
    await user.click(screen.getByRole('button', { name: t.questionConfirm }))

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
      form: { questions: [{ label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] }] },
    })
    expect(screen.queryByRole('button', { name: t.questionConfirm })).not.toBeInTheDocument()
  })

  it('cancels a question being added without sending anything', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render(aRsvpSettings(), { saveRsvpForm })

    await user.click(await screen.findByRole('button', { name: t.questionAdd }))
    await user.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(screen.getByRole('button', { name: t.questionAdd })).toBeInTheDocument()
    expect(saveRsvpForm).not.toHaveBeenCalled()
  })

  it('rewords a question keeping its id, when the field is left', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: asked }))
    render(asked, { saveRsvpForm })

    const label = (await screen.findAllByLabelText(t.questionLabelLabel))[0]!
    await user.clear(label)
    await user.type(label, '  Votre chanson ?  ')
    await user.tab()

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
      form: {
        questions: [
          { id: 'aaaaaaa1', label: 'Votre chanson ?', kind: 'text' },
          { id: 'aaaaaaa2', label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] },
        ],
      },
    })
  })

  it('rewrites the choices of a question, one per line', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: asked }))
    render(asked, { saveRsvpForm })

    const options = await screen.findByLabelText(t.questionOptionsLabel)
    expect(options).toHaveValue('Oui\nNon')
    await user.type(options, '{Enter}Peut-être')
    await user.tab()

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
      form: {
        questions: [
          { id: 'aaaaaaa1', label: 'Un chant ?', kind: 'text' },
          {
            id: 'aaaaaaa2',
            label: 'Voiture ?',
            kind: 'choice',
            options: ['Oui', 'Non', 'Peut-être'],
          },
        ],
      },
    })
  })

  it('removes a question by leaving it out of the list', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render(asked, { saveRsvpForm })

    await user.click(await screen.findByRole('button', { name: t.questionRemove('Un chant ?') }))

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
      form: {
        questions: [
          { id: 'aaaaaaa2', label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] },
        ],
      },
    })
  })

  it('offers no fourth question', async () => {
    const full = aRsvpSettings({
      form: form({
        questions: ['a', 'b', 'c'].map((id, index) => ({
          id: id.repeat(8),
          label: `Q${index}`,
          kind: 'text' as const,
        })),
      }),
    })
    render(full)

    expect(await screen.findByText(t.questionsFull)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.questionAdd })).not.toBeInTheDocument()
  })

  it('does not let a question the server has not named yet be changed', async () => {
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const saveRsvpForm = vi.fn(
      () =>
        new Promise<{ rsvpForm: ReturnType<typeof aRsvpSettings> }>((resolve) => {
          release = () => resolve({ rsvpForm: asked })
        }),
    )
    render(aRsvpSettings(), { saveRsvpForm })

    await user.click(await screen.findByRole('button', { name: t.questionAdd }))
    await user.type(screen.getByLabelText(t.questionLabelLabel), 'Un chant ?')
    await user.click(screen.getByRole('button', { name: t.questionConfirm }))

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText(t.questionLabelLabel)).toBeDisabled()
    release()
    await waitFor(() => expect(screen.getAllByLabelText(t.questionLabelLabel)[0]).toBeEnabled())
  })

  it('is read-only on an event with no invitation', async () => {
    render(aRsvpSettings({ invited: false, form: asked.form }))

    expect(await screen.findByRole('button', { name: t.questionAdd })).toBeDisabled()
    expect(screen.getAllByLabelText(t.questionLabelLabel)[0]).toBeDisabled()
  })
})
