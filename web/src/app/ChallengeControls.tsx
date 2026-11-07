import { useEffect, useState } from 'react'
import { Button } from '../design-system/components/Button'
import { useTranslations } from '../lib/i18n/useTranslations'
import { formatCountdown, remainingMs } from '../lib/serverClock'
import { Field } from '../design-system/components/Field'
import { TextInput } from '../design-system/components/TextInput'
import { SelectField } from '../design-system/components/SelectField'
import { useChallenge, useMissions } from '../features/admin/hooks/useEventData'
import { ChoiceChips } from '../design-system/components/ChoiceChips'
import { useStartChallenge, useStopChallenge } from '../features/admin/hooks/useEventActions'
import styles from './ChallengeControls.module.css'

export interface ChallengeControlsProps {
  readonly slug: string
  /** The event is live: a challenge is asked of a room that can still answer (the server refuses otherwise). */
  readonly live: boolean
  /** Where a refusal is said: a toast on the console, a line in the wall's panel (which has no toaster). */
  readonly onFailure: (message: string | null) => void
  /** Mission and duration as chips rather than selects: the wall's drawer (spec 17). */
  readonly visual?: boolean
}


/** A challenge's text is a mission's: one line of sixty characters (the domain's `MissionPrompt`). */
const PROMPT_MAX_LENGTH = 60

interface PromptChipsProps {
  readonly title: string
  readonly texts: readonly string[]
  readonly disabled: boolean
  readonly onTake: (text: string, index: number) => void
}

/** A short list of texts to take with one touch; nothing at all when the list is empty. */
function PromptChips({ title, texts, disabled, onTake }: PromptChipsProps) {
  if (texts.length === 0) return null
  return (
    <div className={styles['chips']} role="group" aria-label={title}>
      <p className={styles['chipsTitle']}>{title}</p>
      {texts.map((text, index) => (
        <Button
          key={`${index}-${text}`}
          size="sm"
          disabled={disabled}
          onClick={() => onTake(text, index)}
        >
          {text}
        </Button>
      ))}
    </div>
  )
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

  // The text the host is typing, and the mission it was taken from while it is still that text.
  const [prompt, setPrompt] = useState('')
  const [linkedMission, setLinkedMission] = useState<string | null>(null)
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
  const recent = challenge.data?.recent ?? []
  const typed = prompt.trim()

  // A suggestion, a past text or a mission only fills the box: the host may correct it before
  // launching, and correcting a mission's text cuts the link to it.
  const take = (text: string, missionId: string | null = null) => {
    setPrompt(text)
    setLinkedMission(missionId)
  }
  const type = (text: string) => {
    setPrompt(text)
    setLinkedMission(null)
  }

  const launch = () => {
    void start
      .run('start', slug, {
        prompt: typed,
        ...(linkedMission === null ? {} : { missionId: linkedMission }),
        durationSeconds: seconds,
      })
      .then((result) => {
        onFailure(result.ok ? null : result.message)
        if (result.ok) take('')
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
          <Field label={t.challenge.prompt}>
            {(control) => (
              <TextInput
                {...control}
                autoComplete="off"
                maxLength={PROMPT_MAX_LENGTH}
                value={prompt}
                disabled={!live}
                onChange={(event) => type(event.target.value)}
              />
            )}
          </Field>
          <p className={styles['count']} aria-hidden="true">
            {t.challenge.promptCount(prompt.length, PROMPT_MAX_LENGTH)}
          </p>
          <PromptChips
            title={t.challenge.recent}
            texts={recent}
            disabled={!live}
            onTake={(text) => take(text)}
          />
          <PromptChips
            title={t.challenge.ideasTitle}
            texts={t.challenge.ideas}
            disabled={!live}
            onTake={(text) => take(text)}
          />
          <PromptChips
            title={t.challenge.fromMission}
            texts={list.map((mission) => mission.prompt)}
            disabled={!live}
            onTake={(text, index) => take(text, list[index]?.id ?? null)}
          />
          {visual ? (
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
          ) : (
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
          )}
          <div className={styles['actions']}>
            <Button
              loading={start.busy}
              disabled={typed === '' || !live || challenge.loading}
              onClick={launch}
            >
              {t.challenge.launch}
            </Button>
          </div>
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
