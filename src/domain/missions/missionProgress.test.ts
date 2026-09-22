import { describe, expect, it } from 'vitest'
import { isAchieved, isDoneForGuest, NO_PROGRESS, type MissionProgress } from './missionProgress'

const progress = (patch: Partial<MissionProgress> = {}): MissionProgress => ({
  ...NO_PROGRESS,
  ...patch,
})

describe('isAchieved', () => {
  it('is false for a mission no published photograph names', () => {
    expect(isAchieved(NO_PROGRESS)).toBe(false)
  })

  it('is true as soon as one published photograph names it', () => {
    expect(isAchieved(progress({ publishedPhotos: 1 }))).toBe(true)
  })

  it('counts a host upload, which the room cannot tell from a guest photograph', () => {
    expect(isAchieved(progress({ publishedPhotos: 1, completedByGuests: 0 }))).toBe(true)
  })
})

describe('isDoneForGuest', () => {
  it('ticks a per-guest mission only for the guest who sent the photograph', () => {
    const answered = progress({ publishedPhotos: 4, completedByGuests: 3 })

    expect(isDoneForGuest('guest', answered, true)).toBe(true)
    expect(isDoneForGuest('guest', answered, false)).toBe(false)
  })

  it('ticks a once-for-the-evening mission for everyone once anybody has answered it', () => {
    const answered = progress({ publishedPhotos: 1, completedByGuests: 1 })

    expect(isDoneForGuest('event', answered, false)).toBe(true)
  })

  it('leaves a once-for-the-evening mission open while nothing published names it', () => {
    expect(isDoneForGuest('event', NO_PROGRESS, false)).toBe(false)
  })

  it('leaves a per-guest mission open for a guest who has sent nothing, however busy the room', () => {
    const busy = progress({ publishedPhotos: 40, completedByGuests: 38 })

    expect(isDoneForGuest('guest', busy, false)).toBe(false)
  })

  it('reads only the room for a once-for-the-evening mission, never the guest beside it', () => {
    // The two disagree whenever a client is a moment stale, and this is the direction
    // that matters: a guest's own claim must not be able to tick a row the room has not
    // answered. Only the room's published count decides an `event` mission.
    expect(isDoneForGuest('event', NO_PROGRESS, true)).toBe(false)
  })
})
