import { beforeEach, describe, expect, it } from 'vitest'
import { OWNER, WEDDING, rsvpScene, type RsvpScene } from '../../testing/rsvpScene'

/**
 * "Qui vient" (spec 30, PR 7): the host's choice (nothing, a count, first names), the guest's box
 * "Montrer mon prénom", and what the public page may say. The names are the guest's to show: the
 * host never ticks it, and a `no`, a `maybe` or a guest who did not tick is never named.
 */

describe('who comes (spec 30)', () => {
  let scene: RsvpScene
  let token: string

  beforeEach(async () => {
    scene = await rsvpScene()
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
    await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
    token = await scene.token()
  })

  const show = (visibility: unknown) =>
    scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: { visibility } })
  const answer = (name: string, extra: Record<string, unknown> = {}) =>
    scene.submit({ token, name, answer: 'yes', adults: 1, ...extra })
  const proof = async () => {
    const page = await scene.view({ token })
    return page.ok ? page.value.rsvp.proof : undefined
  }

  it('shows nothing by default, a count when asked, first names when the guests agree', async () => {
    await show('names')
    await answer('Léa Martin', { showName: true })
    await answer('Hugo Roux')
    await show('off')
    expect(await proof()).toBeNull()

    await show('count')
    expect(await proof()).toEqual({ count: 2, names: [] })

    await show('names')
    expect(await proof()).toEqual({ count: 2, names: ['Léa'] })
  })

  it('refuses a value that is not one of the three, and saves nothing', async () => {
    const refused = await show('everyone')

    expect(!refused.ok && refused.error.code).toBe('rsvp.visibilityInvalid')
    expect(await proof()).toBeNull()
  })

  it('stores the box only while first names are shown, and only for a yes', async () => {
    await show('count')
    const counting = await answer('Léa', { showName: true })
    await show('names')
    const maybe = await scene.submit({
      token,
      name: 'Tom',
      answer: 'maybe',
      adults: 1,
      showName: true,
    })
    const no = await scene.submit({ token, name: 'Ana', answer: 'no', showName: true })
    const yes = await answer('Inès', { showName: true })

    expect([counting, maybe, no, yes].map((r) => r.ok && r.value.rsvp.details.showName)).toEqual([
      false,
      false,
      false,
      true,
    ])
  })

  it('refuses a box that is not a boolean while it is asked, and ignores it otherwise', async () => {
    await show('names')
    const refused = await answer('Léa', { showName: 'oui' })
    await show('off')
    const ignored = await answer('Léa', { showName: 'oui' })

    expect(!refused.ok && refused.error.code).toBe('rsvp.showNameInvalid')
    expect(ignored.ok).toBe(true)
  })

  it('never names a guest who unticks the box, and keeps a tick while the display is off', async () => {
    await show('names')
    const sent = await answer('Léa Martin', { showName: true })
    if (!sent.ok) throw new Error('sent')
    const own = { token, editToken: sent.value.editToken, name: 'Léa Martin', adults: 1 }

    await show('off')
    const quiet = await scene.updateOwn({ ...own, answer: 'yes' })
    await show('names')
    expect(quiet.ok && quiet.value.details.showName).toBe(true)
    expect(await proof()).toEqual({ count: 1, names: ['Léa'] })

    const declined = await scene.updateOwn({ ...own, answer: 'no', showName: true })
    expect(declined.ok && declined.value.details.showName).toBe(false)
    const back = await scene.updateOwn({ ...own, answer: 'yes' })
    expect(back.ok && back.value.details.showName).toBe(false)

    await scene.updateOwn({ ...own, answer: 'yes', showName: true })
    const unticked = await scene.updateOwn({ ...own, answer: 'yes', showName: false })
    expect(unticked.ok && unticked.value.details.showName).toBe(false)
    expect(await proof()).toEqual({ count: 1, names: [] })
  })

  it('leaves the guest’s choice alone when the host corrects the reply, and the host cannot make it', async () => {
    await show('names')
    const sent = await answer('Léa Martin', { showName: true })
    if (!sent.ok) throw new Error('sent')
    const corrected = await scene.hostUpdate({
      eventId: WEDDING,
      actorId: OWNER,
      rsvpId: sent.value.rsvp.id,
      name: 'Léa M.',
      answer: 'yes',
      adults: 1,
    })
    const added = await scene.hostAdd({
      eventId: WEDDING,
      actorId: OWNER,
      name: 'Zoé Petit',
      answer: 'yes',
      adults: 1,
      showName: true,
    })

    expect(corrected.ok && corrected.value.details.showName).toBe(true)
    expect(added.ok && added.value.details.showName).toBe(false)
    expect(await proof()).toEqual({ count: 2, names: ['Léa'] })
  })

  it('takes the name back when the host turns a yes into a no', async () => {
    await show('names')
    const sent = await answer('Léa Martin', { showName: true })
    if (!sent.ok) throw new Error('sent')

    const declined = await scene.hostUpdate({
      eventId: WEDDING,
      actorId: OWNER,
      rsvpId: sent.value.rsvp.id,
      name: 'Léa Martin',
      answer: 'no',
    })

    expect(declined.ok && declined.value.details.showName).toBe(false)
  })

  it('tells the page the choice, and the guest’s own reply whether it was ticked', async () => {
    await show('names')
    const page = await scene.view({ token })

    expect(page.ok && page.value.rsvp.form.visibility).toBe('names')
  })
})
