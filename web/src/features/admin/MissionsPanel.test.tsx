import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aMission, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { MissionsPanel } from './MissionsPanel'
import type { Api } from '../../lib/api/client'
import type { MissionDto } from '../../lib/api/dto'

const SLUG = 'camille-et-sacha'

const withMissions = (...missions: readonly MissionDto[]): Partial<Api> => ({
  listMissions: vi.fn(async () => ({ items: missions })),
})

const render = (api: Api) => renderWithProviders(<MissionsPanel slug={SLUG} />, { api })

const type = async (label: string, value: string): Promise<void> => {
  const field = screen.getByLabelText(label)
  await userEvent.clear(field)
  await userEvent.type(field, value)
}

describe('MissionsPanel', () => {
  it('says the list is empty rather than showing nothing at all', async () => {
    render(fakeApi())

    expect(await screen.findByText(fr.admin.missionsEmpty)).toBeVisible()
  })

  it('lists the prompts the host set, with how the room is answering each', async () => {
    render(
      fakeApi(
        withMissions(
          aMission({
            id: 'm1',
            prompt: 'un selfie avec les mariés',
            achieved: true,
            publishedPhotos: 17,
            completedByGuests: 12,
          }),
        ),
      ),
    )

    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('un selfie avec les mariés')
    expect(row).toHaveTextContent(fr.admin.missionAnswered(17, 12))
  })

  it('says a prompt is unanswered rather than printing zeroes', async () => {
    render(fakeApi(withMissions(aMission({ prompt: 'un selfie', achieved: false }))))

    expect(await screen.findByText(fr.admin.missionUnanswered)).toBeVisible()
  })

  it('names which prompt is asked of each guest and which is asked once', async () => {
    render(
      fakeApi(
        withMissions(
          aMission({ id: 'm1', prompt: 'un selfie', scope: 'guest' }),
          aMission({ id: 'm2', prompt: 'la première danse', scope: 'event' }),
        ),
      ),
    )

    const rows = await screen.findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent(fr.admin.missionScopeGuest)
    expect(rows[1]).toHaveTextContent(fr.admin.missionScopeEvent)
  })

  it('adds a prompt and reloads the list', async () => {
    const listMissions = vi.fn(async () => ({ items: [] as readonly MissionDto[] }))
    const api = fakeApi({ listMissions, createMission: vi.fn(async () => aMission()) })
    render(api)
    await screen.findByText(fr.admin.missionsEmpty)

    await type(fr.admin.missionPrompt, 'quelqu’un qui pleure')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.missionAdd }))

    await waitFor(() =>
      expect(api.createMission).toHaveBeenCalledWith(SLUG, {
        prompt: 'quelqu’un qui pleure',
        scope: 'guest',
      }),
    )
    await waitFor(() => expect(listMissions).toHaveBeenCalledTimes(2))
  })

  it('sends the scope the host chose', async () => {
    const api = fakeApi({ createMission: vi.fn(async () => aMission()) })
    render(api)
    await screen.findByText(fr.admin.missionsEmpty)

    await type(fr.admin.missionPrompt, 'la première danse')
    await userEvent.selectOptions(
      screen.getByLabelText(fr.admin.missionScope),
      fr.admin.missionScopeEvent,
    )
    await userEvent.click(screen.getByRole('button', { name: fr.admin.missionAdd }))

    await waitFor(() =>
      expect(api.createMission).toHaveBeenCalledWith(SLUG, {
        prompt: 'la première danse',
        scope: 'event',
      }),
    )
  })

  it('shows the server"s refusal against the field rather than as a toast', async () => {
    const api = fakeApi({
      createMission: vi.fn(async () => {
        throw new ApiError(409, 'mission.duplicate')
      }),
    })
    render(api)
    await screen.findByText(fr.admin.missionsEmpty)

    await type(fr.admin.missionPrompt, 'un selfie')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.missionAdd }))

    expect(await screen.findByText(fr.errors['mission.duplicate'])).toBeVisible()
  })

  it('corrects a prompt in place, keeping the photographs already filed under it', async () => {
    // The whole reason editing exists: delete-and-recreate unfiles them.
    const api = fakeApi({
      ...withMissions(aMission({ id: 'm1', prompt: 'un selfi avec les mariés' })),
      updateMission: vi.fn(async () => undefined),
    })
    render(api)
    await screen.findByRole('listitem')

    await userEvent.click(
      screen.getByRole('button', { name: fr.admin.missionEdit('un selfi avec les mariés') }),
    )
    await type(fr.admin.missionPrompt, 'un selfie avec les mariés')
    await userEvent.click(screen.getByRole('button', { name: fr.admin.missionSave }))

    await waitFor(() =>
      expect(api.updateMission).toHaveBeenCalledWith(SLUG, 'm1', {
        prompt: 'un selfie avec les mariés',
        scope: 'guest',
      }),
    )
  })

  it('lets the host abandon a correction without changing anything', async () => {
    const api = fakeApi({
      ...withMissions(aMission({ id: 'm1', prompt: 'un selfie' })),
      updateMission: vi.fn(async () => undefined),
    })
    render(api)
    await screen.findByRole('listitem')

    await userEvent.click(screen.getByRole('button', { name: fr.admin.missionEdit('un selfie') }))
    await userEvent.click(screen.getByRole('button', { name: fr.admin.missionCancel }))

    expect(screen.getByRole('button', { name: fr.admin.missionAdd })).toBeVisible()
    expect(api.updateMission).not.toHaveBeenCalled()
  })

  it('asks before deleting, and says the photographs are safe', async () => {
    const api = fakeApi({
      ...withMissions(aMission({ id: 'm1', prompt: 'un selfie' })),
      deleteMission: vi.fn(async () => undefined),
    })
    render(api)
    await screen.findByRole('listitem')

    await userEvent.click(screen.getByRole('button', { name: fr.admin.missionDelete('un selfie') }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(fr.admin.missionDeleteConfirm)).toBeVisible()
    expect(api.deleteMission).not.toHaveBeenCalled()
  })

  it('deletes once the host confirms', async () => {
    const api = fakeApi({
      ...withMissions(aMission({ id: 'm1', prompt: 'un selfie' })),
      deleteMission: vi.fn(async () => undefined),
    })
    render(api)
    await screen.findByRole('listitem')

    await userEvent.click(screen.getByRole('button', { name: fr.admin.missionDelete('un selfie') }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: fr.admin.missionDeleteAction }),
    )

    await waitFor(() => expect(api.deleteMission).toHaveBeenCalledWith(SLUG, 'm1'))
  })

  it('stops offering a thirteenth prompt, and says why', async () => {
    const full = Array.from({ length: 12 }, (_, index) =>
      aMission({ id: `m${index}`, prompt: `consigne ${index}` }),
    )
    render(fakeApi(withMissions(...full)))
    await screen.findAllByRole('listitem')

    expect(screen.getByLabelText(fr.admin.missionPrompt)).toBeDisabled()
    expect(screen.getByRole('button', { name: fr.admin.missionAdd })).toBeDisabled()
    expect(screen.getByText(fr.admin.missionsFull(12))).toBeVisible()
  })

  it('still lets a full list be corrected, because the ceiling is on adding', async () => {
    const full = Array.from({ length: 12 }, (_, index) =>
      aMission({ id: `m${index}`, prompt: `consigne ${index}` }),
    )
    render(fakeApi(withMissions(...full)))
    await screen.findAllByRole('listitem')

    await userEvent.click(screen.getByRole('button', { name: fr.admin.missionEdit('consigne 0') }))

    expect(screen.getByLabelText(fr.admin.missionPrompt)).toBeEnabled()
    expect(screen.getByRole('button', { name: fr.admin.missionSave })).toBeEnabled()
  })

  it('offers a retry when the list could not be read', async () => {
    const api = fakeApi({
      listMissions: vi.fn(async () => {
        throw new ApiError(500, 'unknown')
      }),
    })
    render(api)

    expect(await screen.findByRole('button', { name: fr.app.retry })).toBeVisible()
  })

  it('renders a prompt as text, never as markup', () => {
    render(fakeApi(withMissions(aMission({ prompt: '<b>gras</b>' }))))

    return waitFor(() => {
      const row = screen.getByRole('listitem')
      expect(row).toHaveTextContent('<b>gras</b>')
      expect(row.querySelector('b')).toBeNull()
    })
  })
})
