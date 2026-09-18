import { EventSettings, type EventSettingsPatch } from './eventSettings'
import { CURATED_ACCENT_HUES } from './eventTheme'

/**
 * The four kinds of evening this product is actually used for, as starting settings.
 *
 * Roadmap 3.5. It serves the **host**, and only at one moment: the create form asks for
 * a name and nothing else, so a host setting up a conference at 09:00 gets the same
 * policy as a couple setting up a wedding at 18:00 — defaults that were chosen to be
 * safe for nobody in particular. A template is the difference between "sensible for this
 * kind of evening" and "sensible in the abstract".
 *
 * ## A template is a copy, not an attachment
 *
 * Choosing one **applies its values once, at creation, and is then over**. The event
 * stores settings, not a template reference; nothing in this file is consulted again for
 * the life of the event, and there is no column, no field and no DTO key saying which
 * template an event came from.
 *
 * The other design — an event stays attached to a living template, so editing the
 * template changes the events already running — is the one the next person will be
 * tempted by, because it looks like less duplication and because "presets" in other
 * products usually work that way. It is a different and worse product here:
 *
 * - **It breaks the escape hatch.** "I picked wedding and then changed moderation" has
 *   to be a first-class outcome. Under an attachment, that edit is a local override
 *   fighting an inherited value, and every settings field grows a third state — set,
 *   unset, inherited — on a form a host opens once, in a hurry, the day of the event.
 * - **It can change an event that is live.** A template edit at 21:00 would move the
 *   moderation mode of a wedding in front of two hundred people. Nothing in this product
 *   may surprise a host with a value they did not choose, and an inherited value is
 *   exactly that.
 * - **It earns nothing.** These four are fixed and ship with the build. There is no
 *   host editing them, so there is no edit to propagate.
 *
 * So: a copy. The host owns the result the instant it exists, `updateEventSettings` is
 * the only thing that ever changes it again, and there is nothing left for a template to
 * assert later because the link does not exist.
 *
 * ## A catalogue in the domain, not a table
 *
 * Four fixed presets, versioned with the code, testable as a pure function, and costing
 * no migration. A table would cost one migration, one repository, one port and a
 * seeding story, and would earn nothing at all until hosts can write their own.
 *
 * What would change if host-authored templates were asked for later: a
 * `TemplateRepository` port and a table of `(ownerId, name, settingsPatch)`, a use case
 * to write one, and `eventTemplateSettings` gaining a sibling that reads from the port.
 * **This file would stay**, because the four below are the product's opinion and a host's
 * own presets are additions to it rather than replacements — and the copy-at-creation
 * rule above would stay too, which is what keeps that feature from turning into
 * inheritance. The only thing that would have to move is the key type: a host's template
 * is identified by an id, so `EventTemplateKey` would become the *built-in* half of a
 * union rather than the whole vocabulary.
 *
 * ## What is deliberately not here
 *
 * - **The wall layout**, which roadmap 3.5 names. No event stores one: the layout is
 *   chosen at the screen, from `?layout=` and the host's `L` key, and docs/API.md says in
 *   as many words that no endpoint accepts one (§8, and `wallQuery` is `.strict()` about
 *   it). A template that set a layout would be setting a value nothing reads. Making the
 *   layout an event setting is a defensible change and it is a different one: it needs a
 *   settings field, a boundary schema, a presenter, and an answer to "two projectors,
 *   whose layout wins" that trap 7 in CLAUDE.md is about.
 * - **The mission list**, also named by 3.5. Roadmap 2.1 has not shipped; there is
 *   nothing to preset.
 */

export const EVENT_TEMPLATE_KEYS = ['wedding', 'birthday', 'conference', 'party'] as const

export type EventTemplateKey = (typeof EVENT_TEMPLATE_KEYS)[number]

/*
 * There is deliberately no `isEventTemplateKey` here, unlike `isModerationMode` and
 * `isThemeFonts` next door. Those exist because `sqliteEventRepository` has to narrow a
 * value it read back out of a JSON column. A template key is never written anywhere, so
 * there is nothing to read back and nothing to narrow — the only boundary that ever sees
 * one is `createEventBody`, and zod narrows it there from this same array.
 */

/**
 * What each template **changes**, and nothing else.
 *
 * A patch rather than a full settings object, and that is the substantive decision in
 * this file. Read as a patch, a template is literally its own justification: the keys
 * present are what this kind of evening differs on, and a reviewer can disagree with a
 * judgement by pointing at one line. Read as a full object, four fifths of every preset
 * would be the defaults restated, the actual opinions would be invisible inside them,
 * and a new settings field would have to be answered four times by whoever adds it
 * rather than flowing through.
 *
 * It also makes the host-facing card honest for free: the picker renders the patch, so
 * it shows exactly what choosing this template does and cannot claim anything else.
 *
 * Two rules, both enforced in `eventTemplate.test.ts` rather than trusted:
 *
 * 1. **No entry may restate a default.** A key whose value is already the default is
 *    noise in the table and a line in the host's card that promises a change and makes
 *    none.
 * 2. **No two templates may resolve to the same settings.** A preset that is another
 *    preset under a second name is worse than no preset.
 *
 * Consequence of rule 1 worth stating once, because it looks like an omission every time
 * it appears below: a template is silent about a field precisely where the default is
 * already the right answer for that evening. `moderation` on the wedding and the
 * conference is the clearest case — both want every photo seen before it reaches a
 * screen, both get it, and neither says so here.
 *
 * The accent hues are taken from `CURATED_ACCENT_HUES` rather than written as angles.
 * The rule in `eventTheme.ts` would accept any legible angle, but the host's settings
 * form offers those four as named radios and `accentNameFor` reports `null` for anything
 * else — so a template on an uncurated hue would leave a host who opens the appearance
 * section looking at four unselected colours and no answer to "what did I pick".
 */
