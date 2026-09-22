import type { MissionScope } from './missionScope'

/**
 * What the photographs say about one mission, and the two questions that follow.
 *
 * ## Only a published photograph counts
 *
 * Both numbers below are counted over **published** photographs and nothing else, and
 * that single choice is what answers the hardest question in §2.1: a photograph a guest
 * tagged and a moderator then refused must not read as complete on the wall. It does
 * not, and not because anything undoes it — because there was never anything to undo.
 * The tag is the guest's claim about what a photograph is; publishing it is the host's
 * verdict that it counts; and the wall reads the verdict, not the claim.
 *
 * That also covers the cases nobody lists: a photograph hidden mid-evening, one deleted
 * by its author inside the grace window, one taken down after a guest asked. Each of
 * them stops counting the moment it stops being published, on the next read, with no
 * compensating write anywhere.
 *
 * ## The two questions are genuinely different
 *
 * The room and a guest are asking different things, which is why there are two
 * functions rather than one flag. The room asks "has this been answered at all" — the
 * same question for every mission. A guest asks "is there still something here for me",
 * and *that* is the question {@link MissionScope} exists to answer.
 */
export interface MissionProgress {
  /**
   * Published photographs naming this mission, whoever sent them.
   *
   * Host uploads are in here: the venue's own camera roll answers a prompt as well as a
   * guest's phone does, and the room has no way to tell which is which.
   */
  readonly publishedPhotos: number

  /**
   * Distinct **guests** with at least one published photograph naming this mission.
   *
   * What the wall shows beside a per-guest mission, and the reason it is guests rather
   * than photographs: a guest who sends four selfies has done the mission once, and a
   * number that read "47" for eleven people would be a celebration of nothing.
   *
   * Host uploads are deliberately absent, because a host is not a guest and counting
   * the one account that uploads all evening alongside two hundred phones would make
   * the number mean two things at once.
   */
  readonly completedByGuests: number
}

/** A mission nobody has answered yet. The shape a list-with-no-photographs takes. */
export const NO_PROGRESS: MissionProgress = { publishedPhotos: 0, completedByGuests: 0 }

/**
 * Has the room seen this mission answered at all?
 *
 * The wall's question, and it is the same one for both scopes: a per-guest mission that
 * eleven people have done has been answered, and a once-for-the-evening mission that
 * one person photographed has been answered too. What differs between them is what the
 * wall then *shows* — a tick, or how many guests — and that is the presenter's business,
 * not this rule's.
 */
export const isAchieved = (progress: MissionProgress): boolean => progress.publishedPhotos > 0

/**
 * Is this mission finished for one particular guest — the row their checklist ticks?
 *
 * This is the only question `scope` decides, and both answers are load-bearing:
 *
 * - **`event`**: anybody's published photograph ticks it for everybody. "The first
 *   dance" happens once, and leaving one hundred and ninety-nine checklists showing an
 *   open row for something that already happened is asking the room to photograph a
 *   moment that is over.
 * - **`guest`**: only *this* guest's own published photograph ticks it. "A selfie with
 *   the couple" is asked of each guest, and a checklist that ticked itself because
 *   somebody across the room had already sent one would take away the only thing this
 *   feature adds — that there is something for *you* to do.
 *
 * `guestHasOne` is the caller's read of this guest's own published photographs; it is
 * passed in rather than looked up because this layer has no repository.
 */
export const isDoneForGuest = (
  scope: MissionScope,
  progress: MissionProgress,
  guestHasOne: boolean,
): boolean => (scope === 'event' ? isAchieved(progress) : guestHasOne)
