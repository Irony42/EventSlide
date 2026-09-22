import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { aGuestMission, renderWithProviders } from '../../../testing/renderWithProviders'
import { MissionChecklist } from './MissionChecklist'

describe('MissionChecklist', () => {
  it('renders nothing when the host set no prompts, which is most events', () => {
    // The upload screen is then exactly the screen it was before this feature existed.
    renderWithProviders(<MissionChecklist missions={[]} selected={null} onToggle={vi.fn()} />)

    expect(screen.queryByRole('heading', { name: fr.upload.missionsTitle })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('offers each prompt as something to press', async () => {
    renderWithProviders(
      <MissionChecklist
        missions={[
          aGuestMission({ id: 'm1', prompt: 'un selfie avec les mariés' }),
          aGuestMission({ id: 'm2', prompt: 'la pire figure de danse' }),
        ]}
        selected={null}
        onToggle={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: fr.upload.missionSelect('un selfie avec les mariés') }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: fr.upload.missionSelect('la pire figure de danse') }),
    ).toBeVisible()
  })

  it('chooses a prompt with one tap', async () => {
    const onToggle = vi.fn()
    renderWithProviders(
      <MissionChecklist
        missions={[aGuestMission({ id: 'm1', prompt: 'un selfie' })]}
        selected={null}
        onToggle={onToggle}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: fr.upload.missionSelect('un selfie') }),
    )

    expect(onToggle).toHaveBeenCalledWith('m1')
  })

  it('reports the chosen prompt as pressed, so a screen reader hears the choice', () => {
    renderWithProviders(
      <MissionChecklist
        missions={[
          aGuestMission({ id: 'm1', prompt: 'un selfie' }),
          aGuestMission({ id: 'm2', prompt: 'la danse' }),
        ]}
        selected="m1"
        onToggle={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: fr.upload.missionSelect('un selfie') }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: fr.upload.missionSelect('la danse') }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('offers the same tap again to take the choice back', async () => {
    // A radio group has no "none of these", and adding one would be a thirteenth row
    // that says nothing.
    const onToggle = vi.fn()
    renderWithProviders(
      <MissionChecklist
        missions={[aGuestMission({ id: 'm1', prompt: 'un selfie' })]}
        selected="m1"
        onToggle={onToggle}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: fr.upload.missionSelect('un selfie') }),
    )

    expect(onToggle).toHaveBeenCalledWith('m1')
  })

  it('says a prompt is done, in a word and not only in a colour', () => {
    renderWithProviders(
      <MissionChecklist
        missions={[aGuestMission({ id: 'm1', prompt: 'un selfie', scope: 'guest', done: true })]}
        selected={null}
        onToggle={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /un selfie/ })).toHaveTextContent(
      fr.upload.missionDone,
    )
  })

  it('says a once-for-the-evening prompt somebody else answered in different words', () => {
    // Without the second wording, a row the guest never touched simply reads as a bug.
    renderWithProviders(
      <MissionChecklist
        missions={[
          aGuestMission({ id: 'm1', prompt: 'la première danse', scope: 'event', done: true }),
        ]}
        selected={null}
        onToggle={vi.fn()}
      />,
    )

    const row = screen.getByRole('button', { name: /la première danse/ })
    expect(row).toHaveTextContent(fr.upload.missionDoneByRoom)
    expect(row).not.toHaveTextContent(fr.upload.missionDone)
  })

  it('leaves a done prompt pressable, because a guest may have a better photograph', async () => {
    const onToggle = vi.fn()
    renderWithProviders(
      <MissionChecklist
        missions={[aGuestMission({ id: 'm1', prompt: 'un selfie', done: true })]}
        selected={null}
        onToggle={onToggle}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /un selfie/ }))

    expect(onToggle).toHaveBeenCalledWith('m1')
  })

  it('renders a prompt as text, never as markup', () => {
    renderWithProviders(
      <MissionChecklist
        missions={[aGuestMission({ prompt: '<b>gras</b>' })]}
        selected={null}
        onToggle={vi.fn()}
      />,
    )

    const row = screen.getByRole('button', { name: /gras/ })
    expect(row).toHaveTextContent('<b>gras</b>')
    expect(row.querySelector('b')).toBeNull()
  })
})
