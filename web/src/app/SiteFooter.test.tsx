import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { SiteFooter } from './SiteFooter'
import { SUPPORTED_LOCALES } from '../lib/i18n/locale'
import { TRANSLATIONS } from '../lib/i18n/translations'
import { fr } from '../lib/i18n/fr'
import { anAbout, fakeApi, renderWithProviders } from '../testing/renderWithProviders'

/**
 * Ring 5. The footer is where AGPL section 13 is honoured on screen: a user of a network
 * service is entitled to the source of what they are using, and this is the link that says
 * so, on every guest and host screen. `vitest.config.ts` injects the build-time values
 * these tests start from — a version and an upstream tag that are **not** what
 * `anAbout()` answers — so every case can tell "what the build knew" from "what the server
 * said".
 */

const BUILD_SOURCE_URL = 'https://source.test/eventslide/tree/v0.0.0-build'
const SERVER_SOURCE_URL = 'https://git.example.org/me/eventslide/tree/v9.9.9-server'

/** A server that has not answered, and never will within a test. */
const silentServer = () => fakeApi({ about: vi.fn(() => new Promise<never>(() => undefined)) })

/** `(` and `)` in a label are regular-expression syntax, and a label is not a pattern. */
const literal = (label: string): RegExp =>
  new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

const sourceLink = () => screen.getByRole('link', { name: literal(fr.about.sourceCode) })

