import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ApiProvider, useApi } from './ApiProvider'
import { fakeApi } from '../testing/renderWithProviders'

const Probe = () => {
  const api = useApi()
  return <p>{api.albumUrl('camille-et-sacha')}</p>
}

describe('useApi', () => {
  it('hands a component the injected API', () => {
    const api = fakeApi()

    render(
      <ApiProvider api={api}>
        <Probe />
      </ApiProvider>,
    )

    expect(screen.getByText('/api/events/camille-et-sacha/album.zip')).toBeInTheDocument()
  })

  it('fails loudly outside a provider instead of silently reaching the real server', () => {
    const failure = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Probe />)).toThrow(/ApiProvider/)

    failure.mockRestore()
  })
})