const TEMPLATES: Readonly<Record<EventTemplateKey, EventSettingsPatch>> = {
  /**
   * A wedding. Family, one evening, an album somebody will actually want in ten years.
   */
  wedding: {
    // An hour, against a default of fifteen minutes: the phone goes back in a pocket for
    // the meal and the speeches, so a guest who wants the photo they just sent taken
    // down looks at the wall an hour later, not within a quarter of one.
    guestSelfDeleteGraceSeconds: 3_600,
    // A year, against a default of "keep forever". The couple get every anniversary
    // they will ask for, and the promise made to two hundred guests who never chose this
    // software is then honoured without anyone having to remember. Keeping it forever
    // stays available to a couple who want that — it is just not a decision a preset
    // should take on a guest's behalf (roadmap section 7).
    retentionDays: 365,
    theme: {
      // The roadmap's wedding pink, as close as a fixed chroma allows.
      accentHue: CURATED_ACCENT_HUES.rose,
      // The one event here that is not a working occasion, and the only one where a
      // display face reads as care rather than decoration.
      fonts: 'serif',
      // A rounded print reads as a keepsake. It is also the frame the polaroid layout
      // was drawn for, which is the layout a small wedding ends the evening on.
      frame: 'round',
      // The material every event wears unless its host says otherwise, restated here
      // because `EventSettings` replaces a theme whole rather than merging it. None of the
      // four presets has an opinion about it: a preset is an occasion, and no occasion
      // implies a surface finish the way a wedding implies a serif.
      material: 'glass',
    },
  },

  /**
   * A birthday. Loose, known guests, nobody moderating anything.
   */
  birthday: {
    // The host is holding a cake, not a laptop. A queue nobody empties is a wall that
    // never moves, and the room is people who know each other — which is the condition
    // the settings page's own warning against automatic publishing names.
    moderation: 'auto',
    // Three months: long enough that the family pulls what it wants off the gallery at
    // its own pace, short enough that a hundred photographs of somebody's children are
    // not still sitting on a machine in a cupboard next year.
    retentionDays: 90,
    theme: {
      // The product's own violet, and that is the decision rather than the absence of
      // one: a birthday honours no house colour and no bride's palette, and the default
      // hue is the one the dark-room wall was designed around.
      accentHue: CURATED_ACCENT_HUES.violet,
      fonts: 'sans',
      // The preset's opinion here is the frame, not the colour. Rounded corners read as
      // a photo album rather than a feed, which is what a family evening's wall is.
      frame: 'round',
      material: 'glass',
    },
  },

  /**
   * A conference. Colleagues rather than family, a company's own box, and a wall that
   * is on behind a stage all day.
   */
  conference: {
    // Off. A clip on the wall during a talk is a distraction in a room that is meant to
    // be looking at a speaker, and an eighty-megabyte upload is the wrong use of a venue
    // link three hundred laptops are already sharing. The one template that takes a
    // feature away, and the reason it is a decision and not a default: `allowClips` is
    // on for everything else because a host who has not thought about it should get the
    // feature.
    allowClips: false,
    // A month. Photographs of employees on a company's own machine, kept long enough for
    // whoever runs the event to pull what they need and no longer — and the one retention
    // a corporate host will be asked to justify, which makes the short answer the right
    // default to start from.
    retentionDays: 30,
    // A cap is a fairness tool, not a storage control. A hundred badge selfies from one
    // enthusiastic attendee owning the screen is the failure mode of a corporate wall,
    // and twenty-five over a day is more than anybody sends in good faith.
    maxPhotosPerGuest: 25,
    theme: {
      // The roadmap's corporate blue, and the furthest of the four from a party colour.
      accentHue: CURATED_ACCENT_HUES.azure,
      // Nothing about this evening should look handmade.
      fonts: 'sans',
      // A square corner reads as a slide or a badge rather than a scrapbook.
      frame: 'square',
      // Not `plain`, although a conference is the one occasion where somebody will argue
      // for it. The reason to turn the material off is a machine or a taste, and a preset
      // knows neither: the host's console runs on the same laptop whatever the occasion,
      // and the projector has already given the material up (DESIGN-SYSTEM.md §13).
      material: 'glass',
    },
  },

  /**
   * A party. Throughput over control: the wall is ambience, and it has to move.
   */
  party: {
    // Same reasoning as the birthday and more so — a host who is dancing is not
    // approving photographs, and a wall waiting on them is a blank screen for the one
    // hour everybody is looking at it.
    moderation: 'auto',
    // A month, and it was a week until a reviewer took the week apart. Three things were
    // wrong with seven days and all of them point the same way. A week is *inside* the
    // window where people are still asking each other for the photographs, so it deletes
    // the album while it is still being used. The clock does not start until the host
    // closes the event (`Event.expiresAt` reads `closedAt`), so it does nothing at all to
    // the careless host it was meant to protect and everything to the diligent one who
    // closes the wall that night. And nothing in this product warns anybody that an
    // expiry is coming. A month keeps the privacy posture — it is still a finite promise
    // chosen on a guest's behalf, which is the point — and sits outside the "can you send
    // me that one" window rather than inside it.
    retentionDays: 30,
    theme: {
      // The one hue that is neither the wedding's rose nor the conference's blue, and
      // the coolest of the four: a party wall is read across a dark room for eight hours
      // beside whatever the lighting is doing, and a cool accent is the one that does not
      // compete with it.
      accentHue: CURATED_ACCENT_HUES.teal,
      fonts: 'sans',
      frame: 'soft',
      material: 'glass',
    },
  },
}

