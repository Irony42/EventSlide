import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { ApiError } from '../../../lib/http'
import type { Api } from '../../../lib/api/client'
import type { SiteAnnouncementDto } from '../../../lib/api/dto'
import { consoleApi, openConsole, stepUpRequired } from '../../../testing/siteConsole'

/**
 * The operator's page of announcements to the hosts (spec 32, A8), through the route table: the form with its preview and the size of
 * the audience, the confirmation that names that size, the step-up, what is sent, and the progress of past announcements.
 */

const t = fr.siteAnnouncements
const NBSP = String.fromCharCode(160)
/** A sentence as the page shows it: the French copy’s no-break spaces are read as spaces by the queries. */
const sentence = (text: string) => (content: string) => content === text.replaceAll(NBSP, ' ')

const anAnnouncement = (overrides: Partial<SiteAnnouncementDto> = {}): SiteAnnouncementDto => ({
  id: 'a-1',
  subject: 'Nouvelles conditions',
  text: 'Elles changent.',
  link: null,
  createdAt: '2026-11-27T08:00:00.000Z',
  finishedAt: null,
  delivered: 12,
  owed: 40,
  ...overrides,
})

const open = (api: Api) => openConsole('/admin/site/announcements', api)

const write = async (subject = 'Nouvelles conditions', text = 'Elles changent le 1er janvier.') => {
  await userEvent.type(await screen.findByLabelText(t.subject), subject)
  await userEvent.type(screen.getByLabelText(t.text), text)
}

