import { EVENT_LANGUAGES, type EventLanguage } from '../events/eventLanguage'
import type { DayMoment } from './bookTime'

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
  /** Chapter titles by moment of the day: `title` alone, `inline` after a weekday. */
  readonly moments: Readonly<Record<DayMoment, { readonly title: string; readonly inline: string }>>
  /** Sunday first. */
  readonly weekdays: readonly string[]
  readonly withDay: (weekday: string, inlineMoment: string) => string
  readonly continued: (title: string) => string
  readonly timeRange: (from: string, to: string) => string
  readonly photoCount: (count: number) => string
  readonly contents: string
  readonly statsTitle: string
  readonly statPhotos: string
  readonly statPhotographers: string
  readonly statHearts: string
  readonly statMessages: string
  readonly favourites: string
  readonly guestbook: string
  readonly thanksTo: (photographers: number) => string
  readonly thanksAnonymous: (photographers: number) => string
  readonly extraMessages: (count: number) => string
  readonly voicesNotIncluded: (count: number) => string
  readonly mission: (prompt: string) => string
}

export const BOOK_TEXTS: Readonly<Record<EventLanguage, BookTexts>> = {
  fr: {
    createdWith: 'Album créé avec EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 vidéo de cette soirée ne figure pas dans ce livre'
        : `${n} vidéos de cette soirée ne figurent pas dans ce livre`,
    moments: {
      morning: { title: 'Le matin', inline: 'le matin' },
      afternoon: { title: "L'après-midi", inline: "l'après-midi" },
      evening: { title: 'La soirée', inline: 'la soirée' },
      night: { title: 'La nuit', inline: 'la nuit' },
    },
    weekdays: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
    withDay: (weekday, inlineMoment) => `${weekday}, ${inlineMoment}`,
    continued: (title) => `${title}, suite`,
    timeRange: (from, to) => `de ${from} à ${to}`,
    photoCount: (n) => (n === 1 ? '1 photo' : `${n} photos`),
    contents: 'Sommaire',
    statsTitle: 'La soirée en chiffres',
    statPhotos: 'photos partagées',
    statPhotographers: 'photographes',
    statHearts: 'cœurs envoyés',
    statMessages: "mots dans le livre d'or",
    favourites: 'Les coups de cœur',
    guestbook: "Le livre d'or",
    thanksTo: (n) => `Merci à nos ${n} photographes`,
    thanksAnonymous: (n) => `Merci aux ${n} photographes de la soirée`,
    extraMessages: (n) =>
      n === 1
        ? "1 autre mot du livre d'or est dans l'export de l'album"
        : `${n} autres mots du livre d'or sont dans l'export de l'album`,
    voicesNotIncluded: (n) =>
      n === 1
        ? 'Un message vocal ne peut pas figurer dans un livre'
        : `${n} messages vocaux ne peuvent pas figurer dans un livre`,
    mission: (prompt) => `Mission\u00a0: ${prompt}`,
  },
  de: {
    createdWith: 'Album erstellt mit EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 Video dieses Abends ist in diesem Buch nicht enthalten'
        : `${n} Videos dieses Abends sind in diesem Buch nicht enthalten`,
    moments: {
      morning: { title: 'Der Morgen', inline: 'am Morgen' },
      afternoon: { title: 'Der Nachmittag', inline: 'am Nachmittag' },
      evening: { title: 'Der Abend', inline: 'am Abend' },
      night: { title: 'Die Nacht', inline: 'in der Nacht' },
    },
    weekdays: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
    withDay: (weekday, inlineMoment) => `${weekday}, ${inlineMoment}`,
    continued: (title) => `${title}, Fortsetzung`,
    timeRange: (from, to) => `von ${from} bis ${to} Uhr`,
    photoCount: (n) => (n === 1 ? '1 Foto' : `${n} Fotos`),
    contents: 'Inhalt',
    statsTitle: 'Der Abend in Zahlen',
    statPhotos: 'geteilte Fotos',
    statPhotographers: 'Fotografen',
    statHearts: 'gesendete Herzen',
    statMessages: 'Einträge im Gästebuch',
    favourites: 'Die Lieblingsfotos',
    guestbook: 'Das Gästebuch',
    thanksTo: (n) => `Danke an unsere ${n} Fotografen`,
    thanksAnonymous: (n) => `Danke an die ${n} Fotografen des Abends`,
    extraMessages: (n) =>
      n === 1
        ? 'Ein weiterer Gästebucheintrag steht im Export des Albums'
        : `${n} weitere Gästebucheinträge stehen im Export des Albums`,
    voicesNotIncluded: (n) =>
      n === 1
        ? 'Eine Sprachnachricht kann nicht in einem Buch stehen'
        : `${n} Sprachnachrichten können nicht in einem Buch stehen`,
    mission: (prompt) => `Mission: ${prompt}`,
  },
  en: {
    createdWith: 'Album created with EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 video from this event is not in this book'
        : `${n} videos from this event are not in this book`,
    moments: {
      morning: { title: 'Morning', inline: 'morning' },
      afternoon: { title: 'Afternoon', inline: 'afternoon' },
      evening: { title: 'Evening', inline: 'evening' },
      night: { title: 'Night', inline: 'night' },
    },
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    withDay: (weekday, inlineMoment) => `${weekday} ${inlineMoment}`,
    continued: (title) => `${title}, continued`,
    timeRange: (from, to) => `from ${from} to ${to}`,
    photoCount: (n) => (n === 1 ? '1 photo' : `${n} photos`),
    contents: 'Contents',
    statsTitle: 'The evening in numbers',
    statPhotos: 'photos shared',
    statPhotographers: 'photographers',
    statHearts: 'hearts sent',
    statMessages: 'guest book messages',
    favourites: 'Favourites',
    guestbook: 'The guest book',
    thanksTo: (n) => `Thank you to our ${n} photographers`,
    thanksAnonymous: (n) => `Thank you to the ${n} photographers of the evening`,
    extraMessages: (n) =>
      n === 1
        ? '1 more guest book message is in the album export'
        : `${n} more guest book messages are in the album export`,
    voicesNotIncluded: (n) =>
      n === 1
        ? 'A voice message cannot be part of a book'
        : `${n} voice messages cannot be part of a book`,
    mission: (prompt) => `Mission: ${prompt}`,
  },
  es: {
    createdWith: 'Álbum creado con EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 vídeo de esta fiesta no aparece en este libro'
        : `${n} vídeos de esta fiesta no aparecen en este libro`,
    moments: {
      morning: { title: 'La mañana', inline: 'la mañana' },
      afternoon: { title: 'La tarde', inline: 'la tarde' },
      evening: { title: 'La noche', inline: 'la noche' },
      night: { title: 'La madrugada', inline: 'la madrugada' },
    },
    weekdays: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
    withDay: (weekday, inlineMoment) => `${weekday}, ${inlineMoment}`,
    continued: (title) => `${title}, continuación`,
    timeRange: (from, to) => `de ${from} a ${to}`,
    photoCount: (n) => (n === 1 ? '1 foto' : `${n} fotos`),
    contents: 'Índice',
    statsTitle: 'La fiesta en cifras',
    statPhotos: 'fotos compartidas',
    statPhotographers: 'fotógrafos',
    statHearts: 'corazones enviados',
    statMessages: 'mensajes en el libro de visitas',
    favourites: 'Los favoritos',
    guestbook: 'El libro de visitas',
    thanksTo: (n) => `Gracias a nuestros ${n} fotógrafos`,
    thanksAnonymous: (n) => `Gracias a los ${n} fotógrafos de la fiesta`,
    extraMessages: (n) =>
      n === 1
        ? 'Otro mensaje del libro de visitas está en la exportación del álbum'
        : `${n} mensajes más del libro de visitas están en la exportación del álbum`,
    voicesNotIncluded: (n) =>
      n === 1
        ? 'Un mensaje de voz no puede figurar en un libro'
        : `${n} mensajes de voz no pueden figurar en un libro`,
    mission: (prompt) => `Misión: ${prompt}`,
  },
  it: {
    createdWith: 'Album creato con EventSlide',
    videosNotIncluded: (n) =>
      n === 1
        ? '1 video di questa serata non è in questo libro'
        : `${n} video di questa serata non sono in questo libro`,
    moments: {
      morning: { title: 'La mattina', inline: 'la mattina' },
      afternoon: { title: 'Il pomeriggio', inline: 'il pomeriggio' },
      evening: { title: 'La sera', inline: 'la sera' },
      night: { title: 'La notte', inline: 'la notte' },
    },
    weekdays: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'],
    withDay: (weekday, inlineMoment) => `${weekday}, ${inlineMoment}`,
    continued: (title) => `${title}, continua`,
    timeRange: (from, to) => `dalle ${from} alle ${to}`,
    photoCount: (n) => (n === 1 ? '1 foto' : `${n} foto`),
    contents: 'Indice',
    statsTitle: 'La serata in numeri',
    statPhotos: 'foto condivise',
    statPhotographers: 'fotografi',
    statHearts: 'cuori inviati',
    statMessages: 'messaggi nel libro degli ospiti',
    favourites: 'I preferiti',
    guestbook: 'Il libro degli ospiti',
    thanksTo: (n) => `Grazie ai nostri ${n} fotografi`,
    thanksAnonymous: (n) => `Grazie ai ${n} fotografi della serata`,
    extraMessages: (n) =>
      n === 1
        ? "Un altro messaggio del libro degli ospiti è nell'esportazione dell'album"
        : `${n} altri messaggi del libro degli ospiti sono nell'esportazione dell'album`,
    voicesNotIncluded: (n) =>
      n === 1
        ? 'Un messaggio vocale non può far parte di un libro'
        : `${n} messaggi vocali non possono far parte di un libro`,
    mission: (prompt) => `Missione: ${prompt}`,
  },
}

/** Every language of an event has a table; a language added to `EVENT_LANGUAGES` fails to compile here. */
export const BOOK_LANGUAGES: readonly EventLanguage[] = EVENT_LANGUAGES

/** The line about clips left out, or `null` when there are none. */
export const videosNoteFor = (count: number, language: EventLanguage): string | null =>
  count < 1 ? null : BOOK_TEXTS[language].videosNotIncluded(count)
