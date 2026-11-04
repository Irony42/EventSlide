import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { WallSoundButton } from './WallSoundButton'

describe('the wall sound button (spec 12)', () => {
  it('draws nothing while it is not needed, and so nothing on a wall that is already allowed', () => {
    renderWithProviders(<WallSoundButton visible={false} onActivate={() => undefined} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is named, and asks this screen to carry the sound when pressed', async () => {
    const onActivate = vi.fn()
    renderWithProviders(<WallSoundButton visible onActivate={onActivate} />)

    await userEvent.click(screen.getByRole('button', { name: fr.wall.soundActivate }))

    expect(onActivate).toHaveBeenCalledTimes(1)
  })
})