describe('the announcements page', () => {
  it('is a section of the console, with its own title and the size of the audience', async () => {
    open(consoleApi({ siteAnnouncements: vi.fn(async () => ({ recipients: 7, items: [] })) }))

    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeVisible()
    expect(screen.getByRole('link', { name: t.nav })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText(sentence(t.audience(7)))).toBeVisible()
    expect(screen.getByText(t.none)).toBeVisible()
  })

  it('shows a preview of the mail as typed, the link included, and asks for a subject and a message first', async () => {
    open(consoleApi())
    const preview = await screen.findByRole('region', { name: t.preview })
    expect(within(preview).getByText(t.previewEmpty)).toBeVisible()
    expect(screen.getByRole('button', { name: t.send })).toBeDisabled()

    await write('  Sujet  ', 'Ligne un\nLigne deux')
    await userEvent.type(screen.getByLabelText(t.link), 'https://eventslide.fr/legal/cgu')

    expect(within(preview).getByText('Sujet')).toBeVisible()
    expect(within(preview).getByText(/Ligne un\s+Ligne deux/)).toBeVisible()
    expect(within(preview).getByText('https://eventslide.fr/legal/cgu')).toBeVisible()
    expect(screen.getByRole('button', { name: t.send })).toBeEnabled()
  })

  it('sends nothing before the confirmation, which names how many accounts, and nothing when it is declined', async () => {
    const api = consoleApi()
    open(api)
    await write()

    await userEvent.click(screen.getByRole('button', { name: t.send }))
    const confirmation = await screen.findByRole('dialog', { name: t.confirmTitle })

    expect(confirmation).toHaveTextContent(t.confirmBody(3).replaceAll(NBSP, ' '))
    await userEvent.click(within(confirmation).getByRole('button', { name: fr.app.cancel }))
    expect(api.siteSendAnnouncement).not.toHaveBeenCalled()
  })

  it('sends the words as typed (a blank link is left out), says how many accounts, empties the form and reads the list again', async () => {
    const siteAnnouncements = vi
      .fn<Api['siteAnnouncements']>()
      .mockResolvedValueOnce({ recipients: 3, items: [] })
      .mockResolvedValue({ recipients: 3, items: [anAnnouncement({ delivered: 0 })] })
    const api = consoleApi({ siteAnnouncements })
    open(api)
    await write()

    await userEvent.click(screen.getByRole('button', { name: t.send }))
    const confirmation = await screen.findByRole('dialog', { name: t.confirmTitle })
    await userEvent.click(within(confirmation).getByRole('button', { name: t.send }))

    await waitFor(() =>
      expect(api.siteSendAnnouncement).toHaveBeenCalledWith({
        subject: 'Nouvelles conditions',
        text: 'Elles changent le 1er janvier.',
      }),
    )
    expect(await screen.findByText(sentence(t.sent(3)))).toBeVisible()
    expect(screen.getByLabelText(t.subject)).toHaveValue('')
    expect(await screen.findByRole('table', { name: t.pastCaption })).toBeVisible()
  })

  it('previews the subject folded as the server keeps it: runs of spaces and invisible characters gone', async () => {
    open(consoleApi())
    const preview = await screen.findByRole('region', { name: t.preview })
    await userEvent.type(await screen.findByLabelText(t.subject), 'Nouvelles   conditions\u202E')
    await userEvent.type(screen.getByLabelText(t.text), 'Un texte.')

    expect(within(preview).getByText('Nouvelles conditions')).toBeVisible()
  })

  it('reads the audience again as the confirmation opens, and names that size', async () => {
    const siteAnnouncements = vi
      .fn<Api['siteAnnouncements']>()
      .mockResolvedValueOnce({ recipients: 3, items: [] })
      .mockResolvedValue({ recipients: 5, items: [] })
    open(consoleApi({ siteAnnouncements }))
    await write()

    await userEvent.click(screen.getByRole('button', { name: t.send }))
    const confirmation = await screen.findByRole('dialog', { name: t.confirmTitle })

    await waitFor(() => expect(siteAnnouncements).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(confirmation).toHaveTextContent(t.confirmBody(5).replaceAll(NBSP, ' ')),
    )
  })

  it('does not offer the confirmation while the audience is being read again', async () => {
    let answer: (value: { recipients: number; items: [] }) => void = () => {}
    const siteAnnouncements = vi
      .fn<Api['siteAnnouncements']>()
      .mockResolvedValueOnce({ recipients: 3, items: [] })
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve
          }),
      )
    open(consoleApi({ siteAnnouncements }))
    await write()

    await userEvent.click(screen.getByRole('button', { name: t.send }))
    const confirmation = await screen.findByRole('dialog', { name: t.confirmTitle })

    expect(within(confirmation).getByRole('button', { name: t.send })).toBeDisabled()
    answer({ recipients: 4, items: [] })
    await waitFor(() =>
      expect(within(confirmation).getByRole('button', { name: t.send })).toBeEnabled(),
    )
  })

  it('sends once when the confirmation is pressed twice: the button is out of reach while it posts', async () => {
    let release: () => void = () => {}
    const siteSendAnnouncement = vi.fn<Api['siteSendAnnouncement']>(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ id: 'a-1', recipients: 3 })
        }),
    )
    open(consoleApi({ siteSendAnnouncement }))
    await write()
    await userEvent.click(screen.getByRole('button', { name: t.send }))
    const confirmation = await screen.findByRole('dialog', { name: t.confirmTitle })
    const confirm = within(confirmation).getByRole('button', { name: t.send })

    await userEvent.dblClick(confirm)
    release()

    await waitFor(() => expect(siteSendAnnouncement).toHaveBeenCalledTimes(1))
  })

  it('says the same words were just sent, in the console’s language, when the server answers a duplicate', async () => {
    const siteSendAnnouncement = vi
      .fn<Api['siteSendAnnouncement']>()
      .mockRejectedValue(new ApiError(409, 'hostAnnouncement.duplicate'))
    open(consoleApi({ siteSendAnnouncement }))
    await write()

    await userEvent.click(screen.getByRole('button', { name: t.send }))
    const confirmation = await screen.findByRole('dialog', { name: t.confirmTitle })
    await userEvent.click(within(confirmation).getByRole('button', { name: t.send }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.errors['hostAnnouncement.duplicate'].replaceAll(NBSP, ' '),
    )
  })

  it('sends the link when there is one', async () => {
    const api = consoleApi()
    open(api)
    await write()
    await userEvent.type(screen.getByLabelText(t.link), 'https://eventslide.fr/legal/cgu')

    await userEvent.click(screen.getByRole('button', { name: t.send }))
    const confirmation = await screen.findByRole('dialog', { name: t.confirmTitle })
    await userEvent.click(within(confirmation).getByRole('button', { name: t.send }))

    await waitFor(() =>
      expect(api.siteSendAnnouncement).toHaveBeenCalledWith({
        subject: 'Nouvelles conditions',
        text: 'Elles changent le 1er janvier.',
        link: 'https://eventslide.fr/legal/cgu',
      }),
    )
  })

  it('asks the operator to confirm themselves when the server wants it, and sends once they did', async () => {
    const siteSendAnnouncement = vi
      .fn<Api['siteSendAnnouncement']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue({ id: 'a-1', recipients: 3 })
    const api = consoleApi({ siteSendAnnouncement })
    open(api)
    await write()

    await userEvent.click(screen.getByRole('button', { name: t.send }))
    const confirmation = await screen.findByRole('dialog', { name: t.confirmTitle })
    await userEvent.click(within(confirmation).getByRole('button', { name: t.send }))
    const prompt = await screen.findByRole('dialog', { name: fr.site.stepUpTitle })
    await userEvent.type(within(prompt).getByLabelText(fr.auth.password), 'le mot de passe')
    await userEvent.type(within(prompt).getByLabelText(fr.auth.secondFactorCode), '123456')
    await userEvent.click(within(prompt).getByRole('button', { name: fr.auth.stepUpSubmit }))

    await waitFor(() => expect(siteSendAnnouncement).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(sentence(t.sent(3)))).toBeVisible()
  })

  it('says what the server refused, keeps what was typed, and offers nothing on a box that cannot mail', async () => {
    const siteSendAnnouncement = vi
      .fn<Api['siteSendAnnouncement']>()
      .mockRejectedValue(new ApiError(409, 'hostAnnouncement.mailerRequired'))
    open(consoleApi({ siteSendAnnouncement }))
    await write()

    await userEvent.click(screen.getByRole('button', { name: t.send }))
    const confirmation = await screen.findByRole('dialog', { name: t.confirmTitle })
    await userEvent.click(within(confirmation).getByRole('button', { name: t.send }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.errors['hostAnnouncement.mailerRequired'].replaceAll(NBSP, ' '),
    )
    expect(screen.getByLabelText(t.subject)).toHaveValue('Nouvelles conditions')
  })

  it('offers no send when nobody would receive it', async () => {
    open(consoleApi({ siteAnnouncements: vi.fn(async () => ({ recipients: 0, items: [] })) }))
    await write()

    expect(await screen.findByText(sentence(t.audience(0)))).toBeVisible()
    expect(screen.getByRole('button', { name: t.send })).toBeDisabled()
  })

  it('lists the past announcements with how far each has gone: going out, or finished with the day', async () => {
    open(
      consoleApi({
        siteAnnouncements: vi.fn(async () => ({
          recipients: 3,
          items: [
            anAnnouncement({ id: 'a-2', subject: 'En cours', delivered: 12, owed: 40 }),
            anAnnouncement({
              id: 'a-1',
              subject: 'Terminée',
              delivered: 40,
              owed: 40,
              finishedAt: '2026-11-28T09:00:00.000Z',
            }),
          ],
        })),
      }),
    )

    const table = await screen.findByRole('table', { name: t.pastCaption })

    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0] as HTMLElement).getByText('En cours')).toBeVisible()
    expect(
      within(rows[0] as HTMLElement).getByText(/^En cours\s*:\s*12 sur 40 envoyés$/),
    ).toBeVisible()
    expect(within(rows[1] as HTMLElement).getByText(/^Terminée le .*40 envoyés$/)).toBeVisible()
  })

  it('reads the list again on request, and says when it could not be read', async () => {
    const siteAnnouncements = vi
      .fn<Api['siteAnnouncements']>()
      .mockRejectedValueOnce(new ApiError(500, 'server.error'))
      .mockResolvedValue({ recipients: 3, items: [anAnnouncement()] })
    open(consoleApi({ siteAnnouncements }))

    await userEvent.click(await screen.findByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('table', { name: t.pastCaption })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: t.refresh }))
    await waitFor(() => expect(siteAnnouncements).toHaveBeenCalledTimes(3))
  })
})
