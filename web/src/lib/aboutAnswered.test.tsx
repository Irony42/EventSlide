import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { AboutProvider } from './AboutProvider'
import { ApiProvider } from './ApiProvider'
import { useAboutAnswered } from './useAbout'
import { anAbout, fakeApi } from '../testing/renderWithProviders'

/**
 * Whether the box has answered `GET /api/about`, for the one screen that cannot be decided before
 * it has (the operator's console, whose address exists only on a box that says so).
 */

function Probe() {
  return <p>{useAboutAnswered() ? 'answered' : 'waiting'}</p>
}

const mount = (about: () => Promise<ReturnType<typeof anAbout>>) =>
  render(
    <ApiProvider api={fakeApi({ about: vi.fn(about) })}>
      <AboutProvider>
        <Probe />
      </AboutProvider>
    </ApiProvider>,
  )

describe('useAboutAnswered', () => {
  it('says waiting until the server has answered, and answered once it has', async () => {
    let answer: (value: ReturnType<typeof anAbout>) => void = () => undefined
    mount(() => new Promise((resolve) => (answer = resolve)))

    expect(screen.getByText('waiting')).toBeVisible()
    await act(async () => answer(anAbout()))

    expect(await screen.findByText('answered')).toBeVisible()
  })

  it('says answered when the request failed, because a failure is an answer and the build’s own is the strict one', async () => {
    mount(() => Promise.reject(new Error('offline')))

    expect(await screen.findByText('answered')).toBeVisible()
  })

  it('says answered with no provider above, which has nothing to wait for', () => {
    render(<Probe />)

    expect(screen.getByText('answered')).toBeVisible()
  })
})
