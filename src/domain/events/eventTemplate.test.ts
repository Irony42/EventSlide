import { describe, expect, it } from 'vitest'
import { EventSettings, type EventSettingsProps } from './eventSettings'
import {
  compileEventTemplate,
  EVENT_TEMPLATE_KEYS,
  eventTemplatePatch,
  eventTemplateSettings,
  type EventTemplateKey,
} from './eventTemplate'
import { accentFailure, accentPalette, CURATED_ACCENT_HUES } from './eventTheme'

/**
 * The four presets a host starts an event from (roadmap 3.5).
 *
 * Two jobs here, and they are different in kind. The first half pins the **rules** a
 * catalogue has to obey — every preset is legible, no preset restates a default, no two
 * presets are the same event under two names — and those are what stop a future edit
 * from quietly producing a preset that does nothing or a wall nobody can read.
 *
 * The second half pins the **judgements**: the actual value each template sets, one
 * assertion per value, named for the reason rather than the number. Those exist so a
 * reviewer who thinks a week is too short for a party argues with a sentence instead of
 * with a diff, and so that changing one is a deliberate act.
 */

const DEFAULTS: EventSettingsProps = EventSettings.default().toProps()

const settingsOf = (key: EventTemplateKey): EventSettingsProps =>
  eventTemplateSettings(key).toProps()

describe('the template catalogue', () => {
  it.each(EVENT_TEMPLATE_KEYS)('%s produces settings the domain accepts', (key) => {
    // Reaching this at all is most of the assertion: `eventTemplateSettings` resolves
    // every preset at module load and throws on one the settings rules refuse, so a
    // catalogue with an out-of-range retention or an illegible accent fails the import
    // rather than a host's create request.
    expect(settingsOf(key)).toBeDefined()
  })

  it.each(EVENT_TEMPLATE_KEYS)('%s picks an accent the room can read', (key) => {
    // Roadmap 2.2 refuses 177 of the 360 hues for crowding `--success`, `--danger` or
    // `--warning`. A preset is a hue chosen by us rather than by a host, so nothing in
    // the product would ever tell us it was one of them — this does.
    expect(accentFailure(accentPalette(settingsOf(key).theme.accentHue))).toBeNull()
  })

  it.each(EVENT_TEMPLATE_KEYS)('%s picks an accent the settings form can show', (key) => {
    // Stricter than the rule above, and for a host-facing reason rather than a legibility
    // one: the appearance section offers four named radios and `accentNameFor` answers
    // `null` for any other angle, so a preset off the curated list would leave a host who
    // opens it looking at four unselected colours with nothing saying what they chose.
    expect(Object.values(CURATED_ACCENT_HUES)).toContain(settingsOf(key).theme.accentHue)
  })

  it.each(EVENT_TEMPLATE_KEYS)('%s changes something', (key) => {
    expect(Object.keys(eventTemplatePatch(key)).length).toBeGreaterThan(0)
  })

  it.each(EVENT_TEMPLATE_KEYS)('%s states nothing that is already the default', (key) => {
    // A key whose value is the default is noise in the table and a line in the host's
    // card promising a change that does not happen. The patch shape is what makes "what
    // this evening differs on" readable, and a restatement is what makes it unreadable.
    for (const [field, value] of Object.entries(eventTemplatePatch(key))) {
      expect({ [field]: value }).not.toEqual({
        [field]: DEFAULTS[field as keyof EventSettingsProps],
      })
    }
  })

  it('has no template that is another template under a second name', () => {
    // "A preset that repeats the defaults under a name is worse than no preset", and two
    // presets that resolve identically are the same failure with an extra radio button.
    const resolved = EVENT_TEMPLATE_KEYS.map((key) => JSON.stringify(settingsOf(key)))

    expect(new Set(resolved).size).toBe(EVENT_TEMPLATE_KEYS.length)
  })

  it('leaves every field a template is silent about at its default', () => {
    // The other half of the patch contract: silence means "the default is already right
    // for this evening", not "unspecified". A wedding wants every photo seen before it
    // reaches a screen and gets exactly that, without the catalogue saying so.
    expect(settingsOf('wedding').moderation).toBe(DEFAULTS.moderation)
    expect(settingsOf('wedding').allowCaptions).toBe(DEFAULTS.allowCaptions)
    expect(settingsOf('conference').moderation).toBe('manual')
  })

  it('hands out settings one event cannot change under another', () => {
    // The resolved templates are shared instances, which is only safe because
    // `EventSettings` is immutable. If `with` ever mutated in place, two events created
    // from the same preset would share a policy.
    const first = eventTemplateSettings('wedding')
    const changed = first.with({ moderation: 'auto' })

    expect(changed.ok && changed.value).not.toBe(first)
    expect(eventTemplateSettings('wedding').moderation).toBe('manual')
  })

  it.each(EVENT_TEMPLATE_KEYS)('hands out a %s nothing can edit under every event', (key) => {
    // `toProps()` returns the instance's own props, and a template's instance is shared
    // by every event created from it — so an unfrozen one is a single assignment away
    // from recolouring, or un-moderating, every wedding on the box at once. Frozen
    // rather than copied, because copying would give up the import-time validation that
    // makes `eventTemplateSettings` total.
    expect(Object.isFrozen(eventTemplateSettings(key).toProps())).toBe(true)
    expect(Object.isFrozen(eventTemplateSettings(key).toProps().theme)).toBe(true)
  })

  it.each(EVENT_TEMPLATE_KEYS)('hands out a %s patch the caller cannot edit either', (key) => {
    // The same object the card renders from, and the same theme object that is inside the
    // compiled settings — `EventSettings` replaces a theme whole rather than copying it.
    expect(Object.isFrozen(eventTemplatePatch(key))).toBe(true)
    expect(Object.isFrozen(eventTemplatePatch(key).theme)).toBe(true)
  })

  it('refuses to compile a preset the settings rules would reject', () => {
    // The guard that makes `eventTemplateSettings` total. Unreachable from the catalogue
    // as it stands — which is exactly why it is driven here rather than trusted.
    expect(() => compileEventTemplate('party', { retentionDays: 0 })).toThrow(
      /party.*eventSettings\.retentionDaysInvalid/,
    )
  })
})

