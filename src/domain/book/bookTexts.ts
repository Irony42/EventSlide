import { EVENT_LANGUAGES, type EventLanguage } from '../events/eventLanguage'

/**
 * The words of the book itself (cover date, closing page), by language.
 *
 * Only the interface text of the PDF lives here. A title, a caption and a first name are
 * content and are never translated. The web cannot import `src/`, so the host dialog has its
 * own strings in `web/src/lib/i18n/`; a contract test pins this table's languages to
 * `EVENT_LANGUAGES`.
 */
export interface BookTexts {
  readonly createdWith: string
  readonly videosNotIncluded: (count: number) => string
  readonly months: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  readonly formatDate: (day: number, month: string, year: number) => string
}

export const BOOK_TEXTS: Readonly<Record<EventLanguage, BookTexts>> = {
  fr: {
    createdWith: 'Album créé avec EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 vidéo de cette soirée ne figure pas dans ce livre'
        : `${n} vidéos de cette soirée ne figurent pas dans ce livre`,
    months: [
      'janvier',
      'février',
      'mars',
      'avril',
      'mai',
      'juin',
      'juillet',
      'août',
      'septembre',
      'octobre',
      'novembre',
      'décembre',
    ],
    formatDate: (d, m, y) => `${d === 1 ? '1er' : d} ${m} ${y}`,
  },
  de: {
    createdWith: 'Album erstellt mit EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 Video dieses Abends ist in diesem Buch nicht enthalten'
        : `${n} Videos dieses Abends sind in diesem Buch nicht enthalten`,
    months: [
      'Januar',
      'Februar',
      'März',
      'April',
      'Mai',
      'Juni',
      'Juli',
      'August',
      'September',
      'Oktober',
      'November',
      'Dezember',
    ],
    formatDate: (d, m, y) => `${d}. ${m} ${y}`,
  },
  en: {
    createdWith: 'Album created with EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 video from this event is not in this book'
        : `${n} videos from this event are not in this book`,
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    formatDate: (d, m, y) => `${m} ${d}, ${y}`,
  },
  es: {
    createdWith: 'Álbum creado con EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 vídeo de esta fiesta no aparece en este libro'
        : `${n} vídeos de esta fiesta no aparecen en este libro`,
    months: [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ],
    formatDate: (d, m, y) => `${d} de ${m} de ${y}`,
  },
  it: {
    createdWith: 'Album creato con EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 video di questa serata non è in questo libro'
        : `${n} video di questa serata non sono in questo libro`,
    months: [
      'gennaio',
      'febbraio',
      'marzo',
      'aprile',
      'maggio',
      'giugno',
      'luglio',
      'agosto',
      'settembre',
      'ottobre',
      'novembre',
      'dicembre',
    ],
    formatDate: (d, m, y) => `${d} ${m} ${y}`,
  },
}

/** Every language of an event has a table; a language added to `EVENT_LANGUAGES` fails to compile here. */
export const BOOK_LANGUAGES: readonly EventLanguage[] = EVENT_LANGUAGES

/** The cover date in the book's language. Calendar fields are read in UTC: the instant is injected. */
export const formatBookDate = (at: Date, language: EventLanguage): string => {
  const texts = BOOK_TEXTS[language]
  return texts.formatDate(
    at.getUTCDate(),
    texts.months[at.getUTCMonth()] as string,
    at.getUTCFullYear(),
  )
}

/** The line about clips left out, or `null` when there are none. */
export const videosNoteFor = (count: number, language: EventLanguage): string | null =>
  count < 1 ? null : BOOK_TEXTS[language].videosNotIncluded(count)
