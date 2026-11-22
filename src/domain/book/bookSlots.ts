import type { BookStyleDef } from './bookStyles'
import { BOOK_TEMPLATES, type TemplateId, type TemplateSlot } from './bookTemplates'

/**
 * The slot a template gives a photograph in a style: `full` is a `single` in Classique and inset in
 * Souvenir, and the grids of a style that bleeds (Magazine) have hairline gutters, each cell growing
 * by 0.7 % on every side. In percent of the cut page (a double page for `wide`).
 *
 * Shared by the PDF drawing and by the host's preview, so a photograph sits where the book puts it.
 */
export const slotForStyle = (
  style: Pick<BookStyleDef, 'id' | 'fullBleed'>,
  template: TemplateId,
  index: number,
): TemplateSlot => {
  if (template === 'full' && style.id === 'classique') return BOOK_TEMPLATES.single.slots[0]!
  if (template === 'full' && style.id === 'souvenir') {
    return { x: 8, y: 8, w: 84, h: 84, role: 'hero' }
  }
  const slot = BOOK_TEMPLATES[template].slots[index]!
  if (style.fullBleed && BOOK_TEMPLATES[template].slots.length > 1 && template !== 'favourites') {
    return { ...slot, x: slot.x - 0.7, y: slot.y - 0.7, w: slot.w + 1.4, h: slot.h + 1.4 }
  }
  return slot
}

/** Is the photograph of this slot contained whole (never cropped) rather than filling it? */
export const isContained = (
  style: Pick<BookStyleDef, 'id'>,
  template: TemplateId,
  slot: TemplateSlot,
): boolean => slot.contain === true || (template === 'full' && style.id === 'classique')
