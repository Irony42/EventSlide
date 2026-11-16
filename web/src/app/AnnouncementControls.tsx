import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { Badge, type BadgeTone } from '../design-system/components/Badge'
import { Button } from '../design-system/components/Button'
import { ChoiceChips } from '../design-system/components/ChoiceChips'
import { Field } from '../design-system/components/Field'
import { Notice } from '../design-system/components/Notice'
import { TextInput } from '../design-system/components/TextInput'
import { useAnnouncements } from '../features/admin/hooks/useEventData'
import {
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useLaunchAnnouncement,
  useUpdateAnnouncement,
} from '../features/admin/hooks/useEventActions'
import { announcementWindowPhaseAt } from '../features/wall/announcementPhase'
import type { AnnouncementDto, AnnouncementKind, AnnouncementState } from '../lib/api/dto'
import { characterCount, clampCharacters } from '../lib/characters'
import { formatDateTime } from '../lib/format'
import { useLocale } from '../lib/i18n/useTranslations'
import { serverNowFrom } from '../lib/serverClock'
import {
  ANNOUNCEMENT_TEXT_MAX,
  KIND_OFFERS,
  blankDraft,
  draftOf,
  editInput,
  hasText,
  launchInput,
  scheduleInput,
  withKind,
  type AnnouncementDraft,
} from './announcementDraft'
import { leadMinutes, resolveAnnouncementInstant } from './announcementInstant'
import styles from './AnnouncementControls.module.css'

export interface AnnouncementControlsProps {
  readonly slug: string
  /** The event is live. A draft may still be prepared (the server allows it); the wall shows nothing before the doors open. */
  readonly live: boolean
  /** The event's scheduled opening (ISO), when it has one: "00:30" then means the night after it opens. */
  readonly opensAt?: string | null
  /** Where a refusal is said: a toast on the event page, a line in the wall's drawer (which has no toaster). */
  readonly onFailure: (message: string | null) => void
}

/** The longest the clock waits before it looks again: the line that resolves the typed time stays honest. */
const CLOCK_TICK_MS = 15_000

/** This machine's clock, named so that a handler reads it and the render does not (the `react-hooks/purity` rule). */
const localNow = (): number => Date.now()

/** The moment each announcement changes phase, in server milliseconds (the countdown, the card, its end). */
const boundariesOf = (items: readonly AnnouncementDto[]): readonly number[] =>
  items.flatMap((item) => {
    const at = Date.parse(item.at)
    return [at - item.countdownSeconds * 1000, at, at + item.durationSeconds * 1000]
  })

/**
 * The server's clock, as this machine tells it, read at every render: a list that has just arrived
 * is derived from now, never from a reading taken at the last tick (an announcement launched a
 * moment ago would read as "À venir" until the next one). The timer only decides **when to render
 * again**: when an announcement changes phase, and at least every fifteen seconds so the line
 * that resolves a typed time stays honest. Nothing runs while unmounted.
 */
const useServerClock = (offsetMs: number, boundaries: readonly number[]): number => {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const serverNow = serverNowFrom(Date.now(), offsetMs)
    const next = boundaries.reduce(
      (soonest, at) => (at > serverNow ? Math.min(soonest, at) : soonest),
      Infinity,
    )
    const wait = Math.max(25, Math.min(CLOCK_TICK_MS, next - serverNow + 25))
    const timer = setTimeout(() => setTick((count) => count + 1), wait)
    return () => clearTimeout(timer)
  }, [tick, offsetMs, boundaries])

  return serverNowFrom(localNow(), offsetMs)
}

/** Where a row is at `serverNowMs`: derived from its three integers, never from a word the server sent. */
const phaseOf = (row: AnnouncementDto, serverNowMs: number): AnnouncementState =>
  announcementWindowPhaseAt(
    {
      atMs: Date.parse(row.at),
      durationSeconds: row.durationSeconds,
      countdownSeconds: row.countdownSeconds,
    },
    serverNowMs,
  ).phase

