import { describe, expect, it } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import { eventTourSteps, offersTourOnArrival, type EventTourFacts } from './eventTour'

const facts = (overrides: Partial<EventTourFacts> = {}): EventTourFacts => ({
  name: 'Camille & Sacha',
  status: 'draft',
  role: 'owner',
  moderation: 'manual',
  ...overrides,
})

const ids = (overrides: Partial<EventTourFacts> = {}) =>
  eventTourSteps(facts(overrides), fr).map((step) => step.id)

describe('eventTourSteps', () => {
  it('walks an owner through the page in the order a host needs it, then shows the way back', () => {
    expect(ids()).toEqual([
      'welcome',
      'now',
      'access',
      'lifecycle',
      'evening',
      'overview',
      'replay',
    ])
  })

  it('welcomes the owner to their evening, by its name as they wrote it', () => {
    const [welcome] = eventTourSteps(facts(), fr)

    expect(welcome?.title).toBe(fr.admin.tourWelcomeTitle)
    expect(welcome?.body).toContain('« Camille & Sacha »')
    expect(welcome?.targets).toEqual([])
  })

  it('welcomes a moderator to the team, and leaves out the lifecycle that is the owner’s', () => {
    const steps = eventTourSteps(facts({ role: 'moderator' }), fr)

    expect(steps[0]?.title).toBe(fr.admin.tourWelcomeModeratorTitle)
    expect(steps.map((step) => step.id)).not.toContain('lifecycle')
  })

  it('says what the lifecycle button does now: open, end, or reopen and archive', () => {
    const lifecycle = (status: EventTourFacts['status']) =>
      eventTourSteps(facts({ status }), fr).find((step) => step.id === 'lifecycle')?.title

    expect(lifecycle('draft')).toBe(fr.admin.tourOpenTitle)
    expect(lifecycle('live')).toBe(fr.admin.tourCloseTitle)
    expect(lifecycle('closed')).toBe(fr.admin.tourAfterTitle)
    expect(lifecycle('archived')).toBeUndefined()
  })

  it('lights the queue and the screen together, and only before or during the evening', () => {
    const evening = eventTourSteps(facts(), fr).find((step) => step.id === 'evening')

    expect(evening?.targets).toEqual(['moderate', 'wall'])
    expect(ids({ status: 'closed' })).not.toContain('evening')
  })

  it('does not promise an approval the event does not ask for', () => {
    const body = (moderation: EventTourFacts['moderation']) =>
      eventTourSteps(facts({ moderation }), fr).find((step) => step.id === 'evening')?.body

    expect(body('manual')).toBe(fr.admin.tourEveningBodyManual)
    expect(body('auto')).toBe(fr.admin.tourEveningBodyAuto)
  })
})

describe('offersTourOnArrival', () => {
  it('offers the tour to an account that never saw it', () => {
    expect(offersTourOnArrival({ toursSeen: [], status: 'draft', pendingCount: 0 })).toBe(true)
  })

  it('never offers it again to an account that saw or skipped it', () => {
    expect(
      offersTourOnArrival({ toursSeen: ['eventPage'], status: 'draft', pendingCount: 0 }),
    ).toBe(false)
  })

  it('does not cover the queue of an evening that has photos waiting', () => {
    expect(offersTourOnArrival({ toursSeen: [], status: 'live', pendingCount: 3 })).toBe(false)
    expect(offersTourOnArrival({ toursSeen: [], status: 'live', pendingCount: 0 })).toBe(true)
  })
})
