import { DomainError } from '../shared/errors'
import { toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'

/**
 * One line the host writes and the room reads — "un selfie avec les mariés".
 *
 * It is **content**, not interface copy. The host types it in whatever language the
 * wedding is held in, it is stored as they typed it, and it is never translated: the
 * guest translation tables in `web/src/lib/i18n/` carry the words *around* the list
 * ("Missions", "fait") and none of the words *in* it. That distinction is what makes a
 * German guest at a French wedding read a French prompt and a French checkbox label,
 * which is right — the prompt names something that happened in that room.
 *
 * It is also untrusted text on the one surface where being wrong is most expensive. A
 * prompt reaches a projector in front of two hundred people and a phone in a dark room,
 * so it is folded to a single line and stripped of everything invisible by
 * {@link toSingleLine} — the same treatment a guest's caption gets, for the same reason
 * and by the same function.
 *
 * **Sixty characters**, against a caption's hundred and forty. The two are read in
 * different shapes: a caption has the full width of the wall and two lines under a
 * photograph, while a prompt is one row of a list that shares a corner panel with up to
 * eleven siblings and has to stay legible at ten metres. Sixty is generous against what
 * a prompt actually is — the roadmap's own three examples are 24, 20 and 14 characters
 * — and it refuses the paragraph that would push the list off the bottom of the panel.
 *
 * What it does **not** do is strip markup. There is nothing to strip: React escapes on
 * render and nothing here writes HTML, so a prompt containing `<b>` shows the room the
 * five characters the host typed. Guessing at markup would mean a host who writes
 * "3 < 4" losing half their sentence to a sanitiser protecting against a hole that does
 * not exist.
 */

const MAX_LENGTH = 60

export class MissionPrompt {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<MissionPrompt, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('mission.promptInvalid'))

    const cleaned = toSingleLine(raw)

    // A blank prompt is a row on the wall with nothing in it, which reads as a defect
    // rather than as an empty list. Refused rather than dropped, because the host is at
    // a keyboard and can be told.
    if (cleaned.length === 0) return err(DomainError.invalid('mission.promptEmpty'))
    if (cleaned.length > MAX_LENGTH) {
      return err(DomainError.invalid('mission.promptTooLong', { max: MAX_LENGTH }))
    }
    return ok(new MissionPrompt(cleaned))
  }

  static readonly maxLength = MAX_LENGTH

  equals(other: MissionPrompt): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
