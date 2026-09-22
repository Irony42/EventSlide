import { useId } from 'react'
import { StatusIcon } from '../../../design-system/components/StatusIcon'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  EVENT_TEMPLATE_KEYS,
  EVENT_TEMPLATE_PATCHES,
  templateSummary,
  templateWarning,
} from '../eventTemplates'
import styles from './EventTemplatePicker.module.css'
import type { EventTemplateKey } from '../../../lib/api/dto'

/**
 * Which kind of evening this is (roadmap 3.5), on the create form.
 *
 * Surface: the host's laptop, usually the day before the event, on the one screen that
 * until now asked for a name and nothing else.
 *
 * ## Why every option shows what it does
 *
 * A preset that a host cannot see the contents of is a box they tick and then discover
 * the consequences of at 21:00. So each option lists the settings it changes, rendered
 * from the same table the server applies — it cannot promise a change that will not
 * happen, and it cannot stay quiet about one that will. The list is short because a
 * template is defined by its differences from the defaults, which is three or four lines.
 *
 * ## Why "Sans modèle" is an option and the default
 *
 * A host who does not want an opinion must be able to have none without hunting for the
 * absence of one, and the product's defaults are a deliberate configuration rather than a
 * fallback. It is also what every event created before this existed got, which is what
 * makes adding this screen safe. It states its own consequences for the same reason the
 * other four do — unlimited retention is a decision, not the absence of one.
 *
 * The hint says the thing that decides whether this feature is helpful or a trap: what a
 * template sets is ordinary settings, editable immediately and for good. Nothing here is
 * remembered — the event stores the values, not the choice — so no value can come back
 * at the host later.
 *
 * ## Why the description sits outside the label
 *
 * A `<ul>` inside a `<label>` is invalid, and jsdom will never say so — but the real cost
 * is not the validity. Everything inside a label becomes part of the control's accessible
 * name, so each radio announced as a twenty-word paragraph instead of "Mariage", and the
 * list stopped being a list to anybody listening. The label holds the name, the
 * description is bound with `aria-describedby`, and a screen reader reads the option and
 * then what it does — including the warning, at the moment the option is reached.
 */

/** `null` is "Sans modèle", which is the absence of a choice rather than a fifth one. */
export interface EventTemplatePickerProps {
  readonly value: EventTemplateKey | null
  readonly disabled: boolean
  readonly onChange: (value: EventTemplateKey | null) => void
}

const NONE = 'none'

export function EventTemplatePicker({ value, disabled, onChange }: EventTemplatePickerProps) {
  const t = useTranslations()
  // One prefix per mounted picker, so two on a page cannot collide on an id.
  const prefix = useId()
  const describedBy = (key: string): string => `${prefix}-${key}`

  return (
    <fieldset className={styles['group']}>
      <legend className={styles['legend']}>{t.admin.template}</legend>
      <p className={styles['hint']}>{t.admin.templateHint}</p>

      <div className={styles['choice']}>
        <label className={styles['control']}>
          <input
            type="radio"
            className={styles['radio']}
            name="template"
            value={NONE}
            checked={value === null}
            disabled={disabled}
            aria-describedby={describedBy(NONE)}
            onChange={() => onChange(null)}
          />
          <span className={styles['name']}>{t.admin.templateNone}</span>
        </label>
        <p className={styles['summary']} id={describedBy(NONE)}>
          {t.admin.templateNoneSummary}
        </p>
      </div>

      {EVENT_TEMPLATE_KEYS.map((key) => {
        const warning = templateWarning(EVENT_TEMPLATE_PATCHES[key], t)

        return (
          <div key={key} className={styles['choice']}>
            <label className={styles['control']}>
              <input
                type="radio"
                className={styles['radio']}
                name="template"
                value={key}
                checked={value === key}
                disabled={disabled}
                aria-describedby={describedBy(key)}
                onChange={() => onChange(key)}
              />
              <span className={styles['name']}>{t.admin.templateNames[key]}</span>
            </label>

            <div className={styles['body']} id={describedBy(key)}>
              {/*
                A list rather than a sentence: these are independent facts about separate
                settings, and a screen reader announcing "liste de trois éléments" is the
                honest shape — which it only is now that the list is not folded into the
                radio's name. The heading before it is what stops the lines reading as
                promises about the whole product rather than as what this option changes.
              */}
              <p className={styles['summary']}>{t.admin.templateChanges}</p>
              <ul className={styles['changes']}>
                {templateSummary(EVENT_TEMPLATE_PATCHES[key], t).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              {warning === null ? null : (
                /*
                  Same component and same string as the settings page shows when a host
                  selects `auto` there. It is inside the described-by region on purpose:
                  a host reaching this option hears what it does before they choose it,
                  which is stronger than the settings page's `aria-live`, where the
                  warning arrives after the choice.
                */
                <p className={styles['warning']}>
                  <span className={styles['warningGlyph']}>
                    <StatusIcon tone="warning" />
                  </span>
                  {warning}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </fieldset>
  )
}
