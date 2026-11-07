import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../testing/renderWithProviders'
import { HostLogo } from './HostLogo'

const URL_OK = `/api/events/soiree/logo/${'a'.repeat(64)}`

describe('HostLogo', () => {
  it.each([
    [null],
    [undefined],
    ['https://evil.example/logo.png'],
    ['/api/events/soiree/logo/short'],
    ['javascript:alert(1)'],
  ])('draws nothing for %o', (url) => {
    renderWithProviders(<HostLogo url={url} eventName="Soirée" />)

    expect(screen.queryByTestId('host-logo')).toBeNull()
  })

  it('draws the logo the server minted, named after the event', () => {
    renderWithProviders(<HostLogo url={URL_OK} eventName="Soirée" variant="compact" />)

    const image = screen.getByRole('img', { name: 'Logo de Soirée' })
    expect(image.getAttribute('src')).toBe(URL_OK)
  })
})
