import { describe, expect, it } from 'vitest'
import { aGuestbookEntry, aGuest, aPhoto } from '../../../application/testing/builders'
import type { TakedownAct } from '../../../application/usecases/notices/notifyTakedown'
import { CSRF_HEADER } from '../middleware/csrf'
import { ID, aBox } from '../testing/siteBox'

/**
 * Ring 4. The two fields an operator act may carry for the host (spec 32, A4) reach the use cases **from the wire**: `notifyHost`
 * (absent means yes) and `hostReason`, on the three take-downs and the three client acts. The use cases are held at ring 2
 * (`hostNotice.test.ts`), the mail at `notifyTakedown.test.ts`; what only a route can break is the line between the body and them.
 */

const A_PHOTO = '99999999-9999-4999-8999-999999999999'

const world = async () => {
  const told: TakedownAct[] = []
  const { site } = await aBox({ notice: (act) => told.push(act) })
  await site.world.addPhoto(
    aPhoto({ id: A_PHOTO, eventId: ID.eventK, author: { kind: 'host', id: ID.owner } }),
  )
  await site.world.addGuest(aGuest({ id: 'guest-1', eventId: ID.eventK }))
  await site.repos.guestbook.admit(
    aGuestbookEntry({ id: A_PHOTO, eventId: ID.eventK, guestId: 'guest-1' }),
  )
  const caller = await site.signInAsOperator()
  const post = (path: string, body: object) =>
    caller.agent.post(path).set(CSRF_HEADER, caller.csrf).send(body)
  return { told, post }
}

const REASON = 'Retrait conservatoire'

describe('the notice to the host, from the wire', () => {
  it('hands a take-down the host reason, and tells by default', async () => {
    const { told, post } = await world()

    expect(
      (
        await post(`/api/site/photos/${A_PHOTO}/take-down`, {
          reason: REASON,
          hostReason: 'Pour la photo.',
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await post(`/api/site/guestbook-entries/${A_PHOTO}/take-down`, {
          reason: REASON,
          hostReason: 'Pour le message.',
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await post(`/api/site/events/${ID.eventL}/take-down`, {
          reason: REASON,
          hostReason: 'Pour l’évènement.',
        })
      ).status,
    ).toBe(204)

    expect(told.map((act) => [act.kind, act.reason])).toEqual([
      ['photo', 'Pour la photo.'],
      ['guestbook', 'Pour le message.'],
      ['event', 'Pour l’évènement.'],
    ])
  })

  it('tells nobody when the body says notifyHost false, for each of the three take-downs', async () => {
    const { told, post } = await world()
    const body = { reason: REASON, notifyHost: false, hostReason: 'Jamais lu.' }

    expect((await post(`/api/site/photos/${A_PHOTO}/take-down`, body)).status).toBe(204)
    expect((await post(`/api/site/guestbook-entries/${A_PHOTO}/take-down`, body)).status).toBe(204)
    expect((await post(`/api/site/events/${ID.eventL}/take-down`, body)).status).toBe(204)

    expect(told).toEqual([])
  })

  it('tells nobody of a restore', async () => {
    const { told, post } = await world()
    await post(`/api/site/events/${ID.eventL}/take-down`, { reason: REASON, notifyHost: false })

    expect((await post(`/api/site/events/${ID.eventL}/restore`, { reason: REASON })).status).toBe(
      204,
    )

    expect(told).toEqual([])
  })

  it('hands a client act the notice: the host reason, or "do not tell"', async () => {
    const { told, post } = await world()

    expect(
      (await post(`/api/site/clients/${ID.clientEmpty}/suspend`, { hostReason: 'Impayé.' })).status,
    ).toBe(204)
    expect(
      (await post(`/api/site/clients/${ID.clientEmpty}/resume`, { notifyHost: false })).status,
    ).toBe(204)
    expect(
      (
        await post(`/api/site/clients/${ID.clientEmpty}/offboard`, {
          graceDays: 30,
          hostReason: 'Fin.',
        })
      ).status,
    ).toBe(204)

    expect(told.map((act) => [act.kind, act.reason])).toEqual([
      ['clientSuspended', 'Impayé.'],
      ['clientOffboarded', 'Fin.'],
    ])
  })

  it('reads an absent body on a suspension as "tell, with no reason"', async () => {
    const { told } = await world()
    const { site } = await aBox({ notice: (act) => told.push(act) })
    const caller = await site.signInAsOperator()

    const response = await caller.agent
      .post(`/api/site/clients/${ID.clientEmpty}/suspend`)
      .set(CSRF_HEADER, caller.csrf)

    expect(response.status).toBe(204)
    expect(told).toEqual([expect.objectContaining({ kind: 'clientSuspended', reason: null })])
  })
})
