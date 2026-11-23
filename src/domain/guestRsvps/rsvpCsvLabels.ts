import type { EventLanguage } from '../events/eventLanguage'
import type { RsvpCsvLabels } from './rsvpCsv'

/**
 * The words of the replies spreadsheet, in the language of the invitation (spec 30). The file is
 * the host's to read, and it is written in the language the guests were asked in. These are
 * interface, not content: what guests wrote (names, diets, words) is never translated.
 */
export const RSVP_CSV_LABELS: Readonly<Record<EventLanguage, RsvpCsvLabels>> = {
  fr: {
    name: 'Nom',
    answer: 'Réponse',
    adults: 'Adultes',
    kids: 'Enfants',
    companions: 'Accompagnants',
    meals: 'Menus',
    diet: 'Allergies ou régime',
    message: 'Message',
    source: 'Origine',
    updatedAt: 'Modifiée le',
    answers: { yes: 'Oui', maybe: 'Peut-être', no: 'Non', waitlist: "Liste d'attente" },
    sources: { open: 'Lien commun', household: 'Lien du foyer', host: 'Saisie par l’hôte' },
  },
  en: {
    name: 'Name',
    answer: 'Answer',
    adults: 'Adults',
    kids: 'Children',
    companions: 'Companions',
    meals: 'Meals',
    diet: 'Allergies or diet',
    message: 'Message',
    source: 'Source',
    updatedAt: 'Changed on',
    answers: { yes: 'Yes', maybe: 'Maybe', no: 'No', waitlist: 'Waiting list' },
    sources: { open: 'Shared link', household: 'Household link', host: 'Entered by the host' },
  },
  de: {
    name: 'Name',
    answer: 'Antwort',
    adults: 'Erwachsene',
    kids: 'Kinder',
    companions: 'Begleitung',
    meals: 'Menüs',
    diet: 'Allergien oder Ernährung',
    message: 'Nachricht',
    source: 'Herkunft',
    updatedAt: 'Geändert am',
    answers: { yes: 'Ja', maybe: 'Vielleicht', no: 'Nein', waitlist: 'Warteliste' },
    sources: {
      open: 'Gemeinsamer Link',
      household: 'Haushaltslink',
      host: 'Vom Gastgeber erfasst',
    },
  },
  es: {
    name: 'Nombre',
    answer: 'Respuesta',
    adults: 'Adultos',
    kids: 'Niños',
    companions: 'Acompañantes',
    meals: 'Menús',
    diet: 'Alergias o dieta',
    message: 'Mensaje',
    source: 'Origen',
    updatedAt: 'Modificada el',
    answers: { yes: 'Sí', maybe: 'Quizás', no: 'No', waitlist: 'Lista de espera' },
    sources: {
      open: 'Enlace común',
      household: 'Enlace del hogar',
      host: 'Anotada por el anfitrión',
    },
  },
  it: {
    name: 'Nome',
    answer: 'Risposta',
    adults: 'Adulti',
    kids: 'Bambini',
    companions: 'Accompagnatori',
    meals: 'Menu',
    diet: 'Allergie o dieta',
    message: 'Messaggio',
    source: 'Origine',
    updatedAt: 'Modificata il',
    answers: { yes: 'Sì', maybe: 'Forse', no: 'No', waitlist: 'Lista d’attesa' },
    sources: { open: 'Link comune', household: 'Link del nucleo', host: 'Inserita dall’ospite' },
  },
}
