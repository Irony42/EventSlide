import { formattersFor } from './formatters'
import type { GuestTranslations } from './translations'

/**
 * Italian, for the guest surface.
 *
 * Only the sections a guest can read: `translations.ts` explains why the admin and
 * moderation consoles stay French, and the type on this table is what enforces it — a
 * host-facing section added here is an excess property and fails the build.
 *
 * Register: `Lei` in every sentence, sentence case, no exclamation marks. The app is the
 * host’s voice speaking to somebody else’s guest, so `tu` never addresses them. Control
 * labels are the bare imperative — `Riprova`, `Invia`, `Chiudi` — which an Italian
 * reader takes as the name of an action rather than as a form of address; it is the
 * same neutrality the French table gets from its infinitives. A recording is a `video`,
 * never the code’s word `clip`.
 *
 * Typography: accents are written out (`più`, `può`, `perché`), never an apostrophe
 * standing in for one; the apostrophe is U+2019 (’), never the ASCII one; quotation
 * marks are « … ».
 */

const t = formattersFor('it')

export const it: GuestTranslations = {
  app: {
    name: 'EventSlide',
    loading: 'Caricamento…',
    retry: 'Riprova',
    cancel: 'Annulla',
    close: 'Chiudi',
    save: 'Salva',
    back: 'Indietro',
    confirm: 'Conferma',
    language: 'Lingua',
  },

  join: {
    title: 'Entri nella galleria',
    codeLabel: 'Codice della serata',
    codeHint: 'Sei caratteri, indicati sul cartoncino o sul codice QR.',
    nameLabel: 'Il suo nome',
    nameHint: 'Apparirà sotto le sue foto. Può lasciarlo vuoto.',
    submit: 'Entra',
    submitting: 'Connessione…',
    welcome: (eventName: string) => `Benvenuti a ${eventName}`,
    anonymous: 'Resta anonimo',
  },

  upload: {
    title: 'Le sue foto',
    intro: 'Aggiunga le sue foto. Appariranno sullo schermo dopo l’approvazione.',
    addPhotos: 'Aggiungi delle foto',
    takePhoto: 'Scatta una foto',
    captionLabel: 'Didascalia',
    captionHint: (max: number) => `${t.number(max)} caratteri al massimo. Facoltativa.`,
    send: 'Invia',
    sending: 'Invio…',
    sendCount: (count: number) =>
      t.count(count, { one: 'Invia la foto', other: `Invia le ${t.number(count)} foto` }),
    queueEmpty: 'Nessuna foto selezionata al momento.',
    itemPending: 'In attesa',
    itemUploading: 'Invio in corso',
    itemDone: 'Inviata',
    itemDuplicate: 'Già inviata',
    itemFailed: 'Non inviata',
    remove: 'Rimuovi',
    mine: 'I suoi invii',
    statusPending: 'In attesa di approvazione',
    statusPublished: 'Sullo schermo',
    statusRejected: 'Non selezionata',
    statusHidden: 'Rimossa dallo schermo',
    deleteOwn: 'Elimina',
    deleteOwnConfirm: 'Eliminare questa foto? L’operazione è definitiva.',
    graceOver: 'Il tempo per eliminare personalmente questa foto è scaduto.',
    thanks: 'Grazie, le sue foto sono arrivate.',
    sendMore: 'Invia altre foto',

    itemPreparing: 'Preparazione…',
    queueLabel: 'Foto da inviare',
    queueSummary: (done: number, total: number) =>
      t.count(done, {
        one: `${t.number(done)} inviata su ${t.number(total)}`,
        other: `${t.number(done)} inviate su ${t.number(total)}`,
      }),
    queueFailed: (count: number) =>
      t.count(count, {
        one: 'Un invio non è riuscito.',
        other: `${t.number(count)} invii non sono riusciti.`,
      }),
    itemAlt: (position: number) => `Foto ${t.number(position)} da inviare`,
    itemProgress: (position: number) => `Invio della foto ${t.number(position)}`,
    removeItem: (position: number) => `Rimuovi la foto ${t.number(position)}`,
    retryItem: (position: number) => `Invia di nuovo la foto ${t.number(position)}`,
    captionRemaining: (remaining: number) =>
      t.count(remaining, {
        one: `${t.number(remaining)} carattere rimasto.`,
        other: `${t.number(remaining)} caratteri rimasti.`,
      }),
    signedAs: (name: string) => `Le sue foto appariranno con il nome ${name}.`,
    signedAnonymous: 'Le sue foto appariranno senza nome.',
    mineEmpty: 'Non ha ancora inviato nessuna foto.',
    mineFailed: 'Non è stato possibile mostrare i suoi invii. Riprovi.',
    mineAlt: 'La sua foto',
    deleteOwnNumbered: (position: number) => `Elimina la foto ${t.number(position)}`,
    notJoinedTitle: 'Entri nella galleria per inviare le sue foto',
    notJoinedHint: 'Scansioni di nuovo il codice QR, oppure inserisca il codice della serata.',
    notJoinedAction: 'Inserisci il codice',

    /* ---- Added by photo missions (ROADMAP 2.1). ---- */

    missionsTitle: 'Missioni',
    missionsHint: 'Tocchi una missione, poi invii la sua foto.',
    missionDone: 'Fatto',
    missionDoneByRoom: 'Già fotografata',
    missionFor: (prompt: string) => `Queste foto conteranno per «${prompt}».`,

    itemQueued: 'In attesa della rete',
    itemExpiredHint:
      'Non è stato possibile inviare questa foto. La invii di nuovo se ce l’ha ancora.',
    offlineTitle: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto è in attesa della rete`,
        other: `${t.number(count)} foto sono in attesa della rete`,
      }),
    offlineHint:
      'Sono salvate sul suo telefono e partiranno appena la connessione ritorna. Può chiudere questa pagina.',
    offlineSending: 'Invio delle foto in attesa…',
    offlineRetry: 'Invia ora',

    installTitle: 'Tenga la galleria a portata di mano',
    installHint:
      'Aggiunga la galleria alla schermata Home per ritrovarla più tardi, senza cercare il codice QR.',
    installIosHint: 'Apra il menu Condividi, poi scelga «Aggiungi a Home».',
    installAction: 'Aggiungi alla schermata Home',
    installDismiss: 'Nascondi questo suggerimento',

    clipSection: 'Video',
    addClip: 'Aggiungi un video',
    recordClip: 'Registra un video',
    clipHint: (seconds: number, megabytes: number) =>
      `${t.number(seconds)} secondi e ${t.number(megabytes)} MB al massimo. Il video viene riprodotto senza audio.`,
    clipSend: 'Invia il video',
    clipChange: 'Scegli un altro video',
    clipDiscard: 'Rimuovi questo video',
    clipCancel: 'Annulla l’invio',
    clipAlreadySent:
      'Questo video è già sul server. Verrà elaborato e poi proposto all’organizzatore.',
    clipChosen: 'Video pronto da inviare',
    clipSize: (megabytes: number) => `${t.number(megabytes)} MB`,
    clipTooLarge: (megabytes: number) =>
      `Questo video supera ${t.number(megabytes)} MB. Registri una sequenza più breve.`,
    clipTooLong: (seconds: number) =>
      `Questo video supera ${t.number(seconds)} secondi. Registri una sequenza più breve.`,
    clipNotAVideo: 'Questo file non è un video.',
    clipUploading: 'Invio del video…',
    clipQueued: 'In coda…',
    clipRunning: 'Elaborazione del video…',
    clipDone: 'Video inviato. Apparirà sullo schermo dopo l’approvazione.',
    clipProgress: 'Invio del video',
    clipQueueFullRetry: (seconds: number) =>
      seconds <= 1
        ? 'Molti video sono in elaborazione. Riprovi tra un istante.'
        : `Molti video sono in elaborazione. Riprovi tra ${t.number(seconds)} secondi.`,
    clipQueueFreed: 'La coda si è liberata. Può inviare di nuovo il video.',
    clipStillWorking:
      'L’elaborazione di questo video sta richiedendo più tempo del previsto. Ricarichi la pagina tra qualche minuto per sapere se è andata a buon fine.',
    clipNotQueued:
      'I video non restano in attesa sul suo telefono: sono troppo pesanti. Riprovi quando la connessione ritorna.',
    mineClipAlt: 'Il suo video',
    mineClipBadge: 'Video',
    mineClipLength: (seconds: number) => `Video · ${t.number(seconds)} s`,
  },

  ui: {
    dialogClose: 'Chiudi la finestra',
    notifications: 'Notifiche',
    dismissNotification: 'Nascondi questa notifica',
    percent: (value: number) => t.percent(value),
    optional: 'Facoltativo',
  },

  shell: {
    skipToContent: 'Vai al contenuto principale',
    sessionChecking: 'Verifica della sua sessione…',
    sessionFailed:
      'Non è stato possibile verificare la sua sessione. Controlli la rete, poi riprovi.',
    crashTitle: 'Questa schermata si è interrotta',
    crashHint: 'Non si è perso nulla: le sue foto sono sul server. Riprovi per continuare.',
    notFoundTitle: 'Pagina non trovata',
    notFoundHint:
      'Questo indirizzo non esiste. Controlli il link, oppure torni alla pagina iniziale.',
    notFoundHome: 'Torna alla pagina iniziale',
    comingSoon: 'Questa schermata arriverà presto.',
  },

  errors: {
    unknown: 'Si è verificato un errore. Riprovi tra un istante.',
    network: 'La connessione si è interrotta. Controlli la rete, poi riprovi.',
    'request.invalid': 'Le informazioni inviate non sono valide.',

    'auth.invalidCredentials': 'Indirizzo e-mail o password non corretti.',
    'auth.required': 'Acceda per continuare.',
    'auth.forbidden': 'Non ha i permessi per questa azione.',

    'event.notFound': 'Questo codice non corrisponde a nessuna galleria aperta.',
    'event.notAcceptingUploads': 'Questa galleria non accetta più foto.',
    'event.quotaExceeded': 'La galleria ha raggiunto la capacità massima. Avvisi l’organizzatore.',
    'event.slugTaken': 'Questo indirizzo è già in uso.',
    'event.immutable': 'Questo evento è archiviato e non può più essere modificato.',
    'event.illegalTransition': 'Questo cambio di stato non è possibile.',

    'guest.wrongEvent': 'Il suo accesso non corrisponde a questa galleria.',
    'guest.revoked': 'Il suo accesso è stato revocato dall’organizzatore.',
    'guestToken.expired': 'Il suo accesso è scaduto. Scansioni di nuovo il codice QR.',
    'guestToken.malformed': 'Il suo accesso non è più valido. Scansioni di nuovo il codice QR.',
    'guestToken.badSignature': 'Il suo accesso non è più valido. Scansioni di nuovo il codice QR.',

    'photo.notFound': 'Questa foto non esiste più.',
    'photo.illegalTransition': 'Questa azione non è possibile su questa foto.',
    'photo.tooManyForGuest': 'Ha raggiunto il numero di foto consentito.',

    'image.unsupportedFormat':
      'Questo file non è una foto. Formati accettati: JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'Questa foto sembra danneggiata. Ne provi un’altra.',
    'image.tooManyPixels': 'Questa foto è troppo grande. La riduca, poi riprovi.',
    'image.animated': 'Le immagini animate non sono accettate.',
    'image.renderFailed': 'Non è stato possibile elaborare questa foto. Ne provi un’altra.',
    'upload.tooLarge': 'Questa foto supera la dimensione massima.',
    'upload.tooManyFiles': 'Troppe foto in una volta sola. Le invii in più gruppi.',

    'caption.tooLong': 'Didascalia troppo lunga.',
    'caption.empty': 'La didascalia è vuota.',

    'password.tooShort': 'Password troppo corta.',
    'password.tooLong': 'Password troppo lunga.',
    'password.tooCommon': 'Questa password è troppo comune.',
    'password.sameAsEmail': 'La password non può essere il suo indirizzo e-mail.',
    'password.sameAsName': 'La password non può essere il suo nome.',
    'password.tooRepetitive': 'Questa password è troppo ripetitiva.',
    'password.unchanged': 'Scelga una password diversa da quella attuale.',
    'password.mismatch': 'Le due password non corrispondono.',

    'eventName.empty': 'Dia un nome al suo evento.',
    'eventName.tooShort': 'Questo nome è troppo corto.',
    'eventName.tooLong': 'Questo nome è troppo lungo.',
    'slug.tooShort': 'L’indirizzo deve avere almeno due caratteri.',
    'slug.tooLong': 'Questo indirizzo è troppo lungo.',
    'slug.malformed': 'L’indirizzo accetta solo lettere senza accento, cifre e trattini.',
    'slug.reserved': 'Questo indirizzo è riservato. Ne scelga un altro.',
    'eventSettings.graceSecondsInvalid': 'Questo tempo di eliminazione non è accettato.',
    'eventSettings.retentionDaysInvalid': 'Questo periodo di conservazione non è accettato.',
    'eventSettings.maxPhotosPerGuestInvalid': 'Questo numero di foto per invitato non è accettato.',
    'email.malformed': 'Questo indirizzo e-mail non è valido.',
    'user.notFound': 'Nessun account corrisponde a questo indirizzo e-mail.',
    'membership.alreadyExists': 'Questa persona modera già questo evento.',

    'displayName.tooLong': 'Nome troppo lungo.',
    'joinCode.wrongLength': 'Il codice è composto da sei caratteri.',
    'joinCode.malformed': 'Questo codice contiene un carattere non previsto.',

    'reaction.rateLimited': 'Con calma — attenda un istante prima di reagire di nuovo.',
    'rate.limited': 'Troppi tentativi. Attenda un istante.',

    'event.captionsNotAllowed': 'Le didascalie non sono attive per questa galleria.',
    'event.reactionsDisabled': 'Le reazioni non sono attive per questa galleria.',
    'event.guestSelfDeleteDisabled':
      'L’organizzatore non permette agli invitati di eliminare le proprie foto.',
    'photo.captionEditForbidden': 'Questa didascalia non può più essere modificata.',
    'photo.deleteForbidden': 'Non può più eliminare personalmente questa foto.',
    'reaction.alreadyExists': 'Ha già reagito così a questa foto.',
    'reaction.notPublished': 'Questa foto non è ancora sullo schermo.',
    'reaction.notFound': 'Questa reazione non esiste più.',
    'upload.noFiles': 'Non è stata ricevuta nessuna foto. Ne selezioni una, poi riprovi.',
    'upload.unexpectedField': 'Non è stato possibile leggere questo invio. Riprovi.',
    'request.csrfMissing': 'Questa pagina è scaduta. La ricarichi, poi riprovi.',
    'request.csrfMismatch': 'Questa pagina è scaduta. La ricarichi, poi riprovi.',

    'event.photoLimitReached': 'Ha raggiunto il numero di foto consentito.',
    'photo.pixelBudgetExceeded': 'Questa foto è troppo grande. La riduca, poi riprovi.',
    'upload.rejected': 'Non è stato possibile leggere questo invio. Riprovi.',
    'event.notModeratable': 'Questo evento è archiviato: le decisioni non si applicano più.',
    'membership.lastOwner': 'Un evento deve mantenere almeno un proprietario.',
    'membership.notFound': 'Questa persona non modera questo evento.',
    'guest.notFound': 'Questo invitato non è più nell’elenco. Aggiorni la pagina.',

    'event.scheduleOutOfOrder': 'La chiusura deve venire dopo l’apertura.',
    'event.scheduleInPast':
      'Questo orario è già passato. Controlli la data: per la fine della serata, scelga il giorno successivo.',
    'event.scheduleInvalid': 'Queste date non sono leggibili. Le scelga di nuovo.',

    'event.clipsNotAllowed': 'I video non sono attivi per questa galleria.',
    'clip.queueFull': 'Molti video sono in elaborazione. Riprovi tra un minuto.',
    'clip.transcoderUnavailable':
      'Questo server non può elaborare i video. Avvisi l’organizzatore.',
    'clip.unsupportedFormat': 'Questo file non è un video. Formati accettati: MP4, MOV, WebM.',
    'clip.corrupt': 'Questo video sembra danneggiato. Ne provi un altro.',
    'clip.noVideoStream': 'Questo file non contiene immagini. Ne provi un altro.',
    'clip.durationUnknown': 'La durata di questo video non è leggibile. Ne provi un altro.',
    'clip.tooShort': 'Questo video è troppo corto.',
    'clip.tooLong': 'Questo video è troppo lungo. Registri una sequenza più breve.',
    'clip.transcodeFailed': 'Non è stato possibile elaborare questo video. Ne provi un altro.',
    'clip.transcodeTimedOut': 'Questo video è troppo pesante da elaborare. Ne provi un altro.',
    'clip.storageFailed': 'Non è stato possibile salvare questo video. Riprovi.',
    'clip.sourceMissing': 'Questo video non è più disponibile. Lo invii di nuovo.',
    'clip.stageFailed': 'Non è stato possibile ricevere questo video. Riprovi.',
    'clip.abandoned': 'L’elaborazione di questo video è stata interrotta. Lo invii di nuovo.',
    'clip.sourceByteSizeInvalid': 'Questo file è vuoto. Ne scelga un altro.',
    'clip.transcodeCancelled':
      'L’elaborazione di questo video è stata interrotta. Riprenderà automaticamente.',
    'clip.probeUnreadable': 'Non è stato possibile analizzare questo video. Riprovi.',
    'clip.pixelBudgetExceeded':
      'Questo video è troppo grande. Registri a una risoluzione più bassa.',
    'clipJob.notFound': 'Questo video non esiste più.',
    'clipJob.illegalTransition': 'Questa azione non è possibile su questo video.',
    'photo.rangeNotSatisfiable': 'Questa parte del file non esiste.',

    /* ---- Added by photo missions (ROADMAP 2.1). ---- */
    'mission.notFound': 'Questa missione non esiste più. Ricarichi la pagina.',
    'mission.duplicate': 'Questa missione esiste già.',
    'mission.limitReached': 'Ha raggiunto il numero massimo di missioni.',
    'mission.promptEmpty': 'Scriva che cosa chiede la missione.',
    'mission.promptTooLong': 'Questo testo è troppo lungo per lo schermo.',
    'mission.promptInvalid': 'Questo testo non è valido.',

    'eventTheme.accentHueInvalid': 'Questo colore non è riconosciuto. Scegline uno dall’elenco.',
    'eventTheme.accentUnreadable':
      'Questo colore non sarebbe leggibile sullo schermo in sala. Scegline uno dall’elenco.',
    'eventTheme.accentTooCloseToStatus':
      'Questo colore somiglia troppo ai colori di stato dell’applicazione. Scegline un altro.',
  },
}
