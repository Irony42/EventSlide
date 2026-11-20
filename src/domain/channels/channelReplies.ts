import { DEFAULT_EVENT_LANGUAGE, type EventLanguage } from '../events/eventLanguage'

/**
 * What the bot says in a conversation (spec 27 §4.6): plain text in the five languages, no Markdown
 * (nothing to escape, and an event's name is content that may hold any character).
 *
 * The language is the **event's** (`wallLanguage`, the one a host chose for the evening), because a
 * group has no preference to read. A conversation that is not bound to an event yet (a wrong code, a
 * first `/soiree`) has none and is answered in {@link DEFAULT_EVENT_LANGUAGE}. French is written by hand
 * and the others follow it; the event's name and the notice's address are the only inserted values.
 */

/** Replies that carry nothing but their words. */
export const PLAIN_REASONS = [
  'notBound',
  'noCode',
  'unknownCode',
  'notAllowed',
  'eventNotOpen',
  'conversationBusy',
  'forgotten',
  'forgetAnonymous',
  'mediaTooLarge',
  'videoNotAccepted',
  'unsupportedFormat',
  'eventClosed',
  'quotaReached',
  'albumFull',
  'tooFast',
  'forgetFailed',
  'channelOff',
  'nowSeesMedia',
] as const

export type PlainReason = (typeof PLAIN_REASONS)[number]

export type BotReply =
  | { readonly reason: PlainReason }
  | {
      readonly reason: 'bound'
      readonly eventName: string
      readonly moderated: boolean
      readonly noticeUrl: string
      /** The bot cannot see this group's photographs (privacy mode, not an administrator): the reply says what to do. */
      readonly mediaBlind?: boolean
    }
  | { readonly reason: 'unbound'; readonly eventName: string }
  | { readonly reason: 'privacy'; readonly noticeUrl: string }

export type ReplyReason = BotReply['reason']

/** The refusals of a media, which a rude or careless group could provoke over and over. */
const THROTTLED: ReadonlySet<ReplyReason> = new Set<ReplyReason>([
  'mediaTooLarge',
  'videoNotAccepted',
  'unsupportedFormat',
  'eventClosed',
  'quotaReached',
  'albumFull',
  'tooFast',
  'channelOff',
])

/** One reply at most per (conversation, sender, reason) per hour. */
export const REPLY_COOLDOWN_MS = 60 * 60 * 1000

/** A command is always answered (somebody typed it); only the refusals of a media are rationed. */
export const isThrottled = (reason: ReplyReason): boolean => THROTTLED.has(reason)

export const replyKey = (conversationRef: string, senderRef: string, reason: ReplyReason): string =>
  `${conversationRef}\u0000${senderRef}\u0000${reason}`

/** Whether the bot may say it again, given when it last did (`null`: never). */
export const mayReply = (lastRepliedAt: Date | null, now: Date): boolean =>
  lastRepliedAt === null || now.getTime() - lastRepliedAt.getTime() >= REPLY_COOLDOWN_MS

/** The refusals a use case may meet, by the stable code of its `DomainError`. */
const REASON_OF_CODE: ReadonlyMap<string, PlainReason> = new Map([
  ['channel.unknownCode', 'unknownCode'],
  ['channel.notAllowed', 'notAllowed'],
  ['channel.eventNotOpen', 'eventNotOpen'],
  ['channel.alreadyBound', 'conversationBusy'],
  ['channel.mediaTooLarge', 'mediaTooLarge'],
  ['channel.videoNotAccepted', 'videoNotAccepted'],
  ['channel.unsupportedFormat', 'unsupportedFormat'],
  // What the photograph and clip pipelines refuse with (their codes are the contract of their own routes).
  ['event.photoLimitReached', 'quotaReached'],
  ['event.quotaExceeded', 'albumFull'],
  ['client.storageFull', 'albumFull'],
  ['event.notAcceptingUploads', 'eventClosed'],
  ['event.clipsNotAllowed', 'videoNotAccepted'],
  ['image.unsupportedFormat', 'unsupportedFormat'],
  ['image.animated', 'unsupportedFormat'],
  ['image.corrupt', 'unsupportedFormat'],
  ['clip.unsupportedFormat', 'unsupportedFormat'],
  ['clip.corrupt', 'unsupportedFormat'],
  ['clip.noVideoStream', 'unsupportedFormat'],
  ['clip.probeUnreadable', 'unsupportedFormat'],
  ['clip.tooLong', 'mediaTooLarge'],
  ['photo.pixelBudgetExceeded', 'mediaTooLarge'],
  ['clip.pixelBudgetExceeded', 'mediaTooLarge'],
  ['clip.queueFull', 'tooFast'],
])

