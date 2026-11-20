import { BOOK_TEMPLATES } from '../../../../domain/book/bookTemplates'
import { AUTHOR_LINE, MESSAGE_FONT_SIZE, TRIM_PT } from '../drawBook'

/**
 * Does a message of this text fit the box of a `messages` page at this size, the first name under
 * it kept? A test helper: the renderer shrinks nothing, so a message that does not fit is cut, and
 * this is how the test knows it will not be.
 */
export const messageFits = (
  doc: PDFKit.PDFDocument,
  font: string,
  text: string,
  size: number = MESSAGE_FONT_SIZE,
): boolean => {
  const box = BOOK_TEMPLATES.messages.texts[0]!
  doc.font(font).fontSize(size)
  const height = doc.heightOfString(text, { width: (box.w / 100) * TRIM_PT, lineGap: 1 })
  return height <= (box.h / 100) * TRIM_PT - AUTHOR_LINE
}
