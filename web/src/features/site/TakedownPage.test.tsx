import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import { ApiError } from '../../lib/http'
import type { Api } from '../../lib/api/client'
import type { SiteEventStateDto, SitePhotoStateDto } from '../../lib/api/dto'
import { CLIENT_ID, EVENT_ID } from '../../testing/siteFixtures'
import {
  callsOutsideTheConsole,
  consoleApi,
  openConsole,
  stepUpRequired,
} from '../../testing/siteConsole'

/**
 * The operator's "remove without viewing" screen (launch review S5), ring 5 and through the route
 * table: finding an event or a photograph from what a report quoted, and the six acts, each with a
 * reason, a confirmation that says what it does and the step-up the server asks for.
 *
 * What is held beyond the acts: **nothing on this screen can show content**. The server sends ids,
 * statuses and instants, and the screen has no element that could print or load anything else; the
 * last block reads the page for exactly that.
 */

const PHOTO_ID = '99999999-9999-4999-8999-999999999999'
const AT = '2026-10-30T09:00:00.000Z'
const SLUG = 'mariage-de-camille'

const anEvent = (overrides: Partial<SiteEventStateDto> = {}): SiteEventStateDto => ({
  id: EVENT_ID,
  clientId: CLIENT_ID,
  status: 'live',
  createdAt: '2026-06-20T10:00:00.000Z',
  takenDownAt: null,
  purgeHeldAt: null,
  ...overrides,
})

const aPhoto = (overrides: Partial<SitePhotoStateDto> = {}): SitePhotoStateDto => ({
  id: PHOTO_ID,
  eventId: EVENT_ID,
  takenDownAt: null,
  ...overrides,
})

const open = (api: Api) => openConsole('/admin/site/takedown', api)

const dialog = (name: string) => screen.findByRole('dialog', { name })

const REASON = 'Signalement reçu, retrait conservatoire'

/** Types what a report quoted and searches, returning the row that comes back. */
const findEvent = async (query = SLUG) => {
  await userEvent.type(await screen.findByLabelText(fr.site.takedownEventLabel), query)
  await userEvent.click(screen.getByRole('button', { name: fr.site.takedownEventAction }))
  return screen.findByRole('heading', { name: fr.site.takedownEventHeading(EVENT_ID) })
}

const findPhoto = async () => {
  await userEvent.type(await screen.findByLabelText(fr.site.takedownPhotoLabel), PHOTO_ID)
  await userEvent.click(screen.getByRole('button', { name: fr.site.takedownPhotoAction }))
  return screen.findByRole('heading', { name: fr.site.takedownPhotoHeading(PHOTO_ID) })
}

const confirmYourself = async () => {
  const prompt = await dialog(fr.site.stepUpTitle)
  await userEvent.type(within(prompt).getByLabelText(fr.auth.password), 'le mot de passe')
  await userEvent.type(within(prompt).getByLabelText(fr.auth.secondFactorCode), '123456')
  await userEvent.click(within(prompt).getByRole('button', { name: fr.auth.stepUpSubmit }))
}

describe('finding an event from what a report quoted', () => {
  it('sends what was typed, and shows the event as an id, a state and a client, never a name', async () => {
    const siteLookupEvents = vi.fn<Api['siteLookupEvents']>(async () => ({
      items: [anEvent()],
    }))
    const api = consoleApi({ siteLookupEvents })
    open(api)

    await findEvent()

    expect(siteLookupEvents).toHaveBeenCalledWith(SLUG)
    expect(screen.getByText(fr.site.takedownStateUp)).toBeVisible()
    expect(screen.getByText(fr.site.takedownStateFree)).toBeVisible()
    expect(screen.getByRole('link', { name: fr.site.takedownClient })).toHaveAttribute(
      'href',
      `/admin/site/clients/${CLIENT_ID}`,
    )
    expect(screen.queryByText(SLUG)).toBeNull()
    expect(callsOutsideTheConsole(api)).toEqual([])
  })

  it('says that nothing matched, and that a name must be exact', async () => {
    open(consoleApi({ siteLookupEvents: vi.fn(async () => ({ items: [] })) }))

    await userEvent.type(await screen.findByLabelText(fr.site.takedownEventLabel), 'Mariage')
    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownEventAction }))

    expect(await screen.findByText(fr.site.takedownEventNone)).toBeVisible()
  })

  it('says what the server said when it refuses the query', async () => {
    open(
      consoleApi({
        siteLookupEvents: vi.fn(async () => {
          throw new ApiError(400, 'siteLookup.queryInvalid')
        }),
      }),
    )

    await userEvent.type(await screen.findByLabelText(fr.site.takedownEventLabel), 'x')
    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownEventAction }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['siteLookup.queryInvalid'])
  })

  it('shows an event with no client without a link, and an event that is down and held as such', async () => {
    open(
      consoleApi({
        siteLookupEvents: vi.fn(async () => ({
          items: [anEvent({ clientId: null, takenDownAt: AT, purgeHeldAt: AT })],
        })),
      }),
    )

    await findEvent()

    expect(screen.getByText(fr.site.takedownStateDown)).toBeVisible()
    expect(screen.getByText(fr.site.takedownStateHeld)).toBeVisible()
    expect(screen.queryByRole('link', { name: fr.site.takedownClient })).toBeNull()
    expect(screen.getByRole('button', { name: fr.site.takedownEventUp })).toBeVisible()
    expect(screen.getByRole('button', { name: fr.site.takedownRelease })).toBeVisible()
  })
})

