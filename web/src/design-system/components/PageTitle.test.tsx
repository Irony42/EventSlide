import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../testing/renderWithProviders'
import { PageTitle } from './PageTitle'

describe('PageTitle', () => {
  let shellTitle: HTMLTitleElement

  // The document the app really boots in: `web/index.html` ships its own `<title>`, and
  // React inserts the page's title ahead of it. jsdom starts with none.
  beforeEach(() => {
    shellTitle = document.createElement('title')
    shellTitle.textContent = 'EventSlide'
    document.head.prepend(shellTitle)
  })

  afterEach(() => {
    shellTitle.remove()
  })

  it('names the tab after the page, followed by the product', () => {
    renderWithProviders(<PageTitle title="Modération" />)

    // WCAG 2.4.2: every address carried the same `<title>EventSlide</title>`, so a host
    // with the console, the wall and the phone console open could not tell the tabs apart.
    expect(document.title).toBe('Modération · EventSlide')
  })

  it('follows the page when its title changes', () => {
    const { rerender } = renderWithProviders(<PageTitle title="Connexion" />)

    rerender(<PageTitle title="Mot de passe oublié" />)

    expect(document.title).toBe('Mot de passe oublié · EventSlide')
  })

  it('gives the tab back to the previous title when the page leaves', () => {
    const { unmount } = renderWithProviders(<PageTitle title="Connexion" />)
    expect(document.title).toBe('Connexion · EventSlide')

    unmount()

    // Back to the document's own `<title>` from `index.html`, which is what a tab shows
    // while a lazy chunk is still arriving.
    expect(document.title).toBe('EventSlide')
  })

  it('hoists into the head and leaves the page body alone', () => {
    renderWithProviders(<PageTitle title="Connexion" />)

    expect(document.body.querySelector('title')).toBeNull()
    expect(screen.queryByText('Connexion · EventSlide')).toBeNull()
    // The page's, ahead of the shell's: a browser reads the first one.
    expect(document.head.querySelector('title')).toHaveTextContent('Connexion · EventSlide')
  })
})
