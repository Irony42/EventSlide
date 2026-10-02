import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { AboutPage } from './AboutPage'
import { fr } from '../../lib/i18n/fr'
import { SUPPORTED_LOCALES } from '../../lib/i18n/locale'
import { TRANSLATIONS } from '../../lib/i18n/translations'
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

/**
 * The operator section (roadmap G2-17 / P3-18): who runs this instance and where their pages
 * are. Drawn only once the operator named themselves or set a link, so a self-hosted box
 * reads the page as it always did; and every address is re-checked where it becomes an
 * `href`, because it arrives over the network.
 */
describe('AboutPage, the operator section', () => {
  const NAME = 'Association Les Photographes'
  const EMAIL = 'contact@hosted.example.org'

  const serving = (answer: Partial<Parameters<typeof anAbout>[0]> = {}) =>
    fakeApi({ about: vi.fn(async () => anAbout(answer as never)) })
  const heading = () => screen.queryByRole('heading', { name: fr.about.operatorTitle })

  it('is not on the page of a box whose operator said nothing', async () => {
    const api = serving({})
    renderWithProviders(<AboutPage />, { api })

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(heading()).toBeNull()
    expect(screen.queryByText(fr.about.operatorNameLabel)).toBeNull()
  })

  it('is not on the page before the server has answered, because the build names nobody', () => {
    renderWithProviders(<AboutPage />, { api: silentServer() })

    expect(heading()).toBeNull()
  })

  it('names the operator and offers their address as a mailto: link', async () => {
    renderWithProviders(<AboutPage />, {
      api: serving({ operator: { name: NAME, contactEmail: EMAIL } }),
    })

    expect(await screen.findByRole('heading', { name: fr.about.operatorTitle })).toBeVisible()
    expect(screen.getByText(NAME)).toBeVisible()
    expect(screen.getByRole('link', { name: EMAIL })).toHaveAttribute('href', `mailto:${EMAIL}`)
  })

  it('names the operator alone when they gave no address', async () => {
    renderWithProviders(<AboutPage />, { api: serving({ operator: { name: NAME } }) })

    expect(await screen.findByText(NAME)).toBeVisible()
    expect(screen.queryByText(fr.about.operatorContactLabel)).toBeNull()
  })

  it('lists the terms, the privacy policy, the legal notice and the help page that are set', async () => {
    renderWithProviders(<AboutPage />, {
      api: serving({
        links: {
          terms: 'https://hosted.example.org/legal/cgu',
          privacy: 'https://hosted.example.org/legal/confidentialite',
          legalNotice: '/legal/mentions',
          support: '/legal/avant-evenement',
        },
      }),
    })

    expect(await screen.findByRole('heading', { name: fr.about.operatorTitle })).toBeVisible()
    const link = (label: string) => screen.getByRole('link', { name: new RegExp(label) })
    expect(link(fr.about.termsLink)).toHaveAttribute('href', 'https://hosted.example.org/legal/cgu')
    expect(link(fr.about.privacyLink)).toHaveAttribute(
      'href',
      'https://hosted.example.org/legal/confidentialite',
    )
    expect(link(fr.about.legalNoticeLink)).toHaveAttribute('href', '/legal/mentions')
    expect(link(fr.about.helpLink)).toHaveAttribute('href', '/legal/avant-evenement')
  })

  it('draws the section for a box that set a link and named nobody, with no name row', async () => {
    renderWithProviders(<AboutPage />, { api: serving({ links: { terms: '/legal/cgu' } }) })

    expect(await screen.findByRole('heading', { name: fr.about.operatorTitle })).toBeVisible()
    expect(screen.queryByText(fr.about.operatorNameLabel)).toBeNull()
  })

  it('leaves the report link to the footer, which every guest screen has', async () => {
    renderWithProviders(<AboutPage />, {
      api: serving({ links: { report: '/legal/signaler', terms: '/legal/cgu' } }),
    })

    await screen.findByRole('heading', { name: fr.about.operatorTitle })

    expect(screen.queryByRole('link', { name: new RegExp(fr.about.reportLink) })).toBeNull()
  })

  it('opens each of its links in a tab of its own, with rel="noopener noreferrer"', async () => {
    renderWithProviders(<AboutPage />, { api: serving({ links: { privacy: '/legal/privacy' } }) })

    const privacy = await screen.findByRole('link', { name: new RegExp(fr.about.privacyLink) })

    expect(privacy).toHaveAttribute('target', '_blank')
    expect(privacy.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
  })

  it.each([
    ['a javascript: URI', 'javascript:alert(1)'],
    ['plain http', 'http://hosted.example.org/legal'],
    ['a protocol-relative address', '//evil.example/legal'],
    ['credentials in the address', 'https://user:secret@hosted.example.org/legal'],
  ])('never puts %s behind a link, whatever the response says', async (_why, hostile) => {
    const api = serving({ links: { terms: hostile, privacy: hostile } })
    renderWithProviders(<AboutPage />, { api })

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(screen.queryByRole('link', { name: new RegExp(fr.about.termsLink) })).toBeNull()
    expect(heading()).toBeNull()
  })

  it.each([
    ['a blank name', { name: '   ' }],
    ['a name with a line break in it', { name: `${NAME}\n${NAME}` }],
    ['a name that is not text', { name: 42 }],
    ['an operator that is not an object', 'Association Les Photographes'],
  ])('shows nothing for %s', async (_why, operator) => {
    const api = serving({ operator: operator as never })
    renderWithProviders(<AboutPage />, { api })

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(heading()).toBeNull()
  })

  it.each([
    ['a mailto: header smuggled into the address', 'a@hosted.example.org?bcc=x@y.zz'],
    ['two addresses', 'a@hosted.example.org,b@hosted.example.org'],
    ['an address with a space', 'a @hosted.example.org'],
    ['something that is not an address', 'write to the office'],
  ])('offers no mailto: link for %s, but still names the operator', async (_why, hostile) => {
    renderWithProviders(<AboutPage />, {
      api: serving({ operator: { name: NAME, contactEmail: hostile } }),
    })

    expect(await screen.findByText(NAME)).toBeVisible()
    expect(screen.queryByText(fr.about.operatorContactLabel)).toBeNull()
    expect(screen.queryAllByRole('link').map((link) => link.getAttribute('href'))).not.toContain(
      `mailto:${hostile}`,
    )
  })

  it('renders the name as text and never as markup', async () => {
    renderWithProviders(<AboutPage />, {
      api: serving({ operator: { name: '<img src=x onerror=alert(1)> Les Photographes' } }),
    })

    expect(await screen.findByText(/<img src=x onerror=alert\(1\)> Les Photographes/)).toBeVisible()
    expect(document.querySelector('img')).toBeNull()
  })

  it.each(SUPPORTED_LOCALES)('reads in %s, the reader’s own language', async (locale) => {
    renderWithProviders(<AboutPage />, {
      api: serving({
        operator: { name: NAME, contactEmail: EMAIL },
        links: { terms: '/legal/cgu' },
      }),
      locale,
    })

    const text = TRANSLATIONS[locale].about

    expect(await screen.findByRole('heading', { name: text.operatorTitle })).toBeVisible()
    expect(screen.getByText(text.operatorNameLabel)).toBeVisible()
    expect(screen.getByText(text.operatorContactLabel)).toBeVisible()
    expect(screen.getByRole('link', { name: new RegExp(text.termsLink) })).toBeVisible()
  })
})