/** The words for an error code, or `null` when the bot has nothing to say about it. */
export const replyReasonOfCode = (code: string): PlainReason | null =>
  REASON_OF_CODE.get(code) ?? null

interface Phrasebook {
  /** The paragraph added to the bound reply when the bot cannot see the group's photographs. */
  readonly blind: string
  readonly plain: Readonly<Record<PlainReason, string>>
  readonly bound: (eventName: string, moderated: boolean, noticeUrl: string) => string
  readonly unbound: (eventName: string) => string
  readonly privacy: (noticeUrl: string) => string
}

/**
 * French asks for a no-break space before `: ; ! ?` and inside « ». The phrases are typed with plain
 * spaces and normalised here, once, so that nobody has to type an invisible character.
 */
export const frenchTypography = (text: string): string =>
  text
    .replace(/ ([:;!?])/gu, ' $1')
    .replace(/« /gu, '« ')
    .replace(/ »/gu, ' »')

const FR: Phrasebook = {
  blind:
    'Attention : je ne vois pas encore les photos de ce groupe. Nommez-moi administrateur du groupe (aucun droit particulier n’est nécessaire), puis postez vos photos.',
  plain: {
    notBound:
      "Ce groupe n'est associé à aucune soirée. Envoyez /soiree suivi du code de la soirée.",
    noCode:
      'Il manque le code de la soirée : /soiree suivi du code, par exemple /soiree ABCD-1234.',
    unknownCode: "Je ne connais pas ce code. Vérifiez-le auprès de l'organisateur.",
    notAllowed: "L'envoi de photos par Telegram n'est pas activé pour cette soirée.",
    eventNotOpen: "Cette soirée n'accepte plus de photos pour le moment.",
    conversationBusy:
      "Ce groupe envoie déjà ses photos à une autre soirée, qui n'est pas terminée. L'organisateur peut le dissocier depuis EventSlide.",
    forgotten: "C'est fait, vos photos ont été retirées.",
    forgetAnonymous:
      "Un message envoyé au nom du groupe n'a pas d'auteur : je ne peux pas retirer ses photos. Écrivez depuis votre propre compte.",
    mediaTooLarge: 'Ce fichier est trop lourd pour être pris. Envoyez-le en plus léger.',
    videoNotAccepted: 'Les vidéos ne sont pas acceptées pour cette soirée, seulement les photos.',
    unsupportedFormat: "Ce format de fichier n'est pas pris : j'accepte les photos et les vidéos.",
    eventClosed: "La soirée est terminée, elle n'accepte plus de photos.",
    quotaReached: 'Vous avez envoyé le nombre maximal de photos pour cette soirée.',
    albumFull: "L'album de cette soirée est plein : il ne peut plus prendre de photos.",
    tooFast: 'Doucement : trop de fichiers à la fois, certains ne sont pas pris.',
    forgetFailed: "Je n'ai pas pu retirer vos photos pour le moment. Réessayez dans un instant.",
    nowSeesMedia: 'Merci, je vois maintenant les photos de ce groupe.',
    channelOff: "L'envoi de photos par Telegram a été désactivé pour cette soirée.",
  },
  // The typography is applied to the phrase, then the event's name and the address go in: what a host wrote is
  // never touched.
  bound: (eventName, moderated, noticeUrl) =>
    frenchTypography('Ce groupe envoie maintenant ses photos et vidéos à « ') +
    eventName +
    frenchTypography(
      ` ». ${
        moderated
          ? "Elles passent par l'organisateur avant d'apparaître."
          : 'Elles apparaissent directement sur le mur.'
      }\nPour retirer vos photos : /oublier\nCe qui est gardé et combien de temps : `,
    ) +
    noticeUrl,
  unbound: (eventName) =>
    frenchTypography("Ce groupe n'envoie plus de photos à « ") +
    eventName +
    frenchTypography(' ».'),
  privacy: (noticeUrl) => frenchTypography('Ce qui est gardé et combien de temps : ') + noticeUrl,
}

