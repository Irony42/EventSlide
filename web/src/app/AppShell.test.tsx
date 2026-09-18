import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell, MAIN_CONTENT_ID } from './AppShell'
import { fr } from '../lib/i18n/fr'
import { LocaleProvider } from '../lib/i18n/LocaleProvider'
import { SUPPORTED_LOCALES } from '../lib/i18n/locale'

describe('AppShell', () => {
  // `<html lang>` is a global that outlives `cleanup()`, and this component is the only
  // thing in the app that writes it. Putting it back the way `index.html` ships it stops
  // a test that rendered German from deciding what the next test's page claims to be.
  afterEach(() => {
    document.documentElement.lang = 'fr'
  })

  it('puts a skip link first in the tab order, pointing at the main landmark', async () => {
    render(
      <AppShell surface="host">
        <p>Contenu</p>
      </AppShell>,
    )

    await userEvent.tab()

    const skip = screen.getByRole('link', { name: fr.shell.skipToContent })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`)
    expect(screen.getByRole('main')).toHaveAttribute('id', MAIN_CONTENT_ID)
  })

  it('renders its children inside the main landmark', () => {
    render(
      <AppShell surface="guest">
        <p>Contenu</p>
      </AppShell>,
    )

    expect(screen.getByRole('main')).toContainElement(screen.getByText('Contenu'))
  })

  it('renders a header above the main landmark when one is given', () => {
    render(
      <AppShell surface="host" header={<header>Barre</header>}>
        <p>Contenu</p>
      </AppShell>,
    )

    expect(screen.getByText('Barre')).toBeVisible()
  })

  it.each([
    ['guest', 'guest'],
    ['host', 'host'],
    ['wall', 'wall'],
  ] as const)('gives the %s surface its own container', (surface, expected) => {
    render(
      <AppShell surface={surface}>
        <p>Contenu</p>
      </AppShell>,
    )

    // The container width is the whole job of this component, and it is per surface:
    // a laptop-comfortable measure is unreadable held at arm's length on a phone.
    expect(screen.getByRole('main').className).toContain(expected)
  })

  it.each([...SUPPORTED_LOCALES])(
    'announces the page in %s when that is the language on screen',
    (locale) => {
      // CLAUDE.md §6: `<html lang>` follows the language actually on screen, and this is
      // the one component every surface renders through — so it is set here and nowhere
      // else. It is not cosmetic. It decides which voice a screen reader pronounces the
      // page with, so a German guest reading German copy announced with French phonemes
      // is the bug, and it is the core of roadmap §1.5.
      //
      // Every locale rather than one, because the rule is "follows" rather than "equals
      // something": a constant here passed the entire web suite.
      render(
        <LocaleProvider initialLocale={locale}>
          <AppShell surface="guest">
            <p>Contenu</p>
          </AppShell>
        </LocaleProvider>,
      )

      expect(document.documentElement).toHaveAttribute('lang', locale)
    },
  )

  /**
   * The glass budget reaches the DOM here and nowhere else — roadmap 11.3.
   *
   * On the shell rather than on `<main>`, because the skip link and any header the
   * surface renders are outside `<main>` and they have to inherit the same material.
   */
  it('marks the wall as the surface that cannot afford the blur', () => {
    render(
      <AppShell surface="wall">
        <p>Contenu</p>
      </AppShell>,
    )

    expect(screen.getByRole('main').closest('[data-glass]')).toHaveAttribute('data-glass', 'opaque')
  })

  it.each(['guest', 'host'] as const)('leaves the %s surface DOM untouched', (surface) => {
    // Absent, not `data-glass="photo"`. A surface held to the strict floor renders exactly
    // what it rendered before the material existed — and that floor is what a shell given
    // no backdrop at all is held to.
    render(
      <AppShell surface={surface}>
        <p>Contenu</p>
      </AppShell>,
    )

    expect(screen.getByRole('main').closest('[data-glass]')).toBeNull()
  })

  /**
   * The tint tier reaches the DOM here too — roadmap 11.2.
   *
   * Same element and same mechanism as the budget above, because they are two answers to
   * one question the surface has to carry: what the material costs here, and what can be
   * painted underneath it. `router.tsx` supplies the second from `glassBackdrop.ts`.
   */
  it.each(['guest', 'host'] as const)(
    'marks the %s surface translucent when the address has earned it',
    (surface) => {
      render(
        <AppShell surface={surface} backdrop="ground">
          <p>Contenu</p>
        </AppShell>,
      )

      expect(screen.getByRole('main').closest('[data-glass]')).toHaveAttribute(
        'data-glass',
        'ground',
      )
    },
  )

  it('keeps the room opaque even on an address with no photograph on it', () => {
    // The budget outranks the backdrop. A wall that took the translucent tier would be a
    // blur back on the projector, which is the one outcome roadmap 11.3 decides in advance.
    render(
      <AppShell surface="wall" backdrop="ground">
        <p>Contenu</p>
      </AppShell>,
    )

    expect(screen.getByRole('main').closest('[data-glass]')).toHaveAttribute('data-glass', 'opaque')
  })
})
