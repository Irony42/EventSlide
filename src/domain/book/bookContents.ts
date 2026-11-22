import type { EventLanguage } from '../events/eventLanguage'
import { chapterTitleText } from './bookChapters'
import type { BookPlan } from './bookPlan'
import { BOOK_TEXTS } from './bookTexts'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

/** The numeral that opens a chapter: Roman up to eight chapters (the ceiling), else the number. */
export const chapterNumeral = (index: number): string => ROMAN[index] ?? String(index + 1)

/** One line of the contents page: its label and the page number it points at. */
export interface ContentsEntry {
  readonly label: string
  readonly page: number
}

/**
 * The lines of the contents page: the chapters, then the favourites and the guest book when the plan
 * has them. Shared by the PDF drawing and by the host's preview, so both list the same thing.
 */
export const contentsEntries = (
  plan: BookPlan,
  language: EventLanguage,
): readonly ContentsEntry[] => {
  const texts = BOOK_TEXTS[language]
  const lines: ContentsEntry[] = plan.chapters.map((chapter) => ({
    label: `${chapterNumeral(chapter.index)} · ${chapterTitleText(chapter.title, language)}`,
    page: chapter.firstPage,
  }))
  if (plan.favouritesPage !== null) {
    lines.push({ label: texts.favourites, page: plan.favouritesPage })
  }
  if (plan.guestbookPage !== null) {
    lines.push({ label: texts.guestbook, page: plan.guestbookPage })
  }
  return lines
}
