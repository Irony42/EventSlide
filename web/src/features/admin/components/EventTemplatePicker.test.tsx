import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventTemplatePicker } from './EventTemplatePicker'
import { EVENT_TEMPLATE_KEYS, EVENT_TEMPLATE_PATCHES, templateSummary } from '../eventTemplates'
import { fr } from '../../../lib/i18n/fr'
import { accentNameFor } from '../../../design-system/eventTheme'
import type { EventTemplateKey } from '../../../lib/api/dto'

/**
 * The control a host meets before they have any events at all (roadmap 3.5).
 *
 * Its job is not to be pretty. It is to make "wedding" mean something the host can read
 * before they press it, and to make "none" as easy to choose as any of the four.
 *
 * Several assertions below are about the **accessible description** rather than the name.
 * That split is the feature: the label carries the name of the evening and the card's
 * prose is bound with `aria-describedby`, so a host using a screen reader hears "Mariage"
 * and then what it does — instead of one twenty-word run-on per option, which is what a
 * list nested inside a `<label>` produces and what jsdom will never complain about.
 */

const TEMPLATE_KEYS = EVENT_TEMPLATE_KEYS

/** French copy goes into `RegExp`, and it has apostrophes and parentheses in it. */
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const renderPicker = (
  value: Parameters<typeof EventTemplatePicker>[0]['value'] = null,
  onChange = vi.fn(),
) => {
  render(<EventTemplatePicker value={value} disabled={false} onChange={onChange} />)
  return onChange
}

