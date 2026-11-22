import { useId } from 'react'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { ChoiceChips } from '../../../design-system/components/ChoiceChips'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import {
  BOOK_LENGTH_TARGET,
  BOOK_LENGTHS,
  BOOK_STYLES,
  type BookLength,
} from '../../../lib/bookStyle'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import classique from '../bookStyles/classique.svg'
import magazine from '../bookStyles/magazine.svg'
import souvenir from '../bookStyles/souvenir.svg'
import type { BookChoices, BookLimits, LookAt } from './bookOptions'
import styles from './BookSettings.module.css'

/** The pictograms of the three styles: the preview beside them is the real thing. */
const THUMBNAILS = { classique, magazine, souvenir } as const

export interface BookSettingsProps {
  readonly choices: BookChoices
  readonly limits: BookLimits
  readonly fromWall: boolean
  /** A change, and what the preview should show for it. */
  readonly onChange: (patch: Partial<BookChoices>, look?: LookAt) => void
}

/**
 * The book's settings, in the order the page reads: the style, the cover, the photographs, the
 * content. Controlled and rule-free: what is possible comes from `limits` (the box's ceilings and the
 * album as it is now), and every change goes up so that the preview can show it at once.
 */
export function BookSettings({ choices, limits, fromWall, onChange }: BookSettingsProps) {
  const t = useTranslations()
  const group = useId()
  const allFits = limits.photos <= limits.maxPhotos
  const effectiveAll = choices.all && allFits

  return (
    <div className={styles['settings']}>
      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{t.admin.bookStyleLegend}</legend>
        <div className={styles['styles']}>
          {BOOK_STYLES.map((option) => (
            <label key={option} className={styles['style']}>
              <input
                type="radio"
                className={styles['radio']}
                name={`${group}-style`}
                value={option}
                checked={choices.style === option}
                onChange={() => onChange({ style: option })}
              />
              <img className={styles['thumb']} src={THUMBNAILS[option]} alt="" />
              <span className={styles['styleName']}>{t.admin.bookStyleNames[option]}</span>
              <span className={styles['styleHint']}>{t.admin.bookStyleHints[option]}</span>
            </label>
          ))}
        </div>
        {fromWall ? <p className={styles['hint']}>{t.admin.bookStyleFromWall}</p> : null}
      </fieldset>

      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{t.bookPage.coverLegend}</legend>
        <Field label={t.admin.bookTitle}>
          {(control) => (
            <TextInput
              {...control}
              name="bookTitle"
              autoComplete="off"
              required
              value={choices.title}
              onChange={(event) => onChange({ title: event.target.value }, 'cover')}
            />
          )}
        </Field>
        <Field label={t.admin.bookSubtitle} optional hint={t.admin.bookSubtitleHint}>
          {(control) => (
            <TextInput
              {...control}
              name="bookSubtitle"
              autoComplete="off"
              value={choices.subtitle}
              onChange={(event) => onChange({ subtitle: event.target.value }, 'cover')}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{t.admin.bookPhotosLegend}</legend>
        <div className={styles['choices']}>
          <label className={styles['choice']}>
            <input
              type="radio"
              className={styles['choiceInput']}
              name={`${group}-selection`}
              checked={effectiveAll}
              disabled={!allFits}
              onChange={() => onChange({ all: true })}
            />
            <span className={styles['choiceText']}>
              <span>{t.admin.bookSelectionAll(limits.photos)}</span>
              {allFits ? null : (
                <span className={styles['hint']}>
                  {t.admin.bookSelectionAllTooMany(limits.maxPhotos)}
                </span>
              )}
            </span>
          </label>
          <label className={styles['choice']}>
            <input
              type="radio"
              className={styles['choiceInput']}
              name={`${group}-selection`}
              checked={!effectiveAll}
              onChange={() => onChange({ all: false })}
            />
            <span className={styles['choiceText']}>
              <span>{t.admin.bookSelectionBest}</span>
              <span className={styles['hint']}>{t.admin.bookSelectionBestHint}</span>
            </span>
          </label>
        </div>
        {effectiveAll ? null : (
          <ChoiceChips
            legend={t.admin.bookLengthLegend}
            value={choices.length}
            options={BOOK_LENGTHS.map((option) => ({
              value: option,
              label: t.admin.bookLengthChip(
                t.admin.bookLengthNames[option],
                BOOK_LENGTH_TARGET[option],
              ),
            }))}
            onChange={(value) =>
              onChange({
                length: BOOK_LENGTHS.find((l): l is BookLength => l === value) ?? 'medium',
              })
            }
          />
        )}
      </fieldset>

      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{t.admin.bookOptionsLegend}</legend>
        <CheckboxField
          label={t.admin.bookShowAuthors}
          hint={t.admin.bookShowAuthorsHint}
          checked={choices.showAuthors}
          onChange={(showAuthors) => onChange({ showAuthors }, showAuthors ? 'authors' : undefined)}
        />
        <CheckboxField
          label={t.admin.bookShowCaptions}
          checked={choices.showCaptions}
          onChange={(showCaptions) =>
            onChange({ showCaptions }, showCaptions ? 'captions' : undefined)
          }
        />
        {limits.messages > 0 ? (
          <CheckboxField
            label={t.admin.bookGuestbook}
            hint={t.admin.bookGuestbookHint(limits.messages, limits.maxMessages)}
            checked={choices.guestbook}
            onChange={(guestbook) => onChange({ guestbook }, guestbook ? 'messages' : undefined)}
          />
        ) : null}
        {limits.printOffered ? (
          <CheckboxField
            label={t.admin.bookPrintVersion}
            hint={t.admin.bookPrintVersionHint}
            checked={choices.print}
            onChange={(print) => onChange({ print })}
          />
        ) : null}
      </fieldset>
    </div>
  )
}
