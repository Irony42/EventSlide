import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { SelectField } from '../../../design-system/components/SelectField'
import { Spinner } from '../../../design-system/components/Spinner'
import { TextInput } from '../../../design-system/components/TextInput'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { PARTY_SIZES, PRESETS, kindOf, type PartyKind } from '../../../lib/rsvp/rsvpSettings'
import type { RsvpSettingsState } from './useRsvpSettings'
import styles from './RsvpPanel.module.css'

export interface RsvpPanelProps {
  readonly rsvp: RsvpSettingsState
  /** An archived event is a record: the settings are read-only. */
  readonly archived: boolean
}

/** An ISO instant as a date a host reads, in the language they read. */
const dateOf = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso),
  )

/**
 * "Réponses des invités": what the host asks the guests on the invitation's page (spec 30, lot 1),
 * saved as it is chosen. Surface: the host (the owner). The window's state, the date it closes and
 * the date the replies are erased are **the server's**, shown as it says them; the form's fields
 * are the host's choices, and the preview beside it follows each at once.
 *
 * Replies hang on the invitation: until it exists the panel says so and asks nothing.
 */
export function RsvpPanel({ rsvp, archived }: RsvpPanelProps) {
  const t = useTranslations()
  const text = t.rsvp.host
  const { locale } = useLocale()
  const { settings } = rsvp

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
  const stateBadge =
    settings.state === 'closed' ? (
      <Badge tone="warning">{text.stateClosed}</Badge>
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
              value={settings.deadline ?? ''}
              disabled={locked}
              onChange={(event) =>
                rsvp.change({ deadline: event.target.value === '' ? null : event.target.value })
              }
            />
          )}
        </Field>
        {settings.deadline === null ? null : (
          <Button
            variant="ghost"
            size="sm"
            disabled={locked}
            onClick={() => rsvp.change({ deadline: null })}
          >
            {text.deadlineClear}
          </Button>
        )}
      </div>

      {settings.invited && settings.enabled ? (
        <div className={styles['window']}>
          {settings.state === 'closed' ? (
            <p>{text.closedNote}</p>
          ) : settings.closesAt === null ? null : (
            <p>{text.closesOn(dateOf(settings.closesAt, locale))}</p>
          )}
          {settings.closedAt === null ? (
            <Button
              size="sm"
              disabled={archived || rsvp.acting || settings.state === 'closed'}
              onClick={rsvp.close}
            >
              {text.closeAction}
            </Button>
          ) : (
            <Button size="sm" disabled={archived || rsvp.acting} onClick={rsvp.reopen}>
              {text.reopenAction}
            </Button>
          )}
        </div>
      ) : null}
      {settings.erasedAt === null ? null : (
        <p className={styles['note']}>{text.erasedOn(dateOf(settings.erasedAt, locale))}</p>
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
            if (value === 'party' || value === 'wedding') {
              rsvp.change({ form: PRESETS[value as PartyKind] })
            }
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
      </fieldset>

      <div
        className={styles['saveLine']}
        role="status"
        aria-live="polite"
        data-state={rsvp.saveState}
      >
        {rsvp.saveState === 'pending' || rsvp.saveState === 'saving'
          ? text.saving
          : rsvp.saveState === 'saved'
            ? text.saved
            : null}
      </div>
      {rsvp.problem === null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {rsvp.problem}
        </Notice>
      )}

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
