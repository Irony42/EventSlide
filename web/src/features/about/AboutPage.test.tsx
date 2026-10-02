import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { AboutPage } from './AboutPage'
import { fr } from '../../lib/i18n/fr'
import { anAbout, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'

/**
 * Ring 5. `/about`: the long form of the footer's one-line AGPL section 13 offer — which
 * build this is, under which licence, and where its source is.
 */

const BUILD_VERSION = '0.0.0-build'
const BUILD_SOURCE_URL = 'https://source.test/eventslide/tree/v0.0.0-build'

const silentServer = () => fakeApi({ about: vi.fn(() => new Promise<never>(() => undefined)) })

describe('AboutPage', () => {
  it('shows the build’s own version and source at once, with no loading state', () => {
    renderWithProviders(<AboutPage />, { api: silentServer() })

    expect(screen.getByRole('heading', { level: 1, name: fr.about.title })).toBeVisible()
    expect(screen.getByText(BUILD_VERSION)).toBeVisible()
    expect(screen.getByRole('link', { name: new RegExp(BUILD_SOURCE_URL) })).toHaveAttribute(
      'href',
      BUILD_SOURCE_URL,
    )
  })

  it('names the licence', () => {
    renderWithProviders(<AboutPage />, { api: silentServer() })

    expect(screen.getByText(fr.about.licenseLabel)).toBeVisible()
    expect(screen.getByText('AGPL-3.0-only')).toBeVisible()
  })

  it('shows what the server says once it has said it', async () => {
    renderWithProviders(<AboutPage />, {
      api: fakeApi({
        about: vi.fn(async () =>
          anAbout({ version: '3.1.4', sourceUrl: 'https://git.example.org/our/fork' }),
        ),
      }),
    })

    expect(await screen.findByText('3.1.4')).toBeVisible()
    expect(screen.getByRole('link', { name: /git\.example\.org\/our\/fork/ })).toHaveAttribute(
      'href',
      'https://git.example.org/our/fork',
    )
  })

  it('keeps the build’s answer when the server cannot be reached', async () => {
    const about = vi.fn(async () => {
      throw new Error('offline')
    })
    renderWithProviders(<AboutPage />, { api: fakeApi({ about }) })

    await waitFor(() => expect(about).toHaveBeenCalled())

    expect(screen.getByText(BUILD_VERSION)).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the build’s version when the response carries none', async () => {
    const about = vi.fn(async () => ({}) as never)
    renderWithProviders(<AboutPage />, { api: fakeApi({ about }) })

    await waitFor(() => expect(about).toHaveBeenCalled())

    expect(screen.getByText(BUILD_VERSION)).toBeVisible()
  })

  it('opens the source in a tab of its own, with rel="noopener noreferrer"', () => {
    renderWithProviders(<AboutPage />, { api: silentServer() })

    const link = screen.getByRole('link', { name: new RegExp(BUILD_SOURCE_URL) })

    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
  })

  it('reads in the reader’s language', () => {
    renderWithProviders(<AboutPage />, { api: silentServer(), locale: 'de' })

    expect(screen.getByRole('heading', { level: 1, name: 'Über EventSlide' })).toBeVisible()
  })

  it('links the licence notices of the bundled libraries, from the first paint (roadmap G1-07)', () => {
    // The file is written by the build and served as a static file, so the link needs no
    // server answer and is there from the first paint.
    renderWithProviders(<AboutPage />, { api: silentServer() })

    expect(screen.getByText(fr.about.noticesLabel)).toBeVisible()
    const link = screen.getByRole('link', { name: new RegExp(fr.about.noticesLink) })

    expect(link).toHaveAttribute('href', '/third-party-licenses.txt')
    // In a tab of its own, as every link out of a guest-reachable page is.
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
  })
})

/**
 * The operator's support section (roadmap G4-02): drawn only when `DONATION_URL` or
 * `BUDGET_URL` is set, and then it says in as many words that a donation unlocks nothing.
 */
describe('AboutPage, the support section', () => {
  const DONATE_URL = 'https://opencollective.com/eventslide'
  const BUDGET_URL = 'https://opencollective.com/eventslide/budget'

  const serving = (links: { donate?: string; budget?: string }) =>
    fakeApi({ about: vi.fn(async () => anAbout({ links })) })

  it('is not on the page of a box that set no link, so a self-hoster reads the page as it was', async () => {
    const api = serving({})
    renderWithProviders(<AboutPage />, { api })

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(screen.queryByRole('heading', { name: fr.about.supportTitle })).toBeNull()
    expect(screen.queryByRole('link', { name: new RegExp(fr.about.supportLink) })).toBeNull()
    expect(screen.queryByText(fr.about.supportNoCounterpart)).toBeNull()
  })

  it('is not on the page before the server has answered, because the build knows no address', () => {
    renderWithProviders(<AboutPage />, { api: silentServer() })

    expect(screen.queryByRole('heading', { name: fr.about.supportTitle })).toBeNull()
  })

  it('offers the donation link, and says that a donation unlocks nothing', async () => {
    renderWithProviders(<AboutPage />, { api: serving({ donate: DONATE_URL }) })

    expect(
      await screen.findByRole('heading', { level: 2, name: fr.about.supportTitle }),
    ).toBeVisible()
    expect(screen.getByText(fr.about.supportIntro)).toBeVisible()
    // The promise, in the product itself: no tier, no badge, the same service for everyone.
    expect(screen.getByText(fr.about.supportNoCounterpart)).toBeVisible()
    expect(screen.getByRole('link', { name: new RegExp(fr.about.supportLink) })).toHaveAttribute(
      'href',
      DONATE_URL,
    )
  })

  it('opens the donation page in a tab of its own, with rel="noopener noreferrer"', async () => {
    renderWithProviders(<AboutPage />, { api: serving({ donate: DONATE_URL }) })

    const link = await screen.findByRole('link', { name: new RegExp(fr.about.supportLink) })

    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
  })

  it('offers the budget link beside it when there is one', async () => {
    renderWithProviders(<AboutPage />, {
      api: serving({ donate: DONATE_URL, budget: BUDGET_URL }),
    })

    expect(
      await screen.findByRole('link', { name: new RegExp(fr.about.budgetLink) }),
    ).toHaveAttribute('href', BUDGET_URL)
    expect(screen.getByRole('link', { name: new RegExp(fr.about.supportLink) })).toBeVisible()
  })

  it('shows a budget published on its own without a donation button or a promise about donations', async () => {
    renderWithProviders(<AboutPage />, { api: serving({ budget: BUDGET_URL }) })

    expect(await screen.findByRole('link', { name: new RegExp(fr.about.budgetLink) })).toBeVisible()
    expect(screen.queryByRole('link', { name: new RegExp(fr.about.supportLink) })).toBeNull()
    expect(screen.queryByText(fr.about.supportNoCounterpart)).toBeNull()
  })

  it.each([
    ['a javascript: URI', 'javascript:alert(document.cookie)'],
    ['plain http', 'http://opencollective.com/eventslide'],
    ['credentials in the address', 'https://user:secret@opencollective.com/eventslide'],
    ['something that is not a URL', 'send a coffee'],
  ])('draws nothing for %s in either link, whatever the response says', async (_name, hostile) => {
    const api = serving({ donate: hostile, budget: hostile })
    renderWithProviders(<AboutPage />, { api })

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(screen.queryByRole('heading', { name: fr.about.supportTitle })).toBeNull()
    // A link's address is not its name, so the assertion reads the hrefs themselves.
    expect(screen.queryAllByRole('link').map((link) => link.getAttribute('href'))).not.toContain(
      hostile,
    )
  })

  it('reads in the reader’s language', async () => {
    renderWithProviders(<AboutPage />, { api: serving({ donate: DONATE_URL }), locale: 'en' })

    expect(
      await screen.findByText('A donation unlocks nothing: same service for everyone.'),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: /Support the project/ })).toBeVisible()
  })
})