const STATE_TONES: Readonly<Record<AnnouncementState, BadgeTone>> = {
  upcoming: 'neutral',
  counting: 'warning',
  showing: 'success',
  over: 'neutral',
}

interface IdeasProps {
  readonly title: string
  readonly texts: readonly string[]
  readonly onTake: (text: string) => void
}

/** A short list of texts to take with one touch. */
function Ideas({ title, texts, onTake }: IdeasProps) {
  return (
    <div className={styles['chips']} role="group" aria-label={title}>
      <p className={styles['chipsTitle']}>{title}</p>
      {texts.map((text) => (
        <Button key={text} size="sm" onClick={() => onTake(text)}>
          {text}
        </Button>
      ))}
    </div>
  )
}

/**
 * Schedule, correct, launch and delete announcements (spec 21): a sentence for the whole room, at
 * a time, as a card in the middle of the wall or as a discreet text over the photos.
 *
 * **Any moderator may**, so this is mounted for the owner and for a moderator alike. It holds
 * view-state only: the server decides what overlaps, what is locked and what each moment means,
 * and this counts against the server's clock (`useAnnouncements` measures the offset). What the
 * host types is a **time of day**; `resolveAnnouncementInstant` turns it into an instant in the
 * browser's zone and the line under the field says which one, in words, before anything is saved.
 */
