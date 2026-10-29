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
    loadFailed: 'Caricamento non riuscito',
    retry: 'Riprova',
    cancel: 'Annulla',
    close: 'Chiudi',
    save: 'Salva',
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
    /* Navigation pass, batch A: leaving a wrong event, a code that opens nothing, the way to the organiser area. */
    notYourEvening: 'Non è la sua festa?',
    notOpenHint:
      'Se ha scansionato un codice QR, la galleria potrebbe non essere ancora aperta o la festa potrebbe essere finita. Riprovi tra un momento o chieda agli organizzatori.',
    organiserLink: 'Area organizzatori',
  },

  upload: {
    intro: 'Aggiunga le sue foto. Appariranno sullo schermo dopo l’approvazione.',
    addPhotos: 'Aggiungi delle foto',
    takePhoto: 'Scatta una foto',
    captionLabel: 'Didascalia',
    captionHint: (max: number) => `${t.number(max)} caratteri al massimo. Facoltativa.`,
    send: 'Invia',
    sendCount: (count: number) =>
      t.count(count, { one: 'Invia la foto', other: `Invia le ${t.number(count)} foto` }),
    queueEmpty: 'Nessuna foto selezionata al momento.',
    itemPending: 'In attesa',
    itemUploading: 'Invio in corso',
    itemDone: 'Inviata',
    itemDuplicate: 'Già inviata',
    itemFailed: 'Non inviata',
    mine: 'I suoi invii',
    statusPending: 'In attesa di approvazione',
    statusPublished: 'Sullo schermo',
    statusRejected: 'Non selezionata',
    statusHidden: 'Rimossa dallo schermo',
    deleteOwn: 'Elimina',
    deleteOwnConfirm: 'Eliminare questa foto? L’operazione è definitiva.',
    thanks: 'Grazie, le sue foto sono arrivate.',

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
    mineFailed: 'Non è stato possibile aggiornare l’elenco dei suoi invii. Riprovi.',
    mineAlt: 'La sua foto',
    deleteOwnNumbered: (position: number) => `Elimina la foto ${t.number(position)}`,
    notJoinedTitle: 'Entri nella galleria per inviare le sue foto',
    notJoinedHint: 'Scansioni di nuovo il codice QR, oppure inserisca il codice della serata.',
    notJoinedAction: 'Inserisci il codice',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    galleryUnavailable: 'Questa galleria non è più disponibile. Non può più inviare foto.',
    galleryUnavailableAction: 'Inserisci di nuovo il codice',

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
      sharedGallery:
        'Le persone a cui l’organizzatore invia un link privato all’album, se ne crea uno, e quelle a cui il link viene inoltrato: possono vedere e scaricare in piena risoluzione le foto mostrate sullo schermo, finché il link non scade o viene ritirato.',
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

    /* ---- Added by guest reactions. ---- */

    reactionKinds: {
      love: 'Adoro',
      laugh: 'Ahah',
      wow: 'Wow',
      cheers: 'Cin cin',
      clap: 'Applausi',
    },
    reactionsGroup: (position: number) => `Reagisci alla foto ${t.number(position)}`,
    reactionsFailed: 'Non è stato possibile caricare le reazioni.',
  },

  ui: {
    dialogClose: 'Chiudi la finestra',
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
    /* Navigation pass, batch B: the way home from a 404 or a crash, and the expired-session banner. */
    hostHome: 'Vai ai suoi eventi',
    sessionExpired: 'La sua sessione è scaduta.',
    sessionExpiredAction: 'Acceda di nuovo',
    crashAutoRetry: 'Un nuovo tentativo partirà automaticamente tra un istante…',
  },

  errors: {
    'clientName.empty': 'Dia un nome al cliente.',
    'clientName.tooLong': 'Questo nome è troppo lungo.',
    'clientName.invalid': 'Questo nome contiene un carattere non accettato.',
    'clientCeilings.maxEventsInvalid': 'Questo numero di eventi non è accettato.',
    'clientCeilings.maxEventsPerPeriodInvalid':
      'Questo numero di eventi per periodo non è accettato.',
    'clientCeilings.maxTotalBytesInvalid': 'Questo spazio totale non è accettato.',
    'clientCeilings.maxEventQuotaBytesInvalid': 'Questa quota di evento non è accettata.',
    'clientCeilings.maxRetentionDaysInvalid':
      'Questa durata di conservazione non è accettata: da 1 a 3.650 giorni.',
    'clientCeilings.maxLiveDaysInvalid':
      'Questa durata di diretta non è accettata: da 1 a 365 giorni.',
    'clientCeilings.periodStartedAtInvalid': 'Questo inizio di periodo non è accettato.',
    'clientCeilings.clipsAllowedInvalid': 'Questa impostazione dei video non è accettata.',
    'clientCeilings.liveAllowedInvalid': 'Questa impostazione di apertura non è accettata.',
    'audit.reasonInvalid':
      'Il motivo deve stare su una riga di al massimo 200 caratteri, senza indirizzo e-mail.',
    'reset.mailerRequired':
      'Questa istanza non invia posta: non è possibile emettere alcun link di reimpostazione.',
    'reset.mailNotSent':
      'Il server di posta ha rifiutato il messaggio. Nessun link è stato emesso.',
    'reset.approverUnavailable':
      'Questo account non appartiene ad alcun cliente, o ne ha più di uno: nessun proprietario può approvare la richiesta.',
    'reset.requestNotFound': 'Questa richiesta non esiste o non è ancora stata approvata.',
    'reset.tooManyForAddress':
      'Questo indirizzo ha già ricevuto diverse reimpostazioni. Riprovi tra un’ora.',
    'account.disabled': 'Questo account è disattivato.',
    'account.operatorProtected':
      'L’account di un operatore non può essere né disattivato né eliminato.',
    'account.holdsEvents': 'Questo account possiede un evento: lo trasferisca o lo elimini prima.',
    'account.holdsMedia':
      'Questo account ha caricato foto o video, i cui file resterebbero sul disco.',
    'account.holdsReviews':
      'Questo account ha esaminato delle foto, le cui righe portano il suo nome.',
    'account.lastClientOwner':
      'Questo account è l’unico proprietario di un cliente che ha ancora membri o eventi: aggiunga un proprietario o concluda l’incarico del cliente.',
    'client.graceInvalid': 'Questo termine non è accettato. Indichi un numero intero di giorni.',
    'client.offboarding':
      'L’incarico di questo cliente sta per concludersi: la sua sospensione non si può revocare.',
    unknown: 'Si è verificato un errore. Riprovi tra un istante.',
    network: 'La connessione si è interrotta. Controlli la rete, poi riprovi.',
    'request.invalid': 'Le informazioni inviate non sono valide.',

    'auth.invalidCredentials': 'Indirizzo e-mail o password non corretti.',
    'auth.required': 'Acceda per continuare.',
    'auth.forbidden': 'Non ha i permessi per questa azione.',
    'auth.passwordChangeRequired': 'Scelga una nuova password prima di continuare.',
    'auth.invalidToken': 'Questo link non è più valido. Ne richieda uno nuovo.',
    'auth.invalidSecondFactor':
      'Questo codice non è valido. Attenda il successivo nella sua app, oppure usi un codice di recupero.',
    'auth.secondFactorExpired': 'Questo accesso è scaduto. Ricominci con la password.',
    'auth.tooManySecondFactorAttempts': 'Troppi codici errati. Riprovi tra un quarto d’ora.',
    'auth.secondFactorRequired': 'Questo account deve prima superare la verifica in due passaggi.',
    'auth.stepUpRequired': 'Confermi la sua identità per continuare.',
    'auth.secondFactorAlreadyEnrolled':
      'La verifica in due passaggi è già attiva su questo account.',
    'auth.noEnrolmentInProgress': 'Nessuna attivazione in corso. Ricominci.',
    'auth.secondFactorUnavailable':
      'Questo server non può verificare adesso il codice dell’app. Usi un codice di recupero.',
    'auth.totpCodeInvalid': 'Inserisca le sei cifre mostrate dall’app.',
    'auth.secondFactorNotEnrolled': 'La verifica in due passaggi non è attiva su questo account.',
    'feature.unavailable': 'Questa funzione non è disponibile su questo server.',

    'event.notFound': 'Questo codice non corrisponde a nessuna galleria aperta.',
    'event.notAcceptingUploads': 'Questa galleria non accetta più foto.',
    'event.quotaExceeded': 'La galleria ha raggiunto la capacità massima. Avvisi l’organizzatore.',
    'event.slugUnavailable': 'Questo indirizzo è già in uso.',
    'event.customSlugNotAllowed': 'Questa istanza non consente di scegliere il proprio indirizzo.',
    'event.creationRateLimited': 'Hai creato troppi eventi di recente. Riprova più tardi.',
    'event.quotaAboveCeiling': 'Questa quota supera il limite consentito da questo server.',
    'event.creationNotAllowed': 'Il tuo account non può creare eventi su questo server.',
    'client.notFound': 'Questo account cliente non è stato trovato.',
    'client.ownerRequired': 'Solo un proprietario dell’account può consultarlo.',
    'client.ceilingReached': 'Il tuo account ha raggiunto il numero di eventi consentito.',
    'client.storageFull': 'La galleria ha raggiunto la capacità massima. Avvisi l’organizzatore.',
    'client.liveNotAllowed': 'Il tuo account non può aprire un evento per ora.',
    'client.liveWindowOver':
      'Il periodo di apertura di questo evento è terminato: non può più essere riaperto.',
    'client.retentionAboveCeiling':
      'Questo periodo di conservazione supera quello consentito dal tuo account.',
    'client.clipsNotAllowed': 'I video non sono disponibili per questa galleria.',
    'event.immutable': 'Questo evento è archiviato e non può più essere modificato.',
    'event.illegalTransition': 'Questo cambio di stato non è possibile.',

    'guest.revoked': 'Il suo accesso è stato revocato dall’organizzatore.',
    'guestToken.expired': 'Il suo accesso è scaduto. Scansioni di nuovo il codice QR.',
    'guestToken.malformed': 'Il suo accesso non è più valido. Scansioni di nuovo il codice QR.',
    'guestToken.badSignature': 'Il suo accesso non è più valido. Scansioni di nuovo il codice QR.',

    'photo.notFound': 'Questa foto non esiste più.',
    'photo.illegalTransition': 'Questa azione non è possibile su questa foto.',

    'image.unsupportedFormat':
      'Questo file non è una foto. Formati accettati: JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'Questa foto sembra danneggiata. Ne provi un’altra.',
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
    'invitation.tooManyForAddress':
      'Questo indirizzo ha già ricevuto diversi inviti. Riprovi tra un’ora.',
    'invitation.notFound':
      'Questo invito non è più valido. Ne chieda uno nuovo alla persona che lo ha inviato.',
    'invitation.signInRequired':
      'Un account usa già l’indirizzo di questo invito. Acceda con quell’account: tornerà qui per accettare.',
    'terms.notAccepted': 'Per continuare, spunti la casella che accetta le condizioni d’uso.',
    'invitation.wrongAccount':
      'Questo invito è stato scritto per un indirizzo e-mail diverso da quello di questo account.',
    'invitation.credentialsRequired':
      'Acceda con l’account invitato, oppure scelga un nome e una password.',
    'accountName.empty': 'Inserisca il suo nome.',
    'accountName.tooLong': 'Questo nome è troppo lungo.',

    'displayName.tooLong': 'Nome troppo lungo.',
    'joinCode.wrongLength': 'Questo codice non ha il numero corretto di caratteri.',
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
    'reaction.ownPhoto': 'Non può reagire alla sua foto.',
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
      'Questo colore somiglia troppo ai colori di stato dell’applicazione. Scegli un’altra tinta.',
    'gallery.notAvailable': 'Questo link non è più disponibile.',
    'gallery.passwordRequired': 'Questo album è protetto da password.',
    'gallery.wrongPassword': 'Password errata.',
    'gallery.tooManyAttempts': 'Troppi tentativi. Riprovi tra un quarto d’ora.',
    'gallery.cursorInvalid': 'L’elenco delle foto è cambiato. Ricarichi la pagina.',
    'shareLink.lifetimeInvalid': 'Scelga una durata tra 1 e 90 giorni.',

    'upload.busy': 'Sono in corso molti invii. Riprovi tra un momento.',
    'storage.boxFull': 'Non c’è più spazio per salvare questo file. Avvisi l’organizzatore.',
    /* ---- The host's venue photograph (ADR 0010, decision 8). ---- */
    'venuePhoto.tooLarge':
      'Questa foto è troppo pesante, anche ridimensionata. Provatene un’altra.',
    'venuePhoto.notFound': 'Questa foto non esiste più.',
    'venuePhoto.saveFailed': 'Non è stato possibile salvare la foto. Riprovate.',
  },

  moderation: {
    title: 'Moderazione',
    // Navigation pass, batch C: the way to the other console.
    openMobile: 'Versione per telefono, una foto alla volta',
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

  /* The guest's view of the evening: the published photographs, with the reactions. */
  feed: {
    title: 'Le foto della serata',
    link: 'Guarda le foto della serata',
    back: 'Invia le foto',
    refresh: 'Aggiorna',
    more: 'Mostra altre foto',
    empty: 'Nessuna foto è ancora sullo schermo.',
    emptyHint: 'Le foto approvate dagli organizzatori compariranno qui.',
    failed: 'Non è stato possibile caricare le foto. Riprovi.',
    own: 'La sua foto',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    unavailable: 'Questa galleria non viene più mostrata.',
    unavailableHint: 'È archiviata o non è più aperta, quindi qui non ci sono foto da vedere.',
  },

  wall: {
    empty: 'Le prime foto stanno per arrivare',
    emptyHint: 'Scansioni il codice QR per inviare le sue foto.',
    joinPrompt: 'Entri nella galleria',
    offline: 'Connessione persa — nuovo tentativo in corso',
    paused: 'Presentazione in pausa',
    codeLabel: 'Codice della serata',
    qrTitle: 'Codice QR per entrare nella galleria',
    photoBy: (name: string) => `Foto inviata da ${name}`,
    photoByAnonymous: 'Foto inviata da un invitato',
    errorTitle: 'Non è stato possibile caricare le foto',
    errorHint: 'Nuovo tentativo in corso. Controlli la rete della sala se lo schermo resta vuoto.',
    notServedTitle: 'Questa galleria non viene mostrata',
    notServedHint:
      'Non è aperta oppure è stata archiviata. Quando verrà aperta, lo schermo riprenderà da solo.',
    dismissJoinCard: 'Nascondi il promemoria del codice',
    shortcuts: 'Scorciatoie da tastiera',
    shortcutsHint:
      'Spazio mette in pausa, le frecce cambiano foto, F passa a schermo intero, L cambia la disposizione.',
    /* Navigation pass, batch A: how to leave the wall. */
    leaveHint: 'Per uscire: Esc o F escono dallo schermo intero, poi chiuda la scheda.',
    layoutNames: {
      spotlight: 'Schermo intero',
      mosaic: 'Mosaico',
      polaroid: 'Polaroid',
      filmstrip: 'Pellicola',
      collage: 'Collage',
      split: 'Affiancate',
      clothesline: 'Filo del bucato',
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
    events: 'I suoi eventi',
    breadcrumbLabel: 'Percorso di navigazione',
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
      violet: 'Kraft (predefinito)',
      rose: 'Rosa',
      azure: 'Blu',
      teal: 'Turchese',
    },
    themeFonts: 'Tipografia',
    themeFontsHint: 'Applicata solo allo schermo in sala.',
    themeFontsNames: {
      sans: 'Editoriale',
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
    themeAmbiance: 'Atmosfera',
    themeAmbianceHint:
      'Il mondo che indossano i telefoni dei vostri ospiti, lo schermo della sala e le pagine di questo evento nella vostra console.',
    themeAmbianceNames: {
      guinguette: 'Guinguette',
      riviera: 'Riviera',
      champs: 'Campi d’oro',
      bivouac: 'Bivacco',
      cabaret: 'Cabaret',
      noces: 'Nozze',
      custom: 'Su misura',
    },
    template: 'Tipo di evento',
    templateHint:
      'Un punto di partenza, adatto al tipo di serata. Tutte queste impostazioni restano modificabili in qualsiasi momento, prima e durante l’evento.',
    templateNone: 'Senza modello',
    templateNoneSummary:
      'Impostazioni predefinite: ogni foto approvata prima dello schermo, conservazione illimitata.',
    templateChanges: 'Questo modello imposta:',
    templatePreviewSample: 'Il tuo evento',
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

    loading: 'Caricamento dei suoi eventi…',
    eventLoading: 'Caricamento dell’evento…',
    eventsEmpty: 'Nessun evento al momento.',
    eventsEmptyHint: 'Tre passaggi per essere pronti il giorno dell’evento.',
    emptyStepCreate: 'Crei l’evento.',
    emptyStepTest: 'Provi lo schermo sulla rete del locale, da un telefono che non sia il suo.',
    emptyStepPrint: 'Stampi il codice QR e lo metta sui tavoli.',
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
    settingsOwnerOnly: 'Solo il proprietario dell’evento può modificarne le impostazioni.',
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
    moderatorEmailHint: 'Riceverà un invito, valido sette giorni, solo per questo evento.',
    inviteSubmit: 'Invita',
    /** An invitation went out by e-mail: nothing to copy. */
    moderatorInviteSent: (email: string) => `Un invito è stato inviato a ${email}.`,
    /** No mail relay, or it refused: the link is for the host to pass on, once. */
    inviteLinkCreated: (email: string) =>
      `Questo link non è stato inviato per e-mail. Lo inoltri lei stesso a ${email}: funziona una volta sola ed è valido per sette giorni.`,
    inviteLinkUrl: 'Link da inoltrare',
    inviteLinkCopy: 'Copia il link',
    inviteLinkCopied: 'Link copiato.',
    /** No clipboard (an address that is not secure) or a refusal: the field is selectable. */
    inviteLinkCopyFailed: 'Copia non possibile qui: selezioni il link e lo copi lei stesso.',
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
    shareLink: 'Album condiviso',
    shareLinkHint:
      'Un link da inviare dopo la festa: le foto pubblicate, da scaricare a piena risoluzione.',
    shareLinkNone: 'Nessun link è attivo.',
    shareLinkActive: (date: string) => `Aperto fino al ${date}`,
    shareLinkUnavailable:
      'Questo link non si apre più: è scaduto, oppure la persona che lo ha creato non organizza più l’evento.',
    shareLinkProtected: 'Protetto da password',
    shareLinkUnprotected: 'Senza password',
    shareLinkLifetime: 'Aperto per',
    shareLinkDays: (days: number) =>
      t.count(days, { one: `${t.number(days)} giorno`, other: `${t.number(days)} giorni` }),
    shareLinkPassword: 'Password',
    shareLinkPasswordHint: (min: number) =>
      `Almeno ${t.number(min)} caratteri. La comunichi separatamente dal link.`,
    shareLinkCreate: 'Crea il link',
    shareLinkReplace: 'Sostituisci con un nuovo link',
    shareLinkReplaceHint: 'Il link attuale smetterà subito di funzionare.',
    shareLinkCreated: 'Ecco il link. Lo copi adesso: non verrà più mostrato.',
    shareLinkUrl: 'Indirizzo del link',
    shareLinkCopy: 'Copia il link',
    shareLinkCopied: 'Link copiato.',
    // Navigation pass, batch C: a copy that failed, and the link that is never shown again.
    shareLinkCopyFailed:
      'Copia non riuscita. L’indirizzo è selezionato: lo copi con Ctrl+C (o con una pressione lunga su un telefono).',
    shareLinkLeaveWarning:
      'Questo indirizzo non verrà più mostrato e non l’ha copiato. Uscire comunque dalla pagina?',
    shareLinkRevoke: 'Disattiva il link',
    shareLinkRevokeTitle: 'Disattivare questo link?',
    shareLinkRevokeHint:
      'Nessuno potrà più aprire l’album con questo link, nemmeno con la password. Potrà crearne uno nuovo.',
    shareLinkRevoked: 'Il link è stato disattivato.',

    /* ---- The host's own photograph of their venue (ADR 0010, decision 8). ---- */
    venuePhoto: 'Foto del vostro locale',
    venuePhotoHint:
      'Sostituisce la foto dell’atmosfera dietro lo schermo dei vostri ospiti e quello della sala. Viene ridimensionata e privata dei metadati, posizione GPS compresa, poi velata perché il testo resti leggibile.',
    venuePhotoPreviewAlt: 'Anteprima della foto del vostro locale',
    venuePhotoDefault:
      'Nessuna foto del vostro locale: l’ambientazione mostra la sua foto predefinita.',
    venuePhotoChoose: 'Scegli una foto',
    venuePhotoReplace: 'Sostituisci la foto',
    venuePhotoRemove: 'Torna alla foto predefinita',
    venuePhotoBusy: 'Invio della foto…',
    venuePhotoSaved: 'La foto del vostro locale è salvata.',
    venuePhotoRemoved: 'La foto predefinita è stata ripristinata.',
    customAmbianceCreate: 'Crea la mia atmosfera (Su misura)',
    customAmbianceEdit: 'Modifica la mia atmosfera',
    customAmbianceEntryHint:
      'Il tuo sfondo, chiaro o scuro, con la tinta che preferisci: lo vedi su schermi reali prima di salvare.',
    customAmbianceTitle: 'La tua atmosfera su misura',
    customAmbianceCrumb: 'Su misura',
    customAmbianceIntro:
      'Scegli uno sfondo chiaro o scuro, la sua tinta, il colore d’accento e un carattere. Le anteprime mostrano gli schermi reali con le tue scelte e nulla viene salvato finché non premi «Salva».',
    customGround: 'Sfondo',
    customGroundNames: { light: 'Chiaro', dark: 'Scuro' },
    customGroundHue: 'Tinta dello sfondo',
    customGroundHueHint:
      'Da 0° a 359°: scegli solo la tinta, la luminosità è fissa perché tutto resti leggibile.',
    customAccentHue: 'Colore d’accento',
    customAccentHueHint:
      'Ogni tinta è permessa, comprese quelle vicine al verde, al giallo o al rosso dell’applicazione: il testo del pulsante resta leggibile su ciascuna, e un avviso porta sempre un’icona e una parola.',
    customFaces: 'Carattere',
    customFacesHint:
      'I font e gli angoli dei pulsanti di una delle sei atmosfere, ciascuna mostrata nel proprio font.',
    customPreview: 'Anteprima',
    customPreviewHint:
      'Un’illustrazione di ciò che vedranno i tuoi ospiti e la sala, con foto di esempio.',
    customPreviewPhone: 'Schermo dei tuoi ospiti',
    customPreviewWall: 'Schermo della sala',
    customPreviewCaption: 'Che bella serata!',
    customPreviewAuthor: 'Lea',
    customKept: 'La tua scelta resta com’era: modificala e salva di nuovo.',
    customSaved: 'La tua atmosfera è salvata.',
  },

  auth: {
    title: 'Accesso',
    email: 'Indirizzo e-mail',
    password: 'Password',
    submit: 'Accedi',
    logout: 'Esci',
    changePassword: 'Cambia password',
    currentPassword: 'Password attuale',
    newPassword: 'Nuova password',
    newPasswordHint: (min: number) =>
      `Almeno ${min} caratteri. Una frase è più sicura di una parola.`,
    confirmPassword: 'Conferma la nuova password',
    changePasswordIntro: 'Scelga una password che non usa altrove.',
    passwordSaved: 'Password salvata.',
    passwordIncorrect: 'La password non è corretta.',

    /* ---- Added by G2-13: the second factor. ---- */
    secondFactorTitle: 'Verifica in due passaggi',
    secondFactorIntro: 'Inserisca il codice di sei cifre mostrato dalla sua app di autenticazione.',
    secondFactorCode: 'Codice di sei cifre',
    secondFactorSubmit: 'Verifica',
    secondFactorRecoveryToggle: 'Usa un codice di recupero',
    secondFactorAppToggle: 'Usa il codice dell’app',
    secondFactorRecoveryIntro:
      'Inserisca uno dei codici di recupero ricevuti all’attivazione. Ognuno vale una sola volta.',
    recoveryCode: 'Codice di recupero',
    secondFactorRestart: 'Ricomincia con la password',
    securityTitle: 'Sicurezza dell’account',
    securityUnavailable:
      'Questo server non ha una chiave di cifratura per la verifica in due passaggi. Chieda al suo amministratore di configurarla.',
    setupIntro:
      'Un’app di autenticazione (Aegis, 1Password, Google Authenticator…) genera un codice di sei cifre che si aggiunge alla sua password.',
    setupStart: 'Attiva la verifica',
    setupScan:
      'Inquadri questo codice QR con la sua app. Senza fotocamera, digiti la chiave a mano.',
    setupQrLabel: 'Codice QR di configurazione',
    setupKeyLabel: 'Chiave di configurazione',
    setupConfirm: 'Conferma',
    recoveryCodesTitle: 'Codici di recupero',
    recoveryCodesIntro:
      'Se perde il telefono, ciascuno di questi dieci codici le apre la porta una volta. Li annoti adesso: non verranno mostrati di nuovo.',
    recoveryCodesCopy: 'Copia i codici',
    recoveryCodesCopied: 'Codici copiati.',
    recoveryCodesSaved: 'Li ho annotati',
    securityEnabled: 'La verifica in due passaggi è attiva su questo account.',
    securityManageIntro:
      'Per rinnovare i codici di recupero o disattivare la verifica, confermi prima la sua identità.',
    stepUpSubmit: 'Conferma la mia identità',
    stepUpDone: 'Identità confermata per cinque minuti.',
    recoveryCodesRegenerate: 'Genera nuovi codici di recupero',
    secondFactorDisable: 'Disattiva la verifica',
    secondFactorDisabled: 'Verifica in due passaggi disattivata.',

    /* ---- Added by G2-10: the invitation page, the reset by e-mail and the account menu. ---- */
    invitationTitle: 'Invito',
    invitationToModerate: (name: string) => `Ha ricevuto un invito a moderare l’evento «${name}».`,
    invitationToOwn: (name: string) =>
      `Ha ricevuto un invito a creare e gestire gli eventi di «${name}».`,
    invitationToJoin: (name: string) => `Ha ricevuto un invito a unirsi al team di «${name}».`,
    invitationExpires: (when: string) => `Valido fino al ${when}.`,
    invitationChoose:
      'Scelga il suo nome e una password: l’account viene creato quando invia questo modulo.',
    invitationName: 'Il suo nome',
    invitationNameHint: 'Compare nell’elenco delle persone con accesso.',
    invitationConfirmPassword: 'Conferma la password',
    invitationSubmit: 'Crea il mio account e accetta',
    invitationAccepted: 'Invito accettato.',
    invitationHaveAccount: 'Ha già un account?',
    invitationSignedInAs: (email: string) => `Ha effettuato l’accesso come ${email}.`,
    invitationAcceptAs: 'Accetta con questo account',
    invitationUseAnother: 'Usa un altro account',
    /* ---- Added by G2-20: the terms of use an invitation's acceptance agrees to. ---- */
    invitationAcceptTerms: (version: string) =>
      `Accetto le condizioni d’uso (versione ${version}), incluse le clausole sul trattamento dei dati per conto del titolare.`,
    invitationReadTerms: 'Leggi le condizioni d’uso',
    deadLinkTitle: 'Questo link non è valido',
    forgotLink: 'Password dimenticata?',
    forgotTitle: 'Password dimenticata',
    forgotIntro:
      'Inserisca l’indirizzo e-mail del suo account. Se un account lo usa, riceverà un link per scegliere una nuova password.',
    forgotSubmit: 'Invia il link',
    forgotSentTitle: 'Controlli la posta',
    forgotSent:
      'Se un account usa questo indirizzo, è appena stato inviato un messaggio con un link. Il link vale un’ora e si usa una sola volta.',
    forgotUnavailable:
      'Questo server non può inviare e-mail, quindi qui la password non si può reimpostare in questo modo. Chieda a chi lo gestisce.',
    backToLogin: 'Torna all’accesso',
    resetTitle: 'Nuova password',
    resetIntro:
      'Scelga una password che non usa altrove. Verrà disconnesso da tutti i suoi dispositivi.',
    resetSubmit: 'Cambia la password',
    resetDoneTitle: 'Password cambiata',
    resetDone: 'Tutte le sue sessioni sono state chiuse. Acceda con la nuova password.',
    resetAskAgain: 'Richiedi un nuovo link',
    accountMenu: 'Account',
    accountSignedInAs: (email: string) => `Connesso come ${email}`,
    logoutEverywhere: 'Disconnetti ovunque',
    logoutEverywhereTitle: 'Disconnettersi ovunque?',
    logoutEverywhereHint:
      'La sua sessione verrà chiusa su tutti i dispositivi, questo compreso, e dovrà accedere di nuovo. Utile se ha perso un dispositivo o usato un computer condiviso.',

    /* ---- Navigation pass, batch D: accounts and sign-in. ---- */
    alreadySignedIn: 'Ha già effettuato l’accesso. Reindirizzamento…',
    forgotNoMail:
      'Ha dimenticato la password? Questo server non invia e-mail: chieda a chi lo gestisce di reimpostarla.',
    changePasswordForced:
      'La sua password è stata scelta per lei: la sostituisca prima di proseguire. Tornerà poi dove stava andando.',
    menuMustChange: 'Cambi prima la password: il resto della console resta chiuso fino ad allora.',
    securityBack: 'Indietro',
    secondFactorEnabled: 'Verifica in due passaggi attivata.',
    recoveryCodesLeaveTitle: 'Uscire senza aver annotato i codici?',
    recoveryCodesLeaveHint:
      'Questi codici vengono mostrati una sola volta: uscendo da questa pagina non potrà più leggerli. Per ottenerne di nuovi dovrà confermare di nuovo la sua identità.',
    recoveryCodesLeaveStay: 'Restare e annotare i codici',
    recoveryCodesLeaveGo: 'Uscire comunque',
    deadInvitationSignIn: 'Se l’ha già accettato, il suo account esiste: acceda.',
    deadInvitationSignedIn:
      'Ha già effettuato l’accesso: se l’ha accettato con questo account, i suoi eventi sono lì.',
  },

  mobileModeration: {
    title: 'Moderazione da telefono',
    // Navigation pass, batch C: the way to the other console.
    openConsole: 'Console completa, per computer',
    intro: 'Trascini la foto verso destra per pubblicare, verso sinistra per rifiutare.',
    releaseToPublish: 'Rilasci per pubblicare',
    releaseToReject: 'Rilasci per rifiutare',
    nowDeciding: (photo: string) => `Foto da moderare. ${photo}`,
    undoLast: 'Annulla l’ultima decisione',
    undoUnavailable: 'Si può annullare solo una pubblicazione.',
  },
  gallery: {
    title: 'Album condiviso',
    opening: 'Apertura dell’album…',
    unavailableTitle: 'Questo link non è più disponibile',
    unavailableHint:
      'Potrebbe essere scaduto o essere stato disattivato. Chieda un nuovo link alla persona che glielo ha inviato.',
    lockedTitle: 'Album protetto',
    lockedHint: 'Inserisca la password che ha ricevuto insieme al link.',
    passwordLabel: 'Password',
    unlock: 'Apri l’album',
    photoCount: (count: number) =>
      t.count(count, { one: `${t.number(count)} foto`, other: `${t.number(count)} foto` }),
    availableUntil: (date: string) => `Disponibile fino al ${date}`,
    privacyNote: 'Le foto si scaricano a piena risoluzione, senza i loro dati di posizione.',
    downloadAll: 'Scarica tutto (.zip)',
    download: 'Scarica l’originale',
    downloadClip: 'Scarica il video',
    openPhoto: (position: number) => `Ingrandisci la foto ${t.number(position)}`,
    photoAlt: (position: number) => `Foto ${t.number(position)} dell’album`,
    clipBadge: 'Video',
    empty: 'In questo album non è ancora stata pubblicata nessuna foto.',
    loadMore: 'Mostra altre foto',
    viewerTitle: (position: number, total: number) =>
      `Foto ${t.number(position)} di ${t.number(total)}`,
  },
  about: {
    sourceCode: 'Codice sorgente (AGPL-3.0)',
    opensInNewTab: 'si apre in una nuova scheda',
    aboutLink: 'Informazioni',
    /* Navigation pass, batch A: a way back from the page. */
    back: 'Indietro',
    home: 'Home',

    title: 'Informazioni su EventSlide',
    intro:
      'EventSlide è software libero: può leggerne, modificarne e ridistribuirne il codice sorgente secondo i termini della sua licenza.',
    versionLabel: 'Versione',
    licenseLabel: 'Licenza',
    sourceLabel: 'Codice sorgente',
    sourceNote: 'Questo link porta al codice sorgente della versione indicata sopra.',
    noticesLabel: 'Licenze di terze parti',
    noticesLink: 'Avvisi delle librerie incluse',
    noticesNote: 'I testi delle licenze delle librerie libere contenute in questa applicazione.',

    supportLink: 'Sostieni il progetto',
    supportTitle: 'Il progetto vive di donazioni',
    supportIntro: 'EventSlide è software libero, gratuito e senza pubblicità.',
    supportNoCounterpart: 'Una donazione non sblocca nulla: lo stesso servizio per tutti.',
    budgetLink: 'Consulta il bilancio pubblico',
    supportDismiss: 'Nascondi questo messaggio',

    termsLink: 'Condizioni d’uso',
    privacyLink: 'Informativa sulla privacy',
    legalNoticeLink: 'Note legali',
    helpLink: 'Aiuto',
    reportLink: 'Segnala un contenuto',
    operatorTitle: 'Chi gestisce questa istanza',
    operatorNameLabel: 'Operatore',
    operatorContactLabel: 'Contatto',
    operatorHostedBy: 'Ospitato da',
  },
  clientSpace: {
    bannerLabel: 'Limiti del suo account',
    warningTitle: 'Si sta avvicinando a un limite del suo account',
    reachedTitle: 'È stato raggiunto un limite del suo account',
    eventsMeter: (used: number, max: number) => `Eventi: ${used} su ${max}`,
    eventsPerPeriodMeter: (used: number, max: number) =>
      `Eventi creati nel periodo: ${used} su ${max}`,
    storageMeter: (used: string, max: string) => `Spazio: ${used} su ${max}`,
    liveNotAllowed: 'L’apertura di nuovi eventi è sospesa sul suo account.',
    contactHint: 'Per togliere un limite, contatti il suo operatore.',
    contactAction: 'Contatta l’operatore',
    suspendedTitle: 'Il suo account è sospeso',
    suspendedBody:
      'I suoi album restano consultabili ed esportabili. Finché la sospensione dura, non può creare, aprire né modificare un evento, e il pubblico non vede più i suoi schermi.',
    spaceLink: 'Area cliente',
    spaceTitle: 'Area cliente',
    limitsTitle: 'Limiti e utilizzo',
    noLimits: 'Il suo operatore non ha fissato alcun limite sul suo account.',
    // Navigation pass, batch C: an account that belongs to no client.
    noClient: 'Il suo account non appartiene ad alcun cliente.',
    noClientHint:
      'Qui non ci sono quindi né limiti né utilizzo da consultare. I suoi eventi sono nella pagina «I suoi eventi».',
    roleOwner: 'Proprietario',
    roleMember: 'Membro',
    pendingTitle: 'In attesa della sua approvazione',
    pendingHint:
      'Il suo operatore ha invitato queste persone nel suo account. Vi entrano solo con l’approvazione di un proprietario.',
    pendingEmpty: 'Nulla attende la sua approvazione.',
    pendingValidUntil: (date: string) => `Valido fino al ${date}`,
    approve: 'Approva',
    approved: 'Invito approvato.',
    auditTitle: 'Registro delle azioni',
    auditHint:
      'Tutto ciò che il suo operatore, il sistema o il suo team ha fatto sul suo account, dal più recente al più vecchio.',
    auditEmpty: 'Nessuna azione registrata per ora.',
    auditMore: 'Mostra le azioni più vecchie',
    actorOperator: 'Operatore',
    actorMember: 'Il suo team',
    actorSystem: 'Sistema',
    actorIntegration: 'Integrazione',
    actionCeilingsChanged: 'I suoi limiti sono stati modificati.',
    actionPeriodReset: 'Il suo periodo è stato rinnovato.',
    actionInvitationIssued: 'È stato emesso un invito.',
    actionInvitationIssuedPending: 'È stato emesso un invito; attende la sua approvazione.',
    actionInvitationApproved: 'Un invito è stato approvato.',
    actionResetRequested: 'È stato richiesto il ripristino della password di un membro.',
    actionResetApproved: 'Un ripristino della password è stato approvato.',
    actionResetMailed: 'Un link di ripristino è stato inviato al membro.',
    actionResetShown: 'Un link di ripristino è stato consegnato all’operatore.',
    actionTermsAccepted: 'Una persona ha accettato le condizioni d’uso accettando un invito.',
    actionOther: 'È stata registrata un’azione.',
    liveWindowEnd: (date: string) => `La finestra in diretta termina il ${date}.`,
  },

  site: {
    menuLink: 'Console dell’operatore',
    consoleTitle: 'Console dell’operatore',
    consoleIntro:
      'Qui vede forme e dimensioni, mai ciò che i suoi clienti hanno creato: nessuna foto, nessun nome di evento.',
    navLabel: 'Sezioni della console',
    navClients: 'Clienti',
    navAccounts: 'Account',
    navAudit: 'Registro',
    factorTitle: 'Verifica in due passaggi obbligatoria',
    factorEnrol:
      'Questa istanza la richiede all’operatore e il suo account non l’ha ancora attivata. La attivi, poi torni qui.',
    factorEnrolLink: 'Attiva la verifica in due passaggi',
    factorSignIn:
      'Questo accesso non ha superato la verifica in due passaggi. Acceda di nuovo e inserisca il codice della sua app.',
    factorSignOut: 'Accedi di nuovo',
    stepUpTitle: 'Confermi la sua identità',
    stepUpIntro:
      'Questa azione modifica un’istanza condivisa. Inserisca la sua password, e il codice della sua app se ne ha una: la conferma vale cinque minuti.',
    more: 'Mostra altro',

    clientsTitle: 'Clienti',
    clientsHint:
      'Un cliente è un account, i suoi eventi e i suoi limiti. Lei legge le sue dimensioni, mai i suoi contenuti.',
    newClient: 'Nuovo cliente',
    clientsEmpty: 'Nessun cliente per ora.',
    clientsEmptyHint:
      'Apra un cliente: il suo proprietario riceve un invito e sceglie da sé la propria password.',
    clientsTableLabel: 'I clienti dell’istanza',
    clientColumn: 'Cliente',
    statusColumn: 'Stato',
    eventsColumn: 'Eventi',
    membersColumn: 'Membri',
    storageColumn: 'Spazio',
    createdColumn: 'Aperto il',
    statusActive: 'Attivo',
    statusSuspended: 'Sospeso',
    statusOffboarding: 'In chiusura',
    eventsCell: (total: number, live: number) =>
      `${t.number(total)} (${t.number(live)} in diretta)`,
    storageOf: (used: string, max: string) => `${used} su ${max}`,
    noCeiling: 'Nessun limite',

    newClientTitle: 'Aprire un cliente',
    newClientIntro:
      'Il cliente viene aperto senza membri né eventi e il suo proprietario viene invitato via e-mail, oppure con un link che lei gli trasmette se l’istanza non può inviare posta. Lei non sceglie mai la sua password.',
    clientName: 'Nome del cliente',
    ownerEmail: 'Indirizzo e-mail del proprietario',
    inviteLanguage: 'Lingua dell’invito',
    defaultsHint:
      'I limiti sono quelli che questa istanza assegna per impostazione predefinita a un nuovo cliente. Svuoti un campo per non fissare alcun limite.',
    createClient: 'Apri il cliente',
    clientCreated: 'Cliente aperto.',

    invitationMailed: (email: string) => `Un invito è stato inviato a ${email}.`,
    invitationPending:
      'L’invito è scritto, ma si apre solo con il consenso di un proprietario del cliente.',
    invitationLinkTitle: 'Nessuna e-mail è partita',
    invitationLinkBody:
      'Questa istanza non può inviare posta, oppure il server di posta ha rifiutato questo messaggio. Questo link è l’unica copia: lo trasmetta al destinatario, poi chiuda questo riquadro.',
    invitationLinkLabel: 'Link d’invito',
    copyLink: 'Copia il link',
    linkCopied: 'Link copiato.',
    invitationValidUntil: (date: string) => `Valido fino al ${date}.`,

    ceilingsLegend: 'Limiti',
    maxEvents: 'Eventi, al massimo',
    maxEventsPerPeriod: 'Eventi creati per periodo, al massimo',
    maxTotalGigabytes: 'Spazio totale, in GB',
    maxEventQuotaGigabytes: 'Quota di un evento, in GB',
    maxRetentionDays: 'Conservazione dopo la chiusura, in giorni, al massimo',
    maxLiveDays: 'Durata di una diretta, in giorni, al massimo',
    clipsAllowed: 'Video consentiti',
    liveAllowed: 'Apertura di eventi consentita',
    renewPeriod: 'Rinnova il periodo adesso',
    renewPeriodHint: 'Azzera il contatore degli eventi creati nel periodo.',
    emptyMeansNone: 'Vuoto: nessun limite.',
    notANumber: 'Inserisca un numero positivo.',

    allClients: 'Tutti i clienti',
    memberCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} membro`,
        other: `${t.number(count)} membri`,
      }),
    periodEvents: (count: number) => `Creati nel periodo: ${t.number(count)}`,
    suspendedSince: (date: string) => `Sospeso dal ${date}.`,
    purgeOn: (date: string) => `Gli album saranno eliminati al più tardi il ${date}.`,
    suspend: 'Sospendi',
    suspendTitle: 'Sospendere questo cliente?',
    suspendBody:
      'Gli ospiti non possono più unirsi ai suoi eventi né inviare foto, il pubblico non vede più i suoi schermi né le sue gallerie e i suoi membri non possono più modificare nulla. Non viene eliminato nulla e nessun account viene disattivato.',
    suspended: 'Cliente sospeso.',
    resume: 'Revoca la sospensione',
    resumeTitle: 'Revocare la sospensione?',
    resumeBody:
      'Gli schermi e le gallerie del cliente tornano subito visibili e i suoi ospiti possono di nuovo unirsi e inviare foto.',
    resumed: 'Sospensione revocata.',
    rename: 'Rinomina',
    renameTitle: 'Nome del cliente',
    renamed: 'Cliente rinominato.',
    ceilingsTitle: 'Limiti',
    ceilingsReason: 'Motivo della modifica',
    ceilingsReasonHint:
      'Una frase su una riga, al massimo 200 caratteri, senza indirizzo e-mail. Viene scritta nel registro dell’operatore e il cliente non la legge. Solo motivi non finanziari: dimensione di un evento, capacità, abuso.',
    ceilingsSave: 'Salva i limiti',
    ceilingsSaved: 'Limiti salvati.',
    ceilingsUnchanged: 'Nessun limite è cambiato.',
    inviteTitle: 'Invitare in questo cliente',
    inviteIntro:
      'Una persona entra nell’account del cliente, mai in un evento. Se il cliente ha già eventi o membri, un proprietario deve approvare l’invito.',
    inviteEmail: 'Indirizzo e-mail',
    inviteRole: 'Ruolo',
    inviteSend: 'Invita',
    roleOwner: 'Proprietario',
    roleMember: 'Membro',
    eventsTitle: 'Eventi',
    eventsHint: 'Solo forme e dimensioni: né nome, né indirizzo, né foto.',
    eventsEmpty: 'Questo cliente non ha alcun evento.',
    eventsTableLabel: 'Gli eventi del cliente',
    eventColumn: 'Evento',
    eventStatusColumn: 'Stato',
    photosColumn: 'Foto',
    usedColumn: 'Spazio usato',
    startsColumn: 'Inizio previsto',
    eventLabel: (short: string) => `Evento ${short}`,
    eventStatuses: {
      draft: 'Bozza',
      live: 'In diretta',
      closed: 'Chiuso',
      archived: 'Archiviato',
    },
    photoCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto`,
        other: `${t.number(count)} foto`,
      }),
    auditLink: 'Vedi il registro di questo cliente',

    accountsTitle: 'Account',
    accountsHint:
      'Gli indirizzi delle persone che hanno un account su questa istanza, e nient’altro: né nome visualizzato, né password.',
    accountsEmpty: 'Nessun account per ora.',
    accountsTableLabel: 'Gli account dell’istanza',
    addressColumn: 'Indirizzo',
    roleColumn: 'Ruolo sull’istanza',
    accountStateColumn: 'Stato',
    lastLoginColumn: 'Ultimo accesso',
    ownedColumn: 'Eventi posseduti',
    clientsColumn: 'Clienti',
    siteRoleOperator: 'Operatore',
    accountActive: 'Attivo',
    accountDisabled: 'Disattivato',
    neverSignedIn: 'Mai',
    mustChange: 'Deve cambiare la password',
    resetPassword: 'Reimposta la password',
    resetTitle: 'Reimpostare questa password?',
    resetBody:
      'Un link valido per un’ora parte verso l’indirizzo dell’account e da nessun’altra parte: lei lo vede solo su un’istanza che non invia posta.',
    resetSent: 'Il link è stato inviato all’indirizzo dell’account.',
    resetPending: 'In attesa di un proprietario',
    resetPendingBody:
      'Questa istanza non invia posta. Un altro proprietario del cliente deve approvare la richiesta prima che il link le venga consegnato.',
    resetFetch: 'Recupera il link approvato',
    resetLinkTitle: 'Link di reimpostazione',
    resetLinkBody:
      'Funziona una sola volta. Lo trasmetta al titolare dell’account, poi chiuda questo riquadro.',

    auditTitle: 'Registro',
    auditHint:
      'Tutto ciò che è stato fatto sull’istanza, dal più recente al più vecchio. Il motivo di una modifica dei limiti è la frase dell’operatore stesso.',
    auditEmpty: 'Nessuna azione registrata per ora.',
    auditMore: 'Mostra le azioni più vecchie',
    auditShowAll: 'Mostra tutto il registro',

    /* ---- Navigation pass, batch D: the console's links and the invitation link. ---- */
    exitsLabel: 'Esci dalla console',
    accountsLink: 'Vedi tutti gli account',
    noClient: 'Nessuno',
    auditFilteredFor: (name: string) => `Registro del cliente «${name}».`,
    auditToClient: 'Vedi questo cliente',
    linkLeaveTitle: 'Uscire senza aver copiato il link?',
    linkLeaveHint:
      'Non è partita nessuna e-mail: questo link è mostrato solo qui, una volta. Uscendo da questa pagina non potrà più copiarlo; dovrà emetterne uno nuovo.',
    linkLeaveStay: 'Restare e copiare il link',
    linkLeaveGo: 'Uscire comunque',
    auditReason: (reason: string) => `Motivo: ${reason}`,
    auditAccount: (short: string) => `account ${short}`,
    actors: {
      operator: 'Operatore',
      member: 'Membro',
      system: 'Sistema',
      integration: 'Integrazione',
    },
    actions: {
      'client.created': 'Cliente aperto.',
      'client.renamed': 'Cliente rinominato.',
      'client.ceilingsChanged': 'Limiti modificati.',
      'client.periodReset': 'Periodo rinnovato.',
      'client.suspended': 'Cliente sospeso.',
      'client.resumed': 'Sospensione revocata.',
      'invitation.issued': 'Invito emesso.',
      'invitation.approved': 'Invito approvato da un proprietario.',
      'account.resetRequested': 'Reimpostazione della password richiesta.',
      'account.resetApproved': 'Reimpostazione approvata da un proprietario.',
      'account.resetIssued': 'Reimpostazione emessa.',
      'account.disabled': 'Account disattivato.',
      'client.offboarded': 'Fine dell’incarico avviata.',
      'client.finalized': 'Cliente eliminato alla fine del suo incarico.',
      'account.enabled': 'Account riattivato.',
      'account.deleted': 'Account eliminato.',
      'account.termsAccepted': 'Condizioni d’uso accettate.',
      'account.secondFactorEnrolled': 'Verifica in due passaggi attivata.',
      'account.secondFactorDisabled': 'Verifica in due passaggi disattivata.',
      'account.recoveryCodesRegenerated': 'Codici di recupero rinnovati.',
      'account.recoveryCodeUsed': 'È stato usato un codice di recupero.',
    },
    actionInvitationIssuedPending: 'Invito emesso; attende il consenso di un proprietario.',
    actionOther: 'È stata registrata un’azione.',
    accountActionsColumn: 'Azioni sull’account',
    disableAccount: 'Disattiva',
    enableAccount: 'Riattiva',
    deleteAccount: 'Elimina',
    disableTitle: (address: string) => `Disattivare l’account di ${address}?`,
    disableBody:
      'Tutte le sue sessioni terminano subito e la persona non può più accedere. Non viene eliminato nulla: riattivarlo restituisce l’accesso, ma dovrà accedere di nuovo.',
    accountDisabledDone: 'Account disattivato.',
    accountEnabledDone: 'Account riattivato.',
    deleteTitle: (address: string) => `Eliminare l’account di ${address}?`,
    deleteBody:
      'Risponde a una richiesta di cancellazione. L’account, le sue appartenenze, gli inviti indirizzati a lui, il suo secondo fattore e i link di condivisione che ha creato scompaiono. Le righe del registro che ha scritto restano, senza il suo nome, e così gli inviti che ha emesso. Il suo indirizzo resta nelle sue sessioni aperte (al massimo sette giorni) e nei link già emessi fino alla loro scadenza. Questa azione è definitiva.',
    accountDeletedDone: 'Account eliminato.',
    offboardTitle: 'Fine dell’incarico',
    offboardIntro:
      'Gli eventi in diretta vengono chiusi, le bozze archiviate, il cliente sospeso e i suoi album eliminati al più tardi allo scadere del termine che lei indica: è il tempo di cui il cliente dispone per esportare ciò che vuole conservare (la conservazione propria di un evento o i limiti del cliente possono eliminarli prima). Poi vengono eliminati gli account che appartenevano solo a lui e non hanno nient’altro, e con essi il cliente.',
    graceDays: 'Termine prima dell’eliminazione, in giorni',
    graceDaysHint: 'Un numero intero di giorni: i limiti sono quelli del server.',
    offboardAction: 'Concludi l’incarico',
    offboardConfirmTitle: 'Concludere l’incarico di questo cliente?',
    offboardConfirmBody: (days: number) =>
      t.count(days, {
        one: `Tra ${t.number(days)} giorno al più tardi gli album di questo cliente verranno eliminati, poi il cliente stesso con gli account che appartenevano solo a lui e non hanno nient’altro. Senza possibilità di recupero: né la data né la sospensione potranno essere modificate. Fino ad allora i suoi eventi in diretta sono chiusi, le sue bozze archiviate e il cliente sospeso.`,
        other: `Tra ${t.number(days)} giorni al più tardi gli album di questo cliente verranno eliminati, poi il cliente stesso con gli account che appartenevano solo a lui e non hanno nient’altro. Senza possibilità di recupero: né la data né la sospensione potranno essere modificate. Fino ad allora i suoi eventi in diretta sono chiusi, le sue bozze archiviate e il cliente sospeso.`,
      }),
    offboardedDone: 'Fine dell’incarico avviata.',
    offboardingRunning:
      'Questo incarico sta per concludersi: gli album verranno eliminati al più tardi alla data indicata sopra.',
    daysNotWhole: 'Indichi un numero intero di giorni.',
  },

  titles: {
    join: 'Entri nella galleria',
    upload: 'Invio di foto',
    feed: 'Foto della serata',
    wall: 'Schermo dell’evento',
    gallery: 'Album condiviso',
    about: 'Informazioni',
    notFound: 'Pagina non trovata',
    login: 'Accesso',
    forgotPassword: 'Password dimenticata',
    resetPassword: 'Nuova password',
    invitation: 'Invito',
    changePassword: 'Cambio della password',
    security: 'Sicurezza dell’account',
    dashboard: 'I suoi eventi',
    newEvent: 'Nuovo evento',
    event: 'Evento',
    moderation: 'Moderazione',
    mobileModeration: 'Moderazione da telefono',
    settings: 'Impostazioni dell’evento',
    customAmbiance: 'Atmosfera su misura',
    clientSpace: 'Area cliente',
    site: 'Console dell’operatore',
    siteClient: 'Cliente',
    siteAccounts: 'Account dell’istanza',
    siteAudit: 'Registro dell’istanza',
  },
}