describe('acting on an event', () => {
  const withEvent = (extra: Partial<Api> = {}, first: SiteEventStateDto = anEvent()) =>
    consoleApi({
      siteLookupEvents: vi.fn(async () => ({ items: [first] })),
      ...extra,
    })

  it('says what taking an event down does, asks for a reason, and does not offer the act without one', async () => {
    open(withEvent())
    await findEvent()

    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownEventDown }))
    const confirmation = await dialog(fr.site.takedownOps.eventDown.title)

    expect(confirmation).toHaveTextContent(fr.site.takedownOps.eventDown.body)
    // And which event it is about, so a mis-clicked row cannot look like the one meant.
    expect(confirmation).toHaveTextContent(EVENT_ID)
    expect(
      within(confirmation).getByRole('button', { name: fr.site.takedownOps.eventDown.confirm }),
    ).toBeDisabled()
  })

  it('sends the id and the reason, reads the state back, and offers to put it back', async () => {
    const siteTakeDownEvent = vi.fn<Api['siteTakeDownEvent']>(async () => undefined)
    const siteEventState = vi.fn<Api['siteEventState']>(async () => anEvent({ takenDownAt: AT }))
    open(withEvent({ siteTakeDownEvent, siteEventState }))
    await findEvent()

    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownEventDown }))
    const confirmation = await dialog(fr.site.takedownOps.eventDown.title)
    await userEvent.type(within(confirmation).getByLabelText(fr.site.takedownReason), REASON)
    await userEvent.click(
      within(confirmation).getByRole('button', { name: fr.site.takedownOps.eventDown.confirm }),
    )

    expect(await screen.findByText(fr.site.takedownStateDown)).toBeVisible()
    expect(siteTakeDownEvent).toHaveBeenCalledWith(EVENT_ID, REASON)
    expect(siteEventState).toHaveBeenCalledWith(EVENT_ID)
    expect(screen.getByRole('button', { name: fr.site.takedownEventUp })).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each([
    ['holds the purge', fr.site.takedownHold, fr.site.takedownOps.purgeHold, 'siteHoldEventPurge'],
    [
      'puts an event back',
      fr.site.takedownEventUp,
      fr.site.takedownOps.eventUp,
      'siteRestoreEvent',
    ],
    [
      'releases a hold',
      fr.site.takedownRelease,
      fr.site.takedownOps.purgeRelease,
      'siteReleaseEventPurge',
    ],
  ] as const)('%s with its own request', async (_what, button, copy, method) => {
    const started: SiteEventStateDto =
      method === 'siteHoldEventPurge'
        ? anEvent()
        : method === 'siteRestoreEvent'
          ? anEvent({ takenDownAt: AT })
          : anEvent({ purgeHeldAt: AT })
    const write = vi.fn(async () => undefined)
    open(withEvent({ [method]: write, siteEventState: vi.fn(async () => started) }, started))
    await findEvent()

    await userEvent.click(screen.getByRole('button', { name: button }))
    const confirmation = await dialog(copy.title)
    await userEvent.type(within(confirmation).getByLabelText(fr.site.takedownReason), REASON)
    await userEvent.click(within(confirmation).getByRole('button', { name: copy.confirm }))

    await waitFor(() => expect(write).toHaveBeenCalledWith(EVENT_ID, REASON))
  })

  it('asks the operator to confirm themselves when the server says so, and sends the act again', async () => {
    const siteTakeDownEvent = vi
      .fn<Api['siteTakeDownEvent']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue(undefined)
    const api = withEvent({
      siteTakeDownEvent,
      siteEventState: vi.fn(async () => anEvent({ takenDownAt: AT })),
    })
    open(api)
    await findEvent()

    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownEventDown }))
    const confirmation = await dialog(fr.site.takedownOps.eventDown.title)
    await userEvent.type(within(confirmation).getByLabelText(fr.site.takedownReason), REASON)
    await userEvent.click(
      within(confirmation).getByRole('button', { name: fr.site.takedownOps.eventDown.confirm }),
    )
    await confirmYourself()

    expect(await screen.findByText(fr.site.takedownStateDown)).toBeVisible()
    expect(api.stepUp).toHaveBeenCalledWith('le mot de passe', { code: '123456' })
    expect(siteTakeDownEvent).toHaveBeenCalledTimes(2)
  })

  it('keeps the confirmation open with the server’s own sentence when it refuses the reason', async () => {
    const siteTakeDownEvent = vi.fn<Api['siteTakeDownEvent']>(async () => {
      throw new ApiError(400, 'audit.reasonInvalid')
    })
    open(withEvent({ siteTakeDownEvent }))
    await findEvent()

    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownEventDown }))
    const confirmation = await dialog(fr.site.takedownOps.eventDown.title)
    await userEvent.type(within(confirmation).getByLabelText(fr.site.takedownReason), 'a@b.c')
    await userEvent.click(
      within(confirmation).getByRole('button', { name: fr.site.takedownOps.eventDown.confirm }),
    )

    expect(await within(confirmation).findByRole('alert')).toHaveTextContent(
      fr.errors['audit.reasonInvalid'],
    )
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.queryByText(fr.site.takedownStateDown)).toBeNull()
  })

  it('says the state is unknown, and offers nothing, when it cannot be read back after an act', async () => {
    const siteEventState = vi.fn<Api['siteEventState']>(async () => {
      throw new ApiError(500, 'unknown')
    })
    open(withEvent({ siteEventState }))
    await findEvent()

    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownEventDown }))
    const confirmation = await dialog(fr.site.takedownOps.eventDown.title)
    await userEvent.type(within(confirmation).getByLabelText(fr.site.takedownReason), REASON)
    await userEvent.click(
      within(confirmation).getByRole('button', { name: fr.site.takedownOps.eventDown.confirm }),
    )

    expect(await screen.findByText(fr.site.takedownUnknown)).toBeVisible()
    expect(screen.queryByText(fr.site.takedownStateUp)).toBeNull()
    expect(screen.queryByRole('button', { name: fr.site.takedownEventDown })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.site.takedownHold })).toBeNull()
  })

  it('lets only the later of two reads of the same event speak, whichever answers last', async () => {
    let releaseFirst: (state: SiteEventStateDto) => void = () => undefined
    const siteEventState = vi
      .fn<Api['siteEventState']>()
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValue(anEvent({ takenDownAt: AT, purgeHeldAt: AT }))
    open(withEvent({ siteEventState }))
    await findEvent()

    const act = async (button: string, copy: { title: string; confirm: string }) => {
      await userEvent.click(screen.getByRole('button', { name: button }))
      const confirmation = await dialog(copy.title)
      await userEvent.type(within(confirmation).getByLabelText(fr.site.takedownReason), REASON)
      await userEvent.click(within(confirmation).getByRole('button', { name: copy.confirm }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
    await act(fr.site.takedownEventDown, fr.site.takedownOps.eventDown)
    await act(fr.site.takedownHold, fr.site.takedownOps.purgeHold)
    expect(await screen.findByText(fr.site.takedownStateHeld)).toBeVisible()

    // The earlier read answers last, with a state from before the hold.
    releaseFirst(anEvent({ takenDownAt: AT }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.getByText(fr.site.takedownStateHeld)).toBeVisible()
    expect(screen.queryByText(fr.site.takedownStateFree)).toBeNull()
  })

  it('sends nothing, and says nothing, when the operator cancels', async () => {
    const siteTakeDownEvent = vi.fn<Api['siteTakeDownEvent']>(async () => undefined)
    open(withEvent({ siteTakeDownEvent }))
    await findEvent()

    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownEventDown }))
    const confirmation = await dialog(fr.site.takedownOps.eventDown.title)
    await userEvent.type(within(confirmation).getByLabelText(fr.site.takedownReason), REASON)
    await userEvent.click(within(confirmation).getByRole('button', { name: fr.app.cancel }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(siteTakeDownEvent).not.toHaveBeenCalled()
  })

  it('does not carry a reason typed for one act into the next', async () => {
    open(withEvent())
    await findEvent()
    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownEventDown }))
    const first = await dialog(fr.site.takedownOps.eventDown.title)
    await userEvent.type(within(first).getByLabelText(fr.site.takedownReason), REASON)
    await userEvent.click(within(first).getByRole('button', { name: fr.app.cancel }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownHold }))
    const second = await dialog(fr.site.takedownOps.purgeHold.title)

    expect(within(second).getByLabelText(fr.site.takedownReason)).toHaveValue('')
  })
})