const EN: Phrasebook = {
  blind:
    'Careful: I cannot see the photos of this group yet. Make me an administrator of the group (no special right is needed), then post your photos.',
  plain: {
    notBound: 'This group is not linked to any event. Send /event followed by the event code.',
    noCode: 'The event code is missing: /event followed by the code, for example /event ABCD-1234.',
    unknownCode: 'I do not know this code. Please check it with the organiser.',
    notAllowed: 'Sending photos through Telegram is not turned on for this event.',
    eventNotOpen: 'This event is not accepting photos right now.',
    conversationBusy:
      'This group already sends its photos to another event that is not over. The organiser can unlink it from EventSlide.',
    forgotten: 'Done, your photos have been removed.',
    forgetAnonymous:
      'A message sent on behalf of the group has no author, so I cannot remove its photos. Write from your own account.',
    mediaTooLarge: 'This file is too big to be taken. Please send a lighter one.',
    videoNotAccepted: 'Videos are not accepted for this event, only photos.',
    unsupportedFormat: 'This file format is not supported: I accept photos and videos.',
    eventClosed: 'The event is over and no longer accepts photos.',
    quotaReached: 'You have sent the maximum number of photos for this event.',
    albumFull: 'The album of this event is full: it cannot take more photos.',
    tooFast: 'Slow down: too many files at once, some were not taken.',
    forgetFailed: 'I could not remove your photos just now. Please try again in a moment.',
    nowSeesMedia: 'Thank you, I can now see the photos of this group.',
    channelOff: 'Sending photos through Telegram has been turned off for this event.',
  },
  bound: (eventName, moderated, noticeUrl) =>
    `This group now sends its photos and videos to "${eventName}". ${
      moderated
        ? 'They go through the organiser before they appear.'
        : 'They appear on the wall right away.'
    }\nTo remove your photos: /forget\nWhat is kept and for how long: ${noticeUrl}`,
  unbound: (eventName) => `This group no longer sends photos to "${eventName}".`,
  privacy: (noticeUrl) => `What is kept and for how long: ${noticeUrl}`,
}

const DE: Phrasebook = {
  blind:
    'Achtung: Ich sehe die Fotos dieser Gruppe noch nicht. Mach mich zum Administrator der Gruppe (besondere Rechte sind nicht nötig) und poste dann deine Fotos.',
  plain: {
    notBound:
      'Diese Gruppe ist mit keiner Feier verbunden. Sende /feier und danach den Code der Feier.',
    noCode: 'Der Code der Feier fehlt: /feier und danach der Code, zum Beispiel /feier ABCD-1234.',
    unknownCode: 'Diesen Code kenne ich nicht. Bitte frage bei den Veranstaltenden nach.',
    notAllowed: 'Das Senden von Fotos über Telegram ist für diese Feier nicht aktiviert.',
    eventNotOpen: 'Diese Feier nimmt im Moment keine Fotos an.',
    conversationBusy:
      'Diese Gruppe sendet ihre Fotos schon an eine andere Feier, die noch nicht vorbei ist. Die Veranstaltenden können die Verbindung in EventSlide lösen.',
    forgotten: 'Erledigt, deine Fotos wurden entfernt.',
    forgetAnonymous:
      'Eine im Namen der Gruppe gesendete Nachricht hat keinen Absender, ich kann ihre Fotos nicht entfernen. Schreibe von deinem eigenen Konto aus.',
    mediaTooLarge: 'Diese Datei ist zu groß. Bitte sende eine kleinere.',
    videoNotAccepted: 'Videos werden für diese Feier nicht angenommen, nur Fotos.',
    unsupportedFormat: 'Dieses Dateiformat wird nicht angenommen: Ich nehme Fotos und Videos.',
    eventClosed: 'Die Feier ist vorbei und nimmt keine Fotos mehr an.',
    quotaReached: 'Du hast die Höchstzahl an Fotos für diese Feier erreicht.',
    albumFull: 'Das Album dieser Feier ist voll: es kann keine Fotos mehr aufnehmen.',
    tooFast: 'Langsam: zu viele Dateien auf einmal, einige wurden nicht übernommen.',
    forgetFailed:
      'Ich konnte deine Fotos gerade nicht entfernen. Bitte versuche es gleich noch einmal.',
    nowSeesMedia: 'Danke, ich sehe jetzt die Fotos dieser Gruppe.',
    channelOff: 'Das Senden von Fotos über Telegram wurde für diese Feier ausgeschaltet.',
  },
  bound: (eventName, moderated, noticeUrl) =>
    `Diese Gruppe sendet ihre Fotos und Videos jetzt an „${eventName}“. ${
      moderated
        ? 'Sie laufen erst über die Veranstaltenden, bevor sie erscheinen.'
        : 'Sie erscheinen sofort auf der Wand.'
    }\nUm deine Fotos zu entfernen: /vergessen\nWas gespeichert wird und wie lange: ${noticeUrl}`,
  unbound: (eventName) => `Diese Gruppe sendet keine Fotos mehr an „${eventName}“.`,
  privacy: (noticeUrl) => `Was gespeichert wird und wie lange: ${noticeUrl}`,
}

