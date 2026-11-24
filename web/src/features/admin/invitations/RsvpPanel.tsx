import { Badge } from '../../../design-system/components/Badge'
import { useState } from 'react'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { SelectField } from '../../../design-system/components/SelectField'
import { Spinner } from '../../../design-system/components/Spinner'
import { TextInput } from '../../../design-system/components/TextInput'
import { RsvpExtras } from './RsvpExtras'
import { useNow } from '../rsvps/useNow'
import { dateOf, dayOf } from '../../../lib/rsvp/rsvpDates'
import { windowAction } from '../../../lib/rsvp/rsvpList'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import {
  PARTY_SIZES,
  PRESETS,
  kindOf,
  usableDeadline,
  type PartyKind,
} from '../../../lib/rsvp/rsvpSettings'
import type { RsvpSettingsState } from './useRsvpSettings'
import styles from './RsvpPanel.module.css'

export interface RsvpPanelProps {
  readonly rsvp: RsvpSettingsState
  /** An archived event is a record: the settings are read-only. */
  readonly archived: boolean
  /** The invitation's own zone: the days it shows are the party's, not the host's browser's. */
  readonly timeZone?: string | null
}

/**
 * "Réponses des invités": what the host asks the guests on the invitation's page (spec 30, lot 1),
 * saved as it is chosen. Surface: the host (the owner). The window's state, the date it closes and
 * the date the replies are erased are **the server's**, shown as it says them; the form's fields
 * are the host's choices, and the preview beside it follows each at once.
 *
 * Replies hang on the invitation: until it exists the panel says so and asks nothing.
 */
