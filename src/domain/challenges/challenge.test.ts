import { describe, expect, it } from 'vitest'
import { MissionPrompt } from '../missions/missionPrompt'
import { asChallengeId, asEventId, asMissionId, asUserId } from '../shared/ids'
import {
  ANSWER_TOLERANCE_MS,
  Challenge,
  ENDED_VISIBLE_MS,
  hasRoomForChallenge,
  MAX_CHALLENGE_SECONDS,
  MAX_CHALLENGES_PER_EVENT,
  MIN_CHALLENGE_SECONDS,
  parseChallengeDuration,
} from './challenge'

const T0 = new Date('2026-06-20T21:00:00.000Z')
const at = (ms: number): Date => new Date(T0.getTime() + ms)

const promptOf = (raw: string): MissionPrompt => {
  const parsed = MissionPrompt.create(raw)
  if (!parsed.ok) throw new Error('prompt refused')
  return parsed.value
}

const startedWith = (durationSeconds: unknown) =>
  Challenge.start(
    {
      eventId: asEventId('e1'),
      missionId: asMissionId('m1'),
      prompt: promptOf('un selfie avec votre voisin'),
      durationSeconds,
      createdBy: asUserId('u1'),
    },
    asChallengeId('c1'),
    T0,
  )

const started = (durationSeconds: unknown = 120): Challenge => {
  const result = startedWith(durationSeconds)
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

describe('parseChallengeDuration', () => {
  it('accepts the shortest and the longest duration', () => {
    expect(parseChallengeDuration(MIN_CHALLENGE_SECONDS)).toEqual({ ok: true, value: 15 })
    expect(parseChallengeDuration(MAX_CHALLENGE_SECONDS)).toEqual({ ok: true, value: 1800 })
  })

  it.each([14, 1801, 0, -60, 90.5, '120', null, Number.NaN])('refuses %s', (raw) => {
    const result = parseChallengeDuration(raw)
    expect(!result.ok && result.error.code).toBe('challenge.durationInvalid')
  })
})

describe('Challenge', () => {
  it('ends the given number of seconds after it starts', () => {
    const challenge = started(120)

    expect(challenge.startedAt).toEqual(T0)
    expect(challenge.endsAt).toEqual(at(120_000))
    expect(challenge.endedAt).toBeNull()
  })

  it('refuses a duration out of bounds', () => {
    expect(startedWith(5).ok).toBe(false)
  })

  it('is running up to, and not at, the end instant', () => {
    const challenge = started(120)

    expect(challenge.isRunning(at(119_999))).toBe(true)
    expect(challenge.isRunning(at(120_000))).toBe(false)
  })

  it('is no longer running once a host stopped it', () => {
    const stopped = started(120).stop(at(30_000))

    expect(stopped.isRunning(at(30_001))).toBe(false)
    expect(stopped.endedAt).toEqual(at(30_000))
  })

  it('stopping twice keeps the first instant', () => {
    const stopped = started(120).stop(at(30_000))

    expect(stopped.stop(at(40_000)).endedAt).toEqual(at(30_000))
  })

  it('stopping a challenge that ran out leaves it as it was', () => {
    const challenge = started(120)

    expect(challenge.stop(at(200_000))).toBe(challenge)
  })

  it('reads running, then ended for twenty seconds, then nothing', () => {
    const challenge = started(120)

    expect(challenge.stateAt(at(119_999))).toBe('running')
    expect(challenge.stateAt(at(120_000))).toBe('ended')
    expect(challenge.stateAt(at(120_000 + ENDED_VISIBLE_MS - 1))).toBe('ended')
    expect(challenge.stateAt(at(120_000 + ENDED_VISIBLE_MS))).toBeNull()
  })

  it('counts the ended window from the host stop when it came first', () => {
    const stopped = started(120).stop(at(30_000))

    expect(stopped.stateAt(at(30_000 + ENDED_VISIBLE_MS - 1))).toBe('ended')
    expect(stopped.stateAt(at(30_000 + ENDED_VISIBLE_MS))).toBeNull()
  })

  it('answers from the start to a minute after the end', () => {
    const window = started(120).answerWindow()

    expect(window.from).toEqual(T0)
    expect(window.to).toEqual(at(120_000 + ANSWER_TOLERANCE_MS))
  })

  it('closes the answer window a minute after an early stop', () => {
    const window = started(120).stop(at(30_000)).answerWindow()

    expect(window.to).toEqual(at(30_000 + ANSWER_TOLERANCE_MS))
  })

  it('round-trips through its props', () => {
    const challenge = started(60)

    expect(Challenge.restore(challenge.toProps()).toProps()).toEqual(challenge.toProps())
    expect(challenge.id).toBe('c1')
    expect(challenge.eventId).toBe('e1')
    expect(challenge.missionId).toBe('m1')
    expect(challenge.prompt.value).toBe('un selfie avec votre voisin')
  })
})

describe('hasRoomForChallenge', () => {
  it('holds fifty, and not a fifty-first', () => {
    expect(hasRoomForChallenge(MAX_CHALLENGES_PER_EVENT - 1)).toBe(true)
    expect(hasRoomForChallenge(MAX_CHALLENGES_PER_EVENT)).toBe(false)
  })
})
