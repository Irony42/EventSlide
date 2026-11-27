import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { Field } from '../../../design-system/components/Field'
import { Textarea } from '../../../design-system/components/Textarea'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { HOST_REASON_MAX, type HostNoticeValue } from './hostNotice'

export interface HostNoticeFieldsProps {
  readonly value: HostNoticeValue
  readonly onChange: (value: HostNoticeValue) => void
}

/**
 * "Prévenir l'hôte" and "Motif pour l'hôte": the two fields every operator act that can write to the host carries in its dialog.
 *
 * **Ticked by default**: the host is told unless the operator says otherwise (a serious report may call for silence: the runbook
 * says when). The reason is a field of its own, **distinct from the audit reason**, which the host never reads; it is hidden when
 * the host is not to be told, so what is typed is never sent for nobody.
 *
 * Surface: the operator's laptop.
 */
export function HostNoticeFields({ value, onChange }: HostNoticeFieldsProps) {
  const t = useTranslations().site.hostNotice

  return (
    <>
      <CheckboxField
        label={t.notify}
        hint={t.notifyHint}
        checked={value.notify}
        onChange={(notify) => onChange({ ...value, notify })}
      />
      {value.notify ? (
        <Field label={t.reason} hint={t.reasonHint}>
          {(control) => (
            <Textarea
              {...control}
              name="hostReason"
              autoComplete="off"
              maxLength={HOST_REASON_MAX}
              value={value.reason}
              onChange={(event) => onChange({ ...value, reason: event.target.value })}
            />
          )}
        </Field>
      ) : null}
    </>
  )
}
