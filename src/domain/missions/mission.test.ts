import { describe, expect, it } from 'vitest'
import { hasRoomForMission, MAX_MISSIONS_PER_EVENT, Mission } from './mission'
import { MissionPrompt } from './missionPrompt'
import { asEventId, asMissionId } from '../shared/ids'

const AT = new Date('2026-06-20T21:00:00.000Z')

const promptOf = (raw: string): MissionPrompt => {
  const parsed = MissionPrompt.create(raw)
  if (!parsed.ok) throw new Error(`fixture prompt refused: ${parsed.error.code}`)
  return parsed.value
}

const aMission = (prompt = 'un selfie avec les mariés', scope: 'guest' | 'event' = 'guest') =>
  Mission.create(
    { eventId: asEventId('mariage'), prompt: promptOf(prompt), scope },
    asMissionId('m1'),
    AT,
  )

describe('Mission.create', () => {
  it('belongs to the event it was created for', () => {
    expect(aMission().eventId).toBe(asEventId('mariage'))
  })

  it('takes the id and the instant it is handed, never one of its own', () => {
    const mission = aMission()

    expect(mission.id).toBe(asMissionId('m1'))
    expect(mission.createdAt).toEqual(AT)
  })

  it('keeps the prompt and the scope the host chose', () => {
    const mission = aMission('la première danse', 'event')

    expect(mission.prompt.value).toBe('la première danse')
    expect(mission.scope).toBe('event')
  })

  it('carries nothing about completion, which is derived from the photographs', () => {
    // The guard for the design decision in `missionProgress.ts`: a stored flag here
    // would need unsetting from five places, and a wall would say "fait" over a
    // photograph the host had just taken down.
    expect(Object.keys(aMission().toProps())).toEqual([
      'id',
      'eventId',
      'prompt',
      'scope',
      'createdAt',
    ])
  })
})

describe('Mission.restore', () => {
  it('round-trips a stored row', () => {
    const props = aMission('quelqu’un qui pleure', 'event').toProps()

    const restored = Mission.restore(props)

    expect(restored.toProps()).toEqual(props)
  })
})

describe('Mission.edit', () => {
  it('returns a corrected mission without mutating the original', () => {
    const mission = aMission('un selfi avec les mariés')

    const fixed = mission.edit(promptOf('un selfie avec les mariés'), 'guest')

    expect(fixed.prompt.value).toBe('un selfie avec les mariés')
    expect(mission.prompt.value).toBe('un selfi avec les mariés')
  })

  it('keeps the id, so the photographs already filed under it stay filed under it', () => {
    const mission = aMission()

    const edited = mission.edit(promptOf('autre chose'), 'event')

    expect(edited.id).toBe(mission.id)
    expect(edited.eventId).toBe(mission.eventId)
    expect(edited.createdAt).toEqual(mission.createdAt)
  })

  it('changes the scope, which is the other half of the one form the host fills in', () => {
    expect(
      aMission('la première danse', 'guest').edit(promptOf('la première danse'), 'event').scope,
    ).toBe('event')
  })
})

describe('Mission.equals', () => {
  it('is identity by id, not by prompt', () => {
    const mission = aMission()
    const renamed = mission.edit(promptOf('autre chose'), 'event')

    expect(mission.equals(renamed)).toBe(true)
  })

  it('separates two missions with the same words', () => {
    const one = aMission()
    const two = Mission.create(
      {
        eventId: asEventId('mariage'),
        prompt: promptOf('un selfie avec les mariés'),
        scope: 'guest',
      },
      asMissionId('m2'),
      AT,
    )

    expect(one.equals(two)).toBe(false)
  })
})

describe('hasRoomForMission', () => {
  it('lets an event with no missions take one', () => {
    expect(hasRoomForMission(0)).toBe(true)
  })

  it('lets an event one short of the ceiling take its last', () => {
    expect(hasRoomForMission(MAX_MISSIONS_PER_EVENT - 1)).toBe(true)
  })

  it('refuses one past the ceiling, which is what keeps the panel readable at ten metres', () => {
    expect(hasRoomForMission(MAX_MISSIONS_PER_EVENT)).toBe(false)
  })

  it('refuses when a list is somehow already over the ceiling', () => {
    expect(hasRoomForMission(MAX_MISSIONS_PER_EVENT + 1)).toBe(false)
  })
})
