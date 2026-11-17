import type { AnnouncementInput, AnnouncementPatchInput } from '../lib/api/client'
import type { AnnouncementDto, AnnouncementKind } from '../lib/api/dto'
import { toLocalInput } from '../features/admin/eventSchedule'

/**
 * What the announcement form offers for each kind, and what it sends (spec 21, rule 18).
 *
 * The **bounds** are the domain's (`ANNOUNCEMENT_DURATION_SECONDS`): 10 to 120 s for a card, 5 to
 * 30 min for a discreet text, refused rather than clamped. These are the **steps the form puts in
 * front of the host**, a subset of them, and the default each kind starts from. A discreet text
 * has no countdown at all (rule 4), so its offer has none to choose from.
 */
export interface KindOffer {
  readonly durations: readonly number[]
  readonly defaultDuration: number
  /** `null`: this kind has no countdown, and the field is not shown. */
  readonly countdowns: readonly number[] | null
  readonly defaultCountdown: number
}

export const KIND_OFFERS: Readonly<Record<AnnouncementKind, KindOffer>> = {
  fullscreen: {
    durations: [15, 30, 60],
    defaultDuration: 30,
    countdowns: [0, 60, 300, 600, 900],
    defaultCountdown: 300,
  },
  discreet: {
    durations: [300, 600, 900, 1800],
    defaultDuration: 900,
    countdowns: null,
    defaultCountdown: 0,
  },
}

/** The one line of text the server accepts (the domain's `AnnouncementText`), counted in characters. */
export const ANNOUNCEMENT_TEXT_MAX = 80

/** What the host has typed and chosen so far: view-state, sent only through the builders below. */
export interface AnnouncementDraft {
  readonly text: string
  /** `HH:mm` from the time field, or `''` for none. */
  readonly time: string
  readonly kind: AnnouncementKind
  readonly countdownSeconds: number
  readonly durationSeconds: number
}

export const blankDraft = (kind: AnnouncementKind = 'fullscreen'): AnnouncementDraft => ({
  text: '',
  time: '',
  kind,
  countdownSeconds: KIND_OFFERS[kind].defaultCountdown,
  durationSeconds: KIND_OFFERS[kind].defaultDuration,
})

/** A change of kind starts the new kind from its own defaults: a 15-minute card is not on offer. */
export const withKind = (draft: AnnouncementDraft, kind: AnnouncementKind): AnnouncementDraft =>
  kind === draft.kind
    ? draft
    : {
        ...draft,
        kind,
        countdownSeconds: KIND_OFFERS[kind].defaultCountdown,
        durationSeconds: KIND_OFFERS[kind].defaultDuration,
      }

/** The row as a draft, to correct it: the time field reads the instant in the browser's zone. */
export const draftOf = (announcement: AnnouncementDto): AnnouncementDraft => ({
  text: announcement.text,
  time: toLocalInput(announcement.at).slice(11),
  kind: announcement.kind,
  countdownSeconds: announcement.countdownSeconds,
  durationSeconds: announcement.durationSeconds,
})

/** A text the form may send: something is written. The limit is the field's own, and the server's. */
export const hasText = (draft: AnnouncementDraft): boolean => draft.text.trim() !== ''

/** "Programmer": the text, the kind, the moment, the durations; no countdown for a discreet text. */
export const scheduleInput = (draft: AnnouncementDraft, atMs: number): AnnouncementInput => ({
  text: draft.text.trim(),
  kind: draft.kind,
  at: new Date(atMs).toISOString(),
  durationSeconds: draft.durationSeconds,
  ...(KIND_OFFERS[draft.kind].countdowns === null
    ? {}
    : { countdownSeconds: draft.countdownSeconds }),
})

/** "Lancer maintenant": no moment and no countdown, which is what makes it a launch. */
export const launchInput = (draft: AnnouncementDraft): AnnouncementInput => ({
  text: draft.text.trim(),
  kind: draft.kind,
  durationSeconds: draft.durationSeconds,
})

/**
 * Saving a correction. A discreet text on screen changes its **text and nothing else** (rule 11),
 * so that is all that is sent: the server would refuse the rest, and the form does not offer it.
 * Otherwise every field is sent, and the moment only when the host touched the time field: an
 * untouched one keeps the instant the server holds, to the second, and a day that has since
 * passed does not turn into tomorrow.
 */
export const editInput = (
  draft: AnnouncementDraft,
  textOnly: boolean,
  atMs: number | null,
): AnnouncementPatchInput =>
  textOnly
    ? { text: draft.text.trim() }
    : {
        text: draft.text.trim(),
        kind: draft.kind,
        ...(atMs === null ? {} : { at: new Date(atMs).toISOString() }),
        durationSeconds: draft.durationSeconds,
        countdownSeconds: KIND_OFFERS[draft.kind].countdowns === null ? 0 : draft.countdownSeconds,
      }