const ES: Phrasebook = {
  blind:
    'Atención: todavía no veo las fotos de este grupo. Nómbrame administrador del grupo (no hace falta ningún permiso especial) y luego publica tus fotos.',
  plain: {
    notBound:
      'Este grupo no está vinculado a ningún evento. Envía /evento seguido del código del evento.',
    noCode:
      'Falta el código del evento: /evento seguido del código, por ejemplo /evento ABCD-1234.',
    unknownCode: 'No conozco este código. Compruébalo con quien organiza.',
    notAllowed: 'El envío de fotos por Telegram no está activado para este evento.',
    eventNotOpen: 'Este evento no acepta fotos por ahora.',
    conversationBusy:
      'Este grupo ya envía sus fotos a otro evento que no ha terminado. Quien organiza puede desvincularlo desde EventSlide.',
    forgotten: 'Listo, se han retirado tus fotos.',
    forgetAnonymous:
      'Un mensaje enviado en nombre del grupo no tiene autor, así que no puedo retirar sus fotos. Escribe desde tu propia cuenta.',
    mediaTooLarge: 'Este archivo pesa demasiado. Envía uno más ligero.',
    videoNotAccepted: 'Los vídeos no se aceptan en este evento, solo las fotos.',
    unsupportedFormat: 'Este formato de archivo no se acepta: admito fotos y vídeos.',
    eventClosed: 'El evento ha terminado y ya no acepta fotos.',
    quotaReached: 'Has enviado el número máximo de fotos para este evento.',
    albumFull: 'El álbum de este evento está lleno: no puede recibir más fotos.',
    tooFast: 'Más despacio: demasiados archivos a la vez, algunos no se han recogido.',
    forgetFailed: 'No he podido retirar tus fotos ahora mismo. Inténtalo de nuevo en un momento.',
    nowSeesMedia: 'Gracias, ahora veo las fotos de este grupo.',
    channelOff: 'El envío de fotos por Telegram se ha desactivado para este evento.',
  },
  bound: (eventName, moderated, noticeUrl) =>
    `Este grupo envía ahora sus fotos y vídeos a «${eventName}». ${
      moderated
        ? 'Pasan por quien organiza antes de aparecer.'
        : 'Aparecen directamente en la pantalla.'
    }\nPara retirar tus fotos: /olvidar\nQué se guarda y durante cuánto tiempo: ${noticeUrl}`,
  unbound: (eventName) => `Este grupo ya no envía fotos a «${eventName}».`,
  privacy: (noticeUrl) => `Qué se guarda y durante cuánto tiempo: ${noticeUrl}`,
}

