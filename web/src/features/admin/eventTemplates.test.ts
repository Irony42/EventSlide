import { describe, expect, it } from 'vitest'
import {
  EVENT_TEMPLATE_KEYS,
  EVENT_TEMPLATE_PATCHES,
  templateSummary,
  templateWarning,
} from './eventTemplates'
import { DEFAULT_EVENT_THEME } from '../../design-system/eventTheme'
import { fr } from '../../lib/i18n/fr'
import type { EventSettingsDto } from '../../lib/api/dto'

const DEFAULT_THEME: EventSettingsDto['theme'] = DEFAULT_EVENT_THEME

/**
 * The host-facing half of roadmap 3.5: what a template card says it will do.
 *
 * The values themselves are the domain's and are pinned against this file by
 * `src/interface/http/presenters/eventTemplateContract.test.ts`. What is pinned here is
 * that every one of them is **said** — a card that silently under-reports what a host is
 * agreeing to is the exact failure a preset is supposed to prevent.
 */

/**
 * For each settings field, a fragment that appears in its line and in no other.
 *
 * `moderation` is two fragments because its line *is* the mode name; everything else is
 * labelled, which is what makes the label worth having.
 */
const FIELD_MARKS: readonly (readonly [field: string, mark: string])[] = [
  ['moderation', fr.admin.moderationAuto],
  ['moderation', fr.admin.moderationManual],
  ['allowClips', 'Vidéos'],
  ['guestSelfDeleteGraceSeconds', fr.admin.selfDeleteGrace],
  ['retentionDays', fr.admin.retention],
  ['maxPhotosPerGuest', fr.admin.maxPhotosPerGuest],
  ['theme', fr.admin.theme],
]

