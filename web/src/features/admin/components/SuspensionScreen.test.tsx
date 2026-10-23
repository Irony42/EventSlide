import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { SuspensionScreen } from './SuspensionScreen'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'

/**
 * The screen of a suspended account (G2-16 / P3-17). It explains and does not lock: reading and
 * exporting still work, so what it must say is that they do, and what no longer does.
 */
describe('SuspensionScreen', () => {
  it('says the account is suspended, and what that leaves the client able to do', () => {
    renderWithProviders(<SuspensionScreen contact={null} />)

    expect(screen.getByRole('status')).toHaveTextContent(fr.clientSpace.suspendedTitle)
    expect(screen.getByRole('status')).toHaveTextContent(fr.clientSpace.suspendedBody)
    expect(screen.getByRole('heading', { name: fr.clientSpace.suspendedTitle })).toBeVisible()
  })

  it('leads to the operator’s own address when the box published one', () => {
    renderWithProviders(<SuspensionScreen contact={{ href: 'mailto:ops@example.org' }} />)

    expect(screen.getByRole('link', { name: fr.clientSpace.contactAction })).toHaveAttribute(
      'href',
      'mailto:ops@example.org',
    )
  })

  it('says "contact your operator" in words when the box published no address', () => {
    renderWithProviders(<SuspensionScreen contact={null} />)

    expect(screen.getByText(fr.clientSpace.contactHint)).toBeVisible()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