describe('SiteFooter', () => {
  it('offers the source from the first paint, before the server has been heard from', () => {
    // The footer is on every screen of the guest's eager chunk, so the link cannot be
    // waiting on a request: on venue Wi-Fi that is the difference between a licence offer
    // and a licence offer that arrives after the guest has left.
    renderWithProviders(<SiteFooter />, { api: silentServer() })

    expect(sourceLink()).toHaveAttribute('href', BUILD_SOURCE_URL)
  })

  it('points at the address the server offers once it has answered', async () => {
    // The operator's `SOURCE_CODE_URL` is the one that can describe a deployment built
    // from somewhere other than upstream, so what the server says replaces the default.
    renderWithProviders(<SiteFooter />, {
      api: fakeApi({ about: vi.fn(async () => anAbout({ sourceUrl: SERVER_SOURCE_URL })) }),
    })

    await waitFor(() => expect(sourceLink()).toHaveAttribute('href', SERVER_SOURCE_URL))
  })

  it('keeps the build-time address when the server cannot be reached', async () => {
    // An installed app opened offline. Nothing the footer can say about that helps a guest,
    // so it is not said: the link is simply still there.
    const about = vi.fn(async () => {
      throw new Error('offline')
    })
    renderWithProviders(<SiteFooter />, { api: fakeApi({ about }) })

    await waitFor(() => expect(about).toHaveBeenCalled())

    expect(sourceLink()).toHaveAttribute('href', BUILD_SOURCE_URL)
  })

  it.each([
    ['a javascript: URI', 'javascript:alert(document.cookie)'],
    ['a data: URI', 'data:text/html,<script>alert(1)</script>'],
    ['plain http', 'http://git.example.org/me/eventslide'],
    ['something that is not a URL', 'the source is on my laptop'],
    ['an empty string', ''],
  ])('never puts %s behind the link, whatever the response says', async (_name, hostile) => {
    // The server refuses these at boot, so this is the same rule applied again at the one
    // place a string becomes an `href`: a proxy that rewrote the response, or a server
    // older than the check, must not be able to arm a link every visitor is invited to press.
    const about = vi.fn(async () => anAbout({ sourceUrl: hostile }))
    renderWithProviders(<SiteFooter />, { api: fakeApi({ about }) })

    await waitFor(() => expect(about).toHaveBeenCalled())

    expect(sourceLink()).toHaveAttribute('href', BUILD_SOURCE_URL)
  })

  it.each([
    ['a box with site administration on', anAbout({ features: { siteAdmin: true } })],
    ['a box with site administration off', anAbout({ features: { siteAdmin: false } })],
    [
      'a box that publishes operator links',
      anAbout({
        links: { donate: 'https://example.org/donate', budget: 'https://example.org/budget' },
      }),
    ],
  ])(
    'is offered on %s, because nothing the server reports can switch it off',
    async (_name, answer) => {
      // The one rule this footer has: no setting, no flag and no capability hides the link.
      // A feature flag added later that "tidies" the footer away would be a licence breach
      // wearing a UI preference, so every shape of answer the server can give is asked.
      const about = vi.fn(async () => answer)
      renderWithProviders(<SiteFooter />, { api: fakeApi({ about }) })

      await waitFor(() => expect(about).toHaveBeenCalled())

      await waitFor(() => expect(sourceLink()).toHaveAttribute('href', answer.sourceUrl))
    },
  )

  it('hands the browser the parsed address, never the string as written', async () => {
    // `https:x.example` is a valid https URL to the parser and a relative reference to a
    // browser: as an `href` on an https page it resolves under the page's own path.
    const about = vi.fn(async () => anAbout({ sourceUrl: 'https:x.example/our/fork' }))
    renderWithProviders(<SiteFooter />, { api: fakeApi({ about }) })

    await waitFor(() => expect(sourceLink()).toHaveAttribute('href', 'https://x.example/our/fork'))
  })

  it.each([
    ['null, as a proxy’s error page might parse', null],
    ['an empty object, as another version of the server might send', {}],
    ['a body of the wrong kind', 'Bad Gateway'],
  ])('keeps the build’s answer when the response is %s', async (_name, answer) => {
    // A promise callback that throws is an unhandled rejection, and a footer that blanks
    // its own link because a proxy answered badly has made the offer worse than not asking.
    const about = vi.fn(async () => answer as never)
    renderWithProviders(<SiteFooter />, { api: fakeApi({ about }) })

    await waitFor(() => expect(about).toHaveBeenCalled())

    expect(sourceLink()).toHaveAttribute('href', BUILD_SOURCE_URL)
  })

  it('opens the source in a tab of its own, with rel="noopener noreferrer"', () => {
    renderWithProviders(<SiteFooter />, { api: silentServer() })

    const link = sourceLink()

    expect(link).toHaveAttribute('target', '_blank')
    // Two tokens, each for its own reason: `noopener` so the source host cannot navigate
    // the page that opened it, `noreferrer` so it does not learn which event's address a
    // guest came from.
    expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
  })

  it('says to a screen reader that the link opens a new tab', () => {
    renderWithProviders(<SiteFooter />, { api: silentServer() })

    expect(sourceLink()).toHaveAccessibleName(`${fr.about.sourceCode} (${fr.about.opensInNewTab})`)
  })

  it('links to the about page too, also in a tab of its own, so a send in progress survives it', () => {
    // An in-page navigation from the upload screen would unmount it, and unmounting aborts
    // every upload in flight.
    renderWithProviders(<SiteFooter />, { api: silentServer() })

    const about = screen.getByRole('link', { name: literal(fr.about.aboutLink) })

    expect(about).toHaveAttribute('href', '/about')
    expect(about).toHaveAttribute('target', '_blank')
    expect(about.getAttribute('rel')?.split(/\s+/)).toContain('noopener')
  })

  it('is a contentinfo landmark, so a screen reader can jump to it', () => {
    renderWithProviders(<SiteFooter />, { api: silentServer() })

    const footer = screen.getByRole('contentinfo')

    expect(within(footer).getAllByRole('link')).toHaveLength(2)
  })

  it('asks the server once, not on every render', async () => {
    const about = vi.fn(async () => anAbout())
    const { rerender } = renderWithProviders(<SiteFooter />, { api: fakeApi({ about }) })

    await waitFor(() => expect(about).toHaveBeenCalledTimes(1))
    rerender(<SiteFooter />)

    expect(about).toHaveBeenCalledTimes(1)
  })

  it.each(SUPPORTED_LOCALES)('names the link in %s, the reader’s own language', (locale) => {
    renderWithProviders(<SiteFooter />, { api: silentServer(), locale })

    const text = TRANSLATIONS[locale].about

    expect(screen.getByRole('link', { name: literal(text.sourceCode) })).toBeVisible()
    expect(screen.getByRole('link', { name: literal(text.aboutLink) })).toBeVisible()
  })
})