export function RsvpPanel({ rsvp, archived, timeZone = null }: RsvpPanelProps) {
  const t = useTranslations()
  const text = t.rsvp.host
  const { locale } = useLocale()
  const { settings } = rsvp
  /** What is being typed in the date field, until it is left: a half-typed date is not a choice. */
  const [typed, setTyped] = useState<{ value: string; base: string | null } | null>(null)
  /** A preset waiting for the host to agree to replace what they chose themselves. */
  const [preset, setPreset] = useState<PartyKind | null>(null)
  /** The time the page was read: a deadline gone by is judged against it, not re-read at every render. */
  const readAt = useNow(60_000)

  if (settings === null) {
    return (
      <section className={styles['panel']} aria-labelledby="rsvp-panel-title">
        <h2 id="rsvp-panel-title" className={styles['title']}>
          {text.title}
        </h2>
        {rsvp.loadFailure === null ? (
          <Spinner size="sm" label={text.title} />
        ) : (
          <Notice tone="danger" variant="boxed" role="alert">
            {text.loadFailed}
            <Button size="sm" onClick={rsvp.retryLoad}>
              {text.retry}
            </Button>
          </Notice>
        )}
      </section>
    )
  }

  const locked = archived || !settings.invited
  const { form } = settings
  const kind = kindOf(settings)
  const action = windowAction(settings, readAt)
  const closedByDate = action === 'closedByDate'
  const reopenNeedsDate = action === 'moveDate'
  const stateBadge =
    settings.state === 'closed' ? (
      <Badge tone="warning">{text.stateClosed}</Badge>
    ) : settings.state === 'full' ? (
      <Badge tone="warning">{text.stateFull}</Badge>
    ) : settings.enabled ? (
      <Badge tone="success">{text.stateOpen}</Badge>
    ) : (
      <Badge tone="neutral">{text.stateOff}</Badge>
    )

  return (
    <section className={styles['panel']} aria-labelledby="rsvp-panel-title">
      <h2 id="rsvp-panel-title" className={styles['title']}>
        <span>{text.title}</span>
        {stateBadge}
      </h2>

      {archived ? (
        <Notice tone="warning" variant="inline">
          {text.archived}
        </Notice>
      ) : settings.invited ? null : (
        <Notice tone="warning" variant="inline">
          {text.needsInvite}
        </Notice>
      )}

      <CheckboxField
        label={text.askLabel}
        hint={text.askHint}
        checked={settings.enabled}
        disabled={locked}
        onChange={(enabled) => rsvp.change({ enabled })}
      />

      <div className={styles['deadline']}>
        <Field label={text.deadlineLabel} hint={text.deadlineHint} optional>
          {(control) => (
            <TextInput
              {...control}
              type="date"
              value={
                typed !== null && typed.base === settings.deadline
                  ? typed.value
                  : (settings.deadline ?? '')
              }
              disabled={locked}
              onBlur={() => setTyped(null)}
              onChange={(event) => {
                // Typing passes through "" and "0020-…": only a real, recent day is a choice (the
                // button beside the field clears the deadline).
                const day = usableDeadline(event.target.value, new Date())
                // Tied to the deadline it left on screen: a refusal puts the server's day back.
                setTyped({ value: event.target.value, base: day ?? settings.deadline })
                if (day !== null) rsvp.change({ deadline: day })
              }}
            />
          )}
        </Field>
        {settings.deadline === null ? null : (
          <Button
            variant="ghost"
            size="sm"
            disabled={locked}
            onClick={() => {
              setTyped(null)
              rsvp.change({ deadline: null })
            }}
          >
            {text.deadlineClear}
          </Button>
        )}
      </div>

      {settings.invited && settings.enabled ? (
        <div className={styles['window']}>
          {closedByDate ? (
            <p>{text.closedByDate}</p>
          ) : settings.state === 'closed' ? (
            <p>{text.closedNote}</p>
          ) : settings.deadline !== null ? (
            <p>{text.openUntil(dayOf(settings.deadline, locale))}</p>
          ) : settings.closesAt === null ? null : (
            <p>{text.closesOn(dateOf(settings.closesAt, locale, timeZone))}</p>
          )}
          {reopenNeedsDate ? <p>{text.reopenNeedsDate}</p> : null}
          {action === 'close' ? (
            <Button size="sm" disabled={archived || rsvp.acting} onClick={rsvp.close}>
              {text.closeAction}
            </Button>
          ) : action === 'reopen' ? (
            <Button size="sm" disabled={archived || rsvp.acting} onClick={rsvp.reopen}>
              {text.reopenAction}
            </Button>
          ) : null}
        </div>
      ) : null}
      {settings.erasedAt === null ? null : (
        <p className={styles['note']}>
          {text.erasedOn(dateOf(settings.erasedAt, locale, timeZone))}
        </p>
      )}

      <fieldset className={styles['asks']} disabled={locked}>
        <legend className={styles['legend']}>{text.asksTitle}</legend>
        <SelectField
          label={text.presetLabel}
          hint={text.presetHint}
          value={kind ?? 'custom'}
          disabled={locked}
          options={[
            { value: 'party', label: text.presetParty },
            { value: 'wedding', label: text.presetWedding },
            ...(kind === null ? [{ value: 'custom', label: text.presetCustom }] : []),
          ]}
          onChange={(value) => {
            if (value !== 'party' && value !== 'wedding') return
            // A preset replaces the choices: silently while they still are one, asked once the
            // host went their own way.
            if (kind === null) setPreset(value)
            else rsvp.change({ form: PRESETS[value] })
          }}
        />
        <CheckboxField
          label={text.maybeLabel}
          hint={text.maybeHint}
          checked={form.maybe}
          disabled={locked}
          onChange={(maybe) => rsvp.change({ form: { maybe } })}
        />
        <CheckboxField
          label={text.sizeLabel}
          hint={text.sizeHint}
          checked={form.partySize.enabled}
          disabled={locked}
          onChange={(enabled) => rsvp.change({ form: { partySize: { enabled } } })}
        />
        {form.partySize.enabled ? (
          <div className={styles['sub']}>
            <SelectField
              label={`${text.sizeMax} ${text.sizeUnit}`}
              value={String(form.partySize.max)}
              disabled={locked}
              options={sizeOptions(form.partySize.max)}
              onChange={(max) => rsvp.change({ form: { partySize: { max: Number(max) } } })}
            />
            <CheckboxField
              label={text.kidsLabel}
              hint={text.kidsHint}
              checked={form.kidsSeparate}
              disabled={locked}
              onChange={(kidsSeparate) => rsvp.change({ form: { kidsSeparate } })}
            />
          </div>
        ) : null}
        <CheckboxField
          label={text.dietLabel}
          hint={text.dietHint}
          checked={form.diet}
          disabled={locked}
          onChange={(diet) => rsvp.change({ form: { diet } })}
        />
        <CheckboxField
          label={text.absentNote}
          hint={text.absentNoteHint}
          checked={form.absentNote}
          disabled={locked}
          onChange={(absentNote) => rsvp.change({ form: { absentNote } })}
        />
        <SelectField
          label={text.visibilityLabel}
          hint={text.visibilityHint}
          value={form.visibility}
          disabled={locked}
          options={[
            { value: 'off', label: text.visibilityOff },
            { value: 'count', label: text.visibilityCount },
            { value: 'names', label: text.visibilityNames },
          ]}
          onChange={(value) => {
            if (value === 'off' || value === 'count' || value === 'names') {
              rsvp.change({ form: { visibility: value } })
            }
          }}
        />
        <RsvpExtras
          form={form}
          locked={locked}
          change={rsvp.change}
          saveState={rsvp.saveState}
          problem={rsvp.problem}
          momentReplies={rsvp.momentReplies}
        />
      </fieldset>

      <div
        className={styles['saveLine']}
        role="status"
        aria-live="polite"
        data-state={rsvp.saveState}
      >
        {rsvp.saveState === 'pending' || rsvp.saveState === 'saving'
          ? text.saving
          : rsvp.saveState === 'saved' && rsvp.problem === null
            ? text.saved
            : null}
      </div>
      {rsvp.problem === null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {rsvp.problem}
        </Notice>
      )}

      <ConfirmDialog
        open={preset !== null}
        title={text.presetConfirmTitle}
        description={text.presetConfirm(
          preset === 'wedding' ? text.presetKindWedding : text.presetKindParty,
        )}
        confirmLabel={text.presetConfirmYes}
        confirmVariant="primary"
        onConfirm={() => {
          if (preset !== null) rsvp.change({ form: PRESETS[preset] })
          setPreset(null)
        }}
        onCancel={() => setPreset(null)}
      />

      <div className={styles['explain']}>
        <h3>{text.fewTitle}</h3>
        <p>{text.few}</p>
        <h3>{text.noContactTitle}</h3>
        <p>{text.noContact}</p>
        <h3>{text.erasedTitle}</h3>
        <p>{text.erased}</p>
      </div>
    </section>
  )
}

/** The sizes offered, and the one the server holds when it is not among them. */
const sizeOptions = (current: number) =>
  [...new Set([...PARTY_SIZES, current])]
    .sort((a, b) => a - b)
    .map((size) => ({ value: String(size), label: String(size) }))
