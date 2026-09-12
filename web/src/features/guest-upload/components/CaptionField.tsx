import type { ChangeEvent } from 'react'
import { Field } from '../../../design-system/components/Field'
import { Textarea } from '../../../design-system/components/Textarea'
import { fr } from '../../../lib/i18n/fr'

/**
 * One caption for the batch, not one per photo.
 *
 * A guest sending four photos of the same moment writes one thing about it, and asking
 * four times is how a phone form gets abandoned. `POST /api/events/:slug/photos`
 * applies the caption to every file in the request, so this matches the wire format.
 *
 * Rendered only when the event allows captions — the host's setting, read from the
 * event the join step returned, never assumed here.
 */

/**
 * Mirrors the cap in `src/domain/photos/caption.ts`: 140 characters is roughly what
 * stays legible on two lines at 3-10 metres. It is duplicated rather than fetched
 * because no endpoint publishes it; the server stays the authority and answers
 * `caption.tooLong`, so the worst a stale copy can do is count down to the wrong
 * number, never accept something the wall cannot show.
 */
const MAX_LENGTH = 140

export interface CaptionFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
}

export function CaptionField({ value, onChange }: CaptionFieldProps) {
  // The hint starts as the rule and becomes the countdown, so the remaining count is
  // read out with the field instead of living in a live region that would interrupt
  // on every keystroke.
  const hint =
    value.length === 0
      ? fr.upload.captionHint(MAX_LENGTH)
      : fr.upload.captionRemaining(MAX_LENGTH - value.length)

  return (
    <Field label={fr.upload.captionLabel} hint={hint} optional>
      {(control) => (
        <Textarea
          {...control}
          value={value}
          maxLength={MAX_LENGTH}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}