/**
 * The judgements, one per value. Each name is the reason; the number is the argument.
 */
describe('what a wedding starts from', () => {
  it('keeps every photo for a decision, because the room is somebody’s family', () => {
    expect(settingsOf('wedding').moderation).toBe('manual')
  })

  it('gives a guest an hour to take a photo back, not a quarter of one', () => {
    // The phone is in a pocket through the meal and the speeches.
    expect(settingsOf('wedding').guestSelfDeleteGraceSeconds).toBe(3_600)
  })

  it('keeps the album a year, which is every anniversary a couple asks for', () => {
    // And then honours the promise to two hundred guests who never chose this software,
    // rather than keeping their faces forever by default.
    expect(settingsOf('wedding').retentionDays).toBe(365)
  })

  it('wears the rose, a display face and a rounded print', () => {
    expect(settingsOf('wedding').theme).toEqual({
      accentHue: CURATED_ACCENT_HUES.rose,
      fonts: 'serif',
      frame: 'round',
      material: 'glass',
    })
  })
})

describe('what a birthday starts from', () => {
  it('publishes on ingest, because the host is holding a cake', () => {
    expect(settingsOf('birthday').moderation).toBe('auto')
  })

  it('keeps the album three months, long enough for a family and no longer', () => {
    expect(settingsOf('birthday').retentionDays).toBe(90)
  })

  it('keeps the product’s own colour and says so by moving only the frame', () => {
    expect(settingsOf('birthday').theme).toEqual({
      accentHue: CURATED_ACCENT_HUES.violet,
      fonts: 'sans',
      frame: 'round',
      material: 'glass',
    })
  })
})

describe('what a conference starts from', () => {
  it('still holds every photo for a decision, which the default already does', () => {
    expect(settingsOf('conference').moderation).toBe('manual')
  })

  it('turns video off, because a clip during a talk is a distraction and 80 MB', () => {
    expect(settingsOf('conference').allowClips).toBe(false)
  })

  it('keeps photographs of employees a month', () => {
    expect(settingsOf('conference').retentionDays).toBe(30)
  })

  it('caps one attendee at twenty-five, so nobody can own the screen', () => {
    expect(settingsOf('conference').maxPhotosPerGuest).toBe(25)
  })

  it('wears the corporate blue, square, and nothing handmade', () => {
    expect(settingsOf('conference').theme).toEqual({
      accentHue: CURATED_ACCENT_HUES.azure,
      fonts: 'sans',
      frame: 'square',
      material: 'glass',
    })
  })
})

describe('what a party starts from', () => {
  it('publishes on ingest, because a wall waiting on a dancing host is a blank screen', () => {
    expect(settingsOf('party').moderation).toBe('auto')
  })

  it('keeps the album a month, outside the window people still ask for the photos in', () => {
    // A week was the first answer and it was wrong in three ways at once: it deletes the
    // album while it is still being passed around, the clock only starts when the host
    // closes the event so it punishes the diligent host and misses the careless one, and
    // nothing in this product warns anybody that an expiry is due.
    expect(settingsOf('party').retentionDays).toBe(30)
  })

  it('puts no cap on a guest, which is what throughput over control means', () => {
    expect(settingsOf('party').maxPhotosPerGuest).toBeNull()
  })

  it('wears the cool hue, which does not compete with the lighting', () => {
    expect(settingsOf('party').theme).toEqual({
      accentHue: CURATED_ACCENT_HUES.teal,
      fonts: 'sans',
      frame: 'soft',
      material: 'glass',
    })
  })
})
