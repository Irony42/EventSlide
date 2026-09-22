import { StatusIcon } from '../../../design-system/components/StatusIcon'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { GuestMissionDto } from '../../../lib/api/dto'
import styles from './MissionChecklist.module.css'

export interface MissionChecklistProps {
  readonly missions: readonly GuestMissionDto[]
  /** The prompt the next upload will be filed under, or `null`. */
  readonly selected: string | null
  readonly onToggle: (missionId: string) => void
}

/**
 * The host's prompts, as something to do (roadmap §2.1).
 *
 * This is the whole point of the feature on the guest's side: instead of "should I bother
 * uploading this", there is a short list with something on it for them.
 *
 * ## One tap, and the same tap again
 *
 * A guest has one thumb, a drink in the other hand and well under a minute of patience.
 * So choosing a mission is **one tap on the prompt itself** — not a select, not a dialog,
 * not a second screen — and tapping the chosen one again clears it. Toggle buttons with
 * `aria-pressed` rather than radios, because a radio group has no "none of these" and
 * adding one would be a thirteenth row that says nothing.
 *
 * The rows are `var(--touch-min)` tall, which is the floor rather than the aspiration: a
 * dark room, sunlight on a terrace, and a thumb reaching from the bottom of the screen.
 *
 * ## A done prompt is still tappable
 *
 * Nothing stops a guest sending a second photograph for a prompt they have answered, and
 * nothing should: they may simply have a better one. What changes is the label — "Fait"
 * for their own, "Déjà photographiée" for a once-for-the-evening prompt somebody else
 * answered, which is the only thing that would otherwise read as a bug.
 *
 * Colour is never the only signal here either: a done row carries the check glyph and the
 * word as well as the accent.
 *
 * ## Nothing at all when the host set no prompts
 *
 * Which is most events. The upload screen is then exactly the screen it was.
 */
export function MissionChecklist({ missions, selected, onToggle }: MissionChecklistProps) {
  const t = useTranslations()

  if (missions.length === 0) return null

  return (
    <section className={styles['checklist']} aria-labelledby="missions-title">
      <h2 id="missions-title" className={styles['title']}>
        {t.upload.missionsTitle}
      </h2>
      <p className={styles['hint']}>{t.upload.missionsHint}</p>
      <ul className={styles['list']}>
        {missions.map((mission) => (
          <li key={mission.id}>
            <button
              type="button"
              className={styles['row']}
              // A toggle, not a radio: the guest must be able to take the choice back,
              // and `aria-pressed` is the pattern a screen reader already knows.
              aria-pressed={mission.id === selected}
              aria-label={t.upload.missionSelect(mission.prompt)}
              data-mission-done={mission.done ? 'true' : 'false'}
              onClick={() => onToggle(mission.id)}
            >
              <StatusIcon
                tone={mission.done ? 'success' : 'neutral'}
                className={styles['icon'] ?? ''}
              />
              <span className={styles['prompt']}>{mission.prompt}</span>
              {mission.done ? (
                <span className={styles['done']}>
                  {/* A per-guest prompt they answered themselves, against a
                      once-for-the-evening one somebody else did. Without the second
                      wording, a row a guest never touched simply reads as a bug. */}
                  {mission.scope === 'event' ? t.upload.missionDoneByRoom : t.upload.missionDone}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