/**
 * A template's patch, for the host-facing card and for the contract test that pins the
 * client's copy of it.
 *
 * The patch and not the resolved settings, because what a host needs to be shown before
 * they choose is what this changes — and because the resolved settings are what
 * `eventTemplateSettings` is for.
 */
export const eventTemplatePatch = (key: EventTemplateKey): EventSettingsPatch => TEMPLATES[key]

/**
 * Resolve a template, refusing to hand out one the domain would not accept.
 *
 * Exported for the test that drives its failure path, which is the only place it can be
 * reached: {@link COMPILED} runs every template in the catalogue through it at module
 * load, so a preset the settings rules refuse — an illegible accent, a retention out of
 * range — takes the whole process down at import. Every test file that touches events
 * fails, the server does not boot, and `npm run verify` is red.
 *
 * That is the point. The alternative is a `Result` threaded through `createEvent`, whose
 * failure branch nothing in production can reach, and whose real-world first reader would
 * be a host receiving a 400 from a form with no field to correct. A preset is our
 * mistake, not theirs, and it belongs in the build rather than in their evening.
 */
export const compileEventTemplate = (
  key: EventTemplateKey,
  patch: EventSettingsPatch,
): EventSettings => {
  const settings = EventSettings.create(patch)
  if (!settings.ok) {
    throw new Error(`event template "${key}" is not valid settings: ${settings.error.code}`)
  }
  return settings.value
}

/**
 * Freeze a patch and the theme object inside it.
 *
 * `eventTemplatePatch` hands the catalogue's own object to a caller, and the theme it
 * holds is the *same* object that ends up inside the compiled settings — `EventSettings`
 * replaces a theme whole rather than copying it. Unfrozen, one `patch.theme.accentHue =`
 * anywhere would recolour every event created from that template for the life of the
 * process.
 */
const freezeTemplate = (patch: EventSettingsPatch): EventSettingsPatch => {
  // Unguarded on purpose. `Object.freeze` of anything that is not an object returns it
  // untouched — it has since ES2015 — so a template with no theme needs no branch here,
  // and a branch no template in the catalogue can take is a branch no test can cover.
  Object.freeze(patch.theme)
  return Object.freeze(patch)
}

/**
 * Every template, resolved once.
 *
 * Shared instances, because `EventSettings` is immutable — `with` returns a new one and
 * nothing can write to an existing one.
 *
 * That "nothing can write to one" is a promise about the **class**, and `toProps()` is
 * the hole in it: it hands back the instance's own props object, and here that is the one
 * object every event created from this template is built from. `EventSettings.default()`
 * copies for exactly this reason — "so `toProps()` can never hand a caller the
 * module-level defaults object" — and a shared template has the same exposure with four
 * more objects. So the props are frozen rather than copied: copying would mean building a
 * fresh `EventSettings` per creation and giving up the import-time validation that makes
 * `eventTemplateSettings` total, and frozen is the stronger guarantee anyway. It is the
 * same trade `DEFAULT_EVENT_THEME` makes one file over.
 */
const COMPILED: Readonly<Record<EventTemplateKey, EventSettings>> = Object.freeze(
  Object.fromEntries(
    EVENT_TEMPLATE_KEYS.map((key) => {
      const settings = compileEventTemplate(key, freezeTemplate(TEMPLATES[key]))
      Object.freeze(settings.toProps())
      return [key, settings]
    }),
  ) as Record<EventTemplateKey, EventSettings>,
)

/**
 * The settings an event created from this template starts with.
 *
 * Total, never failing, and consulted exactly once per event — at creation, by
 * `createEvent`. Nothing calls it again, which is the copy-not-attachment rule expressed
 * as a signature.
 */
export const eventTemplateSettings = (key: EventTemplateKey): EventSettings => COMPILED[key]
