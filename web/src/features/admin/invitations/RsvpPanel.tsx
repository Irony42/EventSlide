import { useState } from 'react'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { Spinner } from '../../../design-system/components/Spinner'
import { TextInput } from '../../../design-system/components/TextInput'
import { cx } from '../../../design-system/classNames'
import { SelectField } from '../../../design-system/components/SelectField'
import { useNow } from '../rsvps/useNow'
import { dateOf, dayOf } from '../../../lib/rsvp/rsvpDates'
import { PARTY_SIZE_MAX, PARTY_SIZE_MIN } from '../../../lib/rsvp/partySize'
import { MOMENTS_MAX, QUESTIONS_MAX } from '../../../lib/rsvp/rsvpExtras'
import { windowAction } from '../../../lib/rsvp/rsvpList'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { PRESETS, kindOf, usableDeadline, type PartyKind } from '../../../lib/rsvp/rsvpSettings'
import { Disclosure } from './Disclosure'
import { PartySizeField } from './PartySizeField'
import { RsvpExtras } from './RsvpExtras'
import { SidePanel } from './SidePanel'
import type { RsvpSettingsState } from './useRsvpSettings'
import styles from './RsvpPanel.module.css'

export interface RsvpPanelProps {
  readonly rsvp: RsvpSettingsState
  /** An archived event is a record: the settings are read-only. */
  readonly archived: boolean
  /** The invitation's own zone: the days it shows are the party's, not the host's browser's. */
  readonly timeZone?: string | null
  /** Closes the panel (the page owns the address that says it is open). */
  readonly onClose: () => void
  /** The panel was opened by the host, not by a reload on its address. */
  readonly focusOnMount?: boolean
}

/** The id the page's entry row points at with `aria-controls`. */
export const RSVP_PANEL_ID = 'invite-panel-rsvp'

/**
 * "Réponses des invités": what the host asks the guests on the invitation's page (spec 30, lot 1),
 * saved as it is chosen, in a panel that takes the place of the card's column. Surface: the host
 * (the owner). The window's state, the date it closes and the date the replies are erased are
 * **the server's**, shown as it says them; the form's fields are the host's choices, and the
 * preview beside it (the guest's page) follows each at once.
 *
 * **Two levels**: what a host sets on nearly every party is on the panel (the switch, the date, the
 * kind of party, the essentials); the rest is in six folded groups that say what they hold on their
 * own line. An option that depends on another is drawn only while its parent is on.
 *
 * Replies hang on the invitation: until it exists the panel says so and asks nothing.
 */
