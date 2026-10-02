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
      anAbout({ links: { terms: 'https://example.org/terms' } }),
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
