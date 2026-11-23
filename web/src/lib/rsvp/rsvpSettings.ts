import type { RsvpFormInput } from '../api/client/invite'
import type { GuestRsvpPageDto, RsvpSettingsDto } from '../api/dto'

/**
 * The host's replies settings as data (spec 30, no React): how a change lays over what the server
 * holds, what the guest's page would say of it (for the preview), and the presets of a kind of
 * party. **The server judges every value**; this only keeps the screen true to what was chosen
 * while a save is on its way.
 */

/** `settings` with a save's input laid over it: an absent field stays, `null` clears the deadline. */
export const applyInput = (settings: RsvpSettingsDto, input: RsvpFormInput): RsvpSettingsDto => {
  const form = input.form
  return {
    ...settings,
    enabled: input.enabled ?? settings.enabled,
    deadline: input.deadline === undefined ? settings.deadline : input.deadline,
    form:
      form === undefined
        ? settings.form
        : {
            ...settings.form,
            maybe: form.maybe ?? settings.form.maybe,
            kidsSeparate: form.kidsSeparate ?? settings.form.kidsSeparate,
            diet: form.diet ?? settings.form.diet,
            companionNames: form.companionNames ?? settings.form.companionNames,
            visibility: form.visibility ?? settings.form.visibility,
            // A moment the host just added has no id until the server answers.
            moments:
              form.moments?.map((moment) => ({ id: moment.id ?? '', label: moment.label })) ??
              settings.form.moments,
            meals: {
              enabled: form.meals?.enabled ?? settings.form.meals.enabled,
              options: form.meals?.options ?? settings.form.meals.options,
            },
            // A question the host just added has no id until the server answers.
            questions:
              form.questions?.map((question) => ({
                id: question.id ?? '',
                label: question.label,
                kind: question.kind,
                ...(question.options === undefined ? {} : { options: question.options }),
              })) ?? settings.form.questions,
            partySize: {
              enabled: form.partySize?.enabled ?? settings.form.partySize.enabled,
              max: form.partySize?.max ?? settings.form.partySize.max,
            },
          },
  }
}

/** Two inputs as one: the later wins field by field, so a burst of choices is one request. */
export const mergeInputs = (earlier: RsvpFormInput, later: RsvpFormInput): RsvpFormInput => {
  const form =
    earlier.form === undefined && later.form === undefined
      ? undefined
      : {
          ...earlier.form,
          ...later.form,
          ...(earlier.form?.partySize === undefined && later.form?.partySize === undefined
            ? {}
            : { partySize: { ...earlier.form?.partySize, ...later.form?.partySize } }),
          ...(earlier.form?.meals === undefined && later.form?.meals === undefined
            ? {}
            : { meals: { ...earlier.form?.meals, ...later.form?.meals } }),
        }
  return {
    ...earlier,
    ...later,
    ...(form === undefined ? {} : { form }),
  }
}

/**
 * What the guest's page would say of these settings, for the host's preview: the block is there
 * while replies are asked (`open`), and absent while they are not (`off`). The preview shows the
 * form, not the clock: the state of the window is the server's and has its own badge.
 */
export const previewPage = (settings: RsvpSettingsDto): GuestRsvpPageDto => ({
  state: settings.enabled ? 'open' : 'off',
  deadline: settings.deadline,
  form: {
    maybe: settings.form.maybe,
    partySize: { enabled: settings.form.partySize.enabled, max: settings.form.partySize.max },
    kidsSeparate: settings.form.kidsSeparate,
    diet: settings.form.diet,
    companionNames: settings.form.companionNames,
    meals: { enabled: settings.form.meals.enabled, options: settings.form.meals.options },
    questions: settings.form.questions,
    visibility: settings.form.visibility,
    moments: settings.form.moments,
  },
})

/**
 * The day a date field holds once it is a choice: `YYYY-MM-DD`, a real day, not older than last
 * year. A field passes through "" and "0020-…" while it is typed; those are not choices.
 */
export const usableDeadline = (value: string, now: Date): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null
  return date.getUTCFullYear() >= now.getFullYear() - 1 ? value : null
}

export type PartyKind = 'party' | 'wedding'

/**
 * What each kind of party starts from (the domain's `defaultRsvpForm`, which the server cannot
 * apply for the host because an event keeps no template key): a wedding does not offer "peut-être"
 * (a couple needs a count) and allows a larger party; any other does the opposite.
 */
export const PRESETS: Readonly<Record<PartyKind, NonNullable<RsvpFormInput['form']>>> = {
  party: { maybe: true, partySize: { enabled: true, max: 4 }, companionNames: false },
  wedding: { maybe: false, partySize: { enabled: true, max: 6 }, companionNames: true },
}

/** The kind of party these settings look like, or `null` when the host went their own way. */
export const kindOf = (settings: RsvpSettingsDto): PartyKind | null => {
  const { maybe, partySize } = settings.form
  const match = (kind: PartyKind): boolean => {
    const preset = PRESETS[kind]
    return maybe === preset.maybe && partySize.enabled && partySize.max === preset.partySize?.max
  }
  return match('party') ? 'party' : match('wedding') ? 'wedding' : null
}

/** The sizes a reply may bring that the panel offers: 1 to 10 is the server's bound. */
export const PARTY_SIZES: readonly number[] = [2, 3, 4, 5, 6, 8, 10]