describe('EventTemplatePicker', () => {
  it('starts on no template, which is what a host who has no opinion gets', () => {
    renderPicker()

    expect(screen.getByRole('radio', { name: new RegExp(fr.admin.templateNone) })).toBeChecked()
  })

  it('offers the four evenings this product is used for', () => {
    renderPicker()

    for (const name of Object.values(fr.admin.templateNames)) {
      expect(screen.getByRole('radio', { name: new RegExp(name) })).toBeInTheDocument()
    }
  })

  it('shows what each template changes, before the host chooses it', () => {
    // The whole reason this is a list of cards and not a `<select>`: a preset whose
    // contents are invisible is a box a host ticks and discovers at 21:00.
    renderPicker()

    const conference = screen.getByRole('radio', {
      name: new RegExp(fr.admin.templateNames.conference),
    })

    for (const line of templateSummary(EVENT_TEMPLATE_PATCHES.conference, fr)) {
      expect(conference).toHaveAccessibleDescription(new RegExp(escape(line)))
    }
  })

  it.each(TEMPLATE_KEYS)('announces %s by its name alone, not by its whole card', (key) => {
    // The assertion that would have caught it. The summary used to live inside the
    // `<label>`, which is invalid markup jsdom will never flag — and the consequence was
    // not cosmetic: everything inside a label is folded into the control's accessible
    // name, so each radio announced as a twenty-word paragraph and the list stopped being
    // a list. The previous version of the test above pinned that as correct by asserting
    // the summary was part of the name.
    renderPicker()

    const radio = screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames[key]) })

    expect(radio).toHaveAccessibleName(fr.admin.templateNames[key])
  })

  it('keeps the changes a list, which is what a screen reader should hear', () => {
    renderPicker()

    // Four cards, four lists. Inside a label they were not reachable as lists at all.
    expect(within(screen.getByRole('group')).getAllByRole('list')).toHaveLength(
      TEMPLATE_KEYS.length,
    )
  })

  it('describes a template in the words the settings page will use for the same values', () => {
    renderPicker()

    expect(screen.getByText(`${fr.admin.retention} : ${fr.admin.retentionDays(365)}`)).toBeVisible()
    expect(screen.getByText(fr.admin.templateClipsOff)).toBeVisible()
  })

  it('says what "Sans modèle" does, since it is the option a host lands on', () => {
    // It was the only card that described where its values came from instead of what they
    // are, and the value it was quietest about — keep everything, forever — is the one
    // ROADMAP section 7 refuses to let pass as a neutral default.
    renderPicker()

    const none = screen.getByRole('radio', { name: fr.admin.templateNone })

    expect(none).toHaveAccessibleDescription(fr.admin.templateNoneSummary)
    expect(fr.admin.templateNoneSummary.toLowerCase()).toContain(
      fr.admin.retentionUnlimited.toLowerCase(),
    )
  })

  it.each(['birthday', 'party'] as const)(
    'discloses what publishing without validation does, on %s',
    (key) => {
      // The assertion that would have caught it. The settings page announces this exact
      // string the instant a host selects `auto`, because it is the one setting that can
      // put something unwanted on a screen in front of two hundred people. Picking one of
      // these templates is that same moment, and the card said only "Publier
      // automatiquement".
      renderPicker()

      const radio = screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames[key]) })

      // In the description, not merely on the page: a warning a screen reader does not
      // reach when it reaches the option is a warning that arrives after the choice.
      expect(radio).toHaveAccessibleDescription(new RegExp(escape(fr.admin.moderationAutoWarning)))
    },
  )

  it('discloses it as text in the option’s description, not as an announcement of its own', () => {
    renderPicker()

    // Reached with the option, as the description above says; a role would also announce
    // it when the picker mounts, before anyone has chosen anything.
    const warnings = screen.getAllByText(fr.admin.moderationAutoWarning)
    expect(warnings.length).toBeGreaterThan(0)
    for (const warning of warnings) {
      expect(warning.closest('[role="alert"], [role="status"]')).toBeNull()
    }
  })

  it.each(['wedding', 'conference'] as const)('warns about nothing on %s', (key) => {
    renderPicker()

    const radio = screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames[key]) })

    expect(radio).not.toHaveAccessibleDescription(
      new RegExp(escape(fr.admin.moderationAutoWarning)),
    )
  })

  it('says that nothing it sets is final', () => {
    // The escape hatch, stated at the moment of choice rather than discovered afterwards.
    renderPicker()

    expect(screen.getByText(fr.admin.templateHint)).toBeVisible()
  })

  it('reports the template the host picked', async () => {
    const onChange = renderPicker()

    await userEvent.click(
      screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames.wedding) }),
    )

    expect(onChange).toHaveBeenCalledWith('wedding')
  })

  it('lets the host go back to no template at all', async () => {
    // `null` rather than a fifth key, because "no template" is the absence of a choice.
    const onChange = renderPicker('wedding')

    await userEvent.click(screen.getByRole('radio', { name: new RegExp(fr.admin.templateNone) }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('cannot be changed while the event is being created', () => {
    render(<EventTemplatePicker value="party" disabled onChange={vi.fn()} />)

    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
  })
})

/**
 * The miniature beside each card (roadmap 3.5 and 2.2).
 *
 * It is decorative, so what these hold is that it adds nothing to the radio group — not to a
 * name, not to a description, not to the tab order — and that each card's picture is about
 * that card's template and about nothing the selection says.
 */
describe('EventTemplatePicker theme previews', () => {
  const previewIn = (key: EventTemplateKey | 'none'): HTMLElement => {
    const preview = document.querySelector<HTMLElement>(`[data-template-preview="${key}"]`)
    if (preview === null) throw new Error(`no preview for ${key}`)
    return preview
  }

  /** A picker that holds its own selection, as the create form does. */
  function Controlled() {
    const [value, setValue] = useState<EventTemplateKey | null>(null)
    return <EventTemplatePicker value={value} disabled={false} onChange={setValue} />
  }

  it('draws one miniature per option, "Sans modèle" included', () => {
    renderPicker()

    expect(document.querySelectorAll('[data-template-preview]')).toHaveLength(
      TEMPLATE_KEYS.length + 1,
    )
  })

  it.each(TEMPLATE_KEYS)('draws %s in the appearance its own card lists in words', (key) => {
    // The two halves of one card, held together: whatever the sentence says moves, the
    // picture next to it moves — and a part the sentence does not name stays the default.
    // Without this a preview could wear a tidy theme that is not the one the card
    // promises, and both of its own tests would pass.
    renderPicker()
    const radio = screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames[key]) })
    const preview = previewIn(key)

    const hue = preview.getAttribute('data-event-accent')
    if (hue !== null) {
      const name = accentNameFor(Number(hue))
      expect(name).not.toBeNull()
      expect(radio).toHaveAccessibleDescription(
        new RegExp(escape(fr.admin.themeAccentNames[name ?? 'violet'])),
      )
    }
    const fonts = preview.getAttribute('data-event-fonts')
    if (fonts === 'serif') {
      expect(radio).toHaveAccessibleDescription(new RegExp(escape(fr.admin.themeFontsNames.serif)))
    }
    const frame = preview.getAttribute('data-event-frame')
    if (frame === 'round' || frame === 'square') {
      expect(radio).toHaveAccessibleDescription(new RegExp(escape(fr.admin.themeFrameNames[frame])))
    }
    // The wedding is the card that names all three, so the loop above cannot pass by
    // checking nothing.
    if (key === 'wedding') expect([hue, fonts, frame]).toEqual(['345', 'serif', 'round'])
  })

  it('draws "Sans modèle" as the defaults', () => {
    renderPicker()

    const preview = previewIn('none')
    expect(preview).not.toHaveAttribute('data-event-accent')
    expect(preview).not.toHaveAttribute('data-event-fonts')
    expect(preview).not.toHaveAttribute('data-event-frame')
  })

  it.each([...TEMPLATE_KEYS, null] as const)(
    'adds nothing to what %s announces: its name and its description are the same with the picture there',
    (key) => {
      renderPicker()

      const radio = screen.getByRole('radio', {
        name: new RegExp(key === null ? fr.admin.templateNone : fr.admin.templateNames[key]),
      })

      expect(radio).not.toHaveAccessibleName(new RegExp(fr.admin.templatePreviewSample))
      expect(radio).not.toHaveAccessibleDescription(new RegExp(fr.admin.templatePreviewSample))
    },
  )

  it('keeps five radios and no other control, with the pictures in', () => {
    renderPicker()

    expect(screen.getAllByRole('radio')).toHaveLength(TEMPLATE_KEYS.length + 1)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // Hidden from the tree altogether: not a list, not an image, not a heading.
    expect(within(screen.getByRole('group')).getAllByRole('list')).toHaveLength(
      TEMPLATE_KEYS.length,
    )
  })

  it('keeps the group usable by keyboard and each picture on its own card when the selection moves', async () => {
    render(<Controlled />)
    const before = Object.fromEntries(
      [...document.querySelectorAll('[data-template-preview]')].map((preview) => [
        preview.getAttribute('data-template-preview'),
        preview.outerHTML,
      ]),
    )

    // Tab lands on the checked radio — "Sans modèle" — and nothing in a miniature is a stop.
    await userEvent.tab()
    expect(screen.getByRole('radio', { name: new RegExp(fr.admin.templateNone) })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(
      screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames.wedding) }),
    ).toBeChecked()
    await userEvent.click(
      screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames.party) }),
    )

    expect(
      screen.getAllByRole('radio').filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(1)
    expect(
      screen.getByRole('radio', { name: new RegExp(fr.admin.templateNames.party) }),
    ).toBeChecked()
    // Choosing never repaints a card's picture: each one is about its own template.
    const after = Object.fromEntries(
      [...document.querySelectorAll('[data-template-preview]')].map((preview) => [
        preview.getAttribute('data-template-preview'),
        preview.outerHTML,
      ]),
    )
    expect(after).toEqual(before)
  })
})
