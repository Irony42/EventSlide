/**
 * Who a mission is asked of: every guest separately, or the room once.
 *
 * The roadmap's own three examples split on this line and cannot share an answer. "A
 * selfie with the couple" is asked of each guest — two hundred people can each do it,
 * and a checklist that ticked itself because somebody else across the room had already
 * sent one would remove the only thing this feature adds. "The first dance" happens
 * once; asking two hundred people each to photograph it and leaving every checklist but
 * one showing an open row is the same mistake in the other direction.
 *
 * So it is a field rather than a policy, and it decides exactly one question:
 * {@link isDoneForGuest} — whether another guest's photograph ticks *your* row. It
 * decides nothing about the room's own view, which is {@link isAchieved} and is the
 * same question for both kinds.
 *
 * `guest` is the default a host gets, because all three of the roadmap's examples are
 * that kind and because the failure is asymmetric: an `event` mission wrongly marked
 * `guest` shows a row that a guest can still do something about, while a `guest`
 * mission wrongly marked `event` silently tells one hundred and ninety-nine people
 * they have nothing left to do.
 */

export const MISSION_SCOPES = ['guest', 'event'] as const

export type MissionScope = (typeof MISSION_SCOPES)[number]

/** What a host gets without choosing. See the note above for why it is this one. */
export const DEFAULT_MISSION_SCOPE: MissionScope = 'guest'

export const isMissionScope = (value: unknown): value is MissionScope =>
  typeof value === 'string' && (MISSION_SCOPES as readonly string[]).includes(value)
