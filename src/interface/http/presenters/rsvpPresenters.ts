import type { GuestRsvp } from '../../../domain/guestRsvps/rsvp'
import type { RsvpSettings } from '../../../domain/guestRsvps/rsvpSettings'
import type { RsvpStats } from '../../../domain/guestRsvps/rsvpStats'
import type { RsvpForm } from '../../../domain/guestRsvps/rsvpForm'
import type { RsvpFormView } from '../../../application/usecases/guestRsvps/getRsvpForm'
import type { RsvpList } from '../../../application/usecases/guestRsvps/listRsvps'
import type {
  RsvpDto,
  RsvpFormDto,
  RsvpFormResponseDto,
  RsvpListResponseDto,
  RsvpResponseDto,
  RsvpSettingsDto,
  RsvpStatsDto,
} from './dto'

/**
 * The host's side of the guests' replies, as the wire carries it (spec 30). Nothing here decides:
 * the state, the closing instant and the erasure date are the use case's, and the figures are the
 * domain's one `statsOf`.
 */

const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())

const toFormDto = (form: RsvpForm): RsvpFormDto => ({
  maybe: form.maybe,
  partySize: { enabled: form.partySize.enabled, max: form.partySize.max },
  kidsSeparate: form.kidsSeparate,
  diet: form.diet,
  companionNames: form.companionNames,
  meals: { enabled: form.meals.enabled, options: [...form.meals.options] },
  questions: form.questions.map((question) => ({
    id: question.id,
    label: question.label,
    kind: question.kind,
    ...(question.options === undefined ? {} : { options: [...question.options] }),
  })),
  visibility: form.visibility,
  capacity: form.capacity,
  moments: form.moments.map((moment) => ({ id: moment.id, label: moment.label })),
  absentNote: form.absentNote,
})

interface SettingsView {
  readonly invite: unknown
  readonly settings: RsvpSettings
  readonly state: RsvpSettingsDto['state']
  readonly closesAt: Date | null
  readonly erasedAt: Date | null
}

const toSettingsDto = (view: SettingsView): RsvpSettingsDto => ({
  invited: view.invite !== null,
  enabled: view.settings.enabled,
  deadline: view.settings.deadline,
  closedAt: isoOrNull(view.settings.closedAt),
  form: toFormDto(view.settings.form),
  state: view.state,
  closesAt: isoOrNull(view.closesAt),
  erasedAt: isoOrNull(view.erasedAt),
})

export const toRsvpDto = (rsvp: GuestRsvp): RsvpDto => ({
  id: rsvp.id,
  name: rsvp.name,
  answer: rsvp.answer,
  adults: rsvp.adults,
  kids: rsvp.kids,
  diet: rsvp.diet,
  message: rsvp.message,
  source: rsvp.source,
  details: {
    companions: [...rsvp.details.companions],
    meals: [...rsvp.details.meals],
    answers: rsvp.details.answers.map(({ questionId, label, value }) => ({
      questionId,
      label,
      value,
    })),
    moments: [...rsvp.details.moments],
    showName: rsvp.details.showName,
  },
  createdAt: rsvp.createdAt.toISOString(),
  updatedAt: rsvp.updatedAt.toISOString(),
})

export const toRsvpResponseDto = (rsvp: GuestRsvp): RsvpResponseDto => ({ rsvp: toRsvpDto(rsvp) })

export const toRsvpFormResponseDto = (view: RsvpFormView): RsvpFormResponseDto => ({
  rsvpForm: toSettingsDto(view),
})

const toStatsDto = (stats: RsvpStats): RsvpStatsDto => ({
  yes: { ...stats.yes },
  maybe: { ...stats.maybe },
  no: { ...stats.no },
  waitlist: { ...stats.waitlist },
  diets: stats.diets.map(({ name, diet }) => ({ name, diet })),
  meals: stats.meals.map(({ label, count }) => ({ label, count })),
})

export const toRsvpListResponseDto = (view: RsvpList): RsvpListResponseDto => ({
  rsvpForm: toSettingsDto(view),
  rsvps: view.rsvps.map(toRsvpDto),
  stats: toStatsDto(view.stats),
  unseen: view.unseen,
})
