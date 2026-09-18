import { accentNameFor, DEFAULT_EVENT_THEME } from '../../design-system/eventTheme'
import { fr } from '../../lib/i18n/fr'
import { graceLabel } from './settingsLabels'
import type { EventSettingsDto, EventTemplateKey } from '../../lib/api/dto'

/**
 * The four presets the create form offers (roadmap 3.5), as the host sees them.
 *
 * The **rule** is server-side, in `src/domain/events/eventTemplate.ts`: what each
 * template sets and why. This file knows how to show one, which is a different job and
 * the reason the values appear twice.
 *
 * They appear twice rather than travelling on the wire because four fixed constants do
 * not deserve a round trip on a form that has not been submitted yet, and because this
 * repository already has an answer for "the client needs a fact the domain owns": mirror
 * it and pin the mirror. `src/interface/http/presenters/eventTemplateContract.test.ts`
 * reads this file and fails if a value here and a value there ever differ, exactly as
 * `eventThemeContract.test.ts` does for the palette and `wallLayoutContract.test.ts` for
 * the layout table.
 *
 * ## Why the card shows a diff
 *
 * `EVENT_TEMPLATE_PATCHES` holds what each template **changes**, not a whole settings
 * object, because that is the shape the domain keeps it in — a template is defined by
 * what this kind of evening differs on. The host-facing consequence is the useful one:
 * the card renders the patch, so it lists exactly what choosing a template does and
 * cannot claim a change that will not happen.
 */

/**
 * The catalogue, in the order the create form offers it.
 *
 * Typed against the wire vocabulary in `lib/api/dto.ts` rather than deriving the type
 * from the array, the way `design-system/eventTheme.ts` does for the font pairings: the
 * server decides what a template key may be, and a fifth name invented here would fail to
 * compile instead of reaching a form as an option the API refuses.
 */
export const EVENT_TEMPLATE_KEYS: readonly EventTemplateKey[] = [
  'wedding',
  'birthday',
  'conference',
  'party',
]

/**
 * What each template changes, mirroring `TEMPLATES` in the domain.
 *
 * Do not edit one half of this without the other; the contract test is what will tell
 * you, and it reads this literal out of this file's source. Keep it a plain literal —
 * a value computed here would be invisible to it.
 */
export const EVENT_TEMPLATE_PATCHES: Readonly<Record<EventTemplateKey, Partial<EventSettingsDto>>> =
  {
    wedding: {
      guestSelfDeleteGraceSeconds: 3600,
      retentionDays: 365,
      theme: { accentHue: 345, fonts: 'serif', frame: 'round', material: 'glass' },
    },
    birthday: {
      moderation: 'auto',
      retentionDays: 90,
      theme: { accentHue: 305, fonts: 'sans', frame: 'round', material: 'glass' },
    },
    conference: {
      allowClips: false,
      retentionDays: 30,
      maxPhotosPerGuest: 25,
      theme: { accentHue: 250, fonts: 'sans', frame: 'square', material: 'glass' },
    },
    party: {
      moderation: 'auto',
      retentionDays: 30,
      theme: { accentHue: 195, fonts: 'sans', frame: 'soft', material: 'glass' },
    },
  }

const MODERATION_LABELS: Readonly<Record<EventSettingsDto['moderation'], string>> = {
  manual: fr.admin.moderationManual,
  auto: fr.admin.moderationAuto,
}

/**
 * The theme, as the names of the parts that **move**.
 *
 * A patch's `theme` is a whole object — `EventSettings` replaces a theme rather than
 * merging one, for the good reason that a half-applied palette is a palette nobody chose
 * — so a template that wants a different frame has to restate the accent and the font
 * pairing it is not changing. `birthday` does exactly that, and rendering the object as
 * written produced "Apparence : Violet, Moderne, Coins très arrondis" where two of the
 * three are the product's own defaults and no change at all.
 *
 * That is the failure the catalogue's own rule 1 forbids — a line that promises a change
 * and makes none — one level deeper than the rule can see, because ring 1 compares the
 * theme as one value. The catalogue cannot express a partial theme and should not try, so
 * the diff is taken here, against the same default the wire and the wall use.
 *
 * `accentNameFor` answers `null` for an angle outside the four the picker offers. No
 * template can be on one — the domain's own tests refuse it, for this exact reason — so
 * an unnamed colour is left out rather than printed as an angle a host cannot act on.
 *
 * `null` when nothing moves, which the catalogue cannot produce (a theme identical to the
 * default is a restated default and ring 1 refuses it) but a caller can ask for.
 */
