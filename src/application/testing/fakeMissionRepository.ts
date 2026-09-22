import type { Mission } from '../../domain/missions/mission'
import type { MissionProgress } from '../../domain/missions/missionProgress'
import type { MissionPrompt } from '../../domain/missions/missionPrompt'
import type { Photo } from '../../domain/photos/photo'
import type { EventId, GuestId, MissionId } from '../../domain/shared/ids'
import type { MissionRepository, MissionWithProgress } from '../ports/missionRepository'

/**
 * In-memory `MissionRepository`, behaving the way the SQLite adapter must.
 *
 * Three properties are load-bearing:
 *
 * 1. **Rows are keyed by `${eventId}:${missionId}`**, so a cross-event read genuinely
 *    misses. A mission id arrives from a guest's phone on every tagged upload, so this
 *    is the fake whose composite key a tenant test is actually exercising.
 * 2. **`(eventId, prompt)` is unique**, as `idx_event_missions_event_prompt` makes it. A
 *    fake that accepted a duplicate would let a ring-2 test prove that a double-tapped
 *    "Ajouter" is harmless while the real database raised.
 * 3. **Progress is derived from the photographs, never stored.** It reads the photo fake
 *    on every call, which is what makes "a photograph refused in moderation stops
 *    counting" true here for the same reason it is true in SQLite — because nothing
 *    remembers it.
 */

/**
 * What this fake needs from the photographs, which live in the photo fake.
 *
 * Structural rather than a concrete import, so the two fakes do not depend on each
 * other's classes; `FakePhotoRepository` satisfies it. The methods it names are test
 * infrastructure on that fake and deliberately not on `PhotoRepository` — in the real
 * schema the first is a grouped index scan and the second is a foreign key.
 */
export interface MissionPhotoView {
  ofEvent(eventId: EventId): readonly Photo[]
  unfileMission(eventId: EventId, missionId: MissionId): void
}

const key = (eventId: EventId, missionId: MissionId): string => `${eventId}:${missionId}`

/** Creation order, then id, exactly as `idx_event_missions_event` orders the real list. */
const inHostOrder = (left: Mission, right: Mission): number =>
  left.createdAt.getTime() - right.createdAt.getTime() ||
  Number(left.id > right.id) - Number(left.id < right.id)

export class FakeMissionRepository implements MissionRepository {
  private readonly rows = new Map<string, Mission>()

  /**
   * The photographs are a constructor argument rather than something a test may forget
   * to wire, because progress *is* this port: a missions fake with no photographs behind
   * it would answer "nothing is done" for every mission at every event, silently, and
   * every test about completion would pass for the wrong reason.
   */
  constructor(private readonly photos: MissionPhotoView) {}

  /** Seed fixtures. Enforces the same uniqueness `save` does. */
  seed(...missions: readonly Mission[]): this {
    for (const mission of missions) this.insert(mission)
    return this
  }

  private insert(mission: Mission): void {
    const clash = [...this.rows.values()].find(
      (row) =>
        row.eventId === mission.eventId &&
        row.id !== mission.id &&
        row.prompt.equals(mission.prompt),
    )
    if (clash !== undefined) {
      // The message mirrors better-sqlite3's, so a test asserting a rejection reads the
      // same way against either implementation.
      throw new Error(
        `UNIQUE constraint failed: event_missions.event_id, event_missions.prompt ` +
          `(${mission.eventId}/${mission.prompt.value} already held by ${clash.id})`,
      )
    }
    this.rows.set(key(mission.eventId, mission.id), mission)
  }

  private forEvent(eventId: EventId): Mission[] {
    return [...this.rows.values()].filter((mission) => mission.eventId === eventId)
  }

  /**
   * Published only, which is the whole rule: a photograph the host refused, hid or
   * deleted was never counted and needs nothing to un-count it.
   */
  private answering(eventId: EventId): readonly Photo[] {
    return this.photos
      .ofEvent(eventId)
      .filter((photo) => photo.status === 'published' && photo.missionId !== null)
  }

  async findById(eventId: EventId, missionId: MissionId): Promise<Mission | null> {
    return this.rows.get(key(eventId, missionId)) ?? null
  }

  async findByPrompt(eventId: EventId, prompt: MissionPrompt): Promise<Mission | null> {
    return this.forEvent(eventId).find((mission) => mission.prompt.equals(prompt)) ?? null
  }

  async listWithProgress(eventId: EventId): Promise<readonly MissionWithProgress[]> {
    const answering = this.answering(eventId)

    return this.forEvent(eventId)
      .sort(inHostOrder)
      .map((mission) => {
        const naming = answering.filter((photo) => photo.missionId === mission.id)
        const guests = new Set(
          naming
            .filter((photo) => photo.author.kind === 'guest')
            // A host upload counts towards `publishedPhotos` and towards nobody's guest
            // tally, exactly as the adapter's `COUNT(DISTINCT author_guest_id)` does.
            .map((photo) => (photo.author.kind === 'guest' ? photo.author.guestId : null)),
        )
        const progress: MissionProgress = {
          publishedPhotos: naming.length,
          completedByGuests: guests.size,
        }
        return { mission, progress }
      })
  }

  async completedByGuest(eventId: EventId, guestId: GuestId): Promise<ReadonlySet<MissionId>> {
    const done = new Set<MissionId>()
    for (const photo of this.answering(eventId)) {
      if (photo.author.kind !== 'guest' || photo.author.guestId !== guestId) continue
      if (photo.missionId !== null) done.add(photo.missionId)
    }
    return done
  }

  async count(eventId: EventId): Promise<number> {
    return this.forEvent(eventId).length
  }

  async save(mission: Mission): Promise<void> {
    this.insert(mission)
  }

  async delete(eventId: EventId, missionId: MissionId): Promise<void> {
    // Order mirrors the database's: the photographs are unfiled by the same action that
    // removes the row, so no caller can observe a photograph pointing at a mission that
    // is already gone.
    this.photos.unfileMission(eventId, missionId)
    this.rows.delete(key(eventId, missionId))
  }
}
