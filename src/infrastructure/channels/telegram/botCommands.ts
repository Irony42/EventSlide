/**
 * The command menu of the bot, in the five languages (spec 27): what Telegram shows when someone types "/" in a group.
 *
 * The names are the aliases `parseCommand` accepts (`src/domain/channels/inboundMessage.ts`): English by default, and
 * the language's own for a client set to French, German, Spanish or Italian. Every alias works in every group whatever
 * the menu showed, so a group that mixes languages is never wrong. Registered at bring-up (`setMyCommands`), so a
 * self-hoster's bot shows the right menu without a visit to BotFather.
 */

export interface BotCommandEntry {
  readonly command: string
  readonly description: string
}

export interface BotCommandMenu {
  /** `null` is the default scope: what a client in any other language sees. */
  readonly languageCode: string | null
  readonly commands: readonly BotCommandEntry[]
}

export const BOT_COMMAND_MENUS: readonly BotCommandMenu[] = [
  {
    languageCode: null,
    commands: [
      { command: 'event', description: 'Link this group to an event (followed by the code)' },
      { command: 'forget', description: 'Erase my photos from this event' },
      { command: 'privacy', description: 'What the bot keeps about you' },
    ],
  },
  {
    languageCode: 'fr',
    commands: [
      { command: 'soiree', description: 'Associer ce groupe à une soirée (suivi du code)' },
      { command: 'oublier', description: 'Effacer mes photos de cette soirée' },
      { command: 'confidentialite', description: 'Ce que le bot garde de vous' },
    ],
  },
  {
    languageCode: 'de',
    commands: [
      {
        command: 'feier',
        description: 'Diese Gruppe mit einer Veranstaltung verbinden (gefolgt vom Code)',
      },
      { command: 'vergessen', description: 'Meine Fotos dieser Veranstaltung löschen' },
      { command: 'datenschutz', description: 'Was der Bot über Sie speichert' },
    ],
  },
  {
    languageCode: 'es',
    commands: [
      { command: 'evento', description: 'Conectar este grupo con un evento (seguido del código)' },
      { command: 'olvidar', description: 'Borrar mis fotos de este evento' },
      { command: 'privacidad', description: 'Qué guarda el bot sobre usted' },
    ],
  },
  {
    languageCode: 'it',
    commands: [
      {
        command: 'evento',
        description: 'Collegare questo gruppo a un evento (seguito dal codice)',
      },
      { command: 'dimentica', description: 'Cancellare le mie foto di questo evento' },
      { command: 'privacy', description: 'Cosa conserva il bot su di Lei' },
    ],
  },
]
