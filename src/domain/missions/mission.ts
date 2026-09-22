import type { EventId, MissionId } from '../shared/ids'
import type { MissionPrompt } from './missionPrompt'
import type { MissionScope } from './missionScope'

/**
 * One prompt on the host's list (docs/ROADMAP.md §2.1).
 *
 * A mission belongs to exactly one event and carries nothing about whether it has been
 * done. That absence is the design. Completion is **derived** from the photographs that
 * name it — see `missionProgress.ts` — rather than stored here, so a photograph tagged
 * with a mission and then refused in moderation stops counting the instant it is
 * refused, with nothing to write and nothing to remember to write.
 *
 * A stored `completed_at` would have to be unset by `moderatePhoto`, by
 * `moderatePhotosBulk`, by `deletePhoto`, by a guest's own delete inside the grace
 * window and by the retention purge — five compensating writes, four of which nobody
 * would think of until a wall said "fait" over a photograph the host had just taken
 * down. Derivation has none of them, and its cost is one indexed query.
 *
 * Immutable, like every other entity here: {@link Mission.edit} returns a new instance.
 */
export interface MissionProps {
  readonly id: MissionId
  readonly eventId: EventId
  readonly prompt: MissionPrompt
  readonly scope: MissionScope
  readonly createdAt: Date
}

export interface NewMission {
  readonly eventId: EventId
  readonly prompt: MissionPrompt
  readonly scope: MissionScope
}

/**
 * How many prompts one event may hold.
 *
 * A ceiling rather than a preference, and it is a product rule on two surfaces at once.
 * On the wall the list shares a corner panel with the photographs and has to be
 * readable at ten metres from across a room; on a phone it is a list a thumb scrolls
 * before the guest has taken a single photograph. The roadmap asks for "a short list",
 * and twelve is the number at which both of those are still true.
 *
 * It is also the only thing standing between a host and a table with ten thousand rows
 * in it, since every mission is read on every wall refresh.
 */
export const MAX_MISSIONS_PER_EVENT = 12

/** Whether an event holding `existing` missions may take one more. */
export const hasRoomForMission = (existing: number): boolean => existing < MAX_MISSIONS_PER_EVENT

export class Mission {
  private constructor(private readonly props: MissionProps) {}

  /**
   * A new mission.
   *
   * Returns a `Mission` rather than a `Result`, unlike most factories here, because
   * there is nothing left to refuse: the prompt arrives already parsed by
   * `MissionPrompt.create` and the scope is a closed set. A `Result` with an error
   * branch nothing can reach is a branch no test can cover, on the one layer this
   * repository holds at 100%.
   */
  static create(input: NewMission, id: MissionId, now: Date): Mission {
    return new Mission({
      id,
      eventId: input.eventId,
      prompt: input.prompt,
      scope: input.scope,
      createdAt: now,
    })
  }

  /** Rehydrate from storage. See `Photo.restore` for why this trusts the row. */
  static restore(props: MissionProps): Mission {
    return new Mission(props)
  }

  get id(): MissionId {
    return this.props.id
  }

  get eventId(): EventId {
    return this.props.eventId
  }

  get prompt(): MissionPrompt {
    return this.props.prompt
  }

  get scope(): MissionScope {
    return this.props.scope
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  /**
   * Correct a prompt, or change who it is asked of.
   *
   * Both at once rather than one setter each, because the host edits one row on one
   * form and a partial update would let a scope be persisted against a prompt that was
   * refused. The photographs already filed under this mission keep pointing at it —
   * which is the whole reason editing exists rather than delete-and-recreate, since
   * deleting a mission unfiles every photograph that named it.
   */
  edit(prompt: MissionPrompt, scope: MissionScope): Mission {
    return new Mission({ ...this.props, prompt, scope })
  }

  equals(other: Mission): boolean {
    return this.props.id === other.props.id
  }

  /** Snapshot for a repository to map into a row. */
  toProps(): MissionProps {
    return this.props
  }
}
