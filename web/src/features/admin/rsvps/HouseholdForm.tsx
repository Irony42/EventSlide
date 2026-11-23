import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Dialog } from '../../../design-system/components/Dialog'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { TextInput } from '../../../design-system/components/TextInput'
import type { HouseholdDto } from '../../../lib/api/dto'
import type { HouseholdInput } from '../../../lib/api/client/invite'
import { invitedAmong } from '../../../lib/rsvp/households'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './HouseholdsPage.module.css'

export interface HouseholdFormProps {
  /** The household being changed, or `null` for one the host adds. */
  readonly household: HouseholdDto | null
  /** The moments of the host's form (lot 4): empty while the host has none, and nothing is asked. */
  readonly moments: readonly { readonly id: string; readonly label: string }[]
  /** Sends it; a refusal is thrown and shown as its sentence. */
  readonly onSubmit: (input: HouseholdInput) => Promise<void>
  readonly onClose: () => void
}

/**
 * "Ajouter un foyer" and "Modifier" (spec 30, lot 3): a name and the places kept for it, nothing else.
 * The server judges both (a name of 1 to 80 characters, 1 to 10 places). Mounted only while open, so
 * each opening starts from the household it is about.
 */
export function HouseholdForm({ household, moments, onSubmit, onClose }: HouseholdFormProps) {
  const t = useTranslations()
  const text = t.rsvp.households
  const momentsHintId = useId()
  const problemId = useId()
  const [name, setName] = useState(household?.name ?? '')
  const [places, setPlaces] = useState(String(household?.places ?? 2))
  /** The moments ticked: every one of the form's by default, and for a household invited to all. */
  const [invited, setInvited] = useState<readonly string[]>(() =>
    invitedAmong(household?.moments ?? null, moments).map((moment) => moment.id),
  )
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await onSubmit({
        name,
        places: Number(places),
        // Every moment ticked is "all" (`null`): a moment the host adds later reaches this household too.
        ...(moments.length > 0
          ? { moments: invited.length === moments.length ? null : invited }
          : {}),
      })
      onClose()
    } catch (cause) {
      setProblem(messageForError(cause, t))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title={household === null ? text.formAddTitle : text.formEditTitle}
      description={text.formHint}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.app.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="household-form"
            disabled={name.trim() === '' || (moments.length > 0 && invited.length === 0)}
            loading={busy}
          >
            {busy ? text.formSaving : text.formSave}
          </Button>
        </>
      }
    >
      <form id="household-form" className={styles['form']} onSubmit={(e) => void submit(e)}>
        <Field label={text.formName}>
          {(control) => (
            <TextInput
              {...control}
              value={name}
              maxLength={80}
              autoComplete="off"
              placeholder={text.formNamePlaceholder}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label={text.formPlaces} hint={text.formPlacesHint}>
          {(control) => (
            <TextInput
              {...control}
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              value={places}
              onChange={(event) => setPlaces(event.target.value)}
            />
          )}
        </Field>
        {moments.length > 0 ? (
          <fieldset
            className={styles['momentsField']}
            aria-describedby={[momentsHintId, ...(problem === null ? [] : [problemId])].join(' ')}
          >
            <legend>{text.formMoments}</legend>
            <small id={momentsHintId}>{text.formMomentsHint}</small>
            {moments.map((moment) => (
              <label key={moment.id}>
                <input
                  type="checkbox"
                  checked={invited.includes(moment.id)}
                  onChange={() =>
                    setInvited((current) =>
                      current.includes(moment.id)
                        ? current.filter((id) => id !== moment.id)
                        : [...current, moment.id],
                    )
                  }
                />{' '}
                {moment.label}
              </label>
            ))}
          </fieldset>
        ) : null}
        {problem === null ? null : (
          <Notice tone="danger" variant="boxed" role="alert" id={problemId}>
            {problem}
          </Notice>
        )}
      </form>
    </Dialog>
  )
}
