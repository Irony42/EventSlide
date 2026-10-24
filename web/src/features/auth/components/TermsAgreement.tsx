import { useId, type Ref } from 'react'
import { NewTabLink } from '../../../app/NewTabLink'
import { Notice } from '../../../design-system/components/Notice'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './TermsAgreement.module.css'

export interface TermsAgreementProps {
  /** The version the box is on, said in the sentence: what the person agrees to is dated. */
  readonly version: string
  /**
   * Where the terms are read, already vetted as an https address or a path on this site, or
   * `null` when the address was not one: the box is still asked for, and nothing unsafe is linked.
   */
  readonly href: string | null
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  /** Present means the box was left empty when the form was sent; the sentence to say so. */
  readonly error?: string
  /** For the form to put the keyboard on the box when it is sent with the box empty. */
  readonly boxRef?: Ref<HTMLInputElement>
}

/**
 * "I accept the terms of use (version X)" with the link to read them (roadmap G2-20).
 *
 * Surface: **the invitee**, on `/invite/:token`, on a box whose operator asks for the terms.
 * It is **required and starts unticked**: an acceptance given by default is not one, and a
 * box ticked for the person would be worth nothing in the log it ends up in.
 *
 * A real `<input type="checkbox">` inside its own `<label>`, so the whole sentence is the click
 * target and the space bar works with no handler. The link to read the terms is **outside the
 * label**, in its own line and in a new tab (`NewTabLink`): inside it, pressing the link and
 * pressing the box would be one gesture, and leaving this page would lose the password just
 * typed. It describes the box, so a screen reader hears where the terms are as it lands on it.
 * `required` is set although the form is `noValidate`: it is what announces "required", and the
 * form's own check says the rest, in the reader's language.
 */
export function TermsAgreement({
  version,
  href,
  checked,
  onChange,
  error,
  boxRef,
}: TermsAgreementProps) {
  const t = useTranslations()
  const generated = useId()
  const linkId = `${generated}-link`
  const errorId = `${generated}-error`
  const describedBy = [href === null ? '' : linkId, error === undefined ? '' : errorId]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={styles['field']}>
      <label className={styles['row']}>
        <input
          ref={boxRef}
          type="checkbox"
          name="acceptTerms"
          className={styles['box']}
          required
          checked={checked}
          {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
          {...(error === undefined ? {} : { 'aria-invalid': true })}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className={styles['label']}>{t.auth.invitationAcceptTerms(version)}</span>
      </label>
      {href === null ? null : (
        <p className={styles['link']} id={linkId}>
          <NewTabLink href={href}>{t.auth.invitationReadTerms}</NewTabLink>
        </p>
      )}
      {error === undefined ? null : (
        <Notice
          tone="danger"
          role="alert"
          variant="inline"
          id={errorId}
          className={styles['error']}
        >
          {error}
        </Notice>
      )}
    </div>
  )
}