const themeLine = (theme: EventSettingsDto['theme']): string | null => {
  const accent = theme.accentHue === DEFAULT_EVENT_THEME.accentHue ? null : theme.accentHue
  const accentName = accent === null ? null : accentNameFor(accent)

  const parts = [
    ...(accentName === null ? [] : [fr.admin.themeAccentNames[accentName]]),
    ...(theme.fonts === DEFAULT_EVENT_THEME.fonts ? [] : [fr.admin.themeFontsNames[theme.fonts]]),
    ...(theme.frame === DEFAULT_EVENT_THEME.frame ? [] : [fr.admin.themeFrameNames[theme.frame]]),
    // No template moves the material and none is likely to — a preset is an occasion, and
    // no occasion implies a surface finish. It is listed all the same, because the rule
    // this function exists for is "print what moves", and a part left out of the diff is a
    // change a host would not be shown the day somebody does move it.
    ...(theme.material === DEFAULT_EVENT_THEME.material
      ? []
      : [fr.admin.themeMaterialNames[theme.material]]),
  ]

  return parts.length === 0 ? null : `${fr.admin.theme} : ${parts.join(', ')}`
}

/**
 * One French line per setting a template changes, in a fixed order.
 *
 * Formatting, not a rule: what the values are is the domain's, and this decides how to
 * say them. `eventTemplates.test.ts` asserts that **every** key any template carries
 * produces a line, so adding a field to a preset without a sentence for it fails there
 * rather than shipping a card that quietly under-reports what the host is agreeing to.
 */
export const templateSummary = (patch: Partial<EventSettingsDto>): readonly string[] => {
  const lines: string[] = []

  if (patch.moderation !== undefined) lines.push(MODERATION_LABELS[patch.moderation])
  if (patch.allowClips !== undefined) {
    lines.push(patch.allowClips ? fr.admin.templateClipsOn : fr.admin.templateClipsOff)
  }
  if (patch.guestSelfDeleteGraceSeconds !== undefined) {
    lines.push(`${fr.admin.selfDeleteGrace} : ${graceLabel(patch.guestSelfDeleteGraceSeconds)}`)
  }
  if (patch.retentionDays !== undefined) {
    // Labelled, unlike on the settings page where the same string is an option inside a
    // select already headed "Suppression automatique". Bare on a card it read "30 jours
    // après la clôture" with no verb — five words that a host can reasonably take to mean
    // the gallery *stays up* that long. What actually happens is `purgeExpiredEvents`
    // deleting the media tree and the event row, and nothing in this product warns anyone
    // it is coming, so the card is the only place it is ever said.
    lines.push(
      patch.retentionDays === null
        ? fr.admin.retentionUnlimited
        : `${fr.admin.retention} : ${fr.admin.retentionDays(patch.retentionDays)}`,
    )
  }
  if (patch.maxPhotosPerGuest !== undefined) {
    lines.push(
      `${fr.admin.maxPhotosPerGuest} : ${
        patch.maxPhotosPerGuest === null
          ? fr.admin.maxPhotosUnlimited
          : String(patch.maxPhotosPerGuest)
      }`,
    )
  }
  if (patch.theme !== undefined) {
    const theme = themeLine(patch.theme)
    if (theme !== null) lines.push(theme)
  }

  return lines
}

/**
 * The one thing a template can set that the product refuses to let a host choose in
 * silence.
 *
 * `EventSettingsPage` mounts an `aria-live` region so `moderationAutoWarning` is
 * announced the instant a host selects `auto`, and its comment says why: publishing
 * without validation is the one setting that can put something unwanted on a screen in
 * front of two hundred people, "so it says so at the moment the host selects it — not in
 * a paragraph they read last week". Picking `birthday` or `party` on the create form
 * **is** that moment, and the card showed only "Publier automatiquement".
 *
 * Here rather than in the picker, because "auto needs a warning" is a judgement about the
 * product and not about markup — the component asks what to say and renders it.
 *
 * The values are not softened by this. A host who is told what `auto` does and picks it
 * anyway has allowed it, which is the same standard the settings page holds them to.
 */
export const templateWarning = (patch: Partial<EventSettingsDto>): string | null =>
  patch.moderation === 'auto' ? fr.admin.moderationAutoWarning : null