export function RsvpPanel({
  rsvp,
  archived,
  timeZone = null,
  onClose,
  focusOnMount = false,
}: RsvpPanelProps) {
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
  const panel = { id: RSVP_PANEL_ID, title: text.title, onClose, focusOnMount }

  if (settings === null) {
    return (
      <SidePanel {...panel}>
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
      </SidePanel>
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

  const choosePreset = (value: PartyKind) => {
    // A preset replaces the choices: silently while they still are one, asked once the host went
    // their own way.
    if (kind === null) setPreset(value)
    else rsvp.change({ form: PRESETS[value] })
  }

  const presets: readonly {
    readonly key: PartyKind | 'custom'
    readonly label: string
    readonly note: string
  }[] = [
    { key: 'party', label: text.presetParty, note: text.presetPartyNote },
    { key: 'wedding', label: text.presetWedding, note: text.presetWeddingNote },
    { key: 'custom', label: text.presetCustom, note: text.presetCustomNote },
  ]

  const mealsSummary =
    [
      form.companionNames ? text.summaryCompanions : null,
      form.meals.enabled ? text.summaryMeals(form.meals.options.length) : null,
    ]
      .filter((part): part is string => part !== null)
      .join(', ') || text.summaryNone
  const placesSummary = [
    form.capacity === null ? text.summaryNoLimit : text.summaryPlaces(form.capacity),
    form.visibility === 'off'
      ? text.summaryNothingShown
      : form.visibility === 'count'
        ? text.summaryCountShown
        : text.summaryNamesShown,
  ].join(' · ')

  const footer = (
    <>
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
    </>
  )

  return (
    <SidePanel {...panel} footer={footer}>
      <div className={styles['state']}>{stateBadge}</div>

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

      {settings.enabled ? null : <p className={styles['note']}>{text.offNote}</p>}
      {
        <>
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
        </>
      }
      {settings.erasedAt === null ? null : (
        <p className={styles['note']}>
          {text.erasedOn(dateOf(settings.erasedAt, locale, timeZone))}
        </p>
      )}

      {
        <fieldset className={styles['asks']} disabled={locked}>
          <legend className={styles['legend']}>{text.presetLabel}</legend>
          <div className={styles['presets']}>
            {presets.map(({ key, label, note }) => {
              const on = key === 'custom' ? kind === null : kind === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  // "Sur mesure" is what the choices are once they match no kind: it is not a thing to apply.
                  disabled={locked || key === 'custom'}
                  className={cx(styles['preset'], on && styles['presetOn'])}
                  onClick={() => {
                    if (key !== 'custom') choosePreset(key)
                  }}
                >
                  <span>{label}</span>
                  <small>{note}</small>
                </button>
              )
            })}
          </div>
          <p className={styles['note']}>{text.presetHint}</p>

          <h3 className={styles['subtitle']}>{text.essentialsTitle}</h3>
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
              <PartySizeField
                label={`${text.sizeMax} ${text.sizeUnit}`}
                rangeHint={text.sizeRange(PARTY_SIZE_MIN, PARTY_SIZE_MAX)}
                value={form.partySize.max}
                disabled={locked}
                onChange={(max, now) => rsvp.change({ form: { partySize: { max } } }, now)}
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

          <h3 className={styles['subtitle']}>{text.moreOptionsTitle}</h3>
          <Disclosure id="rsvp-meals" title={text.groupMeals} summary={mealsSummary}>
            <RsvpExtras
              part="meals"
              form={form}
              locked={locked}
              change={rsvp.change}
              saveState={rsvp.saveState}
              problem={rsvp.problem}
              momentReplies={rsvp.momentReplies}
            />
          </Disclosure>
          <Disclosure
            id="rsvp-questions"
            title={text.questionsTitle}
            summary={`${form.questions.length}/${QUESTIONS_MAX}`}
          >
            <RsvpExtras
              part="questions"
              form={form}
              locked={locked}
              change={rsvp.change}
              saveState={rsvp.saveState}
              problem={rsvp.problem}
              momentReplies={rsvp.momentReplies}
            />
          </Disclosure>
          <Disclosure
            id="rsvp-moments"
            title={text.momentsTitle}
            summary={
              form.moments.length === 0
                ? text.summaryOneMoment
                : `${form.moments.length}/${MOMENTS_MAX}`
            }
          >
            <RsvpExtras
              part="moments"
              form={form}
              locked={locked}
              change={rsvp.change}
              saveState={rsvp.saveState}
              problem={rsvp.problem}
              momentReplies={rsvp.momentReplies}
            />
          </Disclosure>
          <Disclosure id="rsvp-places" title={text.groupPlaces} summary={placesSummary}>
            <RsvpExtras
              part="capacity"
              form={form}
              locked={locked}
              change={rsvp.change}
              saveState={rsvp.saveState}
              problem={rsvp.problem}
              momentReplies={rsvp.momentReplies}
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
          </Disclosure>
          <Disclosure
            id="rsvp-absent"
            title={text.groupAbsent}
            summary={form.absentNote ? text.summaryYes : text.summaryNo}
          >
            <CheckboxField
              label={text.absentNote}
              hint={text.absentNoteHint}
              checked={form.absentNote}
              disabled={locked}
              onChange={(absentNote) => rsvp.change({ form: { absentNote } })}
            />
          </Disclosure>
          <Disclosure id="rsvp-data" title={text.groupData} summary={text.summaryMore}>
            <div className={styles['explain']}>
              <h4>{text.fewTitle}</h4>
              <p>{text.few}</p>
              <h4>{text.noContactTitle}</h4>
              <p>{text.noContact}</p>
              <h4>{text.erasedTitle}</h4>
              <p>{text.erased}</p>
            </div>
          </Disclosure>
        </fieldset>
      }

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
    </SidePanel>
  )
}