describe('acting on a photograph, by its id', () => {
  it('shows where it is and that it is up, with no photograph, and takes it down with a reason', async () => {
    const siteTakeDownPhoto = vi.fn<Api['siteTakeDownPhoto']>(async () => undefined)
    const sitePhotoState = vi
      .fn<Api['sitePhotoState']>()
      .mockResolvedValueOnce(aPhoto())
      .mockResolvedValue(aPhoto({ takenDownAt: AT }))
    open(consoleApi({ sitePhotoState, siteTakeDownPhoto }))

    await findPhoto()
    expect(screen.getByText(fr.site.takedownPhotoOf(EVENT_ID))).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownPhotoDown }))
    const confirmation = await dialog(fr.site.takedownOps.photoDown.title)
    await userEvent.type(within(confirmation).getByLabelText(fr.site.takedownReason), REASON)
    await userEvent.click(
      within(confirmation).getByRole('button', { name: fr.site.takedownOps.photoDown.confirm }),
    )

    expect(await screen.findByRole('button', { name: fr.site.takedownPhotoUp })).toBeVisible()
    expect(sitePhotoState).toHaveBeenCalledWith(PHOTO_ID)
    expect(siteTakeDownPhoto).toHaveBeenCalledWith(PHOTO_ID, REASON)
    expect(document.querySelector('img, video, picture, canvas, audio')).toBeNull()
  })

  it('puts a taken-down photograph back, with its own request', async () => {
    const siteRestorePhoto = vi.fn<Api['siteRestorePhoto']>(async () => undefined)
    open(
      consoleApi({
        sitePhotoState: vi.fn(async () => aPhoto({ takenDownAt: AT })),
        siteRestorePhoto,
      }),
    )

    await findPhoto()
    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownPhotoUp }))
    const confirmation = await dialog(fr.site.takedownOps.photoUp.title)
    await userEvent.type(within(confirmation).getByLabelText(fr.site.takedownReason), REASON)
    await userEvent.click(
      within(confirmation).getByRole('button', { name: fr.site.takedownOps.photoUp.confirm }),
    )

    await waitFor(() => expect(siteRestorePhoto).toHaveBeenCalledWith(PHOTO_ID, REASON))
  })

  it('says that no photograph has that id, in words and not as a failure', async () => {
    open(
      consoleApi({
        sitePhotoState: vi.fn(async () => {
          throw new ApiError(404, 'photo.notFound')
        }),
      }),
    )

    await userEvent.type(await screen.findByLabelText(fr.site.takedownPhotoLabel), PHOTO_ID)
    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownPhotoAction }))

    expect(await screen.findByText(fr.site.takedownPhotoNone)).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says what the server said for any other failure', async () => {
    open(
      consoleApi({
        sitePhotoState: vi.fn(async () => {
          throw new ApiError(500, 'unknown')
        }),
      }),
    )

    await userEvent.type(await screen.findByLabelText(fr.site.takedownPhotoLabel), PHOTO_ID)
    await userEvent.click(screen.getByRole('button', { name: fr.site.takedownPhotoAction }))

    expect(await screen.findByRole('alert')).toBeVisible()
  })
})

describe('the page itself', () => {
  it('says that taking down does not stop the purge, and shows no content of any kind', async () => {
    const api = consoleApi({
      siteLookupEvents: vi.fn(async () => ({ items: [anEvent()] })),
      sitePhotoState: vi.fn(async () => aPhoto()),
    })
    open(api)
    await findEvent()
    await findPhoto()

    expect(screen.getByText(fr.site.takedownIntro)).toBeVisible()
    expect(document.querySelector('img, video, picture, canvas, audio, source, iframe')).toBeNull()
    expect(document.querySelector('[src], [srcset], [poster]')).toBeNull()
    expect(callsOutsideTheConsole(api)).toEqual([])
  })
})
