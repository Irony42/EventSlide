import { formattersFor } from './formatters'
import type { UiText } from './translations'

/**
 * Italian, for every surface: the guest’s phone, the host’s and the moderators’
 * consoles, and the projected wall.
 *
 * The type on this table is `UiText` — the whole of `fr.ts`, every literal widened to
 * `string` — so a key added to the French table fails the build here until this one
 * carries it. `translations.ts` has the argument, including the guest-only one it
 * reversed.
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

export const it: UiText = {
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
    introImmediate: 'Aggiunga le sue foto. Appariranno subito sullo schermo.',
    noticeLink: 'Come vengono usate le sue foto',
    noticeTitle: 'Prima della sua prima foto',
    noticeChangedTitle: 'Queste informazioni sono cambiate',
    noticeChangedHint: 'L’organizzatore ha modificato un’impostazione dalla sua ultima lettura.',
    noticeAcknowledge: 'Ho capito',
    noticeWhatHappens: 'Cosa succede alle sue foto',
    noticeWhoSees: 'Chi vede le sue foto',
    noticeHowLong: 'Per quanto tempo vengono conservate',
    noticeRemoval: 'Come farne rimuovere una',
    noticeMetadataStripped:
      'La posizione e i dati del dispositivo vengono rimossi da ogni foto al suo arrivo.',
    noticePublication: {
      afterReview: 'L’organizzatore approva ogni foto prima che appaia sullo schermo.',
      immediate:
        'Appaiono sullo schermo appena arrivano. L’organizzatore può rimuovere qualsiasi foto in ogni momento.',
    },
    noticeAudiences: {
      wall: 'Chiunque guardi lo schermo dell’evento, in sala o tramite il suo link, una volta che la foto vi compare.',
      organisers:
        'L’organizzatore e il suo staff, che vedono tutto ciò che invia e possono scaricare le foto mostrate sullo schermo.',
    },
    noticeRetentionDays: (days: number) =>
      t.count(days, {
        one: `Vengono eliminate automaticamente ${t.number(days)} giorno dopo la chiusura della galleria.`,
        other: `Vengono eliminate automaticamente ${t.number(days)} giorni dopo la chiusura della galleria.`,
      }),
    noticeRetentionNone:
      'Non è prevista alcuna eliminazione automatica: restano finché l’organizzatore non le elimina.',
    noticeRemovalSeconds: (seconds: number) =>
      t.count(seconds, {
        one: `Può eliminarne una da sé entro ${t.number(seconds)} secondo dall’invio, finché non è stata approvata.`,
        other: `Può eliminarne una da sé entro ${t.number(seconds)} secondi dall’invio, finché non è stata approvata.`,
      }),
    noticeRemovalMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `Può eliminarne una da sé entro ${t.number(minutes)} minuto dall’invio, finché non è stata approvata.`,
        other: `Può eliminarne una da sé entro ${t.number(minutes)} minuti dall’invio, finché non è stata approvata.`,
      }),
    noticeRemovalHours: (hours: number) =>
      t.count(hours, {
        one: `Può eliminarne una da sé entro ${t.number(hours)} ora dall’invio, finché non è stata approvata.`,
        other: `Può eliminarne una da sé entro ${t.number(hours)} ore dall’invio, finché non è stata approvata.`,
      }),
    noticeRemovalOtherwise:
      'Altrimenti, lo chieda all’organizzatore: può eliminare qualsiasi foto.',
    noticeRemovalAskHost: 'Lo chieda all’organizzatore: può eliminare qualsiasi foto.',
    clipDoneImmediate: 'Video inviato. Sta per apparire sullo schermo.',
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
    'eventSettings.wallLanguageInvalid':
      'Questa lingua non è disponibile. Ne scelga una dall’elenco.',
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

  moderation: {
    title: 'Moderazione',
    intro: 'Nulla appare sullo schermo senza la sua approvazione.',
    pending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto in attesa`,
        other: `${t.number(count)} foto in attesa`,
      }),
    empty: 'Nulla da approvare al momento.',
    emptyHint: 'Le nuove foto arrivano qui automaticamente.',
    publish: 'Pubblica',
    reject: 'Rifiuta',
    hide: 'Rimuovi dallo schermo',
    undo: 'Annulla',
    undone: 'Decisione annullata.',
    selectAll: 'Seleziona tutto',
    clearSelection: 'Deseleziona tutto',
    bulkPublish: (count: number) => `Pubblica (${t.number(count)})`,
    bulkReject: (count: number) => `Rifiuta (${t.number(count)})`,
    bulkSkipped: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto ignorata: azione impossibile.`,
        other: `${t.number(count)} foto ignorate: azione impossibile.`,
      }),
    filterAll: 'Tutte',
    filterPending: 'In attesa',
    filterPublished: 'Sullo schermo',
    filterRejected: 'Rifiutate',
    filterHidden: 'Rimosse',
    by: (name: string) => `di ${name}`,
    byAnonymous: 'Invitato anonimo',
    shortcuts: 'Scorciatoie',
    shortcutsHint: 'J / K per navigare, P per pubblicare, R per rifiutare, Z per annullare.',
    shortcutsMore:
      'H per rimuovere dallo schermo, Spazio per selezionare, Esc per deselezionare tutto.',
    queueLabel: 'Foto da moderare',
    filterLabel: 'Filtra per stato',
    emptyFiltered: 'Nessuna foto in questa categoria.',
    emptyFilteredHint: 'Cambi filtro per vedere le altre foto.',
    loadFailed: 'Non è stato possibile caricare la coda di moderazione.',
    live: 'Aggiornamenti in diretta',
    liveLost: 'Connessione persa — nuovo tentativo in corso.',
    statePending: 'In attesa',
    statePublished: 'Pubblicata',
    stateRejected: 'Rifiutata',
    stateHidden: 'Rimossa dallo schermo',
    selected: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto selezionata`,
        other: `${t.number(count)} foto selezionate`,
      }),
    anonymousInName: 'un invitato anonimo',
    selectPhoto: (author: string) => `Seleziona la foto di ${author}`,
    publishPhoto: (author: string) => `Pubblica la foto di ${author}`,
    rejectPhoto: (author: string) => `Rifiuta la foto di ${author}`,
    hidePhoto: (author: string) => `Rimuovi dallo schermo la foto di ${author}`,
    enlargePhoto: (author: string) => `Ingrandisci la foto di ${author}`,
    photoOf: (author: string) => `Foto di ${author}`,
    photoAlt: (author: string) => `Foto inviata da ${author}`,
    photoAltWithCaption: (caption: string, author: string) =>
      `${caption} — foto inviata da ${author}`,
    previousPhoto: 'Foto precedente',
    nextPhoto: 'Foto successiva',
    bulkHide: (count: number) => `Rimuovi dallo schermo (${t.number(count)})`,
    published: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto pubblicata.`,
        other: `${t.number(count)} foto pubblicate.`,
      }),
    refused: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto rifiutata.`,
        other: `${t.number(count)} foto rifiutate.`,
      }),
    removed: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto rimossa dallo schermo.`,
        other: `${t.number(count)} foto rimosse dallo schermo.`,
      }),
    decisionFailed: 'Non è stato possibile registrare la decisione. Riprovi.',
    undoFailed: 'Non è stato possibile registrare l’annullamento. Riprovi.',
    dimensions: (width: number, height: number) => `${width} × ${height} pixel`,
    noCaption: 'Senza didascalia',
    videoBadge: 'Video',
    videoLength: (seconds: number) => `Video · ${seconds} s`,
    watchVideo: (author: string) => `Guarda il video di ${author}`,
    playVideo: (author: string) => `Riproduci il video di ${author}`,
    pauseVideo: (author: string) => `Metti in pausa il video di ${author}`,
    videoOf: (author: string) => `Video di ${author}`,
    videoAlt: (author: string) => `Video inviato da ${author}`,
    videoAltWithCaption: (caption: string, author: string) =>
      `${caption} — video inviato da ${author}`,
    videoMuted:
      'Non è stato possibile attivare l’audio: questo video viene riprodotto senza audio.',
    videoUnplayable:
      'Questo video non può essere riprodotto qui. Si vede solo l’immagine di anteprima.',
  },

  wall: {
    empty: 'Le prime foto stanno per arrivare',
    emptyHint: 'Scansioni il codice QR per inviare le sue foto.',
    joinPrompt: 'Entri nella galleria',
    reactions: 'Reazioni',
    offline: 'Connessione persa — nuovo tentativo in corso',
    paused: 'Presentazione in pausa',
    codeLabel: 'Codice della serata',
    qrTitle: 'Codice QR per entrare nella galleria',
    photoBy: (name: string) => `Foto inviata da ${name}`,
    photoByAnonymous: 'Foto inviata da un invitato',
    errorTitle: 'Non è stato possibile caricare le foto',
    errorHint: 'Nuovo tentativo in corso. Controlli la rete della sala se lo schermo resta vuoto.',
    dismissJoinCard: 'Nascondi il promemoria del codice',
    shortcuts: 'Scorciatoie da tastiera',
    shortcutsHint:
      'Spazio mette in pausa, le frecce cambiano foto, F passa a schermo intero, L cambia la disposizione.',
    layoutNames: {
      spotlight: 'Schermo intero',
      mosaic: 'Mosaico',
      polaroid: 'Polaroid',
      filmstrip: 'Pellicola',
      collage: 'Collage',
      split: 'Affiancate',
    },
    layoutOrder: (names: readonly string[]) => `Disposizioni, in ordine: ${names.join(', ')}.`,
    videoBy: (name: string) => `Video inviato da ${name}`,
    videoByAnonymous: 'Video inviato da un invitato',
    missionsTitle: 'Missioni',
    missionDone: 'Fatto',
    missionGuests: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} invitato`,
        other: `${t.number(count)} invitati`,
      }),
  },

  admin: {
    title: 'Amministrazione',
    events: 'I suoi eventi',
    newEvent: 'Nuovo evento',
    eventName: 'Nome dell’evento',
    eventNameHint: 'Visibile ai suoi invitati, per esempio «Camille & Sacha».',
    slug: 'Indirizzo',
    joinCode: 'Codice di accesso',
    rotateJoinCode: 'Cambia il codice',
    rotateJoinCodeHint:
      'Gli invitati già collegati restano collegati. Il nuovo codice sostituisce subito il precedente.',
    qrCode: 'Codice QR',
    qrCodeHint: 'Da stampare e mettere sui tavoli.',
    openWall: 'Apri lo schermo',
    openModeration: 'Modera',
    download: 'Scarica l’album',
    statusDraft: 'Bozza',
    statusLive: 'In corso',
    statusClosed: 'Terminato',
    statusArchived: 'Archiviato',
    goLive: 'Apri agli invitati',
    closeEvent: 'Chiudi l’evento',
    reopenEvent: 'Riapri',
    archiveEvent: 'Archivia',
    photos: (count: number) =>
      t.count(count, { one: `${t.number(count)} foto`, other: `${t.number(count)} foto` }),
    guests: (count: number) =>
      t.count(count, { one: `${t.number(count)} invitato`, other: `${t.number(count)} invitati` }),
    storageUsed: (used: string, total: string) => `${used} su ${total}`,
    settings: 'Impostazioni',
    moderationMode: 'Moderazione',
    moderationManual: 'Approva ogni foto',
    moderationAuto: 'Pubblica automaticamente',
    moderationAutoWarning:
      'Le foto e i video appariranno sullo schermo senza approvazione. Da riservare agli eventi tra amici e familiari.',
    allowCaptions: 'Consenti le didascalie',
    allowReactions: 'Consenti le reazioni',
    allowClips: 'Consenti i video',
    allowClipsHint:
      'Gli invitati possono inviare brevi video, oltre alle foto. Quando la casella non è selezionata, i video vengono rifiutati: perché l’ha deselezionata, perché il modello scelto alla creazione l’ha impostata così, oppure perché la galleria è anteriore a questa funzionalità. La selezioni per consentirli.',
    allowGuestSelfDelete: 'Consenti agli invitati di eliminare le proprie foto',
    wallLanguage: 'Lingua dello schermo in sala',
    wallLanguageHint:
      'Le parole dello schermo in sala: «Entri nella galleria», «Missioni», i messaggi di attesa. Quello che lei e i suoi invitati scrivono — il nome dell’evento, le didascalie, le consegne — appare così com’è e non viene mai tradotto. I suoi invitati scelgono la propria lingua sul telefono; questa impostazione non li riguarda.',
    theme: 'Aspetto',
    themeHint:
      'Visibile ai suoi invitati e sullo schermo in sala. I colori proposti restano leggibili a dieci metri.',
    themeAccent: 'Colore',
    themeAccentNames: {
      violet: 'Viola',
      rose: 'Rosa',
      azure: 'Blu',
      teal: 'Turchese',
    },
    themeFonts: 'Tipografia',
    themeFontsHint: 'Applicata solo allo schermo in sala.',
    themeFontsNames: {
      sans: 'Moderna',
      serif: 'Classica',
    },
    themeFrame: 'Cornice delle foto',
    themeFrameNames: {
      soft: 'Angoli arrotondati',
      square: 'Angoli vivi',
      round: 'Angoli molto arrotondati',
    },
    themeMaterial: 'Materiale dei pannelli',
    themeMaterialHint:
      'Il vetro lascia intravedere quello che passa sotto; la superficie piena è opaca. La differenza è discreta e riguarda solo la schermata di invio dei suoi invitati: la sua console di moderazione e lo schermo in sala non cambiano.',
    themeMaterialNames: {
      glass: 'Vetro smerigliato',
      plain: 'Superficie piena',
    },
    template: 'Tipo di evento',
    templateHint:
      'Un punto di partenza, adatto al tipo di serata. Tutte queste impostazioni restano modificabili in qualsiasi momento, prima e durante l’evento.',
    templateNone: 'Senza modello',
    templateNoneSummary:
      'Impostazioni predefinite: ogni foto approvata prima dello schermo, conservazione illimitata.',
    templateChanges: 'Questo modello imposta:',
    templateClipsOn: 'Video consentiti',
    templateClipsOff: 'Video disattivati',
    templateNames: {
      wedding: 'Matrimonio',
      birthday: 'Compleanno',
      conference: 'Conferenza',
      party: 'Festa',
    },

    retention: 'Eliminazione automatica',
    retentionNever: 'Mai',
    retentionDays: (days: number) =>
      t.count(days, {
        one: `${t.number(days)} giorno dopo la chiusura`,
        other: `${t.number(days)} giorni dopo la chiusura`,
      }),
    retentionUnlimited: 'Conservazione illimitata',
    moderators: 'Moderatori',
    inviteModerator: 'Invita un moderatore',

    loading: 'Caricamento dei suoi eventi…',
    loadFailed: 'Caricamento non riuscito',
    eventLoading: 'Caricamento dell’evento…',
    eventsEmpty: 'Nessun evento al momento.',
    eventsEmptyHint: 'Crei il suo primo evento, poi stampi il codice QR da mettere sui tavoli.',
    create: 'Crea l’evento',
    slugHint: 'Facoltativo. Lo lasci vuoto per ricavarlo dal nome.',
    slugPreviewLabel: 'Indirizzo della galleria',
    slugPreviewEmpty: 'Inserisca un nome per vedere l’indirizzo.',
    eventCreated: (name: string) => `${name} è pronto. Stampi il codice QR quando vuole.`,
    joinCodeHint: 'Da comunicare agli invitati che non possono scansionare il codice QR.',
    eventControls: 'Gestione dell’evento',
    joinLink: 'Link di invito',
    printQr: 'Stampa il codice QR',
    qrScanPrompt: 'Scansioni per inviare le sue foto.',
    qrAlt: (eventName: string) => `Codice QR di accesso a ${eventName}`,
    storageLabel: 'Spazio foto utilizzato',
    storage: (used: string) => `${used} utilizzati`,
    statusSaved: 'Il nuovo stato è stato salvato.',
    rotateJoinCodeTitle: 'Cambiare il codice di accesso?',
    codeRotated: 'Il codice di accesso è stato cambiato. Il precedente non funziona più.',
    settingsSaved: 'Impostazioni salvate.',
    settingsReadOnly:
      'Questo evento è archiviato: le sue impostazioni non possono più essere modificate.',
    retentionHint: 'Le foto vengono eliminate dopo questo intervallo dalla chiusura dell’evento.',
    selfDeleteGrace: 'Tempo per eliminare',
    selfDeleteGraceHint: 'Durante questo tempo un invitato può eliminare da sé la propria foto.',
    graceNone: 'Nessuno',
    graceSeconds: (seconds: number) =>
      t.count(seconds, {
        one: `${t.number(seconds)} secondo`,
        other: `${t.number(seconds)} secondi`,
      }),
    graceMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `${t.number(minutes)} minuto`,
        other: `${t.number(minutes)} minuti`,
      }),
    graceHours: (hours: number) =>
      t.count(hours, { one: `${t.number(hours)} ora`, other: `${t.number(hours)} ore` }),
    maxPhotosPerGuest: 'Foto per invitato',
    maxPhotosUnlimited: 'Senza limite',
    guestList: 'Invitati',
    guestsEmpty: 'Nessuno è ancora entrato nella galleria.',
    guestsEmptyHint: 'Gli invitati appaiono qui appena scansionano il codice QR.',
    lastSeen: (when: string) => `Ultima attività: ${when}`,
    dateUnknown: 'Data sconosciuta',
    guestRevokedBadge: 'Accesso revocato',
    revokeGuest: 'Revoca l’accesso',
    revokeGuestTitle: 'Revocare l’accesso a questo invitato?',
    revokeGuestHint:
      'Le sue foto già pubblicate restano sullo schermo, ma non potrà più inviarne altre.',
    guestRevoked: 'L’accesso è stato revocato.',
    moderatorsEmpty: 'È l’unica persona a moderare questo evento.',
    moderatorEmail: 'Indirizzo e-mail del moderatore',
    moderatorEmailHint: 'Riceverà i permessi solo su questo evento.',
    moderatorPassword: 'Password temporanea',
    moderatorPasswordHint: (min: number) =>
      `Almeno ${min} caratteri. Non viene inviata nessuna e-mail: comunichi questa password al moderatore. Ne sceglierà un’altra al primo accesso.`,
    inviteSubmit: 'Invita',
    moderatorInvited: (email: string) =>
      `${email} può ora moderare questo evento. Comunichi la password temporanea a questa persona.`,
    moderatorInvitedExisting: (email: string) =>
      `${email} può ora moderare questo evento. Questo account esisteva già: conserva la password abituale.`,
    revokeModerator: 'Rimuovi',
    revokeModeratorTitle: 'Rimuovere questo moderatore?',
    revokeModeratorHint: 'Perderà l’accesso a questo evento. Le decisioni già prese restano.',
    moderatorRevoked: 'Il moderatore è stato rimosso.',
    roleOwner: 'Organizzatore',
    roleModerator: 'Moderatore',
    lastOwnerHint: 'L’ultimo organizzatore non può essere rimosso.',
    purge: 'Elimina l’evento',
    purgeTitle: 'Eliminare definitivamente questo evento?',
    purgeWarning:
      'Tutte le foto, gli invitati e l’album saranno eliminati. L’operazione è definitiva.',
    purgeConfirmLabel: 'Indirizzo dell’evento',
    purgeConfirmHint: (slug: string) => `Inserisca «${slug}» per confermare l’eliminazione.`,
    purged: (name: string) => `${name} è stato eliminato.`,

    schedule: 'Apertura e chiusura automatiche',
    scheduleHint:
      'Lasci vuoto per aprire e chiudere di persona. Gli orari sono quelli del suo computer, quindi quelli del luogo della festa.',
    scheduleOpenAt: 'Apri agli invitati il',
    scheduleCloseAt: 'Chiudi l’evento il',
    scheduleCloseAtHint: 'Le foto e l’album restano: chiudere non cancella nulla.',
    scheduleSaved: 'La programmazione è stata salvata.',
    scheduleNone: 'Nessuna programmazione: apre e chiude di persona.',
    scheduleArmed: (opensAt: string, closesAt: string) =>
      `Apertura il ${opensAt}, chiusura il ${closesAt}.`,
    scheduleOpensOnly: (opensAt: string) => `Apertura il ${opensAt}. Chiuderà di persona.`,
    scheduleClosesOnly: (closesAt: string) => `Chiusura il ${closesAt}. Aprirà di persona.`,
    scheduleSave: 'Salva la programmazione',
    scheduleDiscarded: (when: string) =>
      `La programmazione automatica non è stata applicata il ${when}: in quel momento l’evento non poteva cambiare stato. È stata cancellata. Ne salvi una nuova se le serve.`,

    missionsTitle: 'Missioni',
    missionsHint:
      'Un breve elenco di consegne che i suoi invitati vedono come una lista di cose da fare e che lo schermo mostra in un angolo.',
    missionsEmpty: 'Nessuna missione al momento.',
    missionPrompt: 'Consegna',
    missionPromptHint: (max: number) =>
      `${t.number(max)} caratteri al massimo. Scritta nella lingua della serata: non viene tradotta.`,
    missionScope: 'Da completare',
    missionScopeGuest: 'Per invitato',
    missionScopeEvent: 'Una volta per la serata',
    missionScopeHint:
      'Per invitato: ognuno può completarla. Una volta: la prima foto approvata la spunta per tutti.',
    missionAdd: 'Aggiungi la missione',
    missionSave: 'Salva',
    missionCancel: 'Annulla',
    missionEditShort: 'Modifica',
    missionDeleteShort: 'Elimina',
    missionEdit: (prompt: string) => `Modifica «${prompt}»`,
    missionDelete: (prompt: string) => `Elimina «${prompt}»`,
    missionDeleteTitle: 'Eliminare questa missione?',
    missionDeleteAction: 'Elimina la missione',
    missionDeleteConfirm:
      'Le foto già inviate restano nell’album: semplicemente non conteranno più per questa missione.',
    missionAdded: 'La missione è stata aggiunta.',
    missionSaved: 'La missione è stata salvata.',
    missionDeleted: 'La missione è stata eliminata.',
    missionAnswered: (photos: number, guests: number) =>
      `${t.count(photos, {
        one: `${t.number(photos)} foto`,
        other: `${t.number(photos)} foto`,
      })}, ${t.count(guests, {
        one: `${t.number(guests)} invitato`,
        other: `${t.number(guests)} invitati`,
      })}`,
    missionUnanswered: 'Non ancora completata',
    missionsFull: (max: number) =>
      `${t.number(max)} missioni al massimo: è quello che mantiene l’elenco leggibile a dieci metri.`,
  },

  auth: {
    title: 'Accesso',
    email: 'Indirizzo e-mail',
    password: 'Password',
    submit: 'Accedi',
    submitting: 'Accesso…',
    logout: 'Esci',
    changePassword: 'Cambia password',
    currentPassword: 'Password attuale',
    newPassword: 'Nuova password',
    newPasswordHint: (min: number) =>
      `Almeno ${min} caratteri. Una frase è più sicura di una parola.`,
    confirmPassword: 'Conferma la nuova password',
    mustChangePassword: 'Scelga una password prima di continuare.',
    changePasswordIntro: 'Scelga una password che non usa altrove.',
    passwordSaved: 'Password salvata.',
  },

  mobileModeration: {
    title: 'Moderazione da telefono',
    intro: 'Trascini la foto verso destra per pubblicare, verso sinistra per rifiutare.',
    releaseToPublish: 'Rilasci per pubblicare',
    releaseToReject: 'Rilasci per rifiutare',
    nowDeciding: (photo: string) => `Foto da moderare. ${photo}`,
    undoLast: 'Annulla l’ultima decisione',
    undoUnavailable: 'Si può annullare solo una pubblicazione.',
  },
}
