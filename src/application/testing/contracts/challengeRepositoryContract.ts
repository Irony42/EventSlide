import { beforeEach, describe, expect, it } from 'vitest'
import { Challenge, MAX_CHALLENGES_PER_EVENT } from '../../../domain/challenges/challenge'
import { MissionPrompt } from '../../../domain/missions/missionPrompt'
import {
  asChallengeId,
  asEventId,
  asMissionId,
  asPhotoId,
  asUserId,
} from '../../../domain/shared/ids'
import type { ChallengeRepository } from '../../ports/challengeRepository'
import type { MissionRepository } from '../../ports/missionRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import { aMission, aPhoto, AT, atPlus } from '../builders'

/**
 * The behaviour every `ChallengeRepository` must have, run against the fake **and** SQLite.
 *
 * Most of it is about the answer count, which both derive from the photographs in different
 * ways (a filtered array, a SQL `WHERE`): a fake that counted a refused photograph, or one
 * received a second too late, would make every ring-2 test about challenges prove the
 * opposite of what production does.
 */

/** Rows the SQLite harness must create before the contract runs; the fake ignores them. */
export const CHALLENGE_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  guestIds: ['guest-1'],
  userIds: ['user-host'],
} as const

export interface ChallengeRepositorySubject {
  readonly repo: ChallengeRepository
  readonly photos: PhotoRepository
  /** A real mission table, so a photograph can name a mission the challenge also names. */
  readonly missions: MissionRepository
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const HOST = asUserId('user-host')
const SECOND = 1000

const promptOf = (raw: string): MissionPrompt => {
  const parsed = MissionPrompt.create(raw)
  if (!parsed.ok) throw new Error('contract prompt refused')
  return parsed.value
}

const challengeAt = (
  input: {
    readonly id?: string
    readonly eventId?: string
    readonly missionId?: string
    readonly withoutMission?: boolean
    readonly prompt?: string
    readonly startedAt?: Date
    readonly seconds?: number
  } = {},
): Challenge => {
  const result = Challenge.start(
    {
      eventId: asEventId(input.eventId ?? 'evt-wedding'),
      missionId: input.withoutMission === true ? null : asMissionId(input.missionId ?? 'm1'),
      prompt: promptOf(input.prompt ?? 'un selfie'),
      durationSeconds: input.seconds ?? 120,
      createdBy: HOST,
    },
    asChallengeId(input.id ?? 'c1'),
    input.startedAt ?? AT,
  )
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

export const challengeRepositoryContract = (
  name: string,
  makeSubject: () => Promise<ChallengeRepositorySubject>,
): void => {
  describe(`ChallengeRepository contract: ${name}`, () => {
    let subject: ChallengeRepositorySubject
    let repo: ChallengeRepository
    let photos: PhotoRepository

    beforeEach(async () => {
      if (subject?.dispose !== undefined) await subject.dispose()
      subject = await makeSubject()
      repo = subject.repo
      photos = subject.photos
      await subject.missions.save(
        aMission({ id: 'm1', eventId: 'evt-wedding', prompt: 'un selfie' }),
      )
      await subject.missions.save(
        aMission({ id: 'm2', eventId: 'evt-wedding', prompt: 'le gateau' }),
      )
      await subject.missions.save(
        aMission({ id: 'm-gala', eventId: 'evt-gala', prompt: 'un selfie' }),
      )
    })

    /** A photograph of the wedding answering `c1`, received at `at`, unless a case says otherwise. */
    const answer = async (
      id: string,
      overrides: Parameters<typeof aPhoto>[0] = {},
    ): Promise<void> => {
      await photos.save(
        aPhoto({
          id,
          eventId: 'evt-wedding',
          status: 'published',
          challengeId: 'c1',
          createdAt: atPlus(10 * SECOND),
          ...overrides,
        }),
      )
    }

    const count = async (challenge: Challenge = challengeAt()): Promise<number> =>
      repo.countAnswers(WEDDING, challenge)

    // ---------------------------------------------------------------------- start --

    it('starts a challenge and reads it back as the latest', async () => {
      const challenge = challengeAt()

      expect(await repo.tryStart(challenge, AT)).toBe('started')

      expect((await repo.findLatest(WEDDING))?.toProps()).toEqual(challenge.toProps())
    })

    it('refuses a second challenge while one is running', async () => {
      await repo.tryStart(challengeAt({ id: 'c1' }), AT)

      const second = challengeAt({ id: 'c2', startedAt: atPlus(30 * SECOND) })

      expect(await repo.tryStart(second, atPlus(30 * SECOND))).toBe('alreadyRunning')
      expect((await repo.findLatest(WEDDING))?.id).toBe('c1')
    })

    it('accepts a new challenge once the last one ran out', async () => {
      await repo.tryStart(challengeAt({ id: 'c1', seconds: 60 }), AT)

      const later = atPlus(61 * SECOND)

      expect(await repo.tryStart(challengeAt({ id: 'c2', startedAt: later }), later)).toBe(
        'started',
      )
      expect((await repo.findLatest(WEDDING))?.id).toBe('c2')
    })

    it('accepts a new challenge once the last one was stopped', async () => {
      const first = challengeAt({ id: 'c1' })
      await repo.tryStart(first, AT)
      await repo.save(first.stop(atPlus(10 * SECOND)))

      const later = atPlus(11 * SECOND)

      expect(await repo.tryStart(challengeAt({ id: 'c2', startedAt: later }), later)).toBe(
        'started',
      )
    })

    it('refuses the fifty-first challenge of an event', async () => {
      for (let i = 0; i < MAX_CHALLENGES_PER_EVENT; i += 1) {
        const startedAt = atPlus(i * 200 * SECOND)
        const outcome = await repo.tryStart(
          challengeAt({ id: `c${i}`, startedAt, seconds: 60 }),
          startedAt,
        )
        expect(outcome).toBe('started')
      }

      const startedAt = atPlus(MAX_CHALLENGES_PER_EVENT * 200 * SECOND)

      expect(await repo.tryStart(challengeAt({ id: 'c-last', startedAt }), startedAt)).toBe(
        'limitReached',
      )
    })

    it('does not count another event toward the ceiling or the running challenge', async () => {
      await repo.tryStart(
        challengeAt({ id: 'c-gala', eventId: 'evt-gala', missionId: 'm-gala' }),
        AT,
      )

      expect(await repo.tryStart(challengeAt({ id: 'c1' }), AT)).toBe('started')
    })

    // ------------------------------------------------------------ tenant isolation --

    it('never reads another event challenge', async () => {
      await repo.tryStart(
        challengeAt({ id: 'c-gala', eventId: 'evt-gala', missionId: 'm-gala' }),
        AT,
      )

      expect(await repo.findLatest(WEDDING)).toBeNull()
      expect((await repo.findLatest(GALA))?.id).toBe('c-gala')
    })

    it('returns the most recently started challenge', async () => {
      await repo.tryStart(challengeAt({ id: 'c1', seconds: 60 }), AT)
      const later = atPlus(120 * SECOND)
      await repo.tryStart(challengeAt({ id: 'c2', startedAt: later, seconds: 60 }), later)

      expect((await repo.findLatest(WEDDING))?.id).toBe('c2')
    })

    it('does not move another event row when saving a stop', async () => {
      const wedding = challengeAt({ id: 'c1' })
      await repo.tryStart(wedding, AT)
      const forged = challengeAt({ id: 'c1', eventId: 'evt-gala', missionId: 'm-gala' })

      await repo.save(forged.stop(atPlus(5 * SECOND)))

      expect((await repo.findLatest(WEDDING))?.endedAt).toBeNull()
    })

    // ------------------------------------------------------------ answers (derived) --

    it('counts a published photograph that names the challenge', async () => {
      await repo.tryStart(challengeAt(), AT)
      await answer('p1')

      expect(await count()).toBe(1)
    })

    it.each(['pending', 'rejected', 'hidden'] as const)(
      'does not count a %s photograph, which is what makes a refusal take effect',
      async (status) => {
        await repo.tryStart(challengeAt(), AT)
        await answer('p1', { status })

        expect(await count()).toBe(0)
      },
    )

    it('does not count a photograph the operator took down', async () => {
      await repo.tryStart(challengeAt(), AT)
      await answer('p1')
      await photos.setTakenDown(WEDDING, asPhotoId('p1'), AT)

      expect(await count()).toBe(0)
    })

    it('does not count a photograph that was deleted', async () => {
      await repo.tryStart(challengeAt(), AT)
      await answer('p1')
      await photos.delete(WEDDING, asPhotoId('p1'))

      expect(await count()).toBe(0)
    })

    it('does not count a photograph that names the mission but not the challenge', async () => {
      await repo.tryStart(challengeAt(), AT)
      await answer('p1', { challengeId: null, missionId: 'm1' })

      expect(await count()).toBe(0)
    })

    it('does not count a photograph that answers another challenge', async () => {
      await repo.tryStart(challengeAt({ id: 'c1', seconds: 60 }), AT)
      const later = atPlus(120 * SECOND)
      await repo.tryStart(challengeAt({ id: 'c2', startedAt: later }), later)
      await answer('p1', { challengeId: 'c2' })

      expect(await count(challengeAt({ id: 'c1', seconds: 60 }))).toBe(0)
    })

    it('does not count another event photograph, even one that names this challenge id', async () => {
      await repo.tryStart(challengeAt(), AT)
      await photos.save(
        aPhoto({
          id: 'p-forged',
          eventId: 'evt-gala',
          status: 'published',
          challengeId: 'c1',
          createdAt: atPlus(10 * SECOND),
        }),
      )

      expect(await count()).toBe(0)
    })

    it('counts a challenge that has no mission', async () => {
      const own = challengeAt({ withoutMission: true })
      await repo.tryStart(own, AT)
      await answer('p1')

      expect(await count(own)).toBe(1)
    })

    it('reads the photograph challenge back', async () => {
      await repo.tryStart(challengeAt(), AT)
      await answer('p1')

      expect((await photos.findById(WEDDING, asPhotoId('p1')))?.challengeId).toBe('c1')
    })

    // -------------------------------------------------------------- recent prompts --

    it('lists the texts of the event challenges, newest first, and no other event text', async () => {
      await repo.tryStart(challengeAt({ id: 'c1', seconds: 60, prompt: 'premier' }), AT)
      const later = atPlus(120 * SECOND)
      await repo.tryStart(
        challengeAt({ id: 'c2', startedAt: later, seconds: 60, prompt: 'second' }),
        later,
      )
      await repo.tryStart(
        challengeAt({ id: 'c-gala', eventId: 'evt-gala', missionId: 'm-gala', prompt: 'gala' }),
        AT,
      )

      expect(await repo.listPrompts(WEDDING)).toEqual(['second', 'premier'])
    })
  })
}