/**
 * The optional "Soutenir le projet" link (roadmap G4-02).
 *
 * Three promises: it is **off unless the layout asks** (the guest's footer, which sits under
 * the upload composer, never carries it), it is **absent unless the operator set
 * `DONATION_URL`** (a self-hoster sees nothing about money), and it is **an addition** that
 * never touches the source offer beside it.
 */
describe('SiteFooter, the support link', () => {
  const DONATE_URL = 'https://opencollective.com/eventslide'
  const supportLink = () => screen.queryByRole('link', { name: literal(fr.about.supportLink) })
  const donating = (links: { donate?: string; budget?: string } = { donate: DONATE_URL }) =>
    fakeApi({ about: vi.fn(async () => anAbout({ links })) })

  it('is not offered by a footer that was not asked for it, even when the operator set the address', async () => {
    // The guest layout's footer. Without the prop it must stay silent whatever the server
    // says, because the safe default for a surface nobody thought about is no ask.
    const api = donating()
    renderWithProviders(<SiteFooter />, { api })

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(supportLink()).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('is offered once the layout asks and the operator has set DONATION_URL', async () => {
    renderWithProviders(<SiteFooter supportLink />, { api: donating() })

    await waitFor(() => expect(supportLink()).toHaveAttribute('href', DONATE_URL))
  })

  it('is absent on a box that set no address, so a self-hoster sees nothing about money', async () => {
    const api = fakeApi({ about: vi.fn(async () => anAbout({ links: {} })) })
    renderWithProviders(<SiteFooter supportLink />, { api })

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(supportLink()).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('is absent until the server has answered, because the build knows no donation address', () => {
    renderWithProviders(<SiteFooter supportLink />, { api: silentServer() })

    expect(supportLink()).toBeNull()
  })

  it('opens in a tab of its own, with rel="noopener noreferrer"', async () => {
    renderWithProviders(<SiteFooter supportLink />, { api: donating() })

    const link = await waitFor(() => {
      const found = supportLink()
      if (found === null) throw new Error('the support link has not appeared yet')
      return found
    })

    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
    expect(link).toHaveAccessibleName(`${fr.about.supportLink} (${fr.about.opensInNewTab})`)
  })

  it('leaves the budget link to the pages that have room for it', async () => {
    const api = donating({
      donate: DONATE_URL,
      budget: 'https://opencollective.com/eventslide/budget',
    })
    renderWithProviders(<SiteFooter supportLink />, { api })

    await waitFor(() => expect(supportLink()).not.toBeNull())

    expect(screen.queryByRole('link', { name: literal(fr.about.budgetLink) })).toBeNull()
  })

  it('is an addition: the source offer is still there, first', async () => {
    renderWithProviders(<SiteFooter supportLink />, { api: donating() })

    await waitFor(() => expect(supportLink()).not.toBeNull())

    const links = within(screen.getByRole('contentinfo')).getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(links[0]).toHaveAccessibleName(literal(fr.about.sourceCode))
  })

  it.each([
    ['a javascript: URI', 'javascript:alert(document.cookie)'],
    ['plain http', 'http://opencollective.com/eventslide'],
    ['something that is not a URL', 'send a coffee'],
    ['an empty string', ''],
  ])('never puts %s behind it, whatever the response says', async (_name, hostile) => {
    // The server refuses these at boot; this is the same rule at the one place a string
    // becomes an href, so a proxy that rewrote the response cannot arm the link.
    const api = donating({ donate: hostile })
    renderWithProviders(<SiteFooter supportLink />, { api })

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(supportLink()).toBeNull()
  })

  it.each(SUPPORTED_LOCALES)('is worded in %s, the reader’s own language', async (locale) => {
    renderWithProviders(<SiteFooter supportLink />, { api: donating(), locale })

    const label = TRANSLATIONS[locale].about.supportLink

    expect(await screen.findByRole('link', { name: literal(label) })).toBeVisible()
  })
})
