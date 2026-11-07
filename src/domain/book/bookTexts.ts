import { EVENT_LANGUAGES, type EventLanguage } from '../events/eventLanguage'

/**
 * The words of the book itself (closing page), by language.
 *
 * Only the interface text of the PDF lives here. A title, a caption and a first name are
 * content and are never translated. The web cannot import `src/`, so the host dialog has its
 * own strings in `web/src/lib/i18n/`; a contract test pins this table's languages to
 * `EVENT_LANGUAGES`.
 */
export interface BookTexts {
  readonly createdWith: string
  readonly videosNotIncluded: (count: number) => string
}

export const BOOK_TEXTS: Readonly<Record<EventLanguage, BookTexts>> = {
  fr: {
    createdWith: 'Album créé avec EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 vidéo de cette soirée ne figure pas dans ce livre'
        : `${n} vidéos de cette soirée ne figurent pas dans ce livre`,
  },
  de: {
    createdWith: 'Album erstellt mit EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 Video dieses Abends ist in diesem Buch nicht enthalten'
        : `${n} Videos dieses Abends sind in diesem Buch nicht enthalten`,
  },
  en: {
    createdWith: 'Album created with EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 video from this event is not in this book'
        : `${n} videos from this event are not in this book`,
  },
  es: {
    createdWith: 'Álbum creado con EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 vídeo de esta fiesta no aparece en este libro'
        : `${n} vídeos de esta fiesta no aparecen en este libro`,
  },
  it: {
    createdWith: 'Album creato con EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 video di questa serata non è in questo libro'
        : `${n} video di questa serata non sono in questo libro`,
  },
}

/** Every language of an event has a table; a language added to `EVENT_LANGUAGES` fails to compile here. */
export const BOOK_LANGUAGES: readonly EventLanguage[] = EVENT_LANGUAGES

/** The line about clips left out, or `null` when there are none. */
export const videosNoteFor = (count: number, language: EventLanguage): string | null =>
  count < 1 ? null : BOOK_TEXTS[language].videosNotIncluded(count)