export function AnnouncementControls({
  slug,
  live,
  opensAt = null,
  onFailure,
}: AnnouncementControlsProps) {
  const { text: t, locale } = useLocale()
  const copy = t.announcement
  const announcements = useAnnouncements(slug)
  const create = useCreateAnnouncement()
  const update = useUpdateAnnouncement()
  const launchRow = useLaunchAnnouncement()
  const remove = useDeleteAnnouncement()
  const { reload } = announcements
  const kindName = useId()

  const [draft, setDraft] = useState<AnnouncementDraft>(() => blankDraft())
  const [timeTouched, setTimeTouched] = useState(false)
  const [editing, setEditing] = useState<{ id: string; textOnly: boolean } | null>(null)

  const items = useMemo(
    () =>
      [...(announcements.data?.announcements ?? [])].sort(
        (a, b) => Date.parse(a.at) - Date.parse(b.at),
      ),
    [announcements.data],
  )
  const boundaries = useMemo(() => boundariesOf(items), [items])
  const nowMs = useServerClock(announcements.offsetMs, boundaries)

  const offer = KIND_OFFERS[draft.kind]
  const textOnly = editing?.textOnly === true
  const openAtMs = opensAt === null ? null : Date.parse(opensAt)
  const resolved = resolveAnnouncementInstant(
    draft.time,
    nowMs,
    openAtMs === null || Number.isNaN(openAtMs) ? null : openAtMs,
  )
  // Correcting an announcement and not touching its time keeps the instant the server holds.
  const showResolution = editing === null || timeTouched

  const afterWrite = (message: string | null, done: boolean) => {
    onFailure(message)
    if (done) {
      setDraft((current) => ({
        ...blankDraft(current.kind),
        durationSeconds: current.durationSeconds,
        countdownSeconds: current.countdownSeconds,
      }))
      setTimeTouched(false)
      setEditing(null)
    }
    reload()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!hasText(draft)) return
    if (editing !== null) {
      const atMs = timeTouched && resolved !== null ? resolved.atMs : null
      void update
        .run(editing.id, slug, editing.id, editInput(draft, editing.textOnly, atMs))
        .then((result) => afterWrite(result.ok ? null : result.message, result.ok))
      return
    }
    if (resolved === null) return
    void create
      .run('create', slug, scheduleInput(draft, resolved.atMs))
      .then((result) => afterWrite(result.ok ? null : result.message, result.ok))
  }

  const launchNow = () => {
    if (!hasText(draft)) return
    void create
      .run('launch', slug, launchInput(draft))
      .then((result) => afterWrite(result.ok ? null : result.message, result.ok))
  }

  const relaunch = (id: string) => {
    void launchRow.run(id, slug, id).then((result) => {
      onFailure(result.ok ? null : result.message)
      reload()
    })
  }

  const erase = (id: string) => {
    void remove.run(id, slug, id).then((result) => {
      onFailure(result.ok ? null : result.message)
      if (result.ok && editing?.id === id) {
        setEditing(null)
        setDraft(blankDraft())
        setTimeTouched(false)
      }
      reload()
    })
  }

  const startEditing = (row: AnnouncementDto) => {
    setDraft(draftOf(row))
    setTimeTouched(false)
    // A discreet text may stay up for half an hour, so its words stay correctable while it is on
    // screen and nothing else does (rule 11); every other kind waits for "Retirer de l'écran".
    // Read at the press, on the server's clock: what the screen drew may be a tick behind.
    const state = phaseOf(row, serverNowFrom(localNow(), announcements.offsetMs))
    setEditing({ id: row.id, textOnly: state === 'showing' })
  }

  const cancelEditing = () => {
    setEditing(null)
    setDraft(blankDraft())
    setTimeTouched(false)
  }

  const day = (atMs: number): string =>
    new Date(atMs).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  const resolutionLine =
    resolved === null
      ? ''
      : (() => {
          const lead = copy.lead(leadMinutes(resolved.leadMs))
          if (resolved.day === 'today') return copy.resolvedToday(draft.time, lead)
          if (resolved.day === 'tomorrow') return copy.resolvedTomorrow(draft.time, lead)
          return copy.resolvedOn(day(resolved.atMs), draft.time, lead)
        })()

  const busy = create.busy || update.busy
  const ideas = draft.kind === 'fullscreen' ? copy.ideas : copy.ideasDiscreet
  const kinds: readonly {
    readonly value: AnnouncementKind
    readonly name: string
    readonly help: string
  }[] = [
    { value: 'fullscreen', name: copy.kindFullscreen, help: copy.kindFullscreenHelp },
    { value: 'discreet', name: copy.kindDiscreet, help: copy.kindDiscreetHelp },
  ]

  return (
    <>
      <p className={styles['hint']}>{copy.hint}</p>

      <form className={styles['form']} noValidate onSubmit={submit}>
        {editing === null ? null : <p className={styles['editing']}>{copy.editing}</p>}
        {textOnly ? <p className={styles['hint']}>{copy.textOnly}</p> : null}

        <Field label={copy.text}>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              value={draft.text}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  text: clampCharacters(event.target.value, ANNOUNCEMENT_TEXT_MAX),
                })
              }
            />
          )}
        </Field>
        <p className={styles['count']} aria-hidden="true">
          {copy.textCount(characterCount(draft.text), ANNOUNCEMENT_TEXT_MAX)}
        </p>
        <Ideas
          title={copy.ideasTitle}
          texts={ideas}
          onTake={(text) => setDraft({ ...draft, text })}
        />

        <fieldset className={styles['kind']} disabled={textOnly}>
          <legend className={styles['kindLegend']}>{copy.kind}</legend>
          {kinds.map((kind) => (
            <label key={kind.value} className={styles['kindOption']}>
              <input
                type="radio"
                className={styles['kindInput']}
                name={kindName}
                value={kind.value}
                checked={draft.kind === kind.value}
                onChange={() => setDraft(withKind(draft, kind.value))}
              />
              <span className={styles['kindName']}>{kind.name}</span>
              <span className={styles['kindHelp']}>{kind.help}</span>
            </label>
          ))}
        </fieldset>

        <Field label={copy.time} hint={copy.timeHint} optional>
          {(control) => (
            <TextInput
              {...control}
              type="time"
              value={draft.time}
              disabled={textOnly}
              onChange={(event) => {
                setDraft({ ...draft, time: event.target.value })
                setTimeTouched(true)
              }}
            />
          )}
        </Field>
        {/* The moment the time means, in words: read out politely as the host types. */}
        <div className={styles['resolution']} aria-live="polite">
          {showResolution && resolutionLine !== '' ? <p>{resolutionLine}</p> : null}
          {showResolution && resolved?.far === true ? (
            <Notice tone="warning" variant="inline">
              {copy.far}
            </Notice>
          ) : null}
        </div>

        {offer.countdowns === null ? null : (
          <ChoiceChips
            legend={copy.countdown}
            value={String(draft.countdownSeconds)}
            options={offer.countdowns.map((seconds) => ({
              value: String(seconds),
              label: seconds === 0 ? copy.countdownNone : copy.span(seconds),
            }))}
            disabled={textOnly}
            onChange={(value) => setDraft({ ...draft, countdownSeconds: Number(value) })}
          />
        )}
        <ChoiceChips
          legend={copy.duration}
          value={String(draft.durationSeconds)}
          options={offer.durations.map((seconds) => ({
            value: String(seconds),
            label: copy.span(seconds),
          }))}
          disabled={textOnly}
          onChange={(value) => setDraft({ ...draft, durationSeconds: Number(value) })}
        />

        <div className={styles['actions']}>
          {editing === null ? (
            <>
              <Button
                type="submit"
                variant="primary"
                loading={create.isPending('create')}
                disabled={!hasText(draft) || resolved === null || busy}
              >
                {copy.schedule}
              </Button>
              <Button
                loading={create.isPending('launch')}
                disabled={!hasText(draft) || busy}
                onClick={launchNow}
              >
                {copy.launchNow}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="submit"
                variant="primary"
                loading={update.isPending(editing.id)}
                disabled={!hasText(draft) || busy}
              >
                {copy.save}
              </Button>
              <Button onClick={cancelEditing}>{copy.cancel}</Button>
            </>
          )}
        </div>
        {!live ? <p className={styles['hint']}>{copy.notLive}</p> : null}
      </form>

      {announcements.error !== null ? (
        <Notice tone="danger" role="alert" variant="inline">
          {copy.loadFailed}
        </Notice>
      ) : null}
      {announcements.data !== null && items.length === 0 ? (
        <p className={styles['hint']}>{copy.empty}</p>
      ) : null}
      {items.length === 0 ? null : (
        <ul className={styles['list']} aria-label={copy.listLabel}>
          {items.map((row) => {
            const state = phaseOf(row, nowMs)
            const mayEdit =
              state === 'upcoming' ||
              state === 'counting' ||
              (state === 'showing' && row.kind === 'discreet')
            return (
              <li key={row.id} className={styles['item']}>
                <div role="group" aria-label={row.text} className={styles['row']}>
                  <p className={styles['rowText']}>{row.text}</p>
                  <p className={styles['rowMeta']}>
                    <Badge tone={STATE_TONES[state]}>{copy.states[state]}</Badge>
                    <span>
                      {row.kind === 'fullscreen' ? copy.kindFullscreen : copy.kindDiscreet}
                      {' · '}
                      {formatDateTime(row.at, locale) ?? row.at}
                    </span>
                  </p>
                  <div className={styles['rowActions']}>
                    {mayEdit ? (
                      <Button size="sm" onClick={() => startEditing(row)}>
                        {copy.edit}
                      </Button>
                    ) : null}
                    {state === 'upcoming' || state === 'counting' ? (
                      <Button
                        size="sm"
                        loading={launchRow.isPending(row.id)}
                        onClick={() => relaunch(row.id)}
                      >
                        {copy.launchNow}
                      </Button>
                    ) : null}
                    {state === 'over' ? (
                      <Button
                        size="sm"
                        loading={launchRow.isPending(row.id)}
                        onClick={() => relaunch(row.id)}
                      >
                        {copy.relaunch}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="danger"
                      loading={remove.isPending(row.id)}
                      onClick={() => erase(row.id)}
                    >
                      {state === 'showing' ? copy.withdraw : copy.remove}
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
