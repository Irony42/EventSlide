import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FrenchSurface, LocaleProvider } from './LocaleProvider'
import { readStoredLocale } from './localePreference'
import { useLocale, useTranslations } from './useTranslations'
import { de } from './de'
import { fr } from './fr'

/**
 * The provider, and the boundary that stops a guest's choice reaching the host console.
 *
 * Surface: the guest. Ring 5 — this is a component and its collaborators are a browser
 * API and a lookup table, both of which jsdom has.
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

describe('FrenchSurface', () => {
  it('renders French inside a tree the guest set to German', () => {
    // The scope decision, as the tree enforces it. Without this the shared primitives —
    // `ConfirmDialog`, `Dialog`, `Field`, `Progress`, `Toast` — would render "Cancel"
    // and "Confirm" inside an otherwise French moderation dialog on any host whose
    // browser is not set to French. That host never chose anything: detection reads
    // `navigator.languages`.
    browserSpeaks('de-DE')

    render(
      <LocaleProvider>
        <FrenchSurface>
          <Screen />
        </FrenchSurface>
      </LocaleProvider>,
    )

    expect(screen.getByText(fr.upload.send)).toBeInTheDocument()
    expect(screen.getByTestId('locale')).toHaveTextContent('fr')
  })
})
