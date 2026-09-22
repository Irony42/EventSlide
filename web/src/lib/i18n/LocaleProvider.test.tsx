import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeferredLocale, LocaleOverride, LocaleProvider } from './LocaleProvider'
import { useAnnounceLocale } from './deferredLocale'
import { readStoredLocale } from './localePreference'
import { useLocale, useTranslations } from './useTranslations'
import { de } from './de'
import { es } from './es'
import { fr } from './fr'
import { it as italian } from './it'
import type { Locale } from './locale'

/**
 * The provider, and the two boundaries around it.
 *
 * Ring 5: these are components, and their collaborators are a browser API and a lookup
 * table, both of which jsdom has. `it` from `./it` is imported as `italian` because
 * vitest's own `it` is the test function.
 */

const browserSpeaks = (...languages: readonly string[]): void => {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages)
}

/** Renders one string from the active table, plus the control that changes it. */
function Screen() {
  const { locale, setLocale } = useLocale()
  const text = useTranslations()

  return (
    <div>
      <p>{text.upload.send}</p>
      <p data-testid="locale">{locale}</p>
      <button type="button" onClick={() => setLocale('de')}>
        wechseln
      </button>
    </div>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LocaleProvider', () => {
  it('renders the guest surface in the language the browser asked for', () => {
    browserSpeaks('de-AT')

    render(
      <LocaleProvider>
        <Screen />
      </LocaleProvider>,
    )

    expect(screen.getByText(de.upload.send)).toBeInTheDocument()
  })

  it('paints the detected language on the first render, never French first', () => {
    // Detection happens in the `useState` initialiser rather than in an effect. An
    // effect would paint the join screen in French and repaint it in German, which on a
    // phone reads as a bug and on a slow one is a visible flash of the wrong language.
    browserSpeaks('de-DE')

    const { container } = render(
      <LocaleProvider>
        <Screen />
      </LocaleProvider>,
    )

    expect(container.textContent).not.toContain(fr.upload.send)
  })

  it('remembers what the guest chose, so a reload does not undo it', async () => {
    // The whole persistence requirement, stated as a guest would experience it: pick a
    // language, drop the page, come back to the same one. No account involved.
    browserSpeaks('fr-FR')

    const { unmount } = render(
      <LocaleProvider>
        <Screen />
      </LocaleProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'wechseln' }))
    expect(screen.getByText(de.upload.send)).toBeInTheDocument()

    unmount()
    expect(readStoredLocale()).toBe('de')

    render(
      <LocaleProvider>
        <Screen />
      </LocaleProvider>,
    )
    expect(screen.getByText(de.upload.send)).toBeInTheDocument()
  })

  it('starts where a test tells it to, whatever the machine running the suite speaks', () => {
    browserSpeaks('es-ES')

    render(
      <LocaleProvider initialLocale="it">
        <Screen />
      </LocaleProvider>,
    )

    expect(screen.getByTestId('locale')).toHaveTextContent('it')
  })
})

describe('LocaleOverride', () => {
  it('renders one surface in its own language inside a tree the reader set to German', () => {
    // Without this the shared primitives — `Dialog`, `Field`, `Progress`, `Toast` —
    // render "Abbrechen" inside an otherwise Italian wall panel, decided by whichever
    // laptop was plugged into the projector.
    browserSpeaks('de-DE')

    render(
      <LocaleProvider>
        <LocaleOverride locale="it">
          <Screen />
        </LocaleOverride>
      </LocaleProvider>,
    )

    expect(screen.getByText(italian.upload.send)).toBeInTheDocument()
    expect(screen.getByTestId('locale')).toHaveTextContent('it')
  })

  it('offers no way to change it, because nobody at that surface can be asked', () => {
    // `setLocale` is a no-op inside the override rather than absent, so a shared control
    // that happens to render under it does nothing instead of throwing on a projector.
    browserSpeaks('de-DE')

    render(
      <LocaleProvider>
        <LocaleOverride locale="it">
          <Screen />
        </LocaleOverride>
      </LocaleProvider>,
    )

    return userEvent.click(screen.getByRole('button', { name: 'wechseln' })).then(() => {
      expect(screen.getByTestId('locale')).toHaveTextContent('it')
    })
  })
})

describe('DeferredLocale', () => {
  /** The wall's shape: a shell that renders before its language has arrived. */
  function Announcing({ locale }: { readonly locale: Locale | null }) {
    const announce = useAnnounceLocale()

    useEffect(() => {
      if (locale !== null) announce(locale)
    }, [locale, announce])

    return <Screen />
  }

  it('renders the default until the surface says what language it is in', () => {
    // Before the response there is no event, so no event language — and reading the
    // browser would read the projector operator's laptop, which this exists to refuse.
    browserSpeaks('de-DE')

    render(
      <LocaleProvider>
        <DeferredLocale>
          <Announcing locale={null} />
        </DeferredLocale>
      </LocaleProvider>,
    )

    expect(screen.getByTestId('locale')).toHaveTextContent('fr')
    expect(screen.queryByText(de.upload.send)).not.toBeInTheDocument()
  })

  it('follows the language the surface announces', () => {
    browserSpeaks('de-DE')

    render(
      <LocaleProvider>
        <DeferredLocale>
          <Announcing locale="es" />
        </DeferredLocale>
      </LocaleProvider>,
    )

    expect(screen.getByTestId('locale')).toHaveTextContent('es')
    expect(screen.getByText(es.upload.send)).toBeInTheDocument()
  })
})
