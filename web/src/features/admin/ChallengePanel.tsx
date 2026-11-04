import { useEffect, useState } from 'react'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { useToast } from '../../design-system/components/useToast'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { formatCountdown, remainingMs } from '../../lib/serverClock'
import { SelectField } from './components/SelectField'
import { useChallenge, useMissions } from './hooks/useEventData'
import { ChoiceChips } from '../../design-system/components/ChoiceChips'
import { useStartChallenge, useStopChallenge } from './hooks/useEventActions'
import styles from './ChallengePanel.module.css'

export interface ChallengeControlsProps {
  readonly slug: string
  /** The event is live: a challenge is asked of a room that can still answer (the server refuses otherwise). */
  readonly live: boolean
  /** Where a refusal is said: a toast on the console, a line in the wall's panel (which has no toaster). */
  readonly onFailure: (message: string | null) => void
  /** Mission and duration as chips rather than selects: the wall's drawer (spec 17). */
  readonly visual?: boolean
}

export interface ChallengePanelProps {
  readonly slug: string
  readonly live: boolean
}

/** What the interface offers; the domain accepts any whole number of seconds from 15 to 1800. */
const DURATIONS_SECONDS = [60, 120, 300, 600] as const
const DEFAULT_DURATION_SECONDS = 120

/**
 * Launch and stop a timed photo challenge (spec 10): one of the event's missions, asked of the
 * whole room for a few minutes, counted down on the wall and on every phone.
 *
 * **Any moderator may**, so this is mounted for the owner and for a moderator alike; the owner's
 * mission list is a separate panel. The panel holds view-state only: the server decides whether a
 * challenge is running and what is left of it, and this counts the seconds against the server's
 * clock (`useChallenge` measures the offset), re-reading once when it reaches zero because the end
 * of a challenge is derived from the clock and announces nothing.
 */
export function ChallengeControls({
  slug,
  live,
  onFailure,
  visual = false,
}: ChallengeControlsProps) {
  const t = useTranslations()
  const challenge = useChallenge(slug)
  const missions = useMissions(slug)
  const start = useStartChallenge()
  const stop = useStopChallenge()
  const { reload } = challenge

  const [missionId, setMissionId] = useState('')
  const [seconds, setSeconds] = useState<number>(DEFAULT_DURATION_SECONDS)

  const running = challenge.data?.challenge?.state === 'running' ? challenge.data.challenge : null

  // One tick a second, and only while a challenge is on screen.
  const [now, setNow] = useState(() => Date.now())
  const runningId = running?.id ?? null
  useEffect(() => {
    if (runningId === null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [runningId])

  const left =
    running === null ? 0 : remainingMs(Date.parse(running.endsAt), now, challenge.offsetMs)
  const outOfTime = running !== null && left === 0
  useEffect(() => {
    if (outOfTime) reload()
  }, [outOfTime, reload])

  const list = missions.data ?? []
  // The first mission until the host picks another one: derived at read, so a mission deleted
  // meanwhile never leaves a stale id selected.
  const chosen = list.some((mission) => mission.id === missionId) ? missionId : (list[0]?.id ?? '')

  const launch = () => {
    void start
      .run('start', slug, { missionId: chosen, durationSeconds: seconds })
      .then((result) => {
        onFailure(result.ok ? null : result.message)
        reload()
      })
  }

  const halt = () => {
    void stop.run('stop', slug).then((result) => {
      onFailure(result.ok ? null : result.message)
      reload()
    })
  }

  return (
    <>
      <p className={styles['hint']}>{t.challenge.hint}</p>

      {running === null ? (
        <div className={styles['form']}>
          {visual ? (
            <>
              <ChoiceChips
                legend={t.challenge.mission}
                value={chosen}
                options={list.map((mission) => ({ value: mission.id, label: mission.prompt }))}
                disabled={list.length === 0 || !live}
                onChange={setMissionId}
              />
              <ChoiceChips
                legend={t.challenge.duration}
                value={String(seconds)}
                options={DURATIONS_SECONDS.map((value) => ({
                  value: String(value),
                  label: t.challenge.minutes(value / 60),
                }))}
                disabled={!live}
                onChange={(value) => setSeconds(Number(value))}
              />
            </>
          ) : (
            <>
              <SelectField
                label={t.challenge.mission}
                value={chosen}
                options={list.map((mission) => ({ value: mission.id, label: mission.prompt }))}
                disabled={list.length === 0 || !live}
                onChange={setMissionId}
              />
              <SelectField
                label={t.challenge.duration}
                value={String(seconds)}
                options={DURATIONS_SECONDS.map((value) => ({
                  value: String(value),
                  label: t.challenge.minutes(value / 60),
                }))}
                disabled={!live}
                onChange={(value) => setSeconds(Number(value))}
              />
            </>
          )}
          <div className={styles['actions']}>
            <Button
              loading={start.busy}
              disabled={chosen === '' || !live || challenge.loading}
              onClick={launch}
            >
              {t.challenge.launch}
            </Button>
          </div>
          {list.length === 0 && missions.data !== null ? (
            <p className={styles['hint']}>{t.challenge.noMissions}</p>
          ) : null}
          {!live ? <p className={styles['hint']}>{t.challenge.notOpen}</p> : null}
        </div>
      ) : (
        <div className={styles['running']}>
          <p className={styles['prompt']}>{running.prompt}</p>
          <p className={styles['time']} role="timer" aria-live="off">
            {t.challenge.remaining(formatCountdown(left))}
          </p>
          <div className={styles['actions']}>
            <Button variant="danger" loading={stop.busy} onClick={halt}>
              {t.challenge.stop}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

/** The console's panel: the controls in a card, refusals as toasts. */
export function ChallengePanel({ slug, live }: ChallengePanelProps) {
  const t = useTranslations()
  const toast = useToast()

  return (
    <Card as="h2" title={t.challenge.title}>
      <ChallengeControls
        slug={slug}
        live={live}
        onFailure={(message) => {
          if (message !== null) toast.show(message, { tone: 'danger' })
        }}
      />
    </Card>
  )
}