const IT: Phrasebook = {
  blind:
    'Attenzione: non vedo ancora le foto di questo gruppo. Nominami amministratore del gruppo (non serve alcun permesso particolare), poi pubblica le tue foto.',
  plain: {
    notBound:
      "Questo gruppo non è collegato a nessun evento. Invia /evento seguito dal codice dell'evento.",
    noCode:
      "Manca il codice dell'evento: /evento seguito dal codice, ad esempio /evento ABCD-1234.",
    unknownCode: 'Non conosco questo codice. Controllalo con chi organizza.',
    notAllowed: "L'invio di foto tramite Telegram non è attivo per questo evento.",
    eventNotOpen: 'Questo evento al momento non accetta foto.',
    conversationBusy:
      'Questo gruppo invia già le sue foto a un altro evento non ancora concluso. Chi organizza può scollegarlo da EventSlide.',
    forgotten: 'Fatto, le tue foto sono state rimosse.',
    forgetAnonymous:
      'Un messaggio inviato a nome del gruppo non ha un autore, quindi non posso rimuovere le sue foto. Scrivi dal tuo account.',
    mediaTooLarge: 'Questo file è troppo pesante. Inviane uno più leggero.',
    videoNotAccepted: 'I video non sono accettati per questo evento, solo le foto.',
    unsupportedFormat: 'Questo formato di file non è accettato: accetto foto e video.',
    eventClosed: "L'evento è finito e non accetta più foto.",
    quotaReached: 'Hai inviato il numero massimo di foto per questo evento.',
    albumFull: "L'album di questo evento è pieno: non può ricevere altre foto.",
    tooFast: 'Piano: troppi file insieme, alcuni non sono stati presi.',
    forgetFailed: 'Non sono riuscito a rimuovere le tue foto in questo momento. Riprova tra poco.',
    nowSeesMedia: 'Grazie, ora vedo le foto di questo gruppo.',
    channelOff: "L'invio di foto tramite Telegram è stato disattivato per questo evento.",
  },
  bound: (eventName, moderated, noticeUrl) =>
    `Questo gruppo ora invia le sue foto e i suoi video a «${eventName}». ${
      moderated ? 'Passano da chi organizza prima di comparire.' : 'Compaiono subito sullo schermo.'
    }\nPer rimuovere le tue foto: /dimentica\nCosa viene conservato e per quanto tempo: ${noticeUrl}`,
  unbound: (eventName) => `Questo gruppo non invia più foto a «${eventName}».`,
  privacy: (noticeUrl) => `Cosa viene conservato e per quanto tempo: ${noticeUrl}`,
}

const PHRASEBOOKS: Readonly<Record<EventLanguage, Phrasebook>> = {
  fr: {
    blind: frenchTypography(FR.blind),
    plain: Object.fromEntries(
      Object.entries(FR.plain).map(([reason, text]) => [reason, frenchTypography(text)]),
    ) as Record<PlainReason, string>,
    bound: FR.bound,
    unbound: FR.unbound,
    privacy: FR.privacy,
  },
  en: EN,
  de: DE,
  es: ES,
  it: IT,
}

/** The longest event name quoted in a reply, so no message can come near the 4096 characters a chat takes. */
export const MAX_QUOTED_NAME = 80

const quoted = (eventName: string): string => {
  const letters = [...eventName]
  return letters.length <= MAX_QUOTED_NAME
    ? eventName
    : `${letters.slice(0, MAX_QUOTED_NAME).join('')}…`
}

/** The bot's words for a reply, in the event's language (`null`: not bound yet, so French). */
export const renderReply = (reply: BotReply, language: EventLanguage | null): string => {
  const book = PHRASEBOOKS[language ?? DEFAULT_EVENT_LANGUAGE]
  switch (reply.reason) {
    case 'bound':
      return reply.mediaBlind === true
        ? `${book.bound(quoted(reply.eventName), reply.moderated, reply.noticeUrl)}\n\n${book.blind}`
        : book.bound(quoted(reply.eventName), reply.moderated, reply.noticeUrl)
    case 'unbound':
      return book.unbound(quoted(reply.eventName))
    case 'privacy':
      return book.privacy(reply.noticeUrl)
    default:
      return book.plain[reply.reason]
  }
}