describe('the template summary', () => {
  it.each(EVENT_TEMPLATE_KEYS)('says something about every setting %s changes', (key) => {
    // The guard that matters. Adding a field to a preset in the domain without a sentence
    // for it here would otherwise ship a card that is quietly wrong rather than obviously
    // incomplete.
    const patch = EVENT_TEMPLATE_PATCHES[key]

    expect(templateSummary(patch)).toHaveLength(Object.keys(patch).length)
  })

  it.each(EVENT_TEMPLATE_KEYS)('says nothing about a setting %s leaves alone', (key) => {
    // A template is what it differs on, so a line about an untouched field would be a
    // promise of a change that does not happen.
    //
    // General, and it was not: it used to check one string, `retentionNever`, that no
    // template can produce — so it could only have failed if somebody added a template
    // that set retention to "keep forever", and passed the rest of the time by saying
    // nothing. Now every field the formatter knows about is checked against every
    // template that leaves it alone, which is thirteen real assertions across the four.
    const patch: Partial<EventSettingsDto> = EVENT_TEMPLATE_PATCHES[key]
    const said = templateSummary(patch).join(' ')

    for (const [field, mark] of FIELD_MARKS) {
      if (field in patch) continue
      expect(said).not.toContain(mark)
    }
  })

  it('has a sentence for every field any template in the catalogue uses', () => {
    // The same rule read from the other end, and the one that survives a preset being
    // deleted: it names the fields rather than counting them.
    const fields = [
      ...new Set(EVENT_TEMPLATE_KEYS.flatMap((key) => Object.keys(EVENT_TEMPLATE_PATCHES[key]))),
    ]

    expect(fields).toEqual(
      expect.arrayContaining([
        'moderation',
        'allowClips',
        'guestSelfDeleteGraceSeconds',
        'retentionDays',
        'maxPhotosPerGuest',
        'theme',
      ]),
    )
  })

  it('says nothing at all about a template that changes nothing', () => {
    expect(templateSummary({})).toEqual([])
  })

  it('words a moderation mode the way the settings form does', () => {
    // Two screens, one sentence. A host reading "Publier automatiquement" on the card and
    // something else on the settings page would have to work out whether they are the
    // same setting.
    expect(templateSummary({ moderation: 'auto' })).toEqual([fr.admin.moderationAuto])
    expect(templateSummary({ moderation: 'manual' })).toEqual([fr.admin.moderationManual])
  })

  it('says which way a video switch was thrown, not that it was touched', () => {
    expect(templateSummary({ allowClips: false })).toEqual([fr.admin.templateClipsOff])
    expect(templateSummary({ allowClips: true })).toEqual([fr.admin.templateClipsOn])
  })

  it('words a grace window in the unit the settings form uses', () => {
    expect(templateSummary({ guestSelfDeleteGraceSeconds: 3600 })).toEqual([
      `${fr.admin.selfDeleteGrace} : ${fr.admin.graceHours(1)}`,
    ])
  })

  it('says that a retention deletes, rather than printing a bare duration', () => {
    // The assertion that would have caught it. "30 jours après la clôture" on its own is
    // five words with no verb, and the most natural reading of them is that the gallery
    // *stays up* for thirty days. What happens is `purgeExpiredEvents` removing the media
    // tree and the event row, and nothing anywhere in this product warns a host that an
    // expiry is due — so this card is the only place it is ever said, and it has to say
    // it. On the settings page the same string is an option inside a select already
    // headed "Suppression automatique", which is why it reads correctly there and did
    // not here.
    const line = templateSummary({ retentionDays: 30 })[0] ?? ''

    expect(line).toContain(fr.admin.retention)
    expect(line).toContain(fr.admin.retentionDays(30))
  })

  it('names the act that starts the clock, which is the closing and not "la fin"', () => {
    // `Event.expiresAt` reads `closedAt` and answers `null` until the host closes the
    // event, so "après la fin" named something the server does not measure: the same
    // words meant "never" to a host who leaves the wall open and a real countdown to one
    // who closes it that night.
    expect(fr.admin.retentionDays(30)).toContain('clôture')
  })

  it('says what keeping everything is, rather than answering "Jamais" to no question', () => {
    // `retentionNever` is the right word for an option in a list headed "Suppression
    // automatique". On a card with no such heading it is a bare adverb, and what it
    // stands for — photographs of other people's families kept indefinitely — is the
    // thing ROADMAP section 7 says must not pass as a neutral default.
    expect(templateSummary({ retentionDays: null })).toEqual([fr.admin.retentionUnlimited])
  })

  it('words a per-guest cap, including the absence of one', () => {
    expect(templateSummary({ maxPhotosPerGuest: 25 })).toEqual([
      `${fr.admin.maxPhotosPerGuest} : 25`,
    ])
    expect(templateSummary({ maxPhotosPerGuest: null })).toEqual([
      `${fr.admin.maxPhotosPerGuest} : ${fr.admin.maxPhotosUnlimited}`,
    ])
  })

  it('names a theme by the names the settings form shows for it', () => {
    // Not by its hue angle: 345 is not something a host can act on, and "Rose" is the
    // word the appearance section will use for the same choice.
    expect(templateSummary({ theme: { accentHue: 345, fonts: 'serif', frame: 'round' } })).toEqual([
      `${fr.admin.theme} : ${fr.admin.themeAccentNames.rose}, ${fr.admin.themeFontsNames.serif}, ${fr.admin.themeFrameNames.round}`,
    ])
  })

  it('names only the part of a theme that moves', () => {
    // The assertion that would have caught it. A patch's theme is a whole object, because
    // `EventSettings` replaces a theme rather than merging one — so `birthday`, which
    // wants a different frame and nothing else, has to restate the default hue and the
    // default font pairing. Rendered as written that is "Apparence : Violet, Moderne,
    // Coins très arrondis", two thirds of which is no change: the same "promises a change
    // and makes none" the catalogue's own rule 1 forbids, one level below where ring 1
    // can see it.
    const frameOnly = { accentHue: 305, fonts: 'sans', frame: 'round' } as const

    expect(templateSummary({ theme: frameOnly })).toEqual([
      `${fr.admin.theme} : ${fr.admin.themeFrameNames.round}`,
    ])
  })

  it('says nothing about a theme that is the product’s own', () => {
    // Not reachable from the catalogue — a theme identical to the default is a restated
    // default and ring 1 refuses it — but the alternative to answering `null` here is a
    // dangling "Apparence : " on a card.
    expect(templateSummary({ theme: { accentHue: 305, fonts: 'sans', frame: 'soft' } })).toEqual([])
  })

  it.each(EVENT_TEMPLATE_KEYS)('claims no unchanged part of %s’s theme', (key) => {
    // The same rule over the real catalogue, so a fifth template cannot reintroduce it.
    const theme = EVENT_TEMPLATE_PATCHES[key].theme
    if (theme === undefined) throw new Error(`${key} has no theme to check`)

    const line = templateSummary({ theme }).join('')

    if (theme.accentHue === 305) expect(line).not.toContain(fr.admin.themeAccentNames.violet)
    if (theme.fonts === 'sans') expect(line).not.toContain(fr.admin.themeFontsNames.sans)
    if (theme.frame === 'soft') expect(line).not.toContain(fr.admin.themeFrameNames.soft)
  })

  it('drops the whole theme line rather than leaving a label with nothing after it', () => {
    expect(templateSummary({ moderation: 'auto', theme: DEFAULT_THEME })).toEqual([
      fr.admin.moderationAuto,
    ])
  })

  it('leaves out a colour it has no name for rather than printing an angle', () => {
    // Unreachable from the catalogue — the domain's own tests refuse a preset on an
    // uncurated hue, precisely so the settings form can show what was chosen — but the
    // type allows any angle, and a bare "137" on a card would be worse than silence.
    const theme: EventSettingsDto['theme'] = { accentHue: 137, fonts: 'serif', frame: 'round' }

    expect(templateSummary({ theme })).toEqual([
      `${fr.admin.theme} : ${fr.admin.themeFontsNames.serif}, ${fr.admin.themeFrameNames.round}`,
    ])
  })
})

describe('the warning a template carries', () => {
  it.each(['birthday', 'party'] as const)('discloses what auto publishing does, on %s', (key) => {
    // The assertion that would have caught it. `EventSettingsPage` mounts an `aria-live`
    // region so this exact string is announced the instant a host selects `auto` there,
    // because publishing without validation "says so at the moment the host selects it —
    // not in a paragraph they read last week". Picking one of these two templates is that
    // moment, and the card said only "Publier automatiquement".
    expect(EVENT_TEMPLATE_PATCHES[key].moderation).toBe('auto')
    expect(templateWarning(EVENT_TEMPLATE_PATCHES[key])).toBe(fr.admin.moderationAutoWarning)
  })

  it.each(['wedding', 'conference'] as const)('warns about nothing on %s', (key) => {
    // These two leave moderation at `manual`, so there is nothing to disclose and a
    // standing caution would only teach a host to ignore the one that matters.
    expect(templateWarning(EVENT_TEMPLATE_PATCHES[key])).toBeNull()
  })

  it('uses the settings page’s own words, not a second wording for the same choice', () => {
    expect(templateWarning({ moderation: 'auto' })).toBe(fr.admin.moderationAutoWarning)
  })

  it('covers video as well as photographs, because auto publishes both', () => {
    // `transcodeNextClip` stamps a finished clip with an `automatic` reviewer under
    // `auto` exactly as photo ingest does, and neither template touches `allowClips` — so
    // a guest's video can reach the projector with nobody having watched it. The warning
    // named only photos, which is the half a host would have checked.
    expect(fr.admin.moderationAutoWarning).toContain('vidéos')
  })
})
