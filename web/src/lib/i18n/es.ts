import { formattersFor } from './formatters'
import type { UiText } from './translations'

/**
 * Spanish, for every surface: the guest’s phone, the host’s and the moderators’
 * consoles, and the projected wall.
 *
 * The type on this table is `UiText` — the whole of `fr.ts`, every literal widened to
 * `string` — so a key added to the French table fails the build here until this one
 * carries it. `translations.ts` has the argument, including the guest-only one it
 * reversed.
 *
 * Register: usted throughout, peninsular Spanish, sentence case. The app is the host's
 * voice speaking to somebody else's guest, so the familiar form would be the wrong
 * distance even where a phone app would normally take it.
 *
 * Typography: a question carries its inverted opening mark and so does an exclamation,
 * accents and ñ are written out, quotation marks are the angular pair, and the
 * apostrophe — which Spanish barely needs — is U+2019 (’) and never the ASCII one.
 */

const t = formattersFor('es')

/**
 * "a la 1:00" but "a las 13:00": the article agrees with the hour, and the time arrives already
 * formatted by the browser ("1:00", "01:00"), so the hour is read off its front.
 */
const atTime = (time: string): string =>
  /^0?1(?![0-9])/.test(time) ? `a la ${time}` : `a las ${time}`

export const es: UiText = {
  app: {
    name: 'EventSlide',
    loadFailed: 'No se ha podido cargar',
    loading: 'Cargando…',
    retry: 'Reintentar',
    cancel: 'Cancelar',
    close: 'Cerrar',
    save: 'Guardar',
    confirm: 'Confirmar',
    language: 'Idioma',
  },

  join: {
    title: 'Únase a la fiesta',
    codeLabel: 'Código de la fiesta',
    codeHint: 'Seis caracteres, indicados en la tarjeta o en el código QR.',
    nameLabel: 'Su nombre',
    nameHint: 'Aparecerá debajo de sus fotos. Puede dejarlo en blanco.',
    submit: 'Unirse',
    submitting: 'Conectando…',
    welcome: (eventName: string) => `Le damos la bienvenida a ${eventName}`,
    logoAlt: (eventName: string) => `Logo de ${eventName}`,
    anonymous: 'Mantener el anonimato',
    /* Navigation pass, batch A: leaving a wrong event, a code that opens nothing, the way to the organiser area. */
    notYourEvening: '¿No es su fiesta?',
    notOpenHint:
      'Si ha escaneado un código QR, puede que la fiesta aún no esté abierta o que ya haya terminado. Inténtelo de nuevo en un momento o pregunte a la organización.',
    organiserLink: 'Espacio de organizadores',
  },

  upload: {
    intro: 'Añada sus fotos. Aparecerán en la pantalla una vez aprobadas.',
    addPhotos: 'Añadir fotos',
    takePhoto: 'Hacer una foto',
    captionLabel: 'Pie de foto',
    captionHint: (max: number) => `${t.number(max)} caracteres como máximo. Opcional.`,
    send: 'Enviar',
    sendCount: (count: number) =>
      t.count(count, { one: 'Enviar la foto', other: `Enviar las ${t.number(count)} fotos` }),
    queueEmpty: 'Todavía no ha seleccionado ninguna foto.',
    foldPane: 'Plegar',
    openPane: 'Enviar una foto',
    openPaneReady: (count: number) =>
      t.count(count, {
        one: 'Reabrir el panel: 1 foto lista',
        other: `Reabrir el panel: ${t.number(count)} fotos listas`,
      }),
    itemPending: 'Lista',
    itemUploading: 'Enviando',
    itemDone: 'Enviada',
    itemDuplicate: 'Ya enviada',
    itemFailed: 'Error',
    mine: 'Sus envíos',
    statusPending: 'Pendiente de aprobación',
    statusPublished: 'En la pantalla',
    statusRejected: 'No seleccionada',
    statusHidden: 'Retirada de la pantalla',
    deleteOwn: 'Eliminar',
    deleteOwnConfirm: '¿Eliminar esta foto? Esta acción es definitiva.',
    eraseOpen: 'Eliminar todo lo que envié',
    eraseTitle: '¿Eliminar todo?',
    eraseBody:
      'Sus fotos, vídeos, leyendas, reacciones y su nombre se borrarán de la fiesta: de la pantalla, del álbum y de la lista del organizador. Es definitivo.',
    eraseLimits:
      'Una copia que el organizador u otro invitado ya hayan guardado, o que alguien haya capturado de la pantalla, no se puede recuperar.',
    eraseConfirm: 'Sí, eliminar todo',
    eraseCancel: 'No, conservar',
    eraseFailed: 'No se pudo eliminar. Inténtelo de nuevo o pídaselo al organizador.',
    eraseDoneTitle: 'Hecho',
    eraseDone:
      'Todo lo que había enviado se ha eliminado de la fiesta. Este teléfono ya no está vinculado a ella.',
    eraseLostAccess:
      '¿Cambió de teléfono o perdió el acceso? Pídale al organizador que elimine sus fotos: puede hacerlo desde su espacio.',
    revokedTitle: 'Se retiró su acceso',
    revokedBody:
      'El organizador retiró su acceso: ya no puede enviar fotos. Todavía puede eliminar todo lo que envió.',

    itemPreparing: 'Preparando…',
    queueLabel: 'Fotos por enviar',
    queueSummary: (done: number, total: number) =>
      t.count(done, {
        one: `${t.number(done)} enviada de ${t.number(total)}`,
        other: `${t.number(done)} enviadas de ${t.number(total)}`,
      }),
    queueFailed: (count: number) =>
      t.count(count, {
        one: 'Un envío ha fallado.',
        other: `${t.number(count)} envíos han fallado.`,
      }),
    /**
     * What the pane says once every photo of the batch has arrived, in one line: how many, and
     * how many of them the event already held. The rows behind it keep each photo's own word.
     * Counted by `t.count`, so the agreement is the language's own, zero included.
     */
    queueDone: (arrived: number, already: number) => {
      if (already > 0 && already === arrived) {
        return t.count(arrived, {
          one: 'Esta foto ya estaba enviada',
          other: `Estas ${t.number(arrived)} fotos ya estaban enviadas`,
        })
      }
      const sent = t.count(arrived, {
        one: `${t.number(arrived)} foto enviada`,
        other: `${t.number(arrived)} fotos enviadas`,
      })
      if (already === 0) return sent
      const there = t.count(already, {
        one: `${t.number(already)} ya estaba`,
        other: `${t.number(already)} ya estaban`,
      })
      return `${sent} (${there})`
    },
    queueViewMine: 'Ver mis envíos',
    queueDetails: 'Detalles',
    queueDismiss: 'Ocultar el resumen',
    itemAlt: (position: number) => `Foto ${t.number(position)} por enviar`,
    itemProgress: (position: number) => `Enviando la foto ${t.number(position)}`,
    removeItem: (position: number) => `Quitar la foto ${t.number(position)}`,
    retryItem: (position: number) => `Volver a enviar la foto ${t.number(position)}`,
    captionRemaining: (remaining: number) =>
      t.count(remaining, {
        one: `Queda ${t.number(remaining)} carácter.`,
        other: `Quedan ${t.number(remaining)} caracteres.`,
      }),
    signedAs: (name: string) => `Sus fotos aparecerán con el nombre ${name}.`,
    signedAnonymous: 'Sus fotos aparecerán sin nombre.',
    mineEmpty: 'Todavía no ha enviado ninguna foto.',
    mineFailed: 'No se ha podido actualizar la lista de sus envíos. Inténtelo de nuevo.',
    mineAlt: 'Su foto',
    /* "Levez les yeux" (UX review 2026-10-30): a photo of the guest's goes from waiting to on the wall. */
    photoDeveloped: '¡Aprobada! Saldrá en la pantalla en un momento: levante la vista.',
    photoDevelopedAway: 'Ya ha salido en la pantalla.',
    deleteOwnNumbered: (position: number) => `Eliminar la foto ${t.number(position)}`,
    notJoinedTitle: 'Únase a la fiesta para enviar sus fotos',
    notJoinedHint: 'Vuelva a escanear el código QR o introduzca el código de la fiesta.',
    notJoinedAction: 'Introducir el código',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    galleryUnavailable: 'Esta fiesta ya no está disponible. Ya no puede enviar fotos.',
    galleryUnavailableAction: 'Introducir de nuevo el código',

    missionsTitle: 'Misiones',
    missionsHint: 'Toque una misión y luego envíe su foto.',
    missionDone: 'Hecho',
    missionDoneByRoom: 'Ya fotografiada',
    missionFor: (prompt: string) => `Estas fotos contarán para «${prompt}».`,

    itemQueued: 'Saldrá en cuanto vuelva la conexión',
    itemExpiredHint: 'Esta foto no se ha podido enviar. Vuelva a enviarla si todavía la tiene.',
    offlineTitle: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto espera la conexión`,
        other: `${t.number(count)} fotos esperan la conexión`,
      }),
    offlineHint:
      'Están guardadas en su teléfono y saldrán en cuanto vuelva la conexión. Puede cerrar esta página.',
    offlineSending: 'Enviando las fotos en espera…',
    offlineRetry: 'Enviar ahora',

    /* Guest traps and end-of-evening pass (revue UX 30/10: INV-1, 4, 7, 8). */
    offlineHintNoSync:
      'Están guardadas en su teléfono y saldrán en cuanto vuelva la conexión. Mantenga esta página abierta hasta entonces.',
    queueReady: (count: number) =>
      t.count(count, {
        one: 'Una foto lista: pulse Enviar.',
        other: `${t.number(count)} fotos listas: pulse Enviar.`,
      }),
    leaveWaitCount: (done: number, total: number) =>
      `Espere, envío en curso (${t.number(done)}/${t.number(total)})`,
    leaveWait: 'Espere, envío en curso…',
    endedTitle: 'Por esta noche, se acabó.',
    endedThanks: (count: number) =>
      t.count(count, {
        one: '¡Gracias por su foto!',
        other: `¡Gracias por sus ${t.number(count)} fotos!`,
      }),
    endedThanksNone: '¡Gracias por haber estado con nosotros!',
    endedAlbum: 'Los organizadores compartirán el álbum.',

    installTitle: 'Tenga la fiesta siempre a mano',
    installHint:
      'Añádala a su pantalla de inicio para volver a la fiesta más tarde, sin buscar el código QR.',
    installIosHint: 'Abra el menú Compartir y elija «Añadir a pantalla de inicio».',
    installAction: 'Añadir a la pantalla de inicio',
    installDismiss: 'Ocultar esta sugerencia',

    clipSection: 'Vídeo',
    addClip: 'Añadir un vídeo',
    recordClip: 'Grabar un vídeo',
    clipHint: (seconds: number, megabytes: number) =>
      `${t.number(seconds)} segundos y ${t.number(megabytes)} MB como máximo. El vídeo se reproduce sin sonido.`,
    clipSend: 'Enviar el vídeo',
    clipChange: 'Elegir otro vídeo',
    clipDiscard: 'Quitar este vídeo',
    clipCancel: 'Cancelar el envío',
    clipAlreadySent:
      'Este vídeo ya está en el servidor. Se procesará y después pasará al organizador.',
    clipChosen: 'Vídeo listo para enviar',
    clipSize: (megabytes: number) => `${t.number(megabytes)} MB`,
    clipTooLarge: (megabytes: number) =>
      `Este vídeo supera los ${t.number(megabytes)} MB. Grabe una secuencia más corta.`,
    clipTooLong: (seconds: number) =>
      `Este vídeo supera los ${t.number(seconds)} segundos. Grabe una secuencia más corta.`,
    clipNotAVideo: 'Este archivo no es un vídeo.',
    /**
     * The trim screen (spec 16), opened in place of a "too long" refusal. Nothing on it
     * can be wrong: the handles keep the range valid, so there is no error sentence here.
     */
    clipTrimTitle: (seconds: number) =>
      `Elija los ${t.number(seconds)} segundos que quiere conservar`,
    clipTrimStart: 'Inicio del fragmento',
    clipTrimEnd: 'Final del fragmento',
    clipTrimValue: (seconds: number) => `${t.number(seconds)} segundos`,
    clipTrimSummary: (seconds: number, maxSeconds: number) =>
      `Fragmento: ${t.number(seconds)} s de ${t.number(maxSeconds)} s como máximo`,
    clipTrimPlay: 'Reproducir el fragmento',
    clipTrimPause: 'Pausar el fragmento',
    clipTrimNoPreview:
      'No hay vista previa en este dispositivo. El fragmento se recortará igualmente.',
    clipTrimWholeFileSent:
      'Solo se conserva el fragmento elegido. Si este teléfono no puede recortarlo, se envía el vídeo entero y luego se recorta.',
    clipSendTrimmed: 'Enviar este fragmento',
    clipUploading: 'Enviando el vídeo…',
    clipQueued: 'En la cola…',
    clipRunning: 'Procesando el vídeo…',
    clipDone: 'Vídeo enviado. Aparecerá en la pantalla una vez aprobado.',
    clipProgress: 'Enviando el vídeo',
    clipQueueFullRetry: (seconds: number) =>
      seconds <= 1
        ? 'Se están procesando muchos vídeos. Inténtelo de nuevo en un momento.'
        : `Se están procesando muchos vídeos. Inténtelo de nuevo dentro de ${t.number(seconds)} segundos.`,
    clipQueueFreed: 'La cola se ha liberado. Puede volver a enviar el vídeo.',
    clipStillWorking:
      'El procesamiento de este vídeo está tardando más de lo previsto. Vuelva a cargar la página dentro de unos minutos para saber si ha terminado bien.',
    clipNotQueued:
      'Los vídeos no quedan en espera en su teléfono: son demasiado pesados. Inténtelo de nuevo cuando vuelva la conexión.',
    mineClipAlt: 'Su vídeo',
    mineClipBadge: 'Vídeo',
    mineClipLength: (seconds: number) => `Vídeo · ${t.number(seconds)} s`,
    mineMission: (prompt: string) => `Misión: ${prompt}`,
    mineChallenge: 'Reto',
    introImmediate: 'Añada sus fotos. Aparecerán en la pantalla enseguida.',
    noticeLink: 'Cómo se usan sus fotos',
    noticeTitle: 'Antes de su primera foto',
    noticeChangedTitle: 'Esta información ha cambiado',
    noticeChangedHint: 'El organizador ha cambiado un ajuste desde su última lectura.',
    noticeAcknowledge: 'Entendido',
    noticeWhatHappens: 'Qué pasa con sus fotos',
    noticeWhoSees: 'Quién ve sus fotos',
    noticeHowLong: 'Cuánto tiempo se guardan',
    noticeRemoval: 'Cómo retirar una',
    noticeMetadataStripped:
      'La ubicación y los datos del dispositivo se eliminan de cada foto al llegar.',
    noticePublication: {
      afterReview: 'El organizador aprueba cada foto antes de que aparezca en la pantalla.',
      immediate:
        'Aparecen en la pantalla en cuanto llegan. El organizador puede retirar cualquiera en todo momento.',
    },
    noticeAudiences: {
      wall: 'Cualquiera que mire la pantalla del evento, en la sala o a través de su enlace, una vez que la foto aparece en ella.',
      guestFeed:
        'Los demás invitados de la fiesta, en su teléfono, en «Fotos de la velada»: ven la foto mostrada en la pantalla, con su nombre de pila si lo ha indicado, y su pie de foto.',
      organisers:
        'El organizador y su equipo, que ven todo lo que usted envía y pueden descargar las fotos mostradas en la pantalla.',
      sharedGallery:
        'Las personas a las que el organizador envíe un enlace privado al álbum, si lo crea, y aquellas a las que se reenvíe ese enlace: pueden ver y descargar en resolución completa las fotos mostradas en la pantalla, hasta que el enlace caduque o sea retirado.',
    },
    /** Said after the audiences, only on an evening where saving is on (spec 24). */
    noticeGuestSave:
      'Los demás invitados pueden guardar su foto en su teléfono, sin el lugar ni la cámara con la que se tomó. Una copia guardada no se puede recuperar.',
    noticeRetentionDays: (days: number) =>
      t.count(days, {
        one: `Se borran automáticamente ${t.number(days)} día después de que el organizador finalice la fiesta.`,
        other: `Se borran automáticamente ${t.number(days)} días después de que el organizador finalice la fiesta.`,
      }),
    noticeRetentionNone:
      'No hay ningún borrado automático previsto: se conservan hasta que el organizador las borre.',
    noticeRemovalSeconds: (seconds: number) =>
      t.count(seconds, {
        one: `Puede eliminar una usted mismo durante ${t.number(seconds)} segundo después de enviarla, mientras no haya sido aprobada.`,
        other: `Puede eliminar una usted mismo durante ${t.number(seconds)} segundos después de enviarla, mientras no haya sido aprobada.`,
      }),
    noticeRemovalMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `Puede eliminar una usted mismo durante ${t.number(minutes)} minuto después de enviarla, mientras no haya sido aprobada.`,
        other: `Puede eliminar una usted mismo durante ${t.number(minutes)} minutos después de enviarla, mientras no haya sido aprobada.`,
      }),
    noticeRemovalHours: (hours: number) =>
      t.count(hours, {
        one: `Puede eliminar una usted mismo durante ${t.number(hours)} hora después de enviarla, mientras no haya sido aprobada.`,
        other: `Puede eliminar una usted mismo durante ${t.number(hours)} horas después de enviarla, mientras no haya sido aprobada.`,
      }),
    noticeRemovalOtherwise: 'Si no, pídaselo al organizador: puede eliminar cualquier foto.',
    noticeRemovalAskHost: 'Pídaselo al organizador: puede eliminar cualquier foto.',
    noticeErasure: (action: string, section: string) =>
      `También puede eliminarlo todo desde su teléfono: «${action}», en «${section}».`,
    clipDoneImmediate: 'Vídeo enviado. Ya pasa a la pantalla.',

    /* ---- Added by guest reactions. ---- */

    reactionKinds: {
      love: 'Me encanta',
      laugh: 'Jaja',
      wow: 'Guau',
      cheers: 'Salud',
      clap: 'Aplausos',
    },
    reactionsGroup: (position: number) => `Reaccionar a la foto ${t.number(position)}`,
    reactionsFailed: 'No se han podido cargar las reacciones.',
  },

  ui: {
    dialogClose: 'Cerrar la ventana',
    tourStep: (step: number, total: number) => `Paso ${step} de ${total}`,
    tourNext: 'Siguiente',
    tourPrevious: 'Anterior',
    tourSkip: 'Saltar',
    tourFinish: 'Terminar',
    tourLater: 'Más tarde',
    tourStart: 'Hacer el recorrido',
    dismissNotification: 'Ocultar esta notificación',
    percent: (value: number) => t.percent(value),
    optional: 'Opcional',
  },

  shell: {
    skipToContent: 'Ir al contenido principal',
    sessionChecking: 'Comprobando su sesión…',
    sessionFailed: 'No se ha podido comprobar su sesión. Revise su conexión e inténtelo de nuevo.',
    crashTitle: 'Esta pantalla se ha detenido',
    crashHint:
      'No se ha perdido nada: sus fotos están en el servidor. Inténtelo de nuevo para continuar.',
    notFoundTitle: 'Página no encontrada',
    notFoundHint: 'Esta dirección no existe. Compruebe el enlace o vuelva al inicio.',
    notFoundHome: 'Volver al inicio',
    /* Navigation pass, batch B: the way home from a 404 or a crash, and the expired-session banner. */
    hostHome: 'Ir a sus eventos',
    sessionExpired: 'Su sesión ha caducado.',
    sessionExpiredAction: 'Vuelva a iniciar sesión',
    crashAutoRetry: 'Se volverá a intentar automáticamente en un momento…',
  },

  errors: {
    'clientName.empty': 'Dé un nombre al cliente.',
    'clientName.tooLong': 'Este nombre es demasiado largo.',
    'clientName.invalid': 'Este nombre contiene un carácter que no se acepta.',
    'clientCeilings.maxEventsInvalid': 'Este número de eventos no se acepta.',
    'clientCeilings.maxEventsPerPeriodInvalid': 'Este número de eventos por periodo no se acepta.',
    'clientCeilings.maxTotalBytesInvalid': 'Este almacenamiento total no se acepta.',
    'clientCeilings.maxEventQuotaBytesInvalid': 'Esta cuota de evento no se acepta.',
    'clientCeilings.maxRetentionDaysInvalid':
      'Esta duración de conservación no se acepta: de 1 a 3.650 días.',
    'clientCeilings.maxLiveDaysInvalid':
      'Esta duración de evento en curso no se acepta: de 1 a 365 días.',
    'clientCeilings.periodStartedAtInvalid': 'Este inicio de periodo no se acepta.',
    'clientCeilings.clipsAllowedInvalid': 'Este ajuste de vídeos no se acepta.',
    'clientCeilings.channelsAllowedInvalid': 'Este ajuste de mensajería no se acepta.',
    'clientCeilings.booksAllowedInvalid': 'Este ajuste del libro de fotos no se acepta.',
    'clientCeilings.liveAllowedInvalid': 'Este ajuste de apertura no se acepta.',
    'siteLookup.queryInvalid':
      'Introduzca un identificador, un código, una dirección o el nombre de un evento (300 caracteres como máximo).',
    'audit.reasonInvalid':
      'El motivo debe caber en una línea de 200 caracteres como máximo, sin dirección de correo.',
    'reset.mailerRequired':
      'Esta instancia no envía correo: no se puede emitir ningún enlace de restablecimiento.',
    'reset.mailNotSent':
      'El servidor de correo ha rechazado el mensaje. No se ha emitido ningún enlace.',
    'reset.approverUnavailable':
      'Esta cuenta no pertenece a ningún cliente, o pertenece a varios: ningún propietario puede aprobar la solicitud.',
    'reset.requestNotFound': 'Esta solicitud no existe o todavía no se ha aprobado.',
    'reset.tooManyForAddress':
      'Esta dirección ya ha recibido varios restablecimientos. Inténtelo de nuevo dentro de una hora.',
    'account.disabled': 'Esta cuenta está desactivada.',
    'account.operatorProtected': 'La cuenta de un operador no se puede desactivar ni eliminar.',
    'account.holdsEvents': 'Esta cuenta posee un evento: transfiéralo o elimínelo antes.',
    'account.holdsMedia': 'Esta cuenta subió fotos o vídeos, cuyos archivos quedarían en el disco.',
    'account.holdsReviews': 'Esta cuenta revisó fotos, cuyas filas llevan su nombre.',
    'account.lastClientOwner':
      'Esta cuenta es la única propietaria de un cliente que aún tiene miembros o eventos: añada un propietario o ponga fin al compromiso del cliente.',
    'client.graceInvalid': 'Este plazo no se acepta. Indique un número entero de días.',
    'client.offboarding':
      'La colaboración con este cliente está terminando: su suspensión no se puede levantar.',
    unknown: 'Se ha producido un error. Inténtelo de nuevo en un momento.',
    network: 'Se ha interrumpido la conexión. Revise su red e inténtelo de nuevo.',
    'request.invalid': 'Los datos enviados no son válidos.',

    'auth.invalidCredentials': 'La dirección de correo o la contraseña no son correctas.',
    'auth.required': 'Inicie sesión para continuar.',
    'auth.forbidden': 'No tiene permisos para esta acción.',
    'auth.passwordChangeRequired': 'Elija una nueva contraseña antes de continuar.',
    'auth.invalidToken': 'Este enlace ya no es válido. Solicite uno nuevo.',
    'auth.invalidSecondFactor':
      'Ese código no es válido. Espere al siguiente en su aplicación, o use un código de recuperación.',
    'auth.secondFactorExpired': 'Esta conexión ha caducado. Empiece de nuevo con la contraseña.',
    'auth.tooManySecondFactorAttempts':
      'Demasiados códigos erróneos. Vuelva a intentarlo dentro de un cuarto de hora.',
    'auth.secondFactorRequired': 'Esta cuenta debe pasar primero la verificación en dos pasos.',
    'auth.stepUpRequired': 'Confirme su identidad para continuar.',
    'auth.secondFactorAlreadyEnrolled':
      'La verificación en dos pasos ya está activa en esta cuenta.',
    'auth.noEnrolmentInProgress': 'No hay ninguna activación en curso. Empiece de nuevo.',
    'auth.secondFactorUnavailable':
      'Este servidor no puede comprobar ahora el código de la aplicación. Use un código de recuperación.',
    'auth.totpCodeInvalid': 'Introduzca las seis cifras que muestra la aplicación.',
    'auth.secondFactorNotEnrolled': 'La verificación en dos pasos no está activa en esta cuenta.',
    'feature.unavailable': 'Esta función no está disponible en este servidor.',

    'event.notFound': 'Este código no corresponde a ninguna fiesta abierta.',
    'event.notAcceptingUploads': 'Esta fiesta ya no acepta fotos.',
    'event.quotaExceeded': 'La fiesta ha alcanzado su capacidad. Avise al organizador.',
    'event.slugUnavailable': 'Esta dirección ya está en uso.',
    'event.customSlugNotAllowed': 'Esta instancia no permite elegir su propia dirección.',
    'event.creationRateLimited':
      'Ha creado demasiados eventos recientemente. Inténtelo de nuevo más tarde.',
    'event.quotaAboveCeiling': 'Esta cuota supera el límite que permite este servidor.',
    'event.creationNotAllowed': 'Su cuenta no puede crear eventos en este servidor.',
    'client.notFound': 'No se encuentra esta cuenta de cliente.',
    'client.ownerRequired': 'Solo un propietario de la cuenta puede consultar esto.',
    'client.ceilingReached': 'Su cuenta ha alcanzado el número de eventos permitido.',
    'client.storageFull': 'La fiesta ha alcanzado su capacidad. Avise al organizador.',
    'client.liveNotAllowed': 'Su cuenta no puede abrir un evento por ahora.',
    'client.liveWindowOver':
      'El periodo de apertura de este evento ha terminado: ya no se puede reabrir.',
    'client.retentionAboveCeiling': 'Este periodo de conservación supera el que permite su cuenta.',
    'client.clipsNotAllowed': 'Los vídeos no están disponibles en esta fiesta.',
    'event.immutable': 'Este evento está archivado y ya no se puede modificar.',
    'event.illegalTransition': 'Este cambio de estado no es posible.',

    'guest.revoked': 'El organizador ha retirado su acceso.',
    'guestToken.expired': 'Su acceso ha caducado. Vuelva a escanear el código QR.',
    'guestToken.malformed': 'Su acceso ya no es válido. Vuelva a escanear el código QR.',
    'guestToken.badSignature': 'Su acceso ya no es válido. Vuelva a escanear el código QR.',

    'photo.notFound': 'Esta foto ya no existe.',
    'photo.illegalTransition': 'Esta acción no es posible en esta foto.',
    'highlight.notPublished': 'Solo una foto publicada puede ser favorita.',
    'highlight.empty': 'Todavía no hay favoritas.',
    'book.alreadyRunning': 'Ya se está preparando un libro.',
    'book.empty': 'Todavía no hay fotos publicadas: no hay libro que hacer.',
    'book.dailyLimitReached': 'Has alcanzado el límite de libros de hoy. Inténtalo mañana.',
    'book.unavailable': 'Los libros de fotos no están disponibles por ahora.',
    'book.notAllowed': 'Tu espacio no incluye libros de fotos.',
    'book.notFound': 'Este libro ya no está disponible. Rehazlo.',
    'book.titleEmpty': 'Ponle un título al libro.',
    'book.titleTooLong': 'Este título es demasiado largo.',
    'book.subtitleTooLong': 'Este subtítulo es demasiado largo.',
    'export.alreadyRunning': 'Ya se está preparando un archivo.',
    'export.notClosed': 'El archivo se puede preparar cuando el evento esté cerrado.',
    'export.noRoom':
      'El servidor no tiene espacio suficiente para preparar el archivo. Descargue el álbum directamente o avise al operador.',
    'export.tooLarge':
      'El archivo superaría el tamaño que el servidor acepta preparar. Descargue el álbum directamente.',
    'export.dailyLimitReached':
      'Se ha alcanzado el límite diario de archivos para este evento. Inténtelo mañana o descargue el álbum directamente.',
    'export.unavailable':
      'La preparación de archivos está desactivada en este servidor. Descargue el álbum directamente.',
    'export.notFound': 'Este archivo ya no está disponible. Vuelva a prepararlo.',
    'reel.notEnoughPhotos': 'Hacen falta al menos tres favoritas publicadas para hacer un vídeo.',
    'reel.tooManyPhotos': 'Demasiadas favoritas para un vídeo: quite algunas.',
    'reel.alreadyRunning': 'Ya se está haciendo un vídeo.',
    'reel.queueFull': 'Hay muchos vídeos en espera. Inténtelo de nuevo en unos minutos.',
    'reel.notAllowed': 'El vídeo no está incluido en su plan.',
    'reel.transcoderUnavailable': 'El vídeo no está disponible en este servidor.',
    'reel.notReady': 'El vídeo no está listo.',
    'reel.eventUnavailable': 'Este evento ya no está disponible.',
    'reel.renderFailed': 'No se ha podido hacer el vídeo. Inténtelo de nuevo.',
    'reel.storageFailed': 'No se ha podido guardar el vídeo. Inténtelo de nuevo.',
    'reel.timedOut': 'El vídeo ha tardado demasiado. Inténtelo de nuevo.',
    'reel.cancelled': 'El vídeo se ha interrumpido. Inténtelo de nuevo.',

    'image.unsupportedFormat':
      'Este archivo no es una foto. Formatos aceptados: JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'Esta foto parece dañada. Pruebe con otra.',
    'image.animated': 'No se aceptan imágenes animadas.',
    'image.renderFailed': 'Esta foto no se ha podido procesar. Pruebe con otra.',
    'image.renderUnavailable':
      'Esta foto no se ha podido procesar ahora: el servidor no está disponible momentáneamente. Inténtelo de nuevo en un momento.',
    'upload.tooLarge': 'Esta foto supera el tamaño máximo.',
    'upload.tooManyFiles': 'Demasiadas fotos a la vez. Envíelas en varias tandas.',

    'caption.tooLong': 'El pie de foto es demasiado largo.',
    'caption.empty': 'El pie de foto está vacío.',

    'password.tooShort': 'La contraseña es demasiado corta.',
    'password.tooLong': 'La contraseña es demasiado larga.',
    'password.tooCommon': 'Esta contraseña es demasiado común.',
    'password.sameAsEmail': 'La contraseña no puede ser su dirección de correo.',
    'password.sameAsName': 'La contraseña no puede ser su nombre.',
    'password.tooRepetitive': 'Esta contraseña es demasiado repetitiva.',
    'password.unchanged': 'Elija una contraseña distinta de la actual.',
    'password.mismatch': 'Las dos contraseñas no coinciden.',

    'eventName.empty': 'Póngale un nombre a su evento.',
    'eventName.tooShort': 'Este nombre es demasiado corto.',
    'eventName.tooLong': 'Este nombre es demasiado largo.',
    'slug.tooShort': 'La dirección debe tener al menos dos caracteres.',
    'slug.tooLong': 'Esta dirección es demasiado larga.',
    'slug.malformed': 'La dirección solo admite letras sin acento, números y guiones.',
    'slug.reserved': 'Esta dirección está reservada. Elija otra.',
    'logo.tooLarge': 'Este logotipo pesa demasiado, incluso reducido. Pruebe con otro.',
    'logo.notFound': 'Este logotipo ya no existe.',
    'logo.saveFailed': 'No se ha podido guardar el logotipo. Inténtelo de nuevo.',
    'eventSettings.welcomeInvalid': 'Este mensaje no es válido.',
    'eventSettings.welcomeTooLong': 'Este mensaje es demasiado largo.',
    'eventSettings.welcomeTooManyLines': 'Este mensaje tiene demasiadas líneas.',
    'eventSettings.saveFailed': 'No se han podido guardar los ajustes. Inténtelo de nuevo.',
    'eventSettings.revealInPast': 'La hora de la revelación debe estar en el futuro.',
    'eventSettings.revealDone':
      'La velada ya se ha revelado: la hora ya no se puede mover ni borrar.',
    'eventSettings.revealInstantInvalid': 'Esta hora de revelación no es válida.',
    'eventSettings.graceSecondsInvalid': 'Este plazo de eliminación no se admite.',
    'eventSettings.retentionDaysInvalid': 'Este plazo de conservación no se admite.',
    'eventSettings.maxPhotosPerGuestInvalid': 'Este número de fotos por invitado no se admite.',
    'wallMixed.wallTooShort': 'El tiempo en el muro debe estar entre 30 segundos y 60 minutos.',
    'wallMixed.wallTooLong': 'El tiempo en el muro debe estar entre 30 segundos y 60 minutos.',
    'wallMixed.slideshowTooShort':
      'El tiempo del pase de fotos debe estar entre 15 segundos y 30 minutos.',
    'wallMixed.slideshowTooLong':
      'El tiempo del pase de fotos debe estar entre 15 segundos y 30 minutos.',
    'eventSettings.wallLanguageInvalid': 'Este idioma no está disponible. Elija uno de la lista.',
    'email.malformed': 'Esta dirección de correo no es válida.',
    'user.notFound': 'Ninguna cuenta corresponde a esta dirección de correo.',
    'membership.alreadyExists': 'Esta persona ya modera este evento.',
    'invitation.tooManyForAddress':
      'Esta dirección ya ha recibido varias invitaciones. Inténtelo de nuevo dentro de una hora.',
    'invitation.notFound':
      'Esta invitación ya no es válida. Pida una nueva a la persona que se la envió.',
    'invitation.signInRequired':
      'Ya existe una cuenta con la dirección de esta invitación. Inicie sesión con esa cuenta: volverá aquí para aceptarla.',
    'terms.notAccepted': 'Para continuar, marque la casilla que acepta las condiciones de uso.',
    'invitation.wrongAccount':
      'Esta invitación estaba destinada a una dirección de correo distinta de la de esta cuenta.',
    'invitation.credentialsRequired':
      'Inicie sesión con la cuenta invitada, o elija un nombre y una contraseña.',
    'accountName.empty': 'Indique su nombre.',
    'accountName.tooLong': 'Este nombre es demasiado largo.',

    'displayName.tooLong': 'El nombre es demasiado largo.',
    'joinCode.wrongLength': 'Este código no tiene el número correcto de caracteres.',
    'joinCode.malformed': 'Este código contiene un carácter inesperado.',

    'reaction.rateLimited': 'Con calma: espere un momento antes de volver a reaccionar.',
    'rate.limited': 'Demasiados intentos. Espere un momento.',

    'event.captionsNotAllowed': 'Los pies de foto no están activados en esta fiesta.',
    'event.reactionsDisabled': 'Las reacciones no están activadas en esta fiesta.',
    'event.guestSelfDeleteDisabled':
      'El organizador no permite que los invitados eliminen sus fotos.',
    'photo.captionEditForbidden': 'Este pie de foto ya no se puede modificar.',
    'photo.deleteForbidden': 'Ya no puede eliminar esta foto por su cuenta.',
    'reaction.alreadyExists': 'Ya ha reaccionado así a esta foto.',
    'reaction.notPublished': 'Esta foto todavía no está en la pantalla.',
    'reaction.notFound': 'Esta reacción ya no existe.',
    'reaction.ownPhoto': 'No puede reaccionar a su propia foto.',
    'upload.noFiles': 'No se ha recibido ninguna foto. Seleccione una e inténtelo de nuevo.',
    'upload.unexpectedField': 'Este envío no se ha podido leer. Inténtelo de nuevo.',
    'request.csrfMissing': 'Esta página ha caducado. Vuelva a cargarla e inténtelo de nuevo.',
    'request.csrfMismatch': 'Esta página ha caducado. Vuelva a cargarla e inténtelo de nuevo.',

    'event.photoLimitReached': 'Ha alcanzado el número de fotos permitido.',
    'photo.pixelBudgetExceeded': 'Esta foto es demasiado grande. Redúzcala e inténtelo de nuevo.',
    'upload.rejected': 'Este envío no se ha podido leer. Inténtelo de nuevo.',
    'event.notModeratable': 'Este evento está archivado: las decisiones ya no se aplican.',
    'membership.lastOwner': 'Un evento debe conservar al menos un propietario.',
    'membership.notFound': 'Esta persona no modera este evento.',
    'guest.notFound': 'Este invitado ya no aparece en la lista. Actualice la página.',

    'event.scheduleOutOfOrder': 'El final debe ser posterior a la apertura.',
    'event.scheduleInPast':
      'Esta hora ya ha pasado. Compruebe la fecha: para el final de la fiesta, elija el día siguiente.',
    'event.scheduleInvalid': 'Estas fechas no se pueden leer. Elíjalas de nuevo.',

    'event.clipsNotAllowed': 'Los vídeos no están activados en esta fiesta.',
    'clip.queueFull': 'Se están procesando muchos vídeos. Inténtelo de nuevo dentro de un minuto.',
    'clip.transcoderUnavailable': 'Este servidor no puede procesar vídeos. Avise al organizador.',
    'clip.unsupportedFormat': 'Este archivo no es un vídeo. Formatos aceptados: MP4, MOV, WebM.',
    'clip.corrupt': 'Este vídeo parece dañado. Pruebe con otro.',
    'clip.noVideoStream': 'Este archivo no contiene imagen. Pruebe con otro.',
    'clip.durationUnknown': 'No se puede leer la duración de este vídeo. Pruebe con otro.',
    'clip.tooShort': 'Este vídeo es demasiado corto.',
    'clip.tooLong': 'Este vídeo es demasiado largo. Grabe una secuencia más corta.',
    'clip.trimInvalid': 'Este fragmento no es válido. Elija otro.',
    'clip.trimOutOfRange': 'El fragmento elegido sobrepasa el final del vídeo. Elija otro.',
    'clip.transcodeFailed': 'Este vídeo no se ha podido procesar. Pruebe con otro.',
    'clip.transcodeTimedOut': 'Este vídeo es demasiado pesado para procesarlo. Pruebe con otro.',
    'clip.storageFailed': 'Este vídeo no se ha podido guardar. Inténtelo de nuevo.',
    'clip.sourceMissing': 'Este vídeo ya no está disponible. Envíelo de nuevo.',
    'clip.stageFailed': 'Este vídeo no se ha podido recibir. Inténtelo de nuevo.',
    'clip.abandoned': 'El procesamiento de este vídeo se ha interrumpido. Envíelo de nuevo.',
    'clip.sourceByteSizeInvalid': 'Este archivo está vacío. Elija otro.',
    'clip.transcodeCancelled':
      'El procesamiento de este vídeo se ha interrumpido. Se reanudará automáticamente.',
    'clip.probeUnreadable': 'Este vídeo no se ha podido analizar. Inténtelo de nuevo.',
    'clip.pixelBudgetExceeded':
      'Este vídeo es demasiado grande. Grabe con una resolución más baja.',
    'clipJob.notFound': 'Este vídeo ya no existe.',
    'clipJob.illegalTransition': 'Esta acción no es posible en este vídeo.',
    'photo.rangeNotSatisfiable': 'Esta parte del archivo no existe.',

    'mission.notFound': 'Esta misión ya no existe. Recargue la página.',
    'mission.duplicate': 'Esta misión ya existe.',
    'mission.limitReached': 'Ha alcanzado el número máximo de misiones.',
    'mission.promptEmpty': 'Escriba lo que pide la misión.',
    'mission.promptTooLong': 'Este texto es demasiado largo para la pantalla.',
    'mission.promptInvalid': 'Este texto no es válido.',
    'challenge.alreadyRunning': 'Ya hay un reto en curso. Deténgalo antes de lanzar otro.',
    'challenge.limit': 'Este evento ha alcanzado el número de retos permitido.',
    'challenge.eventNotOpen': 'Un reto solo se puede lanzar mientras el evento está abierto.',
    'challenge.durationInvalid': 'Esta duración no es válida.',
    'announcement.textInvalid': 'Escriba el texto del anuncio (80 caracteres como máximo).',
    'announcement.atInvalid': 'Esa hora ya ha pasado. Use «Lanzar ahora».',
    'announcement.kindInvalid': 'Ese tipo de anuncio no es válido.',
    'announcement.durationInvalid': 'Esa duración no es válida para este tipo de anuncio.',
    'announcement.countdownInvalid': 'Esa cuenta atrás no es válida para este tipo de anuncio.',
    'announcement.notFound': 'Este anuncio ya no existe. Recargue la página.',
    'announcement.overlap': 'Hay otro anuncio previsto para ese momento.',
    'announcement.showing': 'Ya hay un anuncio en pantalla.',
    'announcement.locked': 'Este anuncio está en pantalla: quítelo para corregirlo.',
    'announcement.limit': 'Ha alcanzado los 50 anuncios. Elimine algunos.',
    'announcement.eventNotOpen': 'La fiesta no está abierta: el anuncio no se mostrará.',

    'eventTheme.accentHueInvalid': 'Ese color no se reconoce. Elija uno de la lista.',
    'eventTheme.accentUnreadable':
      'Ese color no sería legible en la pantalla de la sala. Elija uno de la lista.',
    'eventTheme.accentTooCloseToStatus':
      'Ese color se parece demasiado a los colores de estado de la aplicación. Elija otro matiz.',
    'gallery.notAvailable': 'Este enlace ya no está disponible.',
    'gallery.passwordRequired': 'Este álbum está protegido con contraseña.',
    'gallery.wrongPassword': 'Contraseña incorrecta.',
    'gallery.tooManyAttempts':
      'Demasiados intentos. Vuelva a intentarlo dentro de un cuarto de hora.',
    'gallery.cursorInvalid': 'La lista de fotos ha cambiado. Vuelva a cargar la página.',
    'shareLink.lifetimeInvalid': 'Elija una duración de entre 1 y 90 días.',

    'upload.busy': 'Se están realizando muchos envíos. Inténtelo de nuevo en un momento.',
    'storage.boxFull': 'No queda espacio para guardar este archivo. Avise al organizador.',
    /* ---- The host's venue photograph (ADR 0010, decision 8). ---- */
    'venuePhoto.tooLarge': 'Esta foto pesa demasiado, incluso reducida. Pruebe con otra.',
    'venuePhoto.notFound': 'Esta foto ya no existe.',
    'venuePhoto.saveFailed': 'No se ha podido guardar la foto. Inténtelo de nuevo.',
    /* ---- Added by spec 29: the host's invitation form. ---- */
    'guestInvite.titleTooLong': 'Este título es demasiado largo: 80 caracteres como máximo.',
    'guestInvite.titleInvalid': 'Este título no es válido.',
    'guestInvite.venueTooLong':
      'Este nombre de lugar es demasiado largo: 80 caracteres como máximo.',
    'guestInvite.venueInvalid': 'Este nombre de lugar no es válido.',
    'guestInvite.addressTooLong': 'Esta dirección es demasiado larga: 160 caracteres como máximo.',
    'guestInvite.addressTooManyLines': 'La dirección ocupa dos líneas como máximo.',
    'guestInvite.addressInvalid': 'Esta dirección no es válida.',
    'guestInvite.messageTooLong': 'Su mensaje es demasiado largo: 500 caracteres como máximo.',
    'guestInvite.messageTooManyLines': 'Su mensaje ocupa ocho líneas como máximo.',
    'guestInvite.messageInvalid': 'Este mensaje no es válido.',
    'guestInvite.startsAtInvalid': 'Esta fecha de inicio no es válida.',
    'guestInvite.endsAtInvalid': 'Esta fecha de fin no es válida.',
    'guestInvite.endBeforeStart': 'El fin debe ser posterior al inicio.',
    'guestInvite.tooLong': 'El fin debe caer dentro de los 7 días siguientes al inicio.',
    'guestInvite.endNeedsStart': 'Añada un inicio antes del fin.',
    'guestInvite.badTimeZone': 'Esta zona horaria no se reconoce.',
    'guestInvite.timeZoneRequired': 'Elija la zona horaria de la fiesta.',
    'guestInvite.languageInvalid': 'Este idioma no está disponible.',
    'guestInvite.needsDate': 'Añada la fecha de inicio antes de activar la invitación.',
    'guestInvite.eventArchived': 'El evento está archivado: la invitación ya no puede cambiar.',
    'rsvp.notFound': 'Esta respuesta ya no existe.',
    'rsvp.closed': 'Las respuestas están cerradas.',
    'rsvp.off': 'El anfitrión no pide respuestas por ahora.',
    'rsvp.tooMany': 'Esta invitación ha alcanzado su número máximo de respuestas.',
    'rsvp.full': 'Está completo.',
    'rsvp.inviteRequired': 'Guarda primero la invitación.',
    'rsvp.nameEmpty': 'Indica tu nombre y apellido.',
    'rsvp.nameInvalid': 'Este nombre no es válido.',
    'rsvp.nameTooLong': 'Este nombre es demasiado largo: 60 caracteres como máximo.',
    'rsvp.answerInvalid': 'Elige una respuesta.',
    'rsvp.maybeNotOffered': '«Quizás» no se ofrece para esta fiesta.',
    'rsvp.adultsRequired': 'Hace falta al menos un adulto.',
    'rsvp.partyTooBig': 'Sois demasiados para este formulario.',
    'rsvp.countInvalid': 'Este número de personas no es válido.',
    'rsvp.dietInvalid': 'Este texto no es válido.',
    'rsvp.dietTooLong': 'Este texto es demasiado largo: 120 caracteres como máximo.',
    'rsvp.messageInvalid': 'Estas palabras no son válidas.',
    'rsvp.messageTooLong': 'Este texto es demasiado largo: 280 caracteres como máximo.',
    'rsvp.messageTooManyLines': 'Este texto cabe en cuatro líneas como máximo.',
    'rsvp.enabledInvalid': 'Este ajuste no es válido.',
    'rsvp.deadlineInvalid': 'Esta fecha límite no es válida.',
    'rsvp.deadlineNeedsDate': 'Añade primero la fecha de inicio de la invitación.',
    'rsvp.deadlineAfterStart': 'La fecha límite no puede ser posterior al día de la fiesta.',
    'rsvp.formInvalid': 'Este ajuste del formulario no es válido.',
    'rsvp.partyMaxInvalid': 'El número de personas va de 1 a 10.',
    'rsvp.companionsInvalid': 'Estos nombres no son válidos.',
    'rsvp.companionTooLong': 'Un nombre es demasiado largo: 40 caracteres como máximo.',
    'rsvp.companionsTooMany': 'Hay demasiados nombres para el número de personas.',
    'rsvp.mealsInvalid': 'Estos menús no son válidos: de 2 a 6 menús, todos distintos.',
    'rsvp.mealsTooMany': 'Hay más menús que personas.',
    'rsvp.mealNotOffered':
      'Los menús han cambiado: la página se acaba de actualizar. Elige de nuevo.',
    'rsvp.answersInvalid': 'Estas respuestas no son válidas.',
    'rsvp.answerTooLong': 'Una respuesta es demasiado larga: 120 caracteres como máximo.',
    'rsvp.answerNotAnOption':
      'Las opciones han cambiado: la página se acaba de actualizar. Elige de nuevo.',
    'rsvp.questionsInvalid':
      'Estas preguntas no son válidas: tres como máximo, y de 2 a 6 opciones en una pregunta de opciones.',
    'guestInvite.notFound': 'Esta invitación aún no existe. Guárdela primero.',
  },

  /** The guestbook, guest side (spec 01). What guests and hosts write is never translated. */
  guestbook: {
    title: 'Libro de honor',
    helpManual: 'Unas palabras para la fiesta. El organizador las lee antes de mostrarlas.',
    helpAuto: 'Su mensaje aparece en el libro de honor.',
    open: 'Dejar un mensaje',
    label: 'Su mensaje',
    placeholder: 'Su mensaje…',
    counter: (length: number, max: number) => `${t.number(length)} / ${t.number(max)}`,
    counterNear: (left: number) =>
      t.count(left, {
        one: 'Queda 1 carácter.',
        other: `Quedan ${t.number(left)} caracteres.`,
      }),
    counterFull: 'Límite alcanzado.',
    send: 'Enviar mi mensaje',
    cancel: 'Cancelar',
    thanksManual: '¡Gracias! Su mensaje se mostrará cuando el organizador lo apruebe.',
    thanksAuto: '¡Gracias! Su mensaje está en el libro de honor.',
    mine: 'Mis mensajes',
    statusPending: 'Pendiente de aprobación',
    statusPublished: 'En la pantalla',
    statusPublishedNotOnWall: 'Publicado, no se muestra en la pantalla',
    statusRejected: 'No seleccionado',
    statusHidden: 'Retirado de la pantalla',
    remove: 'Retirar este mensaje',
    removeTitle: '¿Retirar este mensaje definitivamente?',
    removeConfirm: 'Retirar',
    removeCancel: 'Conservar',
    removed: 'Mensaje retirado.',
    tooLong: (max: number) => `Mensaje demasiado largo (${t.number(max)} caracteres como máximo).`,
    errors: {
      'guestbook.empty': 'Escriba al menos una palabra.',
      'guestbook.invalid': 'Este mensaje no se puede enviar tal cual.',
      'guestbook.tooManyLines': 'Mensaje demasiado alto: hágalo más corto.',
      'guestbook.limitReached':
        'Ya ha dejado 3 mensajes, de texto o de voz. Retire uno para dejar otro.',
      'guestbook.voiceDisabled': 'Los mensajes de voz están desactivados por ahora.',
      'guestbook.voiceEventFull': 'El libro de honor está lleno.',
      'voice.queueFull': 'Inténtelo de nuevo dentro de un momento.',
      'voice.unsupportedFormat': 'Este archivo no es un mensaje de voz legible.',
      'voice.notAudio': 'Este archivo no es un mensaje de voz legible.',
      'voice.corrupt': 'Este archivo no es un mensaje de voz legible.',
      'voice.tooLong': 'Este mensaje de voz es demasiado largo.',
      'voice.tooShort': 'Este mensaje de voz es demasiado corto.',
      'guestbook.eventFull': 'El libro de honor está completo.',
      'guestbook.disabled': 'El libro de honor no está abierto por el momento.',
      'event.notAcceptingUploads': 'El libro de honor no está abierto por el momento.',
      'guestbook.deleteForbidden':
        'Este mensaje ya no se puede retirar. Pídaselo al organizador: puede eliminarlo.',
      'event.guestSelfDeleteDisabled':
        'El organizador no ha activado la retirada. Pídaselo: puede eliminar un mensaje.',
      'guestbook.notFound': 'Este mensaje ya no existe.',
      'guestbook.deleteFailed': 'No se pudo retirar. Inténtelo de nuevo o pídaselo al organizador.',
      'rate.limited': 'Demasiados mensajes a la vez, inténtelo de nuevo en un minuto.',
    },
    eraseBody:
      'Sus fotos, vídeos, leyendas, mensajes del libro de honor, incluidos sus mensajes de voz, reacciones y su nombre se borrarán de la fiesta: de la pantalla, del álbum y de la lista del organizador. Es definitivo.',
    noticeWhatHappens: 'Qué pasa con sus fotos y sus mensajes',
    noticeWhoSees: 'Quién ve sus fotos y sus mensajes',
    noticeHowLong: 'Cuánto tiempo se guardan',
    noticeRemoval: 'Cómo retirar uno',
    noticeMessagePublication: {
      afterReview:
        'Un mensaje del libro de honor lo lee el organizador antes de que pueda pasar a la pantalla.',
      immediate:
        'Un mensaje del libro de honor puede pasar a la pantalla en cuanto se envía. El organizador puede retirarlo en cualquier momento.',
    },
    noticeMessageAudience:
      'Sus mensajes los leen el organizador y su equipo, y pueden mostrarse en la pantalla de la fiesta. No aparecen en «Fotos de la velada».',
    noticeMessageBook:
      'El organizador puede incluir sus palabras, con su nombre, en el libro de fotos de la fiesta, y puede mandarlo imprimir.',
    noticeMessageRetention:
      'Sus mensajes se guardan tanto tiempo como las fotos y se borran con ellas.',
    noticeMessageRemoval:
      'Un mensaje se retira como una foto, desde «Mis mensajes» y en las mismas condiciones.',
  },

  /**
   * The voice message of the guestbook, guest side (spec 25): recording it, listening before sending,
   * where it stands afterwards and what the privacy notice says about it. What a guest says is never
   * translated and never appears here, only the words around it. Never "IA", "intelligent" or
   * "transcription" in a sentence of this table: nothing listens to a voice but the organiser.
   */
  guestbookVoice: {
    open: 'Dejar un mensaje de voz',
    record: 'Grabar',
    stop: 'Detener',
    clock: (elapsed: string, max: string) => `${elapsed} / ${max}`,
    recordingAnnounce: 'Grabación en curso',
    nearEnd: 'Quedan 10 segundos',
    recordedAnnounce: (duration: string) => `Grabación terminada, ${duration}`,
    closeToTheMicrophone: 'Hable cerca del teléfono: las personas a su alrededor pueden oírse',
    listen: 'Escuchar',
    listenPause: 'Pausar',
    restart: 'Volver a empezar',
    send: 'Enviar mi mensaje de voz',
    cancel: 'Cancelar',
    captionLabel: 'Unas palabras para acompañarlo',
    micBlocked:
      'El micrófono está bloqueado. Autorícelo en los ajustes del navegador y vuelva aquí.',
    micUnavailableHere:
      'El micrófono no está disponible en esta página. Vuelva a abrir el enlace del evento.',
    micMissing:
      'No se ha podido usar ningún micrófono en este dispositivo. Puede escribir una nota en su lugar.',
    tooShort: 'Demasiado corto: hable al menos un segundo.',
    writeInstead: 'Escribir una nota en su lugar',
    openInBrowser: 'Para dejar un mensaje de voz, abra esta página en Safari o Chrome.',
    previewFailed: 'La vista previa no se reproduce aquí, pero puede enviarlo igualmente',
    interrupted: (duration: string) =>
      `La grabación se detuvo porque se salió de la página. Dura ${duration}.`,
    notKept: 'No se pudo guardar la grabación en su teléfono. Vuelva a grabarla.',
    helpManual: 'El organizador decide si conserva su mensaje.',
    helpAuto:
      'Su mensaje se guarda en el libro de honor. Solo el organizador y su equipo pueden escucharlo.',
    thanksManual: '¡Gracias! El organizador decidirá si conserva su mensaje.',
    thanksAuto: '¡Gracias! Su mensaje de voz se ha recibido.',
    waitingNetwork: 'Su mensaje de voz espera una red.',
    offlineHintKeepOpen:
      'Mantenga esta página abierta: sus fotos y su mensaje de voz saldrán en cuanto vuelva la red.',
    keptOnPhone: 'Su grabación se queda en su teléfono.',
    messageLabel: (duration: string | null) =>
      duration === null ? 'Mensaje de voz' : `Mensaje de voz, ${duration}`,
    statusProcessing: 'En proceso',
    statusPublished: 'En el libro de honor',
    failed: 'No se pudo guardar su mensaje de voz. Vuelva a grabarlo.',
    retry: 'Reintentar',
    localWaiting: 'Esperando una red',
    localBlocked: 'Guardado en su teléfono',
    saveToPhone: 'Guardar en mi teléfono',
    deleteLocal: 'Eliminar',
    noticeVoiceAudience: 'Su mensaje de voz solo lo oyen el organizador y su equipo.',
    noticeVoiceNeverRoom:
      'Nunca se reproduce en la pantalla de la sala ni lo oyen los demás invitados.',
    noticeVoicePublication: {
      afterReview: 'El organizador decide si conserva su mensaje.',
      immediate: 'Su mensaje se guarda enseguida en el álbum, sin escucha previa.',
    },
    noticeVoiceRetention: 'Se conserva como sus fotos y va al álbum que descarga el organizador.',
    noticeVoiceRetentionDays: (count: number) =>
      t.count(count, {
        one: 'Se conserva como sus fotos (1 día después del cierre) y va al álbum que descarga el organizador.',
        other: `Se conserva como sus fotos (${t.number(count)} días después del cierre) y va al álbum que descarga el organizador.`,
      }),
    noticeVoiceMicrophone:
      'El micrófono solo funciona durante la grabación. La grabación se queda en su teléfono hasta que la envíe.',
    noticeVoiceSealed:
      'Los mensajes de voz se mantienen en secreto hasta el final de la velada, salvo decisión del organizador.',
    noticeVoiceRemovalSeconds: (count: number) =>
      t.count(count, {
        one: 'Puede retirar su mensaje de voz durante 1 segundo después de enviarlo.',
        other: `Puede retirar su mensaje de voz durante ${t.number(count)} segundos después de enviarlo.`,
      }),
    noticeVoiceRemovalMinutes: (count: number) =>
      t.count(count, {
        one: 'Puede retirar su mensaje de voz durante 1 minuto después de enviarlo.',
        other: `Puede retirar su mensaje de voz durante ${t.number(count)} minutos después de enviarlo.`,
      }),
    noticeVoiceRemovalHours: (count: number) =>
      t.count(count, {
        one: 'Puede retirar su mensaje de voz durante 1 hora después de enviarlo.',
        other: `Puede retirar su mensaje de voz durante ${t.number(count)} horas después de enviarlo.`,
      }),
    noticeVoiceRemovalAskHost: 'Para retirar un mensaje de voz, pídaselo al organizador.',
  },

  moderation: {
    title: 'Moderación',
    // Navigation pass, batch C: the way to the other console.
    openMobile: 'Versión para teléfono, foto a foto',
    intro: 'Nada aparece en la pantalla sin su aprobación.',
    pending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto pendiente`,
        other: `${t.number(count)} fotos pendientes`,
      }),
    empty: 'Nada que aprobar por ahora.',
    emptyHint: 'Las fotos nuevas llegan aquí automáticamente.',
    publish: 'Publicar',
    reject: 'Rechazar',
    hide: 'Retirar de la pantalla',
    undo: 'Deshacer',
    undone: 'Decisión deshecha.',
    selectAll: 'Seleccionar todo',
    clearSelection: 'Deseleccionar todo',
    bulkPublish: (count: number) => `Publicar (${t.number(count)})`,
    bulkReject: (count: number) => `Rechazar (${t.number(count)})`,
    bulkSkipped: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto omitida: acción imposible.`,
        other: `${t.number(count)} fotos omitidas: acción imposible.`,
      }),
    filterAll: 'Todas',
    filterPending: 'Pendientes',
    filterPublished: 'En pantalla',
    filterRejected: 'Rechazadas',
    filterHidden: 'Retiradas',
    by: (name: string) => `por ${name}`,
    byAnonymous: 'Invitado anónimo',
    shortcuts: 'Atajos',
    shortcutsHint:
      'J / K para navegar, P para publicar, R para rechazar, Z para deshacer la última decisión.',

    shortcutsMore:
      'H para retirar de la pantalla, Espacio para seleccionar, Esc para deseleccionar todo.',
    queueLabel: 'Fotos por moderar',
    filterLabel: 'Filtrar por estado',
    emptyFiltered: 'Ninguna foto en esta categoría.',
    emptyFilteredHint: 'Cambie de filtro para ver las demás fotos.',
    loadFailed: 'No se ha podido cargar la cola de moderación.',
    live: 'Actualizaciones en directo',
    liveLost: 'Conexión perdida — se está reintentando.',
    // The word beside the border colour and the icon, so the status survives stage
    // lighting and a red-green colourblind host.
    statePending: 'Pendiente',
    statePublished: 'En pantalla',
    stateRejected: 'Rechazada',
    stateHidden: 'Retirada de la pantalla',
    selected: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto seleccionada`,
        other: `${t.number(count)} fotos seleccionadas`,
      }),
    /**
     * Goes inside «la foto de …». Indefinite rather than definite, because Spanish
     * contracts «de el» to «del» and the phrase is built by interpolation, so a
     * definite article here would render «la foto de el invitado anónimo».
     */
    anonymousInName: 'un invitado anónimo',
    selectPhoto: (author: string) => `Seleccionar la foto de ${author}`,
    publishPhoto: (author: string) => `Publicar la foto de ${author}`,
    rejectPhoto: (author: string) => `Rechazar la foto de ${author}`,
    hidePhoto: (author: string) => `Retirar de la pantalla la foto de ${author}`,
    enlargePhoto: (author: string) => `Ampliar la foto de ${author}`,
    photoOf: (author: string) => `Foto de ${author}`,
    photoAlt: (author: string) => `Foto enviada por ${author}`,
    photoAltWithCaption: (caption: string, author: string) =>
      `${caption} — foto enviada por ${author}`,
    previousPhoto: 'Foto anterior',
    nextPhoto: 'Foto siguiente',
    bulkHide: (count: number) => `Retirar de la pantalla (${t.number(count)})`,
    published: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto publicada.`,
        other: `${t.number(count)} fotos publicadas.`,
      }),
    refused: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto rechazada.`,
        other: `${t.number(count)} fotos rechazadas.`,
      }),
    removed: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto retirada de la pantalla. Sigue en su álbum.`,
        other: `${t.number(count)} fotos retiradas de la pantalla. Siguen en su álbum.`,
      }),
    highlight: 'Favorita',
    highlightAddHint: 'Marcar como favorita',
    highlightRemoveHint: 'Quitar de favoritas',
    shortcutsFavourite: 'F para marcar como favorita.',
    decisionFailed: 'No se ha podido guardar la decisión. Inténtelo de nuevo.',
    undoFailed: 'No se ha podido deshacer la decisión. Inténtelo de nuevo.',
    dimensions: (width: number, height: number) => `${width} × ${height} píxeles`,
    noCaption: 'Sin pie de foto',

    /* ---- Moderation traps pass (MOD-1, MOD-4, MOD-9, MOD-13). Keep additions inside this block. ---- */
    nothingToUndo: 'Nada que deshacer.',
    undoPublish: 'Retirar',
    seeRejected: 'Ver en Rechazadas',
    republish: 'Volver a poner en pantalla',
    republishPhoto: (author: string) => `Volver a poner en pantalla la foto de ${author}`,
    publishAnyway: 'Publicar de todos modos',
    publishAnywayPhoto: (author: string) => `Publicar de todos modos la foto de ${author}`,
    alreadyOnScreen: 'Esta foto ya está en pantalla.',
    alreadyRefused: 'Esta foto ya está rechazada.',
    notOnScreen: 'Esta foto no está en pantalla.',
    decisionsExplained:
      'Retirar de la pantalla: la foto sigue en su álbum. Rechazar: sale del álbum y su autor la ve como «No seleccionada».',
    filterRejectedHint: 'Fuera del álbum. El invitado las ve como «No seleccionada».',
    filterHiddenHint: 'Retiradas de la pantalla. Siguen en su álbum.',
    confirmRejectTitle: (count: number) => `¿Rechazar ${t.number(count)} fotos?`,
    confirmRejectBody:
      'Sus autores las verán como «No seleccionada» y saldrán del álbum. Esta decisión no se puede deshacer.',
    confirmRejectLabel: (count: number) => `Rechazar ${t.number(count)} fotos`,

    videoBadge: 'Vídeo',
    videoLength: (seconds: number) => `Vídeo · ${seconds} s`,
    watchVideo: (author: string) => `Ver el vídeo de ${author}`,
    playVideo: (author: string) => `Reproducir el vídeo de ${author}`,
    pauseVideo: (author: string) => `Pausar el vídeo de ${author}`,
    videoOf: (author: string) => `Vídeo de ${author}`,
    videoAlt: (author: string) => `Vídeo enviado por ${author}`,
    videoAltWithCaption: (caption: string, author: string) =>
      `${caption} — vídeo enviado por ${author}`,
    videoMuted: 'No se ha podido activar el sonido: este vídeo se reproduce sin sonido.',
    videoUnplayable:
      'Este vídeo no se puede reproducir aquí. Solo se muestra la imagen de vista previa.',
    /* Spec 15: the guestbook's tab in the console. Its own block, at the end. */
    tabPhotos: 'Fotos',
    tabMessages: 'Mensajes',
    tabsLabel: 'Lo que modera',
    tabCounted: (label: string, count: number) => `${label}, ${t.number(count)} por revisar`,
    tabFresh: (label: string, count: number) => `${label}, ${t.number(count)} nuevos por leer`,
    messagesPendingAnnounce: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} mensaje en espera`,
        other: `${t.number(count)} mensajes en espera`,
      }),
    messagesEmpty: 'Nada que revisar por ahora.',
    messagesEmptyHint: 'Las notas de sus invitados llegan aquí automáticamente.',
    messagePublished: (author: string) => `Mensaje de ${author} publicado.`,
    messageRejected: (author: string) => `Mensaje de ${author} rechazado.`,
    messageHidden: (author: string) => `Mensaje de ${author} retirado de la pantalla.`,
    messagesListLabel: 'Mensajes del libro de oro',
    messagesLoadFailed: 'No se pudieron cargar los mensajes.',
    /* Spec 15, phone console: messages. */
    messageOf: (author: string) => `Mensaje de ${author}`,
    onScreenMessagesTitle: 'Últimos mensajes en pantalla',
    onScreenMessagesEmpty: 'Todavía no hay mensajes en pantalla.',
    publishMessageOf: (author: string) => `Publicar el mensaje de ${author}`,
    rejectMessageOf: (author: string) => `Rechazar el mensaje de ${author}`,
    readMessage: 'Leer',
    readMessageOf: (author: string) => `Leer el mensaje de ${author}`,
  },

  /* The guest's view of the evening: the published photographs, with the reactions. */
  feed: {
    title: 'Las fotos de la velada',
    link: 'Ver las fotos de la velada',
    back: 'Enviar fotos',
    refresh: 'Actualizar',
    more: 'Ver más fotos',
    empty: 'Todavía no hay ninguna foto en la pantalla.',
    emptyHint: 'Las fotos que aprueben los organizadores aparecerán aquí.',
    failed: 'No se han podido cargar las fotos. Inténtelo de nuevo.',
    own: 'Su foto',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    unavailable: 'Esta fiesta ya no se muestra.',
    unavailableHint:
      'La fiesta ha terminado, así que aquí no hay fotos que ver. Pida a los organizadores el enlace del álbum.',
    /* Spec 24: saving a photograph from the feed. */
    saving: 'Guardando…',
    saveReady: 'Toque para guardarla',
    /** The accessible name of a save button: its word, then the photograph it is under. */
    saveNamed: (action: string, description: string) => `${action}: ${description}`,
    saveDownloaded: 'Foto descargada.',
    saveNetworkFailed:
      'No se ha podido recuperar la foto. Vuelva a intentarlo cuando regrese la red.',
    saveBusy:
      'Muchos invitados están guardando a la vez. Vuelva a intentarlo dentro de un momento.',
    saveGone: 'Esta foto ya no está disponible.',
    saveMediaMissing: 'No se ha podido recuperar la foto.',
    saveDisabled: 'El organizador ha desactivado el guardado.',
    saveRevoked: 'El organizador ha retirado su acceso.',
    /** A lapsed access reads by the state of the evening: open, the code reopens it; over, only the album's link is left. */
    saveExpiredOpen:
      'Su acceso a la fiesta ha caducado. Vuelva a abrir la fiesta con el código o el enlace que recibió.',
    saveExpiredClosed:
      'Su acceso a la fiesta ha caducado. Pida a los organizadores el enlace del álbum.',
    saveHelpSheet: 'En la hoja que se abre, elija «Guardar imagen» para ponerla en Fotos.',
    saveHelpFiles:
      'La foto está en la app Archivos, en la carpeta Descargas. Para que vaya a Fotos, abra la fiesta en Safari: en la aplicación de mensajería, toque Compartir y luego «Abrir en Safari».',
  },

  wall: {
    empty: 'Las primeras fotos llegarán enseguida',
    emptyHint: 'Escanee el código QR para enviar las suyas.',
    joinPrompt: 'Únase a la fiesta',
    offline: 'Nuevas fotos a la espera de la red',
    paused: 'Presentación en pausa',

    /* ---- Spec 11: the souvenir counter and the new-photo signal. Keep additions inside this block. ---- */
    souvenirCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} recuerdo compartido`,
        other: `${t.number(count)} recuerdos compartidos`,
      }),
    arrivalPhoto: 'Nueva foto añadida',
    arrivalClip: 'Nuevo vídeo añadido',
    arrivalPhotos: (count: number) => `${t.number(count)} fotos nuevas`,
    arrivalClips: (count: number) => `${t.number(count)} vídeos nuevos`,
    arrivalMixed: (count: number) => `${t.number(count)} recuerdos nuevos`,

    /* ---- Spec 21: scheduled announcements on the wall. The text inside is the host's, never translated. ---- */
    announcementSay: (text: string) => `Anuncio: ${text}.`,
    announcementIn: (time: string) => `en ${time}`,
    announcementImminent: (time: string) => `en un instante · ${time}`,
    /* A discreet announcement's pill (spec 21): rounded up to the minute, two minutes and over; the last minute has its own words. */
    announcementMinutesLeft: (minutes: number) => `quedan ${minutes} min`,
    announcementLastMinute: 'menos de 1 min',

    codeLabel: 'Código de la fiesta',
    // Read by nothing in the room: the wall is also opened on a laptop while a host
    // sets the projector up.
    qrTitle: 'Código QR para unirse a la fiesta',
    photoBy: (name: string) => `Foto enviada por ${name}`,
    photoByAnonymous: 'Foto enviada por un invitado',
    errorTitle: 'No se han podido cargar las fotos',
    errorHint: 'Se está reintentando. Revise la red del local si la pantalla sigue vacía.',
    notServedTitle: 'Esta pantalla está en espera',
    notServedHint: 'Esta pantalla se encenderá sola en cuanto se abra la fiesta.',
    dismissJoinCard: 'Ocultar el aviso del código',
    shortcuts: 'Atajos de teclado',
    shortcutsHint:
      'Espacio pausa, las flechas cambian de foto, F pasa a pantalla completa, L cambia la disposición, Q oculta o muestra el código QR.',
    /* Navigation pass, batch A: how to leave the wall. */
    leaveHint: 'Para salir: Esc o F salen de la pantalla completa; después cierre la pestaña.',
    mixedHint:
      'El muro alterna una vista general y una foto grande: la tecla L (o la dirección de la pantalla con layout) fija un diseño en esta pantalla y detiene la alternancia hasta recargar la página.',
    /* Spec 12: the muted-speaker icon, and the S key in the shortcuts. */
    soundActivate: 'Activar el sonido en esta pantalla',
    soundShortcutHint: 'S activa el sonido en esta pantalla, si está activado en los ajustes.',
    /* "Levez les yeux" (UX review 2026-10-30): the line under a guest's first photo on the wall. */
    firstPhotoOf: (name: string) => `Primera foto de ${name}`,

    /* ---- Before and after the evening (UX review 30/10, MUR-2 to MUR-9). Keep additions inside this block. ---- */
    // The corner card's title: what to do, in a verb a guest reads from ten metres.
    sendPrompt: 'Envíe sus fotos a la pantalla',
    // Under the code, for the phone that cannot read the QR. Both holes are interpolated as given.
    typeCodeAt: (code: string, host: string) => `o escriba ${code} en ${host}`,
    invitePrompt: {
      tile: 'Su foto aquí',
      cell: 'La próxima es la suya',
      print: 'Su foto aquí',
      tag: 'Cuelgue la suya',
      seam: 'Envíe las suyas',
    },
    // An empty wall of an event the host has closed: nobody can send a photo any more.
    emptyClosed: '¡Gracias por venir!',
    // In the shortcuts panel, only when the browser could not keep the screen awake itself.
    keepAwakeHint: 'Desactive la suspensión de este ordenador.',

    /**
     * The working words a Spanish host at the projector would use for each grid, not
     * translations of the code names. Nothing here is projected.
     */
    layoutNames: {
      spotlight: 'Pantalla completa',
      mosaic: 'Mosaico',
      polaroid: 'Polaroid',
      filmstrip: 'Tira de fotos',
      collage: 'Collage',
      split: 'Lado a lado',
      clothesline: 'Tendedero',
    },
    layoutOrder: (names: readonly string[]) => `Disposiciones, en orden: ${names.join(', ')}.`,

    /* ---- The settings panel on the wall (spec 13). Keep additions to it inside this block. ---- */
    panel: {
      open: 'Ajustes',
      pause: 'Pausa',
      resume: 'Reanudar',
      fullscreen: 'Pantalla completa',
      /* Spec 17: what the owner bar's icons say on hover and on focus, with their key. */
      openTip: 'Ajustes (R)',
      pauseTip: 'Pausa (Espacio)',
      resumeTip: 'Reanudar (Espacio)',
      fullscreenTip: 'Pantalla completa (F)',
      /* Spec 17: the drawer's section row and the current value under each section's title. */
      sectionJump: 'Ir a la sección',
      summaryNone: 'Ninguno',
      summaryHidden: 'Oculto',
      summaryOff: 'Desactivado',
      rhythmAuto: 'Auto',
      summaryRhythm: (n: number) => `${n} s`,
      barLabel: 'Controles del muro',
      panelLabel: 'Ajustes del muro',
      title: 'Ajustes',
      close: 'Cerrar los ajustes',
      sectionDisplay: 'Visualización',
      sectionAmbiance: 'Ambiente',
      sectionQr: 'Código QR',
      forAll: 'Para todas las pantallas',
      thisScreen: 'Solo esta pantalla',
      thisScreenHint:
        'Estos controles solo cambian esta pantalla y se pierden al recargar la página.',
      screenLayout: (name: string) => `Disposición de esta pantalla: ${name} (tecla L)`,
      screenShows: (name: string) => `Esta pantalla muestra ${name} (tecla L)`,
      backToEvent: 'Volver al ajuste del evento',
      hideQr: 'Ocultar la tarjeta QR',
      showQr: 'Mostrar la tarjeta QR',
      saving: 'Guardando…',
      saved: 'Guardado',
      saveFailed: 'No se pudo guardar, inténtelo de nuevo',
      sessionExpired: 'Su sesión ha caducado. Vuelva a iniciar sesión para ajustar el muro.',
      signIn: 'Iniciar sesión',
      signInToSet: 'Iniciar sesión para ajustar este muro',
      openHint: 'R abre los ajustes del muro.',
      /* Spec 12: the state of this screen's speakers, in the "Son" section. */
      soundScreenOn: 'Esta pantalla: sonido activado.',
      soundScreenOff: 'Esta pantalla: sonido desactivado.',
    },

    videoBy: (name: string) => `Vídeo enviado por ${name}`,
    videoByAnonymous: 'Vídeo enviado por un invitado',

    /** The signature under a guestbook card (spec 01) when the guest gave no name. */
    guestbookAnonymous: 'Un invitado',

    missionsTitle: 'Misiones',
    missionDone: 'Hecho',
    missionGuests: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} invitado`,
        other: `${t.number(count)} invitados`,
      }),
  },

  admin: {
    events: 'Sus eventos',
    breadcrumbLabel: 'Ruta de navegación',
    newEvent: 'Nuevo evento',
    eventName: 'Nombre del evento',
    eventNameHint: 'Visible para sus invitados, por ejemplo «Camille & Sacha».',
    slug: 'Dirección',
    joinCode: 'Código de la fiesta',
    rotateJoinCode: 'Cambiar el código',
    rotateJoinCodeHint:
      'Los códigos QR ya impresos y el enlace ya enviado dejarán de funcionar: habrá que reimprimirlos y volver a enviar el enlace. Los invitados ya conectados siguen conectados.',
    openWall: 'Abrir la pantalla',
    openModeration: 'Moderar',
    download: 'Descargar el álbum',
    statusDraft: 'Borrador',
    statusLive: 'En curso',
    statusClosed: 'Finalizado',
    statusArchived: 'Archivado',
    goLive: 'Abrir a los invitados',
    closeEvent: 'Finalizar el evento',
    reopenEvent: 'Reabrir',
    archiveEvent: 'Archivar',
    photos: (count: number) =>
      t.count(count, { one: `${t.number(count)} foto`, other: `${t.number(count)} fotos` }),
    guests: (count: number) =>
      t.count(count, { one: `${t.number(count)} invitado`, other: `${t.number(count)} invitados` }),
    stats: {
      title: 'Estadísticas de la fiesta',
      tile: 'Estadísticas',
      loading: 'Cargando las estadísticas…',
      empty:
        'Todavía no hay nada que contar. Las cifras aparecen en cuanto los invitados se unen al evento.',
      emptyAction: 'Ver el código QR',
      figureUploads: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} envío recibido`,
          other: `${t.number(count)} envíos recibidos`,
        }),
      figureGuests: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} invitado`,
          other: `${t.number(count)} invitados`,
        }),
      figureHere: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} aquí ahora`,
          other: `${t.number(count)} aquí ahora`,
        }),
      figurePending: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} en espera`,
          other: `${t.number(count)} en espera`,
        }),
      timelineTitle: 'Envíos a lo largo del tiempo',
      timelineCaption: 'Envíos por hora',
      hourColumn: 'Hora',
      uploadsColumn: 'Envíos',
      timelineEmpty: 'Todavía no hay envíos.',
      peak: (hour: string, count: number) =>
        `Pico: ${hour}, ${t.count(count, { one: `${t.number(count)} envío`, other: `${t.number(count)} envíos` })}`,
      statusTitle: 'Envíos por estado',
      statusPublished: 'Publicados',
      statusPending: 'En espera',
      statusRejected: 'Rechazados',
      statusHidden: 'Ocultos',
      publishedShare: 'Proporción de envíos publicados',
      guestsTitle: 'Invitados',
      guestsJoined: 'Llegados',
      guestsContributors: 'Han enviado al menos un archivo',
      guestsRevoked: 'Retirados por usted',
      reactionsTitle: 'Reacciones',
      reactionsTotal: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} reacción`,
          other: `${t.number(count)} reacciones`,
        }),
      topTitle: 'Quienes más han compartido',
      topEmpty: 'Nadie ha publicado todavía un envío.',
      topLine: (photos: number, reactions: number) =>
        `${t.count(photos, { one: `${t.number(photos)} envío publicado`, other: `${t.number(photos)} envíos publicados` })} · ${t.count(reactions, { one: `${t.number(reactions)} reacción recibida`, other: `${t.number(reactions)} reacciones recibidas` })}`,
      anonymous: (guests: number, photos: number) =>
        `Los invitados sin nombre se agrupan: ${t.count(guests, { one: `${t.number(guests)} invitado`, other: `${t.number(guests)} invitados` })}, ${t.count(photos, { one: `${t.number(photos)} envío`, other: `${t.number(photos)} envíos` })}.`,
      engagementTitle: 'Después de la fiesta',
      engagementNone:
        'Todavía sin medir: ningún enlace del álbum abierto, ningún ZIP iniciado ni ninguna foto guardada.',
      albumOpens: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} apertura del enlace del álbum`,
          other: `${t.number(count)} aperturas del enlace del álbum`,
        }),
      zipLaunches: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} ZIP iniciado`,
          other: `${t.number(count)} ZIP iniciados`,
        }),
      guestSaves: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} foto guardada por los invitados`,
          other: `${t.number(count)} fotos guardadas por los invitados`,
        }),
      measuredSince: (date: string) => `Medido desde el ${date}. Antes no se contaba nada.`,
      engagementNote:
        'Una apertura es la carga de la página del álbum, no una persona. Un ZIP iniciado no está necesariamente terminado. Un guardado es una solicitud aceptada, no necesariamente una foto que haya llegado al teléfono. Estas cifras son orientativas.',
      retention:
        'Estas cifras desaparecen con el evento, al borrarlo o al terminar el plazo de conservación.',
    },
    storageUsed: (used: string, total: string) => `${used} de ${total}`,
    settings: 'Ajustes',
    moderationMode: 'Moderación',
    moderationManual: 'Aprobar cada foto',
    moderationAuto: 'Publicar automáticamente',
    /**
     * «Las fotos y los vídeos», because both are true: a finished clip is published
     * under `auto` exactly as a photo is, so a guest video reaches the projector with
     * nobody having watched it. A warning, not a description.
     */
    moderationAutoWarning:
      'Las fotos, los vídeos y los mensajes del libro de visitas aparecerán en la pantalla sin aprobación. Resérvelo para eventos entre personas de confianza.',
    allowCaptions: 'Permitir los pies de foto',
    allowReactions: 'Permitir las reacciones',
    allowClips: 'Permitir los vídeos',
    allowClipsHint:
      'Los invitados pueden enviar vídeos cortos, además de fotos. Cuando la casilla está desmarcada, los vídeos se rechazan: porque usted la ha desmarcado, porque la plantilla elegida al crear el evento lo dejó así, o porque el evento es anterior a esta función. Márquela para permitirlos.',
    /** The host's switch over saving from the feed (spec 24). */
    allowGuestSave: 'Los invitados pueden guardar las fotos de la fiesta',
    allowGuestSaveHint:
      'Cada invitado puede conservar en su teléfono una foto mostrada en la pantalla, en alta calidad, sin el lugar ni la cámara con la que se tomó. Usted mantiene el control del álbum: una foto que retire ya no se puede guardar, pero una foto ya guardada se queda en el teléfono de la persona, y no puede impedir que se copie una sola foto sin retirarla. Cambiar este ajuste durante la fiesta hace que los invitados vuelvan a leer el aviso antes de su próxima foto. Cuando la fiesta ha terminado, un invitado cuyo acceso ha caducado ya no puede guardar: envíele el enlace del álbum, que además da la resolución completa.',
    allowGuestbook: 'Abrir el libro de visitas',
    allowGuestbookHint:
      'Los invitados dejan un mensaje corto. Desmarcado: el libro está cerrado y se conservan los mensajes ya escritos.',
    guestbookOnWall: 'Mostrar los mensajes en la pantalla de la sala',
    guestbookOnWallHint:
      'Desmarcado: los mensajes publicados siguen en el libro pero no aparecen en la pantalla.',
    allowGuestSelfDelete: 'Permitir que los invitados eliminen sus fotos',

    /**
     * Named for the screen it changes, and for nothing else. The hint says what the
     * setting deliberately does not do: it never translates what a host or a guest
     * wrote, and it has no effect on the language a guest picks on their own phone.
     */
    wallLanguage: 'Idioma de la pantalla de la sala',
    wallLanguageHint:
      'Las palabras de la pantalla de la sala: «Únase a la fiesta», «Misiones», los mensajes de espera. Lo que usted y sus invitados escriben — el nombre del evento, los pies de foto, los textos de las misiones — se muestra tal cual y nunca se traduce. Sus invitados eligen su propio idioma en su teléfono; este ajuste no les afecta.',

    /* ---- Wall display block of the settings page (spec 13). Keep additions to it inside this block. ---- */
    wallDisplay: {
      title: 'Pantalla del muro',
      forAll: 'Para todas las pantallas',
      hint: 'Estos ajustes se guardan para el evento: todas las pantallas de la sala los siguen.',
      layout: 'Disposición',
      layoutHint:
        'La tecla L, o una dirección con el parámetro layout, sigue teniendo prioridad en esa pantalla.',
      layoutUnset: 'Cada pantalla decide',
      interval: 'Ritmo',
      intervalHint: 'Cuánto tiempo permanece cada foto en pantalla.',
      intervalDefault: 'Por defecto (una foto cada 8 s)',
      intervalSeconds: (n: number) => `Una foto cada ${n} s`,
      mixed: 'Alternar muro y pase de fotos',
      mixedHint: 'El muro muestra una vista general y después una foto grande, por turnos.',
      mixedWall: 'Tiempo en el muro',
      mixedSlideshow: 'Tiempo en el pase de fotos',
      freshLane: 'Fotos nuevas primero',
      freshLaneHint:
        'Una foto publicada ocupa la diapositiva siguiente, tres seguidas como máximo.',
      tilt: 'Fotos ligeramente inclinadas',
      tiltHint: 'Polaroids y cuerda de ropa: un ángulo fijo de unos grados.',
      showTime: 'Hora de envío bajo la foto',
      showTimeHint: 'La hora a la que se envió la foto, según el reloj de la pantalla de la sala.',
      // Spec 11.
      onScreen: 'En pantalla',
      souvenirCounter: 'Mostrar el contador de recuerdos',
      souvenirCounterHint:
        'Un contador discreto, arriba en el centro: «17 recuerdos compartidos». Cuenta las fotos y los vídeos visibles en el muro.',
      newPhotoSignal: 'Avisar de las fotos nuevas',
      newPhotoSignalHint:
        'Un mensaje breve, arriba en el centro, cuando una foto o un vídeo acaba de aparecer en el muro. Nunca el nombre del invitado.',
      // Spec 14: the invitation card.
      qrTitle: 'Código QR',
      qrVisible: 'Mostrar el QR en el muro',
      qrVisibleHint:
        'Los invitados que lleguen tarde ya no tendrán el QR. El muro vacío conserva su invitación.',
      qrSize: 'Tamaño del QR',
      qrSizeValue: (n: number) => `× ${String(Math.round(n * 100) / 100).replace('.', ',')}`,
      qrSizeSmall: 'Pequeño',
      qrSizeMedium: 'Mediano',
      qrSizeLarge: 'Grande',
      qrSizeHint: 'El QR nunca baja de un tamaño legible: un enlace largo lo mantiene más grande.',
      qrPlacement: 'Posición',
      qrCorners: {
        'top-start': 'Arriba a la izquierda',
        'top-end': 'Arriba a la derecha',
        'bottom-start': 'Abajo a la izquierda',
        'bottom-end': 'Abajo a la derecha',
      },
      qrPlacementHint:
        'La esquina vale para el diseño Pantalla completa. Los demás colocan el QR dentro de su propia composición: una casilla del mosaico, una copia, una etiqueta en la cuerda…',
    },
    wallSound: {
      title: 'Sonido',
      hint: 'Un sonido breve cuando se publica una foto o un clip en el muro. Desactivado por defecto.',
      enable: 'Un sonido con cada foto nueva',
      enableHint:
        'Cada pantalla debe activarse también en la sala: basta un clic en el muro (o la tecla S).',
      tone: 'Sonido',
      toneNames: { chime: 'Carillón', bell: 'Campana', drop: 'Gota', pop: 'Pop' },
      tonePlay: (name: string) => `Escuchar ${name}`,
      volume: 'Volumen',
      volumeValue: (n: number) => `Volumen ${n} %`,
      test: 'Probar',
      testHint: 'Reproduce el sonido elegido en este ordenador, a este volumen.',
    },

    theme: 'Apariencia',
    themeHint:
      'Visible para sus invitados y en la pantalla de la sala. Los colores propuestos siguen siendo legibles a diez metros.',
    themeAccent: 'Color',
    themeAccentNames: {
      violet: 'Color del ambiente (predeterminado)',
      rose: 'Rosa',
      azure: 'Azul',
      teal: 'Turquesa',
    },
    themeFonts: 'Tipografía',
    /** The honest scope, said once: a guest phone downloads nothing for this. */
    themeFontsHint: 'Se aplica solo a la pantalla de la sala.',
    themeFontsNames: {
      sans: 'Editorial',
      serif: 'Clásica',
    },
    themeFrame: 'Marco de las fotos',
    themeFrameNames: {
      soft: 'Esquinas redondeadas',
      square: 'Esquinas rectas',
      round: 'Esquinas muy redondeadas',
    },
    themeAmbiance: 'Ambiente',
    themeAmbianceHint:
      'El mundo que visten los móviles de sus invitados, la pantalla de la sala y las páginas de este evento en su espacio.',
    themeAmbianceNames: {
      eventslide: 'EventSlide',
      guinguette: 'Guinguette',
      riviera: 'Riviera',
      champs: 'Campos de oro',
      bivouac: 'Vivac',
      cabaret: 'Cabaret',
      noces: 'Boda',
      custom: 'A medida',
    },

    template: 'Tipo de evento',
    templateHint:
      'Un punto de partida, adaptado al tipo de fiesta. Todos estos ajustes se pueden modificar en cualquier momento, antes y durante el evento.',
    templateNone: 'Sin plantilla',
    templateNoneSummary:
      'Ajustes por defecto: cada foto se aprueba antes de llegar a la pantalla, conservación ilimitada.',
    templateChanges: 'Esta plantilla ajusta:',
    templatePreviewSample: 'Su evento',
    templateClipsOn: 'Vídeos permitidos',
    templateClipsOff: 'Vídeos desactivados',
    templateSelfDeleteOn: 'Borrado foto a foto permitido',
    templateSelfDeleteOff: 'Borrado foto a foto desactivado',
    templateGuestSaveOn: 'Los invitados pueden guardar las fotos',
    templateGuestSaveOff: 'Guardado de fotos desactivado para los invitados',
    templateVoiceOn: 'Mensajes de voz en el libro de visitas activados',
    templateVoiceOff: 'Mensajes de voz desactivados',
    templateVoiceSealed: 'Mensajes de voz guardados en secreto hasta la revelación',
    templateNames: {
      wedding: 'Boda',
      birthday: 'Cumpleaños',
      conference: 'Conferencia',
      party: 'Fiesta',
      disposable: 'Cámara desechable',
    },

    retention: 'Eliminación automática',
    retentionNever: 'Nunca',
    /** «Desde el final del evento», because the retention clock starts when the host ends it. */
    retentionDays: (days: number) =>
      t.count(days, {
        one: `${t.number(days)} día después del final del evento`,
        other: `${t.number(days)} días después del final del evento`,
      }),
    retentionUnlimited: 'Conservación ilimitada',
    moderators: 'Moderadores',

    loading: 'Cargando sus eventos…',
    eventLoading: 'Cargando el evento…',
    eventsEmpty: 'Todavía no hay ningún evento.',
    eventsEmptyHint: 'Cinco pasos para estar listo el día del evento.',
    emptyStepCreate: 'Cree el evento.',
    emptyStepPrint: 'Imprima el código QR y colóquelo en las mesas.',
    emptyStepScreen: 'Conecte la pantalla del lugar y ábrala: esperará a la apertura.',
    emptyStepOpen: 'Abra el evento a los invitados.',
    emptyStepTest: 'Pruebe desde un teléfono que no sea el suyo, en la red del lugar.',
    create: 'Crear el evento',
    slugHint: 'Opcional. Déjelo en blanco para deducirla del nombre.',
    slugPreviewLabel: 'Dirección para sus invitados',
    slugPreviewEmpty: 'Escriba un nombre para ver la dirección.',
    eventCreated: (name: string) => `${name} está listo. Imprima el código QR cuando quiera.`,
    joinLink: 'Enlace para sus invitados',
    printQr: 'Imprimir el código QR',
    qrScanPrompt: 'Escanee para enviar sus fotos.',
    qrAlt: (eventName: string) => `Código QR para unirse a ${eventName}`,
    printKitTitle: 'Tarjetas de mesa y cartel',
    printKitCrumb: 'Tarjetas y cartel',
    printKitIntro:
      'Imprima algo para poner en las mesas: el código QR, el código de respaldo y tres líneas de instrucciones.',
    printKitFormat: 'Formato',
    printKitInk: 'Color del código QR',
    printInkBlack: 'Negro (el más seguro)',
    printInkEvent: 'Color del evento',
    printKitLogo: 'Logotipo del evento en el centro del QR',
    printKitLogoHint:
      'El código QR pasa a la corrección de errores máxima: sigue siendo legible, pero algo más denso.',
    printFormatA4: 'Cartel A4 (1 por hoja)',
    printFormatA5: 'Cartel A5 (2 por hoja)',
    printFormatCard: 'Tarjetas de mesa A6 (4 por hoja)',
    printKitLanguage: 'Idioma del soporte',
    printKitLanguageHint: 'Es el idioma de la velada, no el de su pantalla.',
    printKitPrint: 'Imprimir',
    printKitPrinting: 'Actualizando el código…',
    printKitHelp:
      'En la ventana de impresión, elija A4, escala 100 %, sin encabezados ni pies de página. Su navegador también ofrece allí «Guardar como PDF». Use el botón Imprimir: Ctrl+P no comprueba el código.',
    printKitCodeChanged:
      'El código de la velada ha cambiado: la hoja de abajo está al día. Tire las anteriores.',
    printKitClosed:
      'Esta velada está cerrada: los invitados que escaneen ya no pueden unirse. Si la reabre, el mismo código vuelve a valer.',
    printKitDraft: 'Los invitados solo podrán unirse cuando se abra la velada.',
    printKitArchived: 'Este evento está archivado: su código QR ya no lleva a ninguna parte.',
    printKitBack: 'Volver al evento',
    printKitLongLink: 'El enlace es largo y el código QR será pequeño. Prefiera el cartel.',
    printKitPreview: 'Vista previa de la hoja',
    /* Spec 28: the designs of the printed card and what the host writes on it. */
    printDesignNames: {
      essentiel: 'Esencial',
      classique: 'Clásico',
      ticket: 'Tique de caja',
      bd: 'Cómic',
      magazine: 'Revista',
      souvenir: 'Recuerdo',
      postale: 'Postal',
      billet: 'Entrada',
      embarquement: 'Tarjeta de embarque',
      jetable: 'Cámara desechable',
      affiche: 'Cartel',
      confettis: 'Confeti',
      seventies: 'Años 70',
      nuit: 'Noche',
      guirlande: 'Guirnalda',
    },
    printSwatchNames: {
      coral: 'Coral',
      raspberry: 'Frambuesa',
      plum: 'Ciruela',
      lavender: 'Lavanda',
      navy: 'Azul noche',
      ocean: 'Océano',
      fir: 'Abeto',
      olive: 'Oliva',
      mustard: 'Mostaza',
      terracotta: 'Terracota',
      charcoal: 'Antracita',
    },
    printKitDesign: 'Modelo',
    printKitTexts: 'Textos de la tarjeta',
    printKitTitleField: 'Título',
    printKitTitleHint: 'Si lo deja vacío, es el nombre del evento.',
    printKitTagline: 'Titular',
    printKitNote: 'Mensaje breve',
    printKitDate: 'Fecha y lugar',
    printKitTable: 'Mesa',
    printKitDateExample: '14 de junio de 2026 · Finca Los Tilos',
    printKitTableHint: 'Número o nombre, opcional.',
    printKitOptional: 'Opcional.',
    printKitSteps: 'Los tres pasos, en los modelos que tienen sitio',
    printKitPhoto: 'Foto',
    printKitPhotoChoose: 'Elegir una foto',
    printKitPhotoRemove: 'Quitar la foto',
    printKitPhotoHint:
      'La foto se queda en este navegador: no se envía y otro dispositivo no la verá.',
    printKitPhotoFailed: 'Esta imagen no se puede leer. Pruebe con una foto JPEG o PNG.',
    printKitFocusX: 'Encuadre horizontal',
    printKitFocusY: 'Encuadre vertical',
    printKitColour: 'Color de la tarjeta',
    printKitColourEvent: 'Color del evento',
    printKitColourCustom: 'Otro color',
    printKitInkHeavy: 'Fondo lleno: este modelo gasta mucha tinta.',
    printWorkshopLabel: 'Ajustes de la tarjeta',
    printPanelTexts: 'Textos',
    printPanelColours: 'Colores',
    printPanelPrint: 'Impresión',
    printKitColoursHint: 'Tarjeta y código QR juntos: se juzga el contraste de un vistazo.',
    printFormatShortCard: 'Tarjetas A6 ×4',
    printFormatShortA5: 'A5 ×2',
    printFormatShortA4: 'Cartel A4',
    printToolbarLabel: 'Formato e impresión',
    printViewLabel: 'Vista previa',
    printViewCard: 'Una tarjeta',
    printViewSheet: 'La hoja',
    printSeeBig: 'Ver en grande',
    printCloseBig: 'Cerrar la vista previa',
    printPhotoDragHint:
      'Arrastre la foto sobre la tarjeta para encuadrarla, o use los deslizadores.',
    printPanelPrintLead:
      'Compruebe la hoja y luego imprima desde la barra situada sobre la vista previa.',
    storageLabel: 'Espacio de fotos utilizado',
    storage: (used: string) => `${used} utilizados`,
    rotateJoinCodeTitle: '¿Cambiar el código de la fiesta?',
    codeRotated: 'Nuevo código activo. El anterior ya no funciona.',
    settingsReadOnly: 'Este evento está archivado: sus ajustes ya no se pueden modificar.',
    settingsOwnerOnly: 'Solo el propietario del evento puede modificar sus ajustes.',
    /* The settings page in sections, saved as the host changes it. */
    settingsPage: {
      guests: 'Invitados',
      guestbook: 'Libro de visitas',
      wall: 'Pantalla de la sala',
      schedule: 'Horarios y conservación',
      autosave: 'Cada cambio se guarda al instante.',
      saving: 'Guardando…',
      saved: 'Cambios guardados',
      saveFailed: 'El último cambio no se ha guardado.',
      manual: 'Cada foto validada',
      auto: 'Publicación automática',
      clipsOn: 'vídeos permitidos',
      clipsOff: 'sin vídeos',
      guestSaveOn: 'fotos descargables',
      guestSaveOff: 'fotos no descargables',
      open: 'Abierto',
      closed: 'Cerrado',
      onWall: 'mensajes en pantalla',
      voice: 'mensajes de voz',
      on: 'Activado',
      off: 'Desactivado',
      timed: 'revelado a una hora fija',
      byHand: 'revelado a mano',
      qrOn: 'QR visible',
      qrOff: 'sin QR',
      sound: 'sonido con cada foto',
      logo: 'con logo',
      venuePhoto: 'foto del lugar',
      opensAt: 'Apertura programada',
      opensByHand: 'Apertura a mano',
      closesAt: 'cierre programado',
      closesByHand: 'cierre a mano',
      keptForever: 'fotos conservadas sin límite',
      deletedAfter: (days: number) =>
        t.count(days, {
          one: `fotos eliminadas ${t.number(days)} día después del final`,
          other: `fotos eliminadas ${t.number(days)} días después del final`,
        }),
      confirmAutoTitle: '¿Publicar automáticamente?',
      confirmRevealTitle: '¿Activar la cámara desechable ahora?',
    },
    retentionHint: 'Las fotos se eliminan pasado ese plazo desde el final del evento.',
    selfDeleteGrace: 'Plazo de eliminación',
    selfDeleteGraceHint: 'Durante ese plazo, un invitado puede retirar su propia foto.',
    graceNone: 'Sin plazo',
    graceSeconds: (seconds: number) =>
      t.count(seconds, {
        one: `${t.number(seconds)} segundo`,
        other: `${t.number(seconds)} segundos`,
      }),
    graceMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `${t.number(minutes)} minuto`,
        other: `${t.number(minutes)} minutos`,
      }),
    graceHours: (hours: number) =>
      t.count(hours, { one: `${t.number(hours)} hora`, other: `${t.number(hours)} horas` }),
    maxPhotosPerGuest: 'Fotos por invitado',
    maxPhotosUnlimited: 'Sin límite',
    guestList: 'Invitados',
    guestsEmpty: 'Todavía nadie se ha unido a la fiesta.',
    guestsEmptyHint: 'Los invitados aparecen aquí en cuanto escanean el código QR.',
    lastSeen: (when: string) => `Última actividad: ${when}`,
    dateUnknown: 'Fecha desconocida',
    guestRevokedBadge: 'Acceso retirado',
    revokeGuest: 'Retirar el acceso',
    revokeGuestTitle: '¿Retirar el acceso a este invitado?',
    revokeGuestHint:
      'Sus fotos ya publicadas siguen en la pantalla, pero no podrá enviar ninguna más.',
    guestRevoked: 'El acceso se ha retirado.',
    moderatorsEmpty: 'Usted es la única persona que modera este evento.',
    moderatorEmail: 'Correo del moderador',
    moderatorEmailHint:
      'Recibirá una invitación, válida durante siete días, solo para este evento.',
    inviteSubmit: 'Invitar',
    /** An invitation went out by e-mail: nothing to copy. */
    moderatorInviteSent: (email: string) => `Se ha enviado una invitación a ${email}.`,
    /** No mail relay, or it refused: the link is for the host to pass on, once. */
    inviteLinkCreated: (email: string) =>
      `Este enlace no se ha enviado por correo. Transmítalo usted mismo a ${email}: solo sirve una vez y es válido durante siete días.`,
    inviteLinkUrl: 'Enlace para transmitir',
    inviteLinkCopy: 'Copiar el enlace',
    inviteLinkCopied: 'Enlace copiado.',
    /** No clipboard (an address that is not secure) or a refusal: the field is selectable. */
    inviteLinkCopyFailed: 'No se puede copiar aquí: seleccione el enlace y cópielo usted mismo.',
    revokeModerator: 'Retirar',
    revokeModeratorTitle: '¿Retirar a este moderador?',
    revokeModeratorHint: 'Perderá el acceso a este evento. Sus decisiones anteriores se conservan.',
    moderatorRevoked: 'El moderador se ha retirado.',
    roleOwner: 'Organizador',
    roleModerator: 'Moderador',
    lastOwnerHint: 'No se puede retirar al último organizador.',
    purge: 'Eliminar el evento',
    purgeTitle: '¿Eliminar definitivamente este evento?',
    purgeWarning:
      'Se eliminarán todas las fotos, los invitados y el álbum. Esta acción es definitiva.',
    purgeConfirmLabel: 'Dirección del evento',
    purgeConfirmHint: (slug: string) => `Escriba «${slug}» para confirmar la eliminación.`,
    purged: (name: string) => `${name} se ha eliminado.`,

    scheduleHint:
      'Déjelo en blanco para abrir y finalizar usted mismo. Las horas son las de su ordenador, es decir, las del lugar de la fiesta.',
    scheduleOpenAt: 'Abrir a los invitados el',
    scheduleCloseAt: 'Finalizar el evento el',
    scheduleCloseAtHint: 'Las fotos y el álbum se conservan: finalizar no borra nada.',
    scheduleSaved: 'El horario se ha guardado.',
    scheduleNone: 'Sin horario: usted abre y finaliza el evento.',
    scheduleArmed: (opensAt: string, closesAt: string) =>
      `Apertura el ${opensAt}, final el ${closesAt}.`,
    scheduleOpensOnly: (opensAt: string) => `Apertura el ${opensAt}. Usted finalizará el evento.`,
    scheduleClosesOnly: (closesAt: string) => `Final el ${closesAt}. Usted abrirá el evento.`,
    /* ---- Added by the host lifecycle pass (revue UX 30/10). ---- */
    noticeOpened: 'Evento abierto a los invitados.',
    noticeClosed: 'Evento finalizado. Los invitados ya no pueden enviar fotos.',
    noticeReopened: 'Evento reabierto: los invitados pueden volver a enviar fotos.',
    noticeArchived: 'Evento archivado. El álbum sigue disponible para descargar.',
    noticeArchivedDraft: 'Evento archivado.',
    archiveTitle: (eventName: string) => `¿Archivar ${eventName}?`,
    archiveHint:
      'La pantalla se detiene, los ajustes se congelan y es definitivo. El álbum sigue disponible para descargar.',
    archiveDraftHint: 'Los ajustes se congelan y el evento ya no podrá abrirse: es definitivo.',
    openTitle: (eventName: string) => `¿Abrir ${eventName} a los invitados?`,
    openHint:
      'Todos los que tengan el código QR podrán enviar fotos. Ya no se podrá volver al borrador.',
    wallDraftHint: 'Se encenderá sola en cuanto el evento se abra a los invitados',
    codeRotatedAction: 'Imprimir el nuevo QR',
    afterShare: 'Compartir el álbum',
    nowDraftEyebrow: 'Antes de la fiesta',
    nowDraftTitle: '¿Todo listo?',
    nowDraftSettings: 'Elegir el ambiente y los horarios',
    nowDraftPrint: 'Imprimir las tarjetas de mesa',
    nowDraftWall: 'Probar la pantalla en el proyector',
    nowDraftModerators: 'Invitar a alguien a moderar con usted',
    nowLiveEyebrow: 'En directo',
    nowLiveTitle: 'La fiesta está en marcha',
    nowClosedEyebrow: 'Fiesta terminada',
    nowClosedTitle: 'Hora de los recuerdos',
    nowArchivedEyebrow: 'Evento archivado',
    nowArchivedTitle: 'El álbum sigue siendo suyo',
    moderationWaiting: (count: number) =>
      count === 1 ? '1 foto espera su aprobación' : `${count} fotos esperan su aprobación`,
    moderationNothingWaiting: 'Nada espera su aprobación',
    wallTileHint: 'En una pestaña nueva, para el proyector',
    downloadHint: 'El álbum completo, en un archivo ZIP',
    shareHint: 'Un enlace para quienes no estuvieron',
    accessTitle: 'Para unirse a la fiesta',
    copyJoinLink: 'Copiar el enlace',
    joinLinkCopied: 'Enlace copiado.',
    joinLinkCopyFailed: 'No se pudo copiar el enlace: selecciónelo a mano.',
    qrEnlarge: 'Mostrar el código QR en grande',
    qrEnlargedHint: 'Sus invitados escanean esta pantalla o escriben el código.',
    /* The first visit's guided tour of this page (features/admin/eventTour.ts). */
    tourButton: 'Visita guiada',
    tourWelcomeTitle: 'Le damos la bienvenida a su fiesta',
    tourWelcomeBody: (name: string) =>
      `Aquí prepara «${name}», la dirige el gran día y recupera el álbum después. ¿Damos una vuelta por la pantalla?`,
    tourWelcomeModeratorTitle: 'Le damos la bienvenida al equipo',
    tourWelcomeModeratorBody: (name: string) =>
      `Usted modera «${name}». ¿Damos una vuelta por lo que encontrará aquí?`,
    tourNowTitle: 'Lo que importa ahora',
    tourNowBody:
      'Esta tarjeta sigue la fiesta: antes, lo que queda por preparar; durante, la moderación y la pantalla; después, el álbum. Empiece siempre por ella.',
    tourAccessTitle: 'Hacer entrar a sus invitados',
    tourAccessBody:
      'Escanean este código QR o escriben el código: sin aplicación ni cuenta. Imprima las tarjetas de mesa o muestre el QR en grande el gran día.',
    tourOpenTitle: 'Nada sale antes de abrir',
    tourOpenBody:
      'Mientras el evento sea un borrador, nadie puede enviar fotos. Ábralo aquí cuando llegue el momento, o programe la apertura en los ajustes.',
    tourCloseTitle: 'Finalizar la fiesta en el momento justo',
    tourCloseBody:
      'Los invitados envían fotos hasta que usted finalice el evento aquí, o hasta la hora prevista en los ajustes.',
    tourAfterTitle: 'Reabrir o archivar',
    tourAfterBody:
      'La fiesta ha terminado: ya no se puede enviar nada. Reábrala si hace falta, o archívela una vez guardado el álbum.',
    tourEveningTitle: 'Los dos gestos del gran día',
    tourEveningBodyManual:
      'Moderar: cada foto espera su aprobación antes de aparecer, desde el ordenador o el teléfono. Abrir la pantalla: la página que se muestra a pantalla completa en el proyector.',
    tourEveningBodyAuto:
      'Moderar: las fotos aparecen en cuanto llegan, y usted retira de un gesto las que no deben estar en pantalla. Abrir la pantalla: la página que se muestra a pantalla completa en el proyector.',
    tourOverviewTitle: 'Todo lo demás está aquí',
    tourOverviewBody:
      'Libro de visitas, reto fotográfico, invitados, álbum… El menú ordena todo el evento en tres momentos: preparar, la fiesta, después. Cada tema tiene su propia página.',
    tourEndTitle: 'Ahora le toca a usted',
    tourEndBody: 'Este botón vuelve a iniciar la visita cuando quiera. ¡Buena fiesta!',
    overviewHints: {
      guestbook: 'Las palabras de sus invitados',
      challenge: 'Un reto fotográfico cronometrado',
      missions: 'Ideas de fotos para hacer',
      moderators: 'Moderar entre varios',
      bestOf: 'Sus fotos favoritas',
      book: 'Un libro de fotos para imprimir',
      stats: 'Quién publicó qué, y cuándo',
      settings: 'Ambiente, horarios, pantalla',
    },
    autoOpenAt: (time: string) => `Apertura automática ${atTime(time)}`,
    autoOpenOn: (dateTime: string) => `Apertura automática el ${dateTime}`,
    autoCloseAt: (time: string) => `Final automático ${atTime(time)}`,
    autoCloseOn: (dateTime: string) => `Final automático el ${dateTime}`,
    autoEdit: 'Modificar el horario',
    scheduleDiscardedAction: 'Definir un nuevo horario',

    scheduleDiscarded: (when: string) =>
      `El horario automático no se pudo aplicar el ${when}: el evento no podía cambiar de estado en ese momento. Se ha borrado. Guarde uno nuevo si todavía lo quiere.`,

    missionsTitle: 'Misiones',
    missionsHint:
      'Una lista breve de propuestas que sus invitados ven como una lista de tareas y que la pantalla muestra en una esquina.',
    missionsEmpty: 'Todavía no hay ninguna misión.',
    missionPrompt: 'Texto de la misión',
    missionPromptHint: (max: number) =>
      `${t.number(max)} caracteres como máximo. Escríbalo en el idioma de la fiesta: no se traduce.`,
    missionScope: 'Cómo se cumple',
    missionScopeGuest: 'Por invitado',
    missionScopeEvent: 'Una vez para la fiesta',
    missionScopeHint:
      'Por invitado: cada persona puede cumplirla. Una vez: la primera foto aprobada la marca para todos.',
    missionAdd: 'Añadir la misión',
    missionSave: 'Guardar',
    missionCancel: 'Cancelar',
    /** One word on the button; the sentence a screen reader hears is `missionEdit`. */
    missionEditShort: 'Editar',
    missionDeleteShort: 'Eliminar',
    missionEdit: (prompt: string) => `Editar «${prompt}»`,
    missionDelete: (prompt: string) => `Eliminar «${prompt}»`,
    missionDeleteTitle: '¿Eliminar esta misión?',
    missionDeleteAction: 'Eliminar la misión',
    /** Deleting is safe, and the sentence promises exactly that: the photos are kept. */
    missionDeleteConfirm:
      'Las fotos ya enviadas siguen en el álbum: simplemente dejarán de contar para esta misión.',
    missionAdded: 'La misión se ha añadido.',
    missionSaved: 'La misión se ha guardado.',
    missionDeleted: 'La misión se ha eliminado.',
    missionAnswered: (photos: number, guests: number) =>
      `${t.count(photos, {
        one: `${t.number(photos)} foto`,
        other: `${t.number(photos)} fotos`,
      })}, ${t.count(guests, {
        one: `${t.number(guests)} invitado`,
        other: `${t.number(guests)} invitados`,
      })}`,
    missionUnanswered: 'Todavía sin cumplir',
    missionsFull: (max: number) =>
      `${t.number(max)} misiones como máximo: es lo que mantiene la lista legible a diez metros.`,
    shareLink: 'Álbum compartido',
    shareLinkHint:
      'Un enlace para enviar después de la fiesta: las fotos publicadas, para descargar en resolución completa.',
    shareLinkNone: 'No hay ningún enlace activo.',
    shareLinkActive: (date: string) => `Abierto hasta el ${date}`,
    shareLinkUnavailable:
      'Este enlace ya no se abre: ha caducado, o la persona que lo creó ya no organiza el evento.',
    shareLinkProtected: 'Protegido con contraseña',
    shareLinkUnprotected: 'Sin contraseña',
    shareLinkLifetime: 'Abierto durante',
    shareLinkDays: (days: number) =>
      t.count(days, { one: `${t.number(days)} día`, other: `${t.number(days)} días` }),
    shareLinkPassword: 'Contraseña',
    shareLinkPasswordHint: (min: number) =>
      `Al menos ${t.number(min)} caracteres. Envíela por separado del enlace.`,
    shareLinkCreate: 'Crear el enlace',
    shareLinkReplace: 'Sustituir por un enlace nuevo',
    shareLinkReplaceHint: 'El enlace actual dejará de funcionar de inmediato.',
    shareLinkCreated: 'Aquí tiene el enlace. Cópielo ahora: no se volverá a mostrar.',
    bestOf: 'Best-of',
    bestOfHint: 'Sus fotos favoritas, para llevárselas después de la fiesta.',
    bestOfCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} favorita`,
        other: `${t.number(count)} favoritas`,
      }),
    bestOfNone:
      'Todavía no hay favoritas. Marque con una estrella sus fotos preferidas en la moderación.',
    bestOfPreselect: 'Preseleccionar las más queridas',
    bestOfPreselected: (limit: number) =>
      `Las ${t.number(limit)} fotos más queridas son ahora favoritas. Puede quitar algunas o añadir otras.`,
    bestOfPreselectNothing:
      'Nada que añadir: las más queridas ya son favoritas, o todavía nadie ha reaccionado.',
    bestOfDownload: 'Descargar las favoritas (ZIP)',
    exportBusy: (seconds: number | null) =>
      seconds === null
        ? 'Ya hay una exportación en curso en tu cuenta.'
        : `Ya hay una exportación en curso en tu cuenta. ${t.count(seconds, {
            one: `Inténtalo de nuevo en ${t.number(seconds)} segundo.`,
            other: `Inténtalo de nuevo en ${t.number(seconds)} segundos.`,
          })}`,
    exportNotReady: (seconds: number | null) =>
      seconds === null
        ? 'El servidor ya está preparando otras exportaciones.'
        : `El servidor ya está preparando otras exportaciones. ${t.count(seconds, {
            one: `Inténtalo de nuevo en ${t.number(seconds)} segundo.`,
            other: `Inténtalo de nuevo en ${t.number(seconds)} segundos.`,
          })}`,
    exportFailed: 'No se pudo iniciar la descarga. Inténtalo de nuevo en un momento.',
    // Spec 04: the photo book (a PDF of the published album) on the event page.
    book: 'Libro de fotos',
    bookHint: 'Un libro en PDF con el álbum, listo para enviar o para imprimir.',
    bookStyleLegend: 'Estilo',
    bookStyleNames: {
      classique: 'Clásico',
      magazine: 'Revista',
      souvenir: 'Recuerdo',
    },
    bookStyleHints: {
      classique: 'Sobrio, papel marfil',
      magazine: 'Fotos grandes, titulares grandes',
      souvenir: 'Polaroids y palabras manuscritas',
    },
    bookStyleFromWall: 'Elegido según el ambiente de su pantalla.',
    bookTitle: 'Título',
    bookSubtitle: 'Subtítulo',
    bookSubtitleHint: 'Vacío: la fecha de la fiesta.',
    bookPhotosLegend: 'Fotos',
    bookSelectionAll: (count: number) => `Todas las fotos (${t.number(count)})`,
    bookSelectionAllTooMany: (max: number) => `Más de ${t.number(max)} fotos: elija una selección.`,
    bookSelectionBest: 'Una selección',
    bookSelectionBestHint:
      'Las fotos con estrella, al menos una por fotógrafo, y después las que más gustaron, repartidas a lo largo de la fiesta.',
    bookLengthLegend: 'Extensión de la selección',
    bookLengthNames: {
      short: 'Corta',
      medium: 'Media',
      long: 'Larga',
    },
    bookLengthChip: (name: string, photos: number) => `${name} · ${t.number(photos)} fotos`,
    bookOptionsLegend: 'Contenido',
    bookShowAuthors: 'Nombres',
    bookShowAuthorsHint:
      'Bajo las fotos, bajo las palabras del libro de visitas y en la página de agradecimientos.',
    bookShowCaptions: 'Pies de foto',
    bookGuestbook: 'Palabras del libro de visitas',
    bookGuestbookHint: (count: number, max: number) =>
      `${t.count(count, { one: '1 mensaje escrito', other: `${t.number(count)} mensajes escritos` })}.${count > max ? ` Los primeros ${t.number(max)} irán en el libro.` : ''} Los mensajes de voz no van en el libro.`,
    bookPrintVersion: 'Versión para la imprenta',
    bookPrintVersionHint: 'Dos archivos más, con sangrado, para enviar a una imprenta en línea.',
    bookFormNote:
      'Solo se incluyen las fotos publicadas. El número de páginas se indica cuando el libro está listo.',
    bookCreate: 'Crear el libro',
    bookRebuild: 'Volver a hacer el libro',
    bookRecreate: 'Volver a crear el libro',
    bookWorking: 'El libro se está preparando…',
    bookWorkingDetail: (style: string, target: number | null) =>
      `Estilo ${style}, ${target === null ? 'todas las fotos' : `unas ${t.number(target)} fotos`}. Puede salir de esta página.`,
    bookDone: (photos: number, ofAlbum: number | null, pages: number, until: string | null) =>
      `Libro listo: ${t.count(pages, { one: `${t.number(pages)} página`, other: `${t.number(pages)} páginas` })}, ${t.count(photos, { one: `${t.number(photos)} foto`, other: `${t.number(photos)} fotos` })}${ofAlbum === null ? '' : ` (el álbum tiene ahora ${t.number(ofAlbum)})`}.${until === null ? '' : ` Disponible hasta el ${until}.`}`,
    bookDownload: 'Descargar el libro',
    bookDownloadMeta: (size: string) => `PDF · ${size}`,
    bookDownloadPrintInterior: 'Versión de imprenta: interior',
    bookDownloadPrintCover: 'Versión de imprenta: cubierta',
    bookPrintSkippedTooManyPages: (pages: number, max: number) =>
      `Versión de imprenta no generada: el libro tiene ${t.number(pages)} páginas y las imprentas aceptan ${t.number(max)} como máximo. Elija una selección más corta y vuelva a hacer el libro.`,
    bookPrintSkippedTooLarge:
      'Versión de imprenta no generada: sus archivos son demasiado grandes. Elija una selección más corta y vuelva a hacer el libro.',
    bookHelpLink: '¿Cómo imprimirlo?',
    bookHelpIntro: 'La versión de imprenta son dos archivos hechos a partir del mismo libro.',
    bookHelpStep1:
      'Elija una imprenta en línea que acepte un PDF para un libro cuadrado de 21 × 21 cm con tapa dura.',
    bookHelpStep2:
      'Envíe el interior y la cubierta. El archivo de la cubierta tiene dos páginas: primero la contracubierta y después la portada.',
    bookHelpStep3:
      'Componga el lomo con la herramienta de la imprenta y pida primero un ejemplar de prueba.',
    bookDelete: 'Eliminar el libro',
    bookDeleteTitle: '¿Eliminar el libro?',
    bookDeleteHint: 'El archivo se borra del servidor. Podrá hacer otro, hasta tres al día.',
    bookStale:
      'El libro se retiró porque se eliminó un contenido o cambió un pie de foto. Vuelva a crearlo: sus elecciones se conservan.',
    bookFailed: 'No se pudo hacer el libro. Vuelva a intentarlo dentro de un momento.',
    bookFailedTooLarge: 'El álbum es demasiado voluminoso para un solo libro.',
    // Spec 08, step 2: the highlight video.
    reelTitle: 'Vídeo de lo mejor',
    reelHint:
      'Un vídeo con las favoritas en pase de diapositivas, de la más antigua a la más reciente.',
    reelCreate: 'Crear el vídeo',
    reelRedo: 'Crearlo de nuevo',
    reelQueued: 'El vídeo espera su turno…',
    reelRunning: 'El vídeo se está haciendo, puede tardar unos minutos…',
    reelFailed: 'No se ha podido hacer el vídeo.',
    reelStale: 'Sus favoritas han cambiado: este vídeo está desfasado. Créelo de nuevo.',
    reelDownload: 'Descargar el vídeo (MP4)',
    reelPlayer: 'Vista previa del vídeo',
    reelAsked: 'El vídeo se ha puesto en marcha.',
    reelReady: (count: number) => `Vídeo listo, ${t.number(count)} fotos.`,
    shareLinkUrl: 'Dirección del enlace',
    shareLinkCopy: 'Copiar el enlace',
    shareLinkCopied: 'Enlace copiado.',
    // Navigation pass, batch C: a copy that failed, and the link that is never shown again.
    shareLinkCopyFailed:
      'No se pudo copiar. La dirección está seleccionada: cópiela con Ctrl+C (o con una pulsación larga en un teléfono).',
    shareLinkLeaveWarning:
      'Esta dirección no se volverá a mostrar y no la ha copiado. ¿Salir de la página de todos modos?',
    shareLinkRevoke: 'Desactivar el enlace',
    shareLinkRevokeTitle: '¿Desactivar este enlace?',
    shareLinkRevokeHint:
      'Nadie podrá volver a abrir el álbum con este enlace, ni siquiera con la contraseña. Podrá crear uno nuevo.',
    shareLinkRevoked: 'El enlace se ha desactivado.',

    /* ---- The host's own photograph of their venue (ADR 0010, decision 8). ---- */
    venuePhoto: 'Foto de su local',
    venuePhotoHint:
      'Sustituye la foto del ambiente detrás de la pantalla de sus invitados y la de la sala. Se reduce y se le quitan los metadatos, la posición GPS incluida, y luego se atenúa para que el texto siga siendo legible.',
    venuePhotoPreviewAlt: 'Vista previa de la foto de su local',
    venuePhotoDefault: 'Sin foto de su local: el ambiente muestra su foto por defecto.',
    venuePhotoChoose: 'Elegir una foto',
    venuePhotoReplace: 'Sustituir la foto',
    venuePhotoRemove: 'Volver a la foto por defecto',
    venuePhotoBusy: 'Enviando la foto…',
    venuePhotoSaved: 'La foto de su local está guardada.',
    venuePhotoRemoved: 'Se ha restablecido la foto por defecto.',
    welcomeMessage: 'Mensaje de bienvenida',
    welcomeMessageHint:
      'Unas palabras que verán sus invitados al unirse a la fiesta. Escriba en el idioma de sus invitados: este texto no se traduce. Cualquiera que tenga el código QR puede leerlo, así que no ponga nada privado.',
    welcomeMessagePlaceholder: '¡Bienvenidos! Hagan fotos, las veremos en la pantalla de la sala.',
    welcomeMessageClear: 'Borrar el mensaje',
    welcomeMessageCount: (count, max) => `${count} / ${max}`,
    logo: 'Logotipo del evento',
    logoHint:
      'Un logotipo o monograma, preferiblemente un PNG con fondo transparente (PNG, JPEG o WebP). Aparece en la página de sus invitados y en la pantalla, nunca en las fotos.',
    logoPreviewAlt: 'Vista previa del logotipo del evento',
    logoNone: 'Todavía no hay logotipo.',
    logoChoose: 'Elegir un logotipo',
    logoReplace: 'Sustituir el logotipo',
    logoRemove: 'Quitar el logotipo',
    logoBusy: 'Enviando el logotipo…',
    logoSaved: 'El logotipo está guardado.',
    logoRemoved: 'Se ha quitado el logotipo.',
    customAmbianceCreate: 'Crear mi ambiente (A medida)',
    customAmbianceEdit: 'Modificar mi ambiente',
    customAmbianceEntryHint:
      'Su propio fondo, claro u oscuro, con el matiz que prefiera: lo ve en pantallas reales antes de guardar.',
    customAmbianceTitle: 'Su ambiente a medida',
    customAmbianceCrumb: 'A medida',
    customAmbianceIntro:
      'Elija un fondo claro u oscuro, su matiz, su color de acento y una tipografía. Las vistas previas muestran las pantallas reales con su elección, y no se guarda nada hasta pulsar «Guardar».',
    customGround: 'Fondo',
    customGroundNames: { light: 'Claro', dark: 'Oscuro' },
    customGroundHue: 'Matiz del fondo',
    customGroundHueHint:
      'De 0° a 359°: usted solo elige el matiz; la luminosidad es fija para que todo siga siendo legible.',
    customAccentHue: 'Color de acento',
    customAccentHueHint:
      'Se permite cualquier matiz, incluso los que recuerdan al verde, el amarillo o el rojo de la aplicación: el texto del botón sigue siendo legible en todos, y una alerta siempre lleva un icono y una palabra.',
    customFaces: 'Tipografía',
    customFacesHint:
      'Las fuentes y las esquinas de los botones de uno de los seis ambientes, cada uno mostrado con su propia fuente.',
    customPreview: 'Vista previa',
    customPreviewHint:
      'Una ilustración de lo que verán sus invitados y la sala, con fotos de ejemplo.',
    customPreviewPhone: 'Pantalla de sus invitados',
    customPreviewWall: 'Pantalla de la sala',
    customPreviewCaption: '¡Qué noche tan bonita!',
    customPreviewAuthor: 'Lea',
    customKept: 'Su elección se conserva tal como la dejó: modifíquela y guarde de nuevo.',
    customSaved: 'Su ambiente está guardado.',
  },

  /** The guestbook, host side (spec 01). What guests write is never translated. */
  guestbookHost: {
    title: 'Libro de visitas',
    hint: 'Los mensajes que dejan sus invitados. Llegan a la pantalla según sus ajustes.',
    empty: 'Aún no hay mensajes.',
    anonymous: 'Invitado sin nombre',
    pending: (count: number) =>
      t.count(count, {
        one: '1 en espera',
        other: `${t.number(count)} en espera`,
      }),
    statusPending: 'En espera',
    statusPublished: 'En pantalla',
    statusRejected: 'No aceptado',
    statusHidden: 'Retirado de la pantalla',
    copyId: 'Copiar el identificador',
    idCopied: 'Identificador copiado.',
    copyFailed: 'No se pudo copiar: seleccione el identificador a mano.',
    openMessages: 'Moderar los mensajes',
    onWall: (count: number) => `${t.number(count)} en pantalla`,
  },

  /**
   * The voice messages in the host's console and settings (spec 25): the card, the secret, the
   * action that keeps what waits, and the settings section. What a guest says is never here.
   * The interface says "gardé secret" / "kept secret", never the code's word for it. Never "IA",
   * "intelligent" or "transcription" in a sentence of this table.
   */
  guestbookVoiceHost: {
    cardLabel: (author: string, duration: string) => `Mensaje de voz de ${author}, ${duration}`,
    duration: (duration: string) => `Duración: ${duration}`,
    voiceBadge: 'Mensaje de voz',
    processing: 'En proceso',
    processingCount: (count: number) =>
      t.count(count, {
        one: '1 mensaje de voz en proceso',
        other: `${t.number(count)} mensajes de voz en proceso`,
      }),
    sealedCard: 'Guardado en secreto hasta el final de la velada',
    sealedCardReveal: 'Guardado en secreto hasta la revelación de la velada',
    sealedUntil: (time: string) => `Guardado en secreto hasta las ${time}`,
    sealedUntilOrReveal: (time: string) =>
      `Guardado en secreto hasta las ${time}, o hasta la revelación de la velada si llega antes`,
    notListened: 'No ha escuchado este mensaje',
    cannotHide: 'Un mensaje de voz no se oculta: nunca está en la pantalla.',
    keepPending: (count: number) =>
      t.count(count, {
        one: 'Conservar el mensaje en espera',
        other: `Conservar los ${t.number(count)} mensajes en espera`,
      }),
    keepConfirm: 'No ha escuchado todos estos mensajes. ¿Conservarlos en el álbum?',
    keepConfirmLabel: 'Conservarlos',
    kept: (count: number) =>
      t.count(count, {
        one: '1 mensaje de voz conservado.',
        other: `${t.number(count)} mensajes de voz conservados.`,
      }),
    settingsEnabled: 'Mensajes de voz',
    settingsEnabledHint:
      'Activar los mensajes de voz durante la velada obliga a cada invitado a volver a leer el aviso antes de su próximo envío: mejor activarlos antes.',
    settingsSealed: 'Guardar los mensajes de voz en secreto hasta el final de la velada',
    settingsSealedReveal: 'Guardar los mensajes de voz en secreto hasta la revelación',
    settingsSealedHint:
      'No podrá escucharlos antes. Aun así puede decidir conservarlos o rechazarlos.',
    settingsSealedRevealHint:
      'En una velada que se revela más tarde, se abren cuando reveles la velada, o al terminar. No podrás escucharlos antes. Aun así puedes decidir conservarlos o rechazarlos.',
    openNow: 'Abrir ahora',
    openConfirmTitle: '¿Abrir los mensajes de voz?',
    openConfirmBody: 'Podrá escucharlos ahora mismo. Esta acción es definitiva.',
    opened: 'Los mensajes de voz están abiertos.',
    insecure: 'Esta dirección no es segura: sus invitados no podrán grabar',
  },

  auth: {
    title: 'Inicio de sesión',
    email: 'Dirección de correo',
    password: 'Contraseña',
    submit: 'Iniciar sesión',
    logout: 'Cerrar sesión',
    changePassword: 'Cambiar la contraseña',
    currentPassword: 'Contraseña actual',
    newPassword: 'Contraseña nueva',
    newPasswordHint: (min: number) =>
      `Al menos ${min} caracteres. Una frase es más segura que una palabra.`,
    confirmPassword: 'Confirmar la contraseña nueva',

    changePasswordIntro: 'Elija una contraseña que no use en ningún otro sitio.',
    passwordSaved: 'Contraseña guardada.',
    passwordIncorrect: 'La contraseña no es correcta.',
    deleteAccount: 'Eliminar mi cuenta',
    deleteAccountIntro:
      'Al eliminar la cuenta se borran su dirección, su contraseña y sus accesos. Los eventos que aún le pertenezcan deben eliminarse antes o cederse a otra persona. Durante unos días como máximo seguirán activas las conexiones ya abiertas, y el registro de auditoría conserva líneas anónimas: un identificador que ya no remite a nadie, sin su nombre ni su dirección. No se puede deshacer.',
    deleteAccountConfirm: 'Introduzca su contraseña para confirmar.',
    deleteAccountSubmit: 'Eliminar mi cuenta definitivamente',
    deleteAccountDone: 'Su cuenta ha sido eliminada.',
    deleteAccountCode: 'Código de su aplicación de autenticación',
    deleteAccountCodeHint: 'Solo si activó un segundo factor; si no, déjelo vacío.',
    deleteAccountHoldsEvents:
      'Todavía es propietario de al menos un evento. Elimínelo o cédaselo a otra persona y vuelva a intentarlo. ¿Necesita ayuda? Contacte con el operador del sitio.',
    deleteAccountHoldsMedia:
      'Subió fotos o vídeos a un evento, por lo que su cuenta no se puede eliminar por su cuenta. Contacte con el operador del sitio.',
    deleteAccountHoldsReviews:
      'Moderó fotos, por lo que su cuenta no se puede eliminar por su cuenta. Contacte con el operador del sitio.',
    deleteAccountLastOwner:
      'Es el único propietario de su espacio, que aún tiene miembros o eventos. Añada otro propietario o contacte con el operador del sitio.',

    /* ---- Added by G2-13: the second factor. ---- */
    secondFactorTitle: 'Verificación en dos pasos',
    secondFactorIntro:
      'Introduzca el código de seis cifras que muestra su aplicación de autenticación.',
    secondFactorCode: 'Código de seis cifras',
    secondFactorSubmit: 'Verificar',
    secondFactorRecoveryToggle: 'Usar un código de recuperación',
    secondFactorAppToggle: 'Usar el código de la aplicación',
    secondFactorRecoveryIntro:
      'Introduzca uno de los códigos de recuperación que recibió al activarla. Cada uno sirve una sola vez.',
    recoveryCode: 'Código de recuperación',
    secondFactorRestart: 'Empezar de nuevo con la contraseña',
    securityTitle: 'Seguridad de la cuenta',
    securityUnavailable:
      'Este servidor no tiene una clave de cifrado para la verificación en dos pasos. Pida a su administrador que la configure.',
    setupIntro:
      'Una aplicación de autenticación (Aegis, 1Password, Google Authenticator…) genera un código de seis cifras que se suma a su contraseña.',
    setupStart: 'Activar la verificación',
    setupScan: 'Escanee este código QR con su aplicación. Sin cámara, escriba la clave a mano.',
    setupQrLabel: 'Código QR de configuración',
    setupKeyLabel: 'Clave de configuración',
    setupConfirm: 'Confirmar',
    recoveryCodesTitle: 'Códigos de recuperación',
    recoveryCodesIntro:
      'Si pierde el teléfono, cada uno de estos diez códigos le abre la puerta una vez. Anótelos ahora: no volverán a mostrarse.',
    recoveryCodesCopy: 'Copiar los códigos',
    recoveryCodesCopied: 'Códigos copiados.',
    recoveryCodesCopyFailed:
      'No se puede copiar aquí: seleccione los códigos y cópielos usted mismo.',
    recoveryCodesSaved: 'Ya los he anotado',
    securityEnabled: 'La verificación en dos pasos está activa en esta cuenta.',
    securityManageIntro:
      'Para renovar sus códigos de recuperación o desactivar la verificación, confirme primero su identidad.',
    stepUpSubmit: 'Confirmar mi identidad',
    stepUpDone: 'Identidad confirmada durante cinco minutos.',
    recoveryCodesRegenerate: 'Generar nuevos códigos de recuperación',
    secondFactorDisable: 'Desactivar la verificación',
    secondFactorDisabled: 'Verificación en dos pasos desactivada.',

    /* ---- Added by G2-10: the invitation page, the reset by e-mail and the account menu. ---- */
    invitationTitle: 'Invitación',
    invitationToModerate: (name: string) =>
      `Ha recibido una invitación para moderar el evento «${name}».`,
    invitationToOwn: (name: string) =>
      `Ha recibido una invitación para crear y gestionar los eventos de «${name}».`,
    invitationToJoin: (name: string) =>
      `Ha recibido una invitación para unirse al equipo de «${name}».`,
    invitationExpires: (when: string) => `Válida hasta el ${when}.`,
    invitationChoose:
      'Elija su nombre y una contraseña: su cuenta se crea al enviar este formulario.',
    invitationName: 'Su nombre',
    invitationNameHint: 'Aparece en la lista de personas con acceso.',
    invitationConfirmPassword: 'Confirmar la contraseña',
    invitationSubmit: 'Crear mi cuenta y aceptar',
    invitationAccepted: 'Invitación aceptada.',
    invitationHaveAccount: '¿Ya tiene una cuenta?',
    invitationSignedInAs: (email: string) => `Ha iniciado sesión como ${email}.`,
    invitationAcceptAs: 'Aceptar con esta cuenta',
    invitationUseAnother: 'Usar otra cuenta',
    /* ---- Added by G2-20: the terms of use an invitation's acceptance agrees to. ---- */
    invitationAcceptTerms: (version: string) =>
      `Acepto las condiciones de uso (versión ${version}), incluidas las cláusulas de encargo del tratamiento.`,
    invitationReadTerms: 'Leer las condiciones de uso',
    deadLinkTitle: 'Este enlace no es válido',
    forgotLink: '¿Ha olvidado su contraseña?',
    forgotTitle: 'Contraseña olvidada',
    forgotIntro:
      'Introduzca la dirección de correo de su cuenta. Si una cuenta la utiliza, recibirá un enlace para elegir una nueva contraseña.',
    forgotSubmit: 'Enviar el enlace',
    forgotSentTitle: 'Revise su correo',
    forgotSent:
      'Si una cuenta utiliza esta dirección, se acaba de enviar un mensaje con un enlace. El enlace es válido durante una hora y solo funciona una vez.',
    forgotUnavailable:
      'Este servidor no puede enviar correos, así que aquí no se puede restablecer la contraseña de este modo. Pregunte a la persona que lo administra.',
    backToLogin: 'Volver al inicio de sesión',
    resetTitle: 'Nueva contraseña',
    resetIntro:
      'Elija una contraseña que no use en ningún otro sitio. Se cerrará su sesión en todos sus dispositivos.',
    resetSubmit: 'Cambiar la contraseña',
    resetDoneTitle: 'Contraseña cambiada',
    resetDone:
      'Se ha cerrado la sesión en todos sus dispositivos. Inicie sesión con su nueva contraseña.',
    resetAskAgain: 'Solicitar un nuevo enlace',
    accountMenu: 'Cuenta',
    accountSignedInAs: (email: string) => `Sesión iniciada como ${email}`,
    logoutEverywhere: 'Cerrar sesión en todas partes',
    logoutEverywhereTitle: '¿Cerrar sesión en todas partes?',
    logoutEverywhereHint:
      'Se cerrará su sesión en todos los dispositivos, también en este, y tendrá que volver a iniciarla. Útil si ha perdido un dispositivo o ha usado un ordenador compartido.',

    /* ---- Navigation pass, batch D: accounts and sign-in. ---- */
    alreadySignedIn: 'Ya ha iniciado sesión. Redirigiendo…',
    forgotNoMail:
      '¿Ha olvidado la contraseña? Este servidor no envía correos: pida a la persona que lo administra que la restablezca.',
    changePasswordForced:
      'Su contraseña se eligió por usted: cámbiela antes de continuar. Después volverá a donde iba.',
    menuMustChange:
      'Cambie primero su contraseña: el resto de su espacio permanece cerrado hasta entonces.',
    securityBack: 'Volver',
    secondFactorEnabled: 'Verificación en dos pasos activada.',
    recoveryCodesLeaveTitle: '¿Salir sin haber anotado sus códigos?',
    recoveryCodesLeaveHint:
      'Estos códigos solo se muestran una vez: si sale de esta página, ya no podrá leerlos. Para obtener otros nuevos tendrá que confirmar de nuevo su identidad.',
    recoveryCodesLeaveStay: 'Quedarme y anotar mis códigos',
    recoveryCodesLeaveGo: 'Salir de todos modos',
    deadInvitationSignIn: 'Si ya la aceptó, su cuenta existe: inicie sesión.',
    deadInvitationSignedIn:
      'Ya ha iniciado sesión: si la aceptó con esta cuenta, sus eventos están ahí.',
  },

  mobileModeration: {
    title: 'Moderación en el teléfono',
    // Navigation pass, batch C: the way to the other console.
    openConsole: 'Versión completa, para ordenador',
    intro: 'Deslice la foto hacia la derecha para publicar y hacia la izquierda para rechazar.',
    releaseToPublish: 'Suelte para publicar',
    releaseToReject: 'Suelte para rechazar',
    nowDeciding: (photo: string) => `Foto por moderar. ${photo}`,
    /** Named more fully than `moderation.undo`; both are on screen at once here. */
    undoLast: 'Deshacer la última decisión',
    /** A refusal cannot be taken back, so the console says what it can do instead. */
    undoUnavailable: 'Solo se puede deshacer una publicación.',

    /* ---- Moderation traps pass (MOD-2). Keep additions inside this block. ---- */
    onScreenTitle: 'Últimas fotos en pantalla',
    onScreenHint: 'Toque una foto para retirarla de la pantalla.',
    onScreenEmpty: 'No hay nada en pantalla por ahora.',
    openOnScreen: (author: string) => `Ver la foto de ${author}, en pantalla`,
  },
  gallery: {
    title: 'Álbum compartido',
    opening: 'Abriendo el álbum…',
    unavailableTitle: 'Este enlace ya no está disponible',
    unavailableHint:
      'Puede que haya caducado o que se haya desactivado. Pida un enlace nuevo a la persona que se lo envió.',
    lockedTitle: 'Álbum protegido',
    lockedHint: 'Introduzca la contraseña que recibió junto con el enlace.',
    passwordLabel: 'Contraseña',
    unlock: 'Abrir el álbum',
    photoCount: (count: number) =>
      t.count(count, { one: `${t.number(count)} foto`, other: `${t.number(count)} fotos` }),
    availableUntil: (date: string) => `Disponible hasta el ${date}`,
    privacyNote: 'Las fotos se descargan en resolución completa, sin sus datos de ubicación.',
    downloadAll: 'Descargarlo todo (.zip)',
    download: 'Descargar el original',
    downloadClip: 'Descargar el vídeo',
    openPhoto: (position: number) => `Ampliar la foto ${t.number(position)}`,
    photoAlt: (position: number) => `Foto ${t.number(position)} del álbum`,
    clipBadge: 'Vídeo',
    empty: 'Todavía no se ha publicado ninguna foto en este álbum.',
    loadMore: 'Mostrar más fotos',
    viewerTitle: (position: number, total: number) =>
      `Foto ${t.number(position)} de ${t.number(total)}`,
  },
  about: {
    sourceCode: 'Código fuente (AGPL-3.0)',
    opensInNewTab: 'se abre en una pestaña nueva',
    aboutLink: 'Acerca de',
    /* Navigation pass, batch A: a way back from the page. */
    back: 'Volver',
    home: 'Inicio',

    title: 'Acerca de EventSlide',
    intro:
      'EventSlide es software libre: puede leer, modificar y redistribuir su código fuente según los términos de su licencia.',
    versionLabel: 'Versión',
    licenseLabel: 'Licencia',
    sourceLabel: 'Código fuente',
    sourceNote: 'Este enlace lleva al código fuente de la versión indicada arriba.',
    noticesLabel: 'Licencias de terceros',
    noticesLink: 'Avisos de las bibliotecas incluidas',
    noticesNote: 'Los textos de licencia de las bibliotecas libres que contiene esta aplicación.',

    supportLink: 'Apoyar el proyecto',
    supportTitle: 'El proyecto vive de donaciones',
    supportIntro: 'EventSlide es software libre, gratuito y sin publicidad.',
    supportNoCounterpart: 'Una donación no desbloquea nada: el mismo servicio para todos.',
    budgetLink: 'Ver el presupuesto público',
    supportDismiss: 'Ocultar este mensaje',

    termsLink: 'Condiciones de uso',
    privacyLink: 'Política de privacidad',
    legalNoticeLink: 'Aviso legal',
    helpLink: 'Ayuda',
    reportLink: 'Denunciar un contenido',
    operatorTitle: 'Quién gestiona esta instancia',
    operatorNameLabel: 'Operador',
    operatorContactLabel: 'Contacto',
    operatorHostedBy: 'Alojado por',
  },
  clientSpace: {
    bannerLabel: 'Límites de su cuenta',
    warningTitle: 'Se acerca a un límite de su cuenta',
    reachedTitle: 'Se ha alcanzado un límite de su cuenta',
    eventsMeter: (used: number, max: number) => `Eventos: ${used} de ${max}`,
    eventsPerPeriodMeter: (used: number, max: number) =>
      `Eventos creados en el periodo: ${used} de ${max}`,
    storageMeter: (used: string, max: string) => `Almacenamiento: ${used} de ${max}`,
    liveNotAllowed: 'La apertura de nuevos eventos está suspendida en su cuenta.',
    contactHint: 'Para levantar un límite, póngase en contacto con su operador.',
    contactAction: 'Contactar con el operador',
    suspendedTitle: 'Su cuenta está suspendida',
    suspendedBody:
      'Sus álbumes siguen siendo consultables y exportables. Mientras dure la suspensión, no puede crear, abrir ni modificar un evento, y el público ya no ve sus pantallas.',
    spaceLink: 'Espacio de cliente',
    spaceTitle: 'Espacio de cliente',
    limitsTitle: 'Límites y uso',
    noLimits: 'Su operador no ha fijado ningún límite en su cuenta.',
    // Navigation pass, batch C: an account that belongs to no client.
    noClient: 'Su cuenta no pertenece a ningún cliente.',
    noClientHint:
      'Por lo tanto, aquí no hay límites ni uso que consultar. Sus eventos están en la página «Sus eventos».',
    roleOwner: 'Propietario',
    roleMember: 'Miembro',
    pendingTitle: 'Pendiente de su aprobación',
    pendingHint:
      'Su operador ha invitado a estas personas a su cuenta. Solo entran con la aprobación de un propietario.',
    pendingEmpty: 'Nada espera su aprobación.',
    pendingValidUntil: (date: string) => `Válida hasta el ${date}`,
    approve: 'Aprobar',
    approved: 'Invitación aprobada.',
    auditTitle: 'Registro de acciones',
    auditHint:
      'Todo lo que su operador, el sistema o su equipo ha hecho en su cuenta, de la más reciente a la más antigua.',
    auditEmpty: 'Todavía no se ha registrado ninguna acción.',
    auditMore: 'Ver acciones más antiguas',
    actorOperator: 'Operador',
    actorMember: 'Su equipo',
    actorSystem: 'Sistema',
    actorIntegration: 'Integración',
    actionCeilingsChanged: 'Sus límites se han modificado.',
    actionPeriodReset: 'Su periodo se ha renovado.',
    actionInvitationIssued: 'Se ha emitido una invitación.',
    actionInvitationIssuedPending: 'Se ha emitido una invitación; espera su aprobación.',
    actionInvitationApproved: 'Se ha aprobado una invitación.',
    actionResetRequested: 'Se ha solicitado restablecer la contraseña de un miembro.',
    actionResetApproved: 'Se ha aprobado un restablecimiento de contraseña.',
    actionResetMailed: 'Se ha enviado un enlace de restablecimiento al miembro.',
    actionResetShown: 'Se ha entregado un enlace de restablecimiento al operador.',
    actionTermsAccepted: 'Una persona aceptó las condiciones de uso al aceptar una invitación.',
    actionOther: 'Se ha registrado una acción.',
    liveWindowEnd: (date: string) => `El evento termina el ${date}.`,
  },

  site: {
    menuLink: 'Consola del operador',
    consoleTitle: 'Consola del operador',
    consoleIntro:
      'Aquí ve formas y tamaños, nunca lo que sus clientes han creado: ninguna foto, ningún nombre de evento.',
    navLabel: 'Secciones de la consola',
    navClients: 'Clientes',
    navAccounts: 'Cuentas',
    navAudit: 'Registro',
    factorTitle: 'Verificación en dos pasos obligatoria',
    factorEnrol:
      'Esta instancia se la exige al operador y su cuenta aún no la ha activado. Actívela y vuelva aquí.',
    factorEnrolLink: 'Activar la verificación en dos pasos',
    factorSignIn:
      'Esta sesión no ha pasado la verificación en dos pasos. Vuelva a iniciar sesión e introduzca el código de su aplicación.',
    factorSignOut: 'Iniciar sesión de nuevo',
    stepUpTitle: 'Confirme su identidad',
    stepUpIntro:
      'Esta acción cambia una instancia compartida. Introduzca su contraseña, y el código de su aplicación si tiene una: la confirmación vale cinco minutos.',
    more: 'Ver más',

    clientsTitle: 'Clientes',
    clientsHint:
      'Un cliente es una cuenta, sus eventos y sus límites. Usted lee sus tamaños, nunca sus contenidos.',
    newClient: 'Nuevo cliente',
    clientsEmpty: 'Todavía no hay ningún cliente.',
    clientsEmptyHint:
      'Abra un cliente: su propietario recibe una invitación y elige él mismo su contraseña.',
    clientsTableLabel: 'Los clientes de la instancia',
    clientColumn: 'Cliente',
    statusColumn: 'Estado',
    eventsColumn: 'Eventos',
    membersColumn: 'Miembros',
    storageColumn: 'Almacenamiento',
    createdColumn: 'Abierto el',
    statusActive: 'Activo',
    statusSuspended: 'Suspendido',
    statusOffboarding: 'En proceso de cierre',
    eventsCell: (total: number, live: number) => `${t.number(total)} (${t.number(live)} en curso)`,
    storageOf: (used: string, max: string) => `${used} de ${max}`,
    noCeiling: 'Sin límite',

    newClientTitle: 'Abrir un cliente',
    newClientIntro:
      'El cliente se abre sin miembros ni eventos, y su propietario recibe una invitación por correo, o mediante un enlace que usted le transmite si la instancia no puede enviar correo. Usted nunca elige su contraseña.',
    clientName: 'Nombre del cliente',
    ownerEmail: 'Correo electrónico del propietario',
    inviteLanguage: 'Idioma de la invitación',
    defaultsHint:
      'Los límites son los que esta instancia da por defecto a un cliente nuevo. Vacíe un campo para no fijar ningún límite.',
    createClient: 'Abrir el cliente',
    clientCreated: 'Cliente abierto.',

    invitationMailed: (email: string) => `Se ha enviado una invitación a ${email}.`,
    invitationPending:
      'La invitación está escrita, pero solo se abre con la aprobación de un propietario del cliente.',
    invitationLinkTitle: 'No ha salido ningún correo',
    invitationLinkBody:
      'Esta instancia no puede enviar correo, o el servidor de correo ha rechazado este mensaje. Este enlace es la única copia: transmítaselo al destinatario y cierre después este recuadro.',
    invitationLinkLabel: 'Enlace de invitación',
    copyLink: 'Copiar el enlace',
    linkCopied: 'Enlace copiado.',
    linkCopyFailed: 'No se puede copiar aquí: seleccione el enlace y cópielo usted mismo.',
    invitationValidUntil: (date: string) => `Válida hasta el ${date}.`,

    ceilingsLegend: 'Límites',
    maxEvents: 'Eventos, como máximo',
    maxEventsPerPeriod: 'Eventos creados por periodo, como máximo',
    maxTotalGigabytes: 'Almacenamiento total, en GB',
    maxEventQuotaGigabytes: 'Cuota de un evento, en GB',
    maxRetentionDays: 'Conservación tras el final del evento, en días, como máximo',
    maxLiveDays: 'Duración de un evento en curso, en días, como máximo',
    clipsAllowed: 'Vídeos permitidos',
    booksAllowed: 'Libros de fotos (PDF) permitidos',
    channelsAllowed: 'Grupos de mensajería (Telegram) permitidos',
    liveAllowed: 'Apertura de eventos permitida',
    renewPeriod: 'Renovar el periodo ahora',
    renewPeriodHint: 'Pone a cero el contador de eventos creados en el periodo.',
    emptyMeansNone: 'Vacío: sin límite.',
    notANumber: 'Introduzca un número positivo.',

    allClients: 'Todos los clientes',
    memberCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} miembro`,
        other: `${t.number(count)} miembros`,
      }),
    periodEvents: (count: number) => `Creados en el periodo: ${t.number(count)}`,
    suspendedSince: (date: string) => `Suspendido desde el ${date}.`,
    purgeOn: (date: string) => `Los álbumes se eliminarán como muy tarde el ${date}.`,
    suspend: 'Suspender',
    suspendTitle: '¿Suspender este cliente?',
    suspendBody:
      'Los invitados ya no pueden unirse a sus eventos ni enviar fotos, el público deja de ver sus pantallas y sus álbumes, y sus miembros ya no pueden modificar nada. No se elimina nada y no se desactiva ninguna cuenta.',
    suspended: 'Cliente suspendido.',
    resume: 'Levantar la suspensión',
    resumeTitle: '¿Levantar la suspensión?',
    resumeBody:
      'Las pantallas y los álbumes del cliente vuelven a ser visibles de inmediato, y sus invitados pueden volver a unirse y enviar fotos.',
    resumed: 'Suspensión levantada.',
    rename: 'Cambiar el nombre',
    renameTitle: 'Nombre del cliente',
    renamed: 'Cliente renombrado.',
    ceilingsTitle: 'Límites',
    ceilingsReason: 'Motivo del cambio',
    ceilingsReasonHint:
      'Una frase en una línea, 200 caracteres como máximo, sin dirección de correo. Se anota en el registro del operador y el cliente no la lee. Solo motivos no financieros: tamaño de un evento, capacidad, abuso.',
    ceilingsSave: 'Guardar los límites',
    ceilingsSaved: 'Límites guardados.',
    ceilingsUnchanged: 'Ningún límite ha cambiado.',
    inviteTitle: 'Invitar a este cliente',
    inviteIntro:
      'Una persona entra en la cuenta del cliente, nunca en un evento. Si el cliente ya tiene eventos o miembros, un propietario debe aprobar la invitación.',
    inviteEmail: 'Correo electrónico',
    inviteRole: 'Función',
    inviteSend: 'Invitar',
    roleOwner: 'Propietario',
    roleMember: 'Miembro',
    eventsTitle: 'Eventos',
    eventsHint: 'Solo formas y tamaños: ni nombre, ni dirección, ni foto.',
    eventsEmpty: 'Este cliente no tiene ningún evento.',
    eventsTableLabel: 'Los eventos del cliente',
    eventColumn: 'Evento',
    eventStatusColumn: 'Estado',
    photosColumn: 'Fotos',
    usedColumn: 'Espacio usado',
    startsColumn: 'Inicio previsto',
    eventLabel: (short: string) => `Evento ${short}`,
    eventStatuses: {
      draft: 'Borrador',
      live: 'En curso',
      closed: 'Finalizado',
      archived: 'Archivado',
    },
    photoCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto`,
        other: `${t.number(count)} fotos`,
      }),
    auditLink: 'Ver el registro de este cliente',

    accountsTitle: 'Cuentas',
    accountsHint:
      'Las direcciones de las personas que tienen una cuenta en esta instancia, y nada más: ni nombre visible, ni contraseña.',
    accountsEmpty: 'Todavía no hay ninguna cuenta.',
    accountsTableLabel: 'Las cuentas de la instancia',
    addressColumn: 'Dirección',
    roleColumn: 'Función en la instancia',
    accountStateColumn: 'Estado',
    lastLoginColumn: 'Último acceso',
    termsColumn: 'Condiciones aceptadas',
    termsNone: 'Sin registro',
    termsAccepted: (version: string, at: string) => `Versión ${version}, el ${at}`,
    ownedColumn: 'Eventos propios',
    clientsColumn: 'Clientes',
    siteRoleOperator: 'Operador',
    accountActive: 'Activa',
    accountDisabled: 'Desactivada',
    neverSignedIn: 'Nunca',
    mustChange: 'Debe cambiar su contraseña',
    resetPassword: 'Restablecer la contraseña',
    resetTitle: '¿Restablecer esta contraseña?',
    resetBody:
      'Un enlace válido durante una hora sale hacia la dirección de la cuenta y a ningún otro sitio: usted solo lo ve en una instancia que no envía correo.',
    resetSent: 'El enlace se ha enviado a la dirección de la cuenta.',
    resetPending: 'A la espera de un propietario',
    resetPendingBody:
      'Esta instancia no envía correo. Otro propietario del cliente debe aprobar la solicitud antes de que se le entregue el enlace.',
    resetFetch: 'Obtener el enlace aprobado',
    resetLinkTitle: 'Enlace de restablecimiento',
    resetLinkBody:
      'Solo sirve una vez. Transmítaselo al titular de la cuenta y cierre después este recuadro.',

    auditTitle: 'Registro',
    auditHint:
      'Todo lo que se ha hecho en la instancia, de lo más reciente a lo más antiguo. El motivo de un cambio de límites es la frase del propio operador.',
    auditEmpty: 'Todavía no hay ninguna acción registrada.',
    auditMore: 'Ver acciones más antiguas',
    auditShowAll: 'Ver todo el registro',

    /* ---- Navigation pass, batch D: the console's links and the invitation link. ---- */
    exitsLabel: 'Salir de la consola',
    accountsLink: 'Ver todas las cuentas',
    noClient: 'Ninguno',
    auditFilteredFor: (name: string) => `Registro del cliente «${name}».`,
    auditToClient: 'Ver este cliente',
    linkLeaveTitle: '¿Salir sin haber copiado el enlace?',
    linkLeaveHint:
      'No ha salido ningún correo: este enlace solo se muestra aquí, una vez. Si sale de esta página, ya no podrá copiarlo; tendrá que emitir uno nuevo.',
    linkLeaveStay: 'Quedarme y copiar el enlace',
    linkLeaveGo: 'Salir de todos modos',
    auditReason: (reason: string) => `Motivo: ${reason}`,
    auditAccount: (short: string) => `cuenta ${short}`,
    actors: {
      operator: 'Operador',
      member: 'Miembro',
      system: 'Sistema',
      integration: 'Integración',
    },
    actions: {
      'client.created': 'Cliente abierto.',
      'client.renamed': 'Cliente renombrado.',
      'client.ceilingsChanged': 'Límites modificados.',
      'client.periodReset': 'Periodo renovado.',
      'client.suspended': 'Cliente suspendido.',
      'client.resumed': 'Suspensión levantada.',
      'invitation.issued': 'Invitación emitida.',
      'invitation.approved': 'Invitación aprobada por un propietario.',
      'account.resetRequested': 'Restablecimiento de contraseña solicitado.',
      'account.resetApproved': 'Restablecimiento aprobado por un propietario.',
      'account.resetIssued': 'Restablecimiento emitido.',
      'account.disabled': 'Cuenta desactivada.',
      'client.offboarded': 'Fin de la colaboración iniciado.',
      'client.finalized': 'Cliente eliminado al terminar la colaboración.',
      'account.enabled': 'Cuenta reactivada.',
      'account.deleted': 'Cuenta eliminada.',
      'account.termsAccepted': 'Condiciones de uso aceptadas.',
      'account.secondFactorEnrolled': 'Verificación en dos pasos activada.',
      'account.secondFactorDisabled': 'Verificación en dos pasos desactivada.',
      'account.recoveryCodesRegenerated': 'Códigos de recuperación renovados.',
      'account.recoveryCodeUsed': 'Se ha usado un código de recuperación.',
    },
    actionInvitationIssuedPending: 'Invitación emitida; espera la aprobación de un propietario.',
    actionOther: 'Se ha registrado una acción.',
    accountActionsColumn: 'Acciones sobre la cuenta',
    disableAccount: 'Desactivar',
    enableAccount: 'Reactivar',
    deleteAccount: 'Eliminar',
    disableTitle: (address: string) => `¿Desactivar la cuenta de ${address}?`,
    disableBody:
      'Todas sus conexiones abiertas terminan al instante y la persona ya no puede iniciar sesión. No se elimina nada: al reactivarla recupera el acceso, pero tendrá que volver a iniciar sesión.',
    accountDisabledDone: 'Cuenta desactivada.',
    accountEnabledDone: 'Cuenta reactivada.',
    deleteTitle: (address: string) => `¿Eliminar la cuenta de ${address}?`,
    deleteBody:
      'Responde a una solicitud de supresión. La cuenta, sus pertenencias, las invitaciones dirigidas a ella, su segundo factor y los enlaces para compartir que creó desaparecen. Las líneas del registro que escribió permanecen, sin su nombre, y también las invitaciones que emitió. Su dirección permanece en sus conexiones abiertas (siete días como máximo) y en los enlaces ya emitidos hasta que caduquen. Esta acción es definitiva.',
    accountDeletedDone: 'Cuenta eliminada.',
    offboardTitle: 'Fin de la colaboración',
    offboardIntro:
      'Los eventos en curso se finalizan, los borradores se archivan, el cliente se suspende y sus álbumes se eliminan como muy tarde al terminar el plazo que usted fija: es el tiempo que tiene el cliente para exportar lo que quiere conservar (la retención propia de un evento o los límites del cliente pueden eliminarlos antes). Después se eliminan las cuentas que solo le pertenecían y no tienen nada más, y el cliente con ellas.',
    graceDays: 'Plazo antes de la eliminación, en días',
    graceDaysHint: 'Un número entero de días: los límites son los del servidor.',
    offboardAction: 'Poner fin a la colaboración',
    offboardConfirmTitle: '¿Poner fin a la colaboración con este cliente?',
    offboardConfirmBody: (days: number) =>
      t.count(days, {
        one: `Dentro de ${t.number(days)} día como muy tarde, los álbumes de este cliente se eliminarán y después el propio cliente, con las cuentas que solo le pertenecían y no tienen nada más. No hay vuelta atrás: ni la fecha ni la suspensión podrán cambiarse. Hasta entonces sus eventos en curso se cierran, sus borradores se archivan y el cliente se suspende.`,
        other: `Dentro de ${t.number(days)} días como muy tarde, los álbumes de este cliente se eliminarán y después el propio cliente, con las cuentas que solo le pertenecían y no tienen nada más. No hay vuelta atrás: ni la fecha ni la suspensión podrán cambiarse. Hasta entonces sus eventos en curso se cierran, sus borradores se archivan y el cliente se suspende.`,
      }),
    offboardedDone: 'Fin de la colaboración en marcha.',
    offboardingRunning:
      'Esta colaboración termina: los álbumes se eliminarán como muy tarde en la fecha indicada arriba.',
    daysNotWhole: 'Indique un número entero de días.',
    takedownNav: 'Retirada',
    takedownTitle: 'Retirar sin mirar',
    takedownIntro:
      'Retire una foto o un evento denunciado a partir de su identificador, sin abrirlo nunca: esta consola no muestra miniatura, ni pie de foto, ni nombre de invitado, ni dirección de medio. Cada acto pide un motivo, que se escribe en el registro de la instancia y que el cliente no lee. Retirar no detiene la purga: para conservar el contenido como prueba, retírelo y congele después su purga.',
    takedownEventTitle: 'Un evento',
    takedownEventIntro:
      'Busque el evento denunciado por su dirección, el código de la fiesta o su nombre exacto. De él solo ve su identificador y su estado.',
    takedownEventLabel: 'Dirección, código o nombre exacto',
    takedownEventAction: 'Buscar el evento',
    takedownEventNone:
      'Ningún evento coincide. El nombre debe ser exacto: una parte del nombre no basta.',
    takedownEventHeading: (id: string) => `Evento ${id}`,
    takedownClient: 'Abrir el cliente',
    takedownNoClient: 'Sin cliente',
    takedownStateDown: 'Retirado',
    takedownStateUp: 'En línea',
    takedownStateHeld: 'Purga congelada',
    takedownStateFree: 'Purga normal',
    takedownEventDown: 'Retirar el evento',
    takedownEventUp: 'Volver a ponerlo en línea',
    takedownHold: 'Congelar la purga',
    takedownRelease: 'Reanudar la purga',
    takedownPhotoTitle: 'Una foto',
    takedownPhotoIntro:
      'Pegue el identificador de la foto tal como lo da la denuncia (la última parte de su dirección, antes del nombre de la variante). Solo ve el evento al que pertenece y su estado.',
    takedownPhotoLabel: 'Identificador de la foto',
    takedownPhotoAction: 'Buscar la foto',
    takedownPhotoNone: 'Ninguna foto tiene este identificador.',
    takedownPhotoHeading: (id: string) => `Foto ${id}`,
    takedownPhotoOf: (id: string) => `En el evento ${id}`,
    takedownPhotoDown: 'Retirar la foto',
    takedownPhotoUp: 'Restituir la foto',
    takedownGuestbookTitle: 'Un mensaje del libro de visitas',
    takedownGuestbookIntro:
      'Pegue el identificador del mensaje tal como lo da el aviso. Solo ve el evento al que pertenece y su estado, nunca su texto.',
    takedownGuestbookLabel: 'Identificador del mensaje',
    takedownGuestbookAction: 'Buscar el mensaje',
    takedownGuestbookNone: 'Ningún mensaje tiene este identificador.',
    takedownGuestbookHeading: (id: string) => `Mensaje ${id}`,
    takedownGuestbookOf: (id: string) => `En el evento ${id}`,
    takedownGuestbookDown: 'Retirar el mensaje',
    takedownGuestbookUp: 'Restablecer el mensaje',
    takedownReason: 'Motivo',
    takedownReasonHint:
      'Una frase en una sola línea, de 200 caracteres como máximo, sin dirección de correo. Se escribe en el registro de la instancia.',
    takedownUnknown:
      'Estado desconocido: el acto puede haberse realizado o no, repita la búsqueda para saberlo.',
    takedownDone: 'Hecho.',
    takedownOps: {
      eventDown: {
        title: '¿Retirar este evento?',
        body: 'El muro, el flujo de los invitados, el enlace del álbum y el espacio del anfitrión responden como si el evento no existiera, y las pantallas abiertas se cierran. No se borra nada. La conservación sigue: para guardar el contenido como prueba, congele también su purga.',
        confirm: 'Retirar el evento',
      },
      eventUp: {
        title: '¿Volver a poner este evento en línea?',
        body: 'El muro, los invitados, el álbum y el anfitrión lo recuperan tal como estaba.',
        confirm: 'Volver a ponerlo en línea',
      },
      purgeHold: {
        title: '¿Congelar la purga de este evento?',
        body: 'El barrido de retención lo ignora, y ni el anfitrión ni un invitado pueden ya borrar el evento ni una foto. No se oculta nada: el bloqueo no se ve en la sala. Las copias de seguridad no se congelan.',
        confirm: 'Congelar la purga',
      },
      purgeRelease: {
        title: '¿Reanudar la purga de este evento?',
        body: 'El evento vuelve a ser purgable en su propio plazo, que puede haber pasado: el próximo barrido lo purgará entonces.',
        confirm: 'Reanudar la purga',
      },
      photoDown: {
        title: '¿Retirar esta foto?',
        body: 'Desaparece al instante del muro, del flujo de los invitados, del enlace del álbum y de las pantallas del anfitrión, y las pantallas abiertas la olvidan. El archivo se conserva. El anfitrión no puede devolverla.',
        confirm: 'Retirar la foto',
      },
      photoUp: {
        title: '¿Restituir esta foto?',
        body: 'Reaparece con el estado que le había dado el anfitrión.',
        confirm: 'Restituir la foto',
      },
      guestbookDown: {
        title: '¿Retirar este mensaje?',
        body: 'Desaparece al instante de la pantalla, de la cola del anfitrión y de la lista de su autor, y las pantallas abiertas lo olvidan. El texto se conserva. El anfitrión no puede restablecerlo, y su autor no recupera el sitio que ocupaba.',
        confirm: 'Retirar el mensaje',
      },
      guestbookUp: {
        title: '¿Restablecer este mensaje?',
        body: 'Reaparece con el estado que el anfitrión le había dado.',
        confirm: 'Restablecer el mensaje',
      },
    },
  },

  /** The text on the printed sheet, in the language of the evening (spec 02). */
  printKit: {
    title: 'Comparta sus fotos de la velada',
    step1: 'Escanee el código QR con la cámara de su teléfono.',
    step2: 'Envíe sus fotos.',
    step3: 'Se unen a la pantalla de la velada.',
    fallback: (code: string, address: string) =>
      `¿Sin código QR? Escriba el código ${code} en ${address}.`,
    /* Spec 28: the words the designs print around the host's own. */
    table: (name: string) => `Mesa ${name}`,
    ourEvening: 'nuestra fiesta',
    scanMe: '¡Escanéeme!',
    greetings: 'Recuerdos de',
    seeYou: '¡Hasta ahora en la pantalla!',
    toScreen: 'Para: la pantalla de la sala',
    ticketGuest: 'Entrada de invitado',
    freeEntry: 'Entrada libre',
    dateLabel: 'Fecha',
    tableLabel: 'Mesa',
    seatLabel: 'Asiento',
    everywhere: 'Donde sea',
    freeSeat: 'Libre',
    tonight: 'Esta noche',
    scan: 'Escanee',
    stubLine: 'Sus fotos salen en la pantalla de la fiesta.',
    boarding: 'Tarjeta de embarque',
    partyClass: 'Clase fiesta',
    fromCode: 'TEL',
    toCode: 'PNT',
    fromName: 'Su teléfono',
    toName: 'La pantalla de la sala',
    flight: 'Vuelo especial',
    gate: 'Puerta',
    allGates: 'Todas',
    boardingTime: 'Embarque',
    now: 'Ahora',
    shortSteps: '1. Escanee · 2. Envíe · 3. Mire la pantalla',
    shots: 'Carrete sin fin',
    partyIso: 'ISO fiesta',
    issue: 'Número especial',
    headline: 'En portada',
    freeIssue: 'Gratis',
    forAll: 'para todos',
    coverCta: 'Escanee, publique: usted sale en portada',
    receipt1: 'Fotos de la fiesta',
    receipt2: 'Ataques de risa',
    receipt3: 'Selfis fallidos',
    receipt4: 'Pasos de baile',
    price: '0,00',
    total: 'Total',
    unlimited: 'Ilimitado',
    receiptFoot: 'Tique 000142 · ¡Gracias!',
    boom: '¡Escanee!',
    meanwhileTable: (table: string) => `Mientras tanto, en la mesa ${table}…`,
    meanwhile: 'Mientras tanto, en la pantalla…',
  },
  /** The timed photo challenge (spec 10): the console's panel. The prompt inside it is content, never translated. */
  challenge: {
    title: 'Reto fotográfico',
    hint: 'Escriba lo que pide a la sala. El texto solo aparece al lanzar el reto.',
    prompt: 'Texto del reto',
    /** The text box's counter: how much of the sixty characters is used. */
    promptCount: (used: number, max: number) => `${t.number(used)} / ${t.number(max)}`,
    recent: 'Últimos retos',
    ideasTitle: 'Ideas',
    /** Ready-made challenges the host may take as they are or correct; each is at most 60 characters. */
    ideas: [
      'Un selfi con su vecino de mesa',
      'Toda la mesa en la foto',
      'La mejor sonrisa de la noche',
      'Una foto de sus pies en la pista',
      'Un brindis a la cámara',
      'Una mueca, todos juntos',
    ],
    fromMission: 'Una de mis misiones',
    duration: 'Duración',
    minutes: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} minuto`,
        other: `${t.number(count)} minutos`,
      }),
    launch: 'Lanzar como reto',
    stop: 'Detener',
    remaining: (time: string) => `Reto en curso · ${time}`,
    notOpen: 'Un reto se puede lanzar cuando el evento está abierto.',
    ended: 'Reto terminado',
    answers: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto`,
        other: `${t.number(count)} fotos`,
      }),
    /** Said once to a screen reader when a challenge begins; the prompt in it is content. */
    announceStart: (prompt: string) => `Comienza el reto fotográfico: ${prompt}`,
    /** The box above "Envoyer" while a challenge runs (spec 18): checked, the photo answers it. */
    participate: 'Participo en el reto',
    announceEnd: 'Fin del reto fotográfico',
  },
  /** The disposable camera (spec 23): the host's section, band and confirmation. The guest's and the wall's sentences come with their own surfaces. */
  reveal: {
    title: 'Cámara desechable',
    hint: 'Las fotos permanecen ocultas para los invitados y la sala hasta la revelación. Usted las ve en cuanto llegan.',
    enabled: 'Activar la cámara desechable',
    timed: 'Revelar a una hora concreta',
    timedHint:
      'Sin hora, la revelación la hace usted, con el botón «Revelar ahora» de la página del evento.',
    at: 'Hora de la revelación',
    atLocked: 'La velada ya está revelada: la hora ya no se puede cambiar.',
    shots: 'Poses por invitado',
    shotsHint:
      'Una pose es una foto enviada. Sin límite, cada invitado envía las fotos que quiera. Este límite también vale sin revelación.',
    film: 'Aspecto de carrete',
    filmHint:
      'En las pantallas, las fotos adoptan el aspecto de un carrete. Sus originales y las descargas quedan intactos.',
    liveWarning:
      'Ya han llegado fotos: las que están en pantalla desaparecerán hasta la revelación.',
    countdown: (hours: number, minutes: number) =>
      hours > 0
        ? `Revelación en ${t.number(hours)} h ${String(minutes).padStart(2, '0')} min`
        : `Revelación en ${t.number(minutes)} min`,
    soon: 'Revelación en menos de un minuto',
    manual: 'Las fotos permanecen ocultas hasta que usted las revele.',
    scheduledFor: (when: string) => `Revelación prevista el ${when}`,
    waiting: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto publicada espera la revelación`,
        other: `${t.number(count)} fotos publicadas esperan la revelación`,
      }),
    revealNow: 'Revelar ahora',
    editTime: 'Cambiar la hora',
    revealedAt: (time: string) => `Revelado a las ${time}`,
    revealedOn: (when: string) => `Revelado el ${when}`,
    confirmTitle: '¿Revelar ahora?',
    confirmPublished: (count: number) =>
      count === 0
        ? 'Todavía no hay ninguna foto publicada.'
        : t.count(count, {
            one: 'La foto publicada aparecerá en el muro y en los teléfonos.',
            other: `Las ${t.number(count)} fotos publicadas aparecerán en el muro y en los teléfonos.`,
          }),
    confirmPending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto espera todavía una decisión: seguirá oculta.`,
        other: `${t.number(count)} fotos esperan todavía una decisión: seguirán ocultas.`,
      }),
    definitive: 'Esta acción es definitiva.',
    closeTitle: (name: string) => `¿Terminar «${name}»?`,
    closeHeld:
      'Las fotos aún no se han revelado. Al terminar el evento siguen ocultas hasta que las reveles, y la conservación de las fotos cuenta desde el cierre.',
    closedNotRevealed:
      'Las fotos no se han revelado. El evento está cerrado: siguen ocultas mientras no las revele.',
    closesBefore:
      'El cierre programado llega antes de la revelación. Sin revelación, las fotos seguirán ocultas.',
    templateOn: 'Fotos ocultas hasta la revelación',
    templateOff: 'Sin revelación diferida',
    templateFilmOn: 'Aspecto de carrete en pantalla',
    templateFilmOff: 'Sin aspecto de carrete',
    wallAt: (time: string) => `Revelación a las ${time}`,
    wallOn: (when: string) => `Revelación el ${when}`,
    wallSoon: 'Revelación pronto',
    developing: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto en revelado`,
        other: `${t.number(count)} fotos en revelado`,
      }),
    /* The guest's phone (spec 23): the roll, the veiled photographs, the hour and the moment of the reveal. */
    poses: (count: number) =>
      t.count(count, {
        one: `Te queda ${t.number(count)} foto`,
        other: `Te quedan ${t.number(count)} fotos`,
      }),
    freshRoll: (count: number) =>
      t.count(count, {
        one: `Carrete nuevo: ${t.number(count)} foto`,
        other: `Carrete nuevo: ${t.number(count)} fotos`,
      }),
    rollEmpty: 'Carrete terminado: tu cámara está vacía',
    rollKept: (kept: number) =>
      t.count(kept, {
        one: 'Te quedaba 1 foto, así que se conserva la primera.',
        other: `Te quedaban ${t.number(kept)} fotos, así que se conservan las ${t.number(kept)} primeras.`,
      }),
    undeveloped: 'Se revelará en la revelación',
    guestAt: (time: string) => `Revelación a las ${time}`,
    guestOn: (when: string) => `Revelación el ${when}`,
    guestLeft: (hours: number, minutes: number) =>
      hours > 0
        ? `dentro de ${t.number(hours)} h ${String(minutes).padStart(2, '0')}`
        : `dentro de ${t.number(minutes)} min`,
    guestSoon: 'en menos de un minuto',
    guestManual: 'Los anfitriones revelarán las fotos durante la velada.',
    bannerManual: 'Revelación con el botón',
    bannerWaiting: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto espera`,
        other: `${t.number(count)} fotos esperan`,
      }),
    guestIntro: 'Haga sus fotos: se revelarán en el momento de la revelación.',
    guestIntroAt: (time: string) =>
      `Haga sus fotos: se revelarán en el momento de la revelación, a las ${time}.`,
    guestIntroOn: (when: string) =>
      `Haga sus fotos: se revelarán en el momento de la revelación, el ${when}.`,
    noticeHeld: {
      afterReview:
        'El organizador aprueba cada foto, y las fotos aprobadas solo aparecen en la pantalla en la revelación. Él y sus moderadores las ven en cuanto llegan.',
      immediate:
        'Aparecen en la pantalla en la revelación, no antes. El organizador y sus moderadores las ven en cuanto llegan y pueden retirar cualquiera en todo momento.',
    },
    noticeShots: (count: number) =>
      t.count(count, {
        one: `Dispone de ${t.number(count)} toma: una toma es una foto enviada.`,
        other: `Dispone de ${t.number(count)} tomas: una toma es una foto enviada.`,
      }),
    noticeFilm:
      'El aspecto de carrete solo existe en la pantalla: su foto original se conserva tal cual.',
    wallDeveloping: 'Las fotos se revelarán en el momento de la revelación',
    developedNow: (count: number) =>
      t.count(count, {
        one: 'Tu foto acaba de revelarse.',
        other: `Tus ${t.number(count)} fotos acaban de revelarse.`,
      }),
    feedAt: (time: string) => `Las fotos se revelarán a las ${time}`,
    feedOn: (when: string) => `Las fotos se revelarán el ${when}`,
    feedSoon: 'Las fotos se revelarán pronto',
    feedHint: 'Aparecerán aquí en la revelación. Tus propias fotos siguen en tu lista.',
    /* The shared gallery (spec 23): a link that opens before the reveal, and what a download is. */
    galleryHeld: (when: string) => `Las fotos se revelarán el ${when}.`,
    galleryHeldSoon: 'Las fotos se revelarán pronto.',
    galleryOriginal: 'La descarga es el original, sin el aspecto de carrete.',
  },
  /** Messaging channels (spec 27): the settings switch, the "Telegram group" panel and the badge of the moderation console. The group's title is content, never translated. */
  channels: {
    settingsSection: 'Mensajería',
    allowTelegram: 'Recibir las fotos de un grupo de Telegram',
    allowTelegramHint:
      'Las fotos y los vídeos enviados al grupo pasan por Telegram antes de llegar aquí; solo se guardan el nombre de pila y una huella de la cuenta de Telegram. Siguen el mismo modo de validación que las fotos de los invitados.',
    on: 'Activado',
    off: 'Desactivado',
    notAllowed: 'No incluido en su plan',
    noBot: 'Esta instalación no tiene un bot de Telegram: quien la opera debe configurar uno.',
    notLive: 'Un grupo solo se puede vincular mientras el evento está abierto.',
    title: 'Grupo de Telegram',
    hint: 'Las fotos publicadas en un grupo de Telegram llegan aquí, como las de los invitados.',
    step1: (bot: string) => `Añada @${bot} a su grupo de Telegram.`,
    step2: 'En el grupo, envíe:',
    /** The word that connects a group, as the bot's profile lists it in this language (the bot accepts them all). */
    bindCommand: 'evento',
    copyCommand: 'Copiar el comando',
    copied: 'Comando copiado',
    copyFailed: 'No se ha podido copiar el comando: selecciónelo y cópielo a mano.',
    visibility:
      'El bot tiene que ver las fotos: nómbrelo administrador del grupo, o use un bot con el modo de privacidad desactivado (este ajuste solo vale para los grupos a los que el bot se une después: retírelo y añádalo de nuevo).',
    listTitle: 'Grupos vinculados',
    none: 'Todavía no hay ningún grupo vinculado.',
    boundOn: (date: string) => `vinculado el ${date}`,
    photos: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} foto recibida`,
        other: `${t.number(count)} fotos recibidas`,
      }),
    unlink: 'Desvincular',
    ownerOnlyUnlink: 'Solo quien es propietario del evento puede desvincular un grupo.',
    unlinkConfirmTitle: '¿Desvincular este grupo?',
    unlinkConfirmBody: (title: string) =>
      `El bot dejará de recoger las fotos de «${title}». Lo dirá en el grupo y se quedará en él: puede retirarlo usted mismo.`,
    unlinked: 'Grupo desvinculado',
    viaTelegram: 'vía Telegram',
  },
  /** Scheduled announcements (spec 21): the host's panel and the wall drawer's section. The text inside is content, never translated. */
  announcement: {
    title: 'Anuncios',
    hint: 'Una frase para toda la sala, a la hora elegida. Solo aparece en el momento previsto.',
    text: 'Texto del anuncio',
    /** The text box's counter: how much of the eighty characters is used. */
    textCount: (used, max) => `${t.number(used)} / ${t.number(max)}`,
    ideasTitle: 'Ideas',
    /** Ready-made texts for a full-screen card; each is at most 80 characters. */
    ideas: ['Tarta', 'Discursos', 'Primer baile', 'Abre el buffet', 'Última canción'],
    /** The same for a discreet one, which says something that stays true for a while; each at most 80 characters. */
    ideasDiscreet: ['El buffet está abierto', 'El fotomatón le espera', 'Última ronda en el bar'],
    time: 'Hora',
    timeHint: 'Déjelo vacío para usar «Lanzar ahora».',
    /** The line that says which moment the typed time is: the day, the time, and how far away it is. */
    resolvedToday: (time, lead) => `Hoy ${time}, dentro de ${lead}`,
    resolvedTomorrow: (time, lead) => `Mañana ${time}, dentro de ${lead}`,
    resolvedOn: (date, time, lead) => `${date} ${time}, dentro de ${lead}`,
    /** How far away, from whole minutes: "1 h 12", "45 min". */
    lead: (minutes) => {
      if (minutes <= 0) return 'un instante'
      if (minutes < 60) return `${minutes} min`
      const rest = minutes % 60
      const hours = Math.floor(minutes / 60)
      return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`
    },
    far: 'Faltan más de 12 horas: compruebe la hora y el día.',
    kind: 'Tipo de anuncio',
    kindFullscreen: 'Pantalla completa',
    kindFullscreenHelp: 'Una tarjeta en medio de la pantalla, unos segundos.',
    kindDiscreet: 'Discreto',
    kindDiscreetHelp: 'Un texto discreto sobre las fotos, de 5 a 30 minutos.',
    countdown: 'Cuenta atrás',
    countdownNone: 'Ninguna',
    duration: 'Duración en pantalla',
    /** A span of seconds as the chips say it: under a minute in seconds, from a minute in minutes. */
    span: (seconds) => (seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`),
    schedule: 'Programar',
    launchNow: 'Lanzar ahora',
    save: 'Guardar',
    cancel: 'Cancelar',
    edit: 'Modificar',
    relaunch: 'Volver a lanzar',
    remove: 'Eliminar',
    withdraw: 'Quitar de la pantalla',
    editing: 'Modificación de un anuncio',
    textOnly: 'Este anuncio está en pantalla: solo puede cambiar su texto.',
    listLabel: 'Anuncios de la fiesta',
    empty: 'Todavía no hay anuncios.',
    loadFailed: 'No se han podido cargar los anuncios.',
    notLive:
      'La fiesta aún no está abierta: el anuncio solo se mostrará cuando se abra la pantalla.',
    /** The state the row is in, in words: never by colour alone. */
    states: {
      upcoming: 'Próximo',
      counting: 'Cuenta atrás',
      showing: 'En pantalla',
      over: 'Pasado',
    },
  },
  exportPurge: {
    title: 'Eliminación del álbum',
    deletesOn: (date: string, days: number) =>
      `Este álbum se eliminará el ${date} (${t.count(days, { one: 'en 1 día', other: `en ${t.number(days)} días` })}).`,
    deletesToday: (date: string) => `Este álbum se eliminará hoy, ${date}.`,
    passed: 'La fecha de eliminación prevista ya ha pasado.',
    downloadFirst: 'Descárguelo antes: pasada esa fecha ya no existirá en ningún sitio.',
    downloadAlbum: 'Descargar el álbum',
    directNote:
      'El servidor no puede comprobar esta descarga directa: el archivo MANIFEST.sha256 que contiene le permite comprobarla usted mismo.',
    prepare: 'Preparar un archivo verificado',
    downloadArchive: 'Descargar el archivo',
    rebuild: 'Volver a preparar el archivo',
    working: 'Archivo en preparación. Puede salir de esta página: se actualiza sola.',
    digest: 'Huella SHA-256',
    ready: (entries: number, size: string, sealedOn: string, until: string | null) =>
      `Archivo listo: ${t.count(entries, { one: `${t.number(entries)} fichero`, other: `${t.number(entries)} ficheros` })}, ${size}, verificado el ${sealedOn}.${until === null ? '' : ` Disponible hasta el ${until}.`}`,
    sent: (date: string) =>
      `Archivo enviado por completo el ${date}. Compruebe su fichero antes de eliminar nada.`,
    incomplete: (missing: number) =>
      `Archivo listo, pero ${t.count(missing, { one: `faltaba ${t.number(missing)} fichero`, other: `faltaban ${t.number(missing)} ficheros` })} en el disco del servidor: ${t.count(missing, { one: 'no está incluido.', other: 'no están incluidos.' })}`,
    voiceSecret: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} mensaje de voz sigue en secreto: se borraría sin haberse escuchado.`,
        other: `${t.number(count)} mensajes de voz siguen en secreto: se borrarían sin haberse escuchado.`,
      }),
    voicePending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} mensaje de voz espera su decisión: no estará en el álbum.`,
        other: `${t.number(count)} mensajes de voz esperan su decisión: no estarán en el álbum.`,
      }),
    retired: 'El archivo se retiró porque se borró una foto. Vuelva a prepararlo.',
    changed:
      'El álbum ha cambiado desde que se preparó el archivo, por lo que ya no se ofrece. Vuelva a prepararlo.',
    noRoom:
      'El servidor no tiene espacio suficiente para preparar el archivo. Descargue el álbum directamente o avise al operador.',
    tooLarge:
      'El archivo superaría el tamaño que el servidor acepta preparar. Descargue el álbum directamente.',
    failed:
      'No se pudo preparar el archivo. Inténtelo de nuevo; si se repite, contacte con el operador.',
    deleteNow: 'Eliminar ahora',
    deleteWithout: 'Eliminar sin archivo…',
    needsArchive:
      'Para eliminar el álbum ahora, prepare primero el archivo verificado y descárguelo por completo.',
    needsDownload: 'Para eliminar el álbum ahora, descargue primero el archivo por completo.',
    needsComplete:
      'El archivo está incompleto: faltaban ficheros en el disco del servidor. Aun así puede eliminar el álbum, tras confirmarlo.',
    wordPrompt: (word: string) =>
      `Este álbum no se ha archivado por completo. Para eliminarlo de todos modos, escriba ${word}.`,
    confirmWord: 'ELIMINAR',
    wordLabel: 'Palabra de confirmación',
  },
  /* Added by spec 29 (guest invitations): the page a guest opens from an invitation. */
  guestInvite: {
    page: {
      eyebrow: 'Invitación',
      when: 'Cuándo',
      where: 'Dónde',
      itinerary: 'Cómo llegar',
      agenda: 'Añadir a mi calendario',
      join: 'Unirse al muro de fotos',
      live: 'La fiesta ha empezado',
      tonight:
        'La noche de la fiesta, vuelva a esta página para compartir sus fotos en el muro de la fiesta.',
      notOpen: 'El muro de fotos aún no está abierto.',
      over: 'Esta fiesta ha terminado. Gracias por venir.',
      gone: 'Esta invitación ya no está disponible',
      goneSub: 'Puede que el organizador haya cambiado el enlace. Pídale el nuevo.',
      report: 'Denunciar esta invitación',
      madeWith: 'Invitación creada con EventSlide',
      otherTz: (when: string, place: string) => `Es decir, ${when} en ${place}`,
      loading: 'Cargando la invitación',
      failed: 'No se pudo cargar la invitación. Compruebe su conexión.',
      busy: 'Mucha gente está abriendo esta invitación ahora mismo. Inténtelo de nuevo en un momento.',
      retry: 'Reintentar',
      logoAlt: (title: string) => `Logo de ${title}`,
    },
    host: {
      crumb: 'Invitaciones',
      title: 'Invitaciones',
      formTitle: 'El texto',
      titleLabel: 'Título',
      titleHint: (name: string) => `por defecto: ${name}`,
      startLabel: 'Inicio',
      endLabel: 'Fin',
      zoneLine: (zone: string) => `Zona horaria: ${zone}`,
      zoneChange: 'cambiar de zona horaria',
      zoneLabel: 'Zona horaria',
      zoneHint:
        'La del lugar de la fiesta: la hora de la invitación se lee en esta zona, esté donde esté el invitado. Cambiar de zona conserva las horas escritas tal cual.',
      venueLabel: 'Lugar',
      addressLabel: 'Dirección',
      addressHint: '2 líneas',
      addressWarning:
        'Cualquiera que tenga el enlace de la invitación ve esta dirección hasta el final de la fiesta.',
      messageLabel: 'Su mensaje',
      messageCount: (count: number, max: number) => `${count} / ${max}`,
      lineCount: (count: number, max: number) => `${count} / ${max} líneas`,
      languageLabel: 'Idioma de la invitación',
      languageHint: 'solo las etiquetas fijas',
      linkIntro: 'Una vez activada, la invitación tiene un enlace y un código QR.',
      activate: 'Activar la invitación',
      activateNeedsDate: 'Añada la fecha de inicio para poder activar la invitación.',
      linkLabel: 'Dirección del enlace',
      copy: 'Copiar',
      copied: 'Enlace copiado.',
      copyFailed: 'El navegador rechazó la copia. Seleccione el enlace y cópielo a mano.',
      rotate: 'Cambiar el enlace',
      rotateTitle: '¿Cambiar el enlace de la invitación?',
      rotateBody:
        'El enlace anterior y los códigos QR ya impresos dejarán de funcionar. Recuerde volver a imprimir y enviar el nuevo enlace. El código de la fiesta no cambia.',
      rotateConfirm: 'Cambiar el enlace',
      rotated: 'Nuevo enlace. El anterior ya no funciona.',
      disable: 'Desactivar',
      disabled:
        'Invitación desactivada. La página responde «no disponible»; al reactivarla vuelve el mismo enlace.',
      enabled: 'Invitación activada. El enlace y el código QR existen.',
      openNote:
        'En cuanto abra la fiesta, aunque sea para probar, la página de la invitación muestra el botón para unirse al muro.',
      formatsLabel: 'Formatos de la invitación',
      tabPrint: 'Tarjeta impresa',
      tabImage: 'Imagen para compartir',
      tabEmail: 'Correo electrónico',
      locked: 'Añada la fecha y active la invitación para compartirla.',
      nonexistentHour:
        'Esa hora no existe ese día en esa zona (cambio a la hora de verano). Elija otra.',
      loadFailed: 'No se pudieron cargar las invitaciones.',
      ownerOnly: 'Solo el propietario del evento escribe la invitación.',
      printFormatLegend: 'Formato',
      printFormatCard: 'Tarjeta A6 · 4 por A4',
      printFormatA5: 'A5 · 2 por A4',
      shortLabel: 'Mensaje en la tarjeta',
      shortCount: (count: number, max: number) => `${count} / ${max}`,
      shortAuto: 'auto',
      shortHint: 'El mensaje completo está en la página de la invitación.',
      shortReset: 'Volver al texto automático',
      printA5Help: 'Para A5, imprima desde Chrome, Edge o Firefox: Safari no puede girar la hoja.',
      photoHint:
        'La foto se queda en este navegador: EventSlide no la envía a ninguna parte, y otro dispositivo no la verá.',
      photoNotKept:
        'No se pudo guardar la foto en este dispositivo: desaparecerá al salir de la página.',
      printButton: 'Imprimir',
      previewLabel: 'Vista previa de la tarjeta',
      printHelp:
        'En la ventana de impresión, elija una escala del 100 % y sin márgenes. La dirección va impresa en la tarjeta: entréguela solo a los invitados que haya elegido.',
      commonBadge: 'común a todos los formatos',
      lookTitle: 'La apariencia',
      lookBadge: 'tarjeta e imagen',
      statusOn: 'Invitación activa',
      statusOff: 'Invitación desactivada',
      statusBarLabel: 'Enlace de la invitación',
      saving: 'Guardando…',
      savedAuto: 'Guardado',
      saveFailed: 'El último cambio no se guardó.',
      saveRetry: 'Reintentar',
      leaveWarning: 'Los cambios de la invitación aún no están guardados. ¿Salir de la página?',
      lockedTitle: 'Su invitación aún no está lista',
      lockedStepDate: 'Añadir la fecha de inicio',
      lockedStepActivate: 'Activar la invitación',
      lockedDateFocus: 'Escribir la fecha',
      lockedDateSave: 'Guardar esta fecha',
      tabGuest: 'Página del invitado',
      optionsLabel: 'Ajustes del formato',
      guestStateLegend: 'Momento',
      guestStateUpcoming: 'Antes de la fiesta',
      guestStateJoinable: 'Durante',
      guestStateOver: 'Después',
      guestHelp:
        'Lo que ve un invitado que escanea el código QR o abre el enlace. La misma noche, la página lleva al muro de fotos.',
      guestOpen: 'Abrir la página',
      guestCopy: 'Copiar el enlace',
      guestPreviewLabel: 'Vista previa de la página del invitado',
      previewEnlarge: 'Ver la vista previa en grande',
      previewClose: 'Cerrar la vista previa',
      lookLocked:
        'El diseño, el color y la foto se ajustan aquí en cuanto la invitación esté lista.',
    },
    image: {
      sameLook: 'El diseño, el color y la foto se ajustan a la izquierda, en «La apariencia».',
      formatLegend: 'Formato',
      formatSquare: 'Cuadrado',
      formatStory: 'Story',
      addressLegend: 'Dirección en la imagen',
      addressLabel: 'Mostrar la dirección',
      addressHint:
        'Una story la ven todos sus seguidores: sin dirección, solo la verá quien tenga el enlace.',
      textLabel: 'Texto que acompaña la imagen',
      textNote: 'solo esta vez',
      share: 'Compartir',
      download: 'Descargar la imagen',
      copy: 'Copiar el texto',
      rendering: 'Preparando la imagen…',
      copied: 'Texto copiado.',
      copiedBeforeShare:
        'Texto copiado: péguelo bajo la imagen si la aplicación no lo ha recogido.',
      copyFailed: 'No se pudo copiar el texto: selecciónelo en el campo.',
      renderFailed: 'No se pudo crear la imagen en este dispositivo.',
      retry: 'Reintentar',
      revertText: 'Volver al texto automático',
      downloaded: 'Imagen descargada.',
      shareFailed: 'No se pudo compartir: descargue la imagen y envíela desde su teléfono.',
      previewLabel: 'Vista previa de la imagen',
      help: 'En el teléfono, «Compartir» abre WhatsApp, Instagram, Mensajes… con la imagen y el texto. El texto también se copia, por si la aplicación lo olvida.',
      fileName: 'invitacion',
    },
    email: {
      subjectLabel: 'Asunto',
      bodyLabel: 'Mensaje',
      bodyNote: 'solo esta vez',
      counter: (length: number, max: number) =>
        `Enlace mailto: ${length} / ${max} caracteres codificados`,
      counterCut: 'texto cortado, el final remite a la página',
      open: 'Abrir en mi correo',
      copy: 'Copiar el texto',
      copied: 'Texto copiado.',
      copyFailed: 'No se pudo copiar el texto: selecciónelo en el campo.',
      download: 'Descargar la imagen',
      rendering: 'Preparando la imagen…',
      renderFailed: 'No se pudo crear la imagen en este dispositivo.',
      retry: 'Reintentar',
      revertText: 'Volver al texto automático',
      size: (kilobytes: number) => `${kilobytes} KB`,
      bccAdvice:
        'Ponga a sus invitados en copia oculta (CCO) para que no compartan sus direcciones entre sí. EventSlide no envía nada y no guarda ninguna dirección.',
      previewLabel: 'Vista previa del mensaje',
      previewHeader: 'Mensaje nuevo',
      previewTo: 'Para',
      previewToValue: 'usted mismo',
      previewBcc: 'CCO',
      previewBccValue: 'sus invitados',
      attachmentNote: '(si la adjunta)',
      fileName: 'invitacion',
    },
    card: {
      eyebrow: 'Invitación',
      more: 'Todos los detalles en la página de la invitación.',
      link: (link: string) => `Información y muro de fotos: ${link}`,
      entry: 'Entrada: usted',
      hourLabel: 'Hora',
      placeLabel: 'Lugar',
      stubLine: 'Todos los detalles y, esa noche, el muro de fotos.',
      startLabel: 'Inicio',
      endLabel: 'Fin',
      storyTop: 'Está invitado/a',
      infos: 'Info y muro de fotos',
      shareIntro: (title: string) => `${title}: está invitado/a.`,
      mailHello: 'Hola,',
      mailIntro: (title: string) => `${title}, y usted está invitado/a.`,
      whenLabel: 'Cuándo',
      whereLabel: 'Dónde',
      mailDetails: 'Todos los detalles y, esa noche, el muro de fotos de la fiesta:',
      mailSubject: (title: string, day: string) => `Invitación: ${title}, ${day}`,
      mailMore: '(más en la página de la invitación)',
    },
  },

  /**
   * The menu of one event (`eventLayout/`): the three moments, one entry per subject, the phone's
   * tab bar, and the few words of the pages that only exist because the event page was cut up.
   */
  /**
   * The guests' replies on the invitation's page (spec 30): the guest's block. Read in the
   * invitation's language, like the rest of the page. The host's panel and page come with their own
   * namespaces in later pull requests.
   */
  rsvp: {
    guest: {
      title: '¿Vendrás?',
      deadline: (day: string) => `Responde antes del ${day}, por favor.`,
      yes: 'Voy',
      maybe: 'Quizás',
      no: 'No puedo',
      nameLabel: 'Tu nombre y apellido',
      namePlaceholder: 'Para que el anfitrión te reconozca',
      howManyLabel: '¿Cuántos seréis?',
      howManyHint: (max: number) => `contigo incluido, ${max} como máximo`,
      adults: 'Adultos',
      people: 'Personas',
      kids: 'Niños',
      kidsHint: 'menores de 12 años',
      less: 'Menos',
      more: 'Más',
      dietLabel: 'Alergias o dieta',
      dietHint: 'opcional, solo lo ve el anfitrión',
      dietPlaceholder: 'P. ej. sin gluten',
      messageLabel: 'Unas palabras para el anfitrión',
      optional: 'opcional',
      send: 'Enviar mi respuesta',
      save: 'Guardar mis cambios',
      cancel: 'Cancelar',
      notice:
        'Tu respuesta solo la ve el anfitrión. Se borra como máximo dos meses después de la fiesta. Puedes cambiarla o borrarla con tu enlace.',
      showNameLabel: 'Mostrar mi nombre de pila a los demás invitados',
      noticeNames:
        'Tu respuesta la ve el anfitrión. Solo tu nombre de pila (la primera palabra de tu nombre) puede mostrarse a cualquiera que tenga el enlace de la invitación, si marcas la casilla. Se borra como máximo dos meses después de la fiesta. Puedes cambiarla o borrarla con tu enlace.',
      noticeCount:
        'Tu respuesta la ve el anfitrión. El número de personas que vienen se muestra a cualquiera que tenga el enlace de la invitación. Se borra como máximo dos meses después de la fiesta. Puedes cambiarla o borrarla con tu enlace.',
      showNameShown: (first: string) => `Se mostrará: «${first}» (la primera palabra de tu nombre)`,
      recapShowName: 'Tu nombre se muestra a los demás invitados',
      doneYes: (first: string) => `Anotado, ${first}`,
      doneMaybe: 'Anotado: quizás',
      doneNo: (first: string) => `Qué pena, ${first}`,
      maybeSub: 'El anfitrión cuenta con una respuesta firme antes de la fiesta.',
      noSub:
        'El anfitrión ha recibido tu respuesta. Puedes cambiar de opinión mientras las respuestas estén abiertas.',
      recapYes: 'Vienes',
      recapMaybe: 'Quizás',
      person: { one: 'persona', other: 'personas' },
      child: { one: 'niño', other: 'niños' },
      recapKids: (count: number, label: string) => `de ellas ${count} ${label}`,
      proofCountOne: '1 persona ha dicho que sí',
      proofCount: (count: number) => `${count} personas han dicho que sí`,
      proofNameOne: (name: string) => `${name} viene`,
      proofNames: (names: string) => `${names} vienen`,
      proofNamesAndOne: (names: string) => `${names} y 1 más vienen`,
      proofNamesAndMany: (names: string, others: number) => `${names} y ${others} más vienen`,
      recapNo: 'No vienes',
      recapDiet: (diet: string) => `Dieta: ${diet}`,
      recapMessage: (message: string) => `Tus palabras: ${message}`,
      edit: 'Cambiar mi respuesta',
      delete: 'Borrar mi respuesta',
      deleteAsk: '¿Borrar mi respuesta?',
      deleteSub:
        'El anfitrión dejará de verla. Podrás responder de nuevo mientras las respuestas estén abiertas.',
      deleteYes: 'Sí, borrar',
      deleted: 'Tu respuesta se ha borrado.',
      linkTitle: 'Tu enlace para cambiarla desde otro dispositivo',
      linkHint: 'Guárdalo para cambiarla desde otro dispositivo. Este se acuerda solo.',
      copy: 'Copiar',
      copied: 'Enlace copiado',
      closedTitle: 'Las respuestas están cerradas',
      closedSub: '¿Un cambio? Avisa al anfitrión directamente.',
      earlier: (summary: string) => `Habías respondido: ${summary}`,
      failed: 'No se ha podido enviar tu respuesta. Comprueba tu conexión e inténtalo de nuevo.',
      busy: 'Mucha gente está respondiendo ahora. Inténtalo de nuevo en un momento.',
      forgotten: 'Este dispositivo ya no encuentra tu respuesta: se borró o el enlace cambió.',
      companionsLabel: 'Nombres de quienes vienen contigo',
      companionLabel: (n: number) => `Acompañante ${n}`,
      companionPlaceholder: 'Nombre',
      mealsLabel: 'Menús',
      mealFor: (who: string) => `Menú de ${who}`,
      personFallback: (n: number) => `Persona ${n}`,
      answerPick: 'Elegir',
      recapCompanions: (names: string) => `Contigo: ${names}`,
      recapMeals: (meals: string) => `Menús: ${meals}`,
      recapAnswer: (label: string, value: string) => `${label}: ${value}`,
      trap: 'Deja este campo vacío',
      tooLarge: 'Tu respuesta es demasiado larga para enviarla. Acorta tus textos.',
    },
    host: {
      title: 'Respuestas de los invitados',
      stateOff: 'No se piden',
      stateOpen: 'Se piden',
      stateClosed: 'Cerradas',
      needsInvite:
        'Guarda primero la invitación (título y fecha): las respuestas se piden en su página.',
      askLabel: 'Pedir una respuesta',
      askHint: 'El bloque «¿Vendrás?» aparece en la página de la invitación.',
      deadlineLabel: 'Fecha límite',
      deadlineHint:
        'Se muestra a los invitados. Las respuestas siguen abiertas hasta el final de ese día y luego se cierran: cambia la fecha para reabrirlas.',
      deadlineClear: 'Quitar la fecha límite',
      closeAction: 'Cerrar las respuestas',
      reopenAction: 'Reabrir las respuestas',
      closedNote: 'Cerradas: la página de la invitación dice «Las respuestas están cerradas».',
      closesOn: (date: string) =>
        `Sin fecha límite, las respuestas se cierran al empezar la fiesta, el ${date}.`,
      erasedOn: (date: string) => `Las respuestas se borrarán el ${date}.`,
      asksTitle: 'Lo que pides',
      presetLabel: 'Tipo de fiesta',
      presetParty: 'Fiesta',
      presetWedding: 'Boda',
      presetCustom: 'A medida',
      presetHint:
        'Una boda no ofrece «Quizás», acepta 6 personas por respuesta y pide el nombre de los acompañantes; una fiesta, lo contrario.',
      maybeLabel: 'Ofrecer «Quizás»',
      maybeHint: 'Práctico para un cumpleaños, a menudo se quita para una boda.',
      sizeLabel: 'Número de personas',
      sizeHint: 'El invitado dice cuántos vienen, él incluido.',
      sizeMax: 'Como máximo',
      sizeUnit: 'por respuesta',
      kidsLabel: 'Contar los niños aparte',
      kidsHint: 'Útil para el catering y los menús infantiles.',
      dietLabel: 'Alergias y dietas',
      dietHint: 'Texto libre opcional. Dato de salud: solo lo ves tú, se borra con las respuestas.',
      saving: 'Guardando…',
      saved: 'Guardado',
      retry: 'Reintentar',
      loadFailed: 'No se han podido cargar los ajustes de las respuestas.',
      fewTitle: 'Por qué se exige tan poco',
      few: 'El nombre y la respuesta bastan. Cada campo de más pierde respuestas: las preguntas vienen después del «sí», en la misma pantalla.',
      noContactTitle: 'Sin dirección, sin número',
      noContact:
        'EventSlide no envía correos ni SMS. El invitado guarda su enlace privado; tú lo recuerdas desde tus propias aplicaciones.',
      erasedTitle: 'Borradas tras la fiesta',
      erased:
        'Las respuestas desaparecen 30 días después de cerrar la velada, o 60 días después de su inicio. Expórtalas antes.',
      previewName: 'Camille',
      archived: 'El evento está archivado: los ajustes ya no pueden cambiar.',
      openUntil: (day: string) => `Respuestas abiertas hasta el ${day}, incluido.`,
      closedByDate: 'Cerradas por la fecha límite: cámbiala para reabrir las respuestas.',
      reopenNeedsDate: 'La fecha límite ha pasado: cámbiala para poder reabrir.',
      stateFull: 'Completo',
      companionsLabel: 'Nombres de los acompañantes',
      companionsHint: 'El invitado anota el nombre de cada persona que viene con él.',
      companionsNeedSize:
        'Los nombres se piden por cada persona además del invitado: activa también el número de personas.',
      visibilityLabel: 'Quién viene',
      visibilityHint:
        'Lo que la página de la invitación dice de las respuestas, a cualquiera que tenga el enlace. Nunca los «no», los «quizás», las notas ni las dietas. En una fiesta pequeña, el número puede revelar la respuesta de una sola persona. Salir de «nombres» retira las casillas marcadas: los invitados tendrán que marcar de nuevo.',
      visibilityOff: 'Nada',
      visibilityCount: 'El número de personas que vienen',
      visibilityNames: 'El número y los nombres de quienes aceptan',
      mealsLabel: 'Menús a elegir',
      mealsHint: 'Un menú por persona, solo para quienes vienen.',
      mealsOptionsLabel: 'Los menús',
      mealsOptionsHint: 'Uno por línea, de 2 a 6.',
      questionsTitle: 'Tus preguntas',
      questionsHint:
        'Tres como máximo, para quienes responden «sí» o «quizás». Quitar una pregunta no borra las respuestas ya dadas.',
      questionAdd: 'Añadir una pregunta',
      questionLabelLabel: 'La pregunta',
      questionKindLabel: 'Tipo de respuesta',
      questionKindText: 'Texto libre',
      questionKindChoice: 'Opciones',
      questionOptionsLabel: 'Las opciones',
      questionOptionsHint: 'Una por línea, de 2 a 6.',
      questionRemove: (label: string) => `Quitar la pregunta «${label}»`,
      questionConfirm: 'Añadir la pregunta',
      questionsFull: 'Tres preguntas como máximo.',
      presetConfirmTitle: '¿Sustituir tus ajustes?',
      presetConfirm: (kind: string) =>
        `Tus opciones de «Quizás», número de personas, niños y nombres de acompañantes serán sustituidas por las de ${kind}.`,
      presetConfirmYes: 'Sustituir',
      presetKindParty: 'una fiesta',
      presetKindWedding: 'una boda',
    },
    /** The host's replies page (spec 30, lot 1). */
    list: {
      crumb: 'Respuestas',
      title: 'Respuestas',
      loadFailed: 'No se pudieron cargar las respuestas.',
      retry: 'Reintentar',
      settings: 'Ajustes',
      reply: { one: 'respuesta', other: 'respuestas' },
      person: { one: 'persona', other: 'personas' },
      adult: { one: 'adulto', other: 'adultos' },
      child: { one: 'niño', other: 'niños' },
      expected: { one: 'persona esperada', other: 'personas esperadas' },
      line: { one: 'fila', other: 'filas' },
      menuNew: { one: 'respuesta nueva', other: 'respuestas nuevas' },
      deadlineSub: (d: string) => `fecha límite el ${d}`,
      closedSub: 'respuestas cerradas',
      tilesLabel: 'Las cifras',
      tileYes: 'Vienen',
      tileMaybe: 'Quizás',
      tileNo: 'No vienen',
      tileMaybeDetail: (replies: string, people: string) => `${replies} · ${people}`,
      adultsKids: (a: string, k: string) => `${a}, ${k}`,
      barSummary: (parts: string) => `Reparto de las respuestas: ${parts}`,
      legendItem: (label: string, count: number, unit: string) => `${label}: ${count} ${unit}`,
      barUpTo: (n: number) => `, hasta ${n} con los «quizás»`,
      tabsLabel: 'Filtrar las respuestas',
      tabAll: 'Todas',
      tabYes: 'Vienen',
      tabMaybe: 'Quizás',
      tabNo: 'No vienen',
      searchLabel: 'Buscar un nombre',
      add: 'Añadir una respuesta',
      export: 'Exportar (hoja de cálculo)',
      colName: 'Nombre',
      colAnswer: 'Respuesta',
      colPeople: 'Pers.',
      colDiet: 'Dieta',
      colCompanions: 'Con',
      colMeals: 'Menús',
      colMessage: 'Nota',
      colReceived: 'Recibida',
      answerYes: 'Viene',
      answerMaybe: 'Quizás',
      answerNo: 'No viene',
      answerWaitlist: 'Lista de espera',
      none: '—',
      peopleKids: (a: number, k: number) => `${a} + ${k} niños`,
      showMore: (n: number) => `Mostrar las ${n} restantes`,
      rowsOf: (s: number, t: number) => `${s} de ${t}.`,
      rowsAll: (n: number, w: string) =>
        `${n} ${w}. ¿Una respuesta recibida por teléfono o en persona? «Añadir una respuesta» sobre la tabla.`,
      noneHere: 'Ninguna respuesta aquí.',
      emptyTitle: 'Aún no hay respuestas',
      emptyBody:
        'Las respuestas aparecen aquí en cuanto tus invitados contestan, sin recargar la página.',
      emptyOff: 'Todavía no pides respuestas. Actívalas en los ajustes de la invitación.',
      detailPeople: 'Personas',
      detailDiet: 'Dieta',
      detailCompanions: 'Acompañantes',
      detailMeals: 'Menús',
      detailShowName: 'Nombre mostrado a los invitados',
      detailYes: 'Sí',
      detailMessage: 'Nota',
      detailReceived: 'Recibida',
      sourceOpen: 'enlace común',
      sourceHost: 'introducida por ti',
      sourceHousehold: 'enlace del hogar',
      receivedVia: (d: string, s: string) => `${d} · ${s}`,
      edit: 'Editar',
      remove: 'Eliminar',
      deleteNote:
        'Eliminar sirve para duplicados y respuestas de broma: el enlace común no identifica a nadie. El enlace privado del invitado deja entonces de funcionar.',
      closeDetail: 'Cerrar',
      formAddTitle: 'Añadir una respuesta',
      formEditTitle: 'Editar la respuesta',
      formHint:
        'El mismo formulario del invitado, rellenado por ti: para una respuesta recibida por teléfono o en persona. Los límites de plazas no te frenan.',
      formName: 'Nombre',
      formAnswer: 'Respuesta',
      formAdults: 'Adultos',
      formKids: 'Niños',
      formDiet: 'Dieta o alergia',
      formCompanion: (n: number) => `Acompañante ${n}`,
      formMeal: (who: string) => `Menú de ${who}`,
      formQuestionNone: '—',
      formMessage: 'Nota',
      formSave: 'Guardar',
      formSaving: 'Guardando…',
      deleteTitle: (n: string) => `¿Eliminar la respuesta de ${n}?`,
      deleteBody: 'Desaparece de la lista y de las cifras. Esta acción es definitiva.',
      deleteYes: 'Eliminar',
      latestTitle: 'Últimas respuestas',
      latestYes: (n: string) => `${n} viene`,
      latestYesMany: (n: string, p: number) => `${n} viene con ${p} personas`,
      latestMaybe: (n: string) => `${n} quizás venga`,
      latestNo: (n: string) => `${n} no viene`,
      notifyTitle: 'Recibir avisos',
      notifyApp: 'Indicador en la app',
      notifyAppHint:
        'El número de respuestas nuevas, en la entrada «Respuestas» del menú del evento.',
      notifyLive: 'Tabla en directo',
      notifyLiveHint: 'Mientras está abierta, se actualiza sola con cada respuesta.',
      notifyNoEmail: 'Sin correo: la instancia alojada no envía correos.',
      catererTitle: 'Catering',
      catererHint: 'Lo que hay que decirle: quienes vienen, sin los «quizás».',
      catererAdults: 'Adultos',
      catererKids: 'Niños',
      catererMaybe: 'Quizás (no contados)',
      catererMeals: 'Menús',
      catererNoMeals: 'Aún no se ha elegido ningún menú.',
      catererDiets: 'Dietas y alergias',
      catererPrivate: 'Datos de salud: solo los ves tú, nunca en la página de los invitados.',
      catererExport: 'Exportar para el catering',
      catererPrint: 'Imprimir la lista',
      printTitle: (event: string) => `Invitados que vienen · ${event}`,
      printConfidential: 'Documento confidencial: contiene dietas.',
      printTotals: (adults: number, kids: number) => `Adultos: ${adults} · Niños: ${kids}`,
    },
  },

  eventMenu: {
    label: 'Menú de la fiesta',
    tabBar: 'Navegación de la fiesta',
    home: 'Inicio',
    /** Beside the moment the event is in. */
    current: 'ahora',
    moments: {
      before: 'Preparar',
      during: 'Durante la fiesta',
      after: 'Después de la fiesta',
    },
    /** The phone's tab bar, where four words share one line. */
    momentsShort: {
      before: 'Preparar',
      during: 'Fiesta',
      after: 'Después',
    },
    momentIntros: {
      before: 'Lo que se prepara antes de que lleguen los invitados.',
      during: 'Lo que pasa durante la fiesta.',
      after: 'Lo que guardas de la fiesta.',
    },
    sections: {
      access: 'Código QR y enlace',
      print: 'Tarjetas y cartel',
      invitations: 'Invitaciones',
      rsvps: 'Respuestas',
      missions: 'Misiones',
      moderators: 'Moderadores',
      moderation: 'Moderación',
      wall: 'Pantalla de la sala',
      announcements: 'Anuncios',
      challenge: 'Reto fotográfico',
      guestbook: 'Libro de visitas',
      reveal: 'Revelado',
      telegram: 'Telegram',
      guests: 'Invitados',
      album: 'Álbum',
      bestOf: 'Lo mejor',
      book: 'Libro de fotos',
      share: 'Álbum compartido',
      stats: 'Estadísticas',
      settings: 'Ajustes',
    },
    /** One line under each entry, on the lists of the moments' pages. */
    hints: {
      access: 'El código, el enlace y el QR para entrar',
      print: 'El código QR para las mesas',
      invitations: 'La invitación y su enlace',
      rsvps: 'Quién viene, y cuántos',
      missions: 'Ideas de fotos para hacer',
      moderators: 'Moderar entre varios',
      moderation: 'Lo que sale en pantalla',
      wall: 'Para abrir en el proyector',
      announcements: 'Un mensaje para toda la sala',
      challenge: 'Un reto fotográfico con tiempo',
      guestbook: 'Las palabras de tus invitados',
      reveal: 'Cuándo aparecen las fotos',
      telegram: 'El grupo vinculado a la fiesta',
      guests: 'Quién se ha unido a la fiesta',
      album: 'Todas las fotos, en un archivo',
      bestOf: 'Tus fotos favoritas',
      book: 'Un libro de fotos para imprimir',
      share: 'Un enlace para quien no estuvo',
      stats: 'Quién publicó qué, y cuándo',
      settings: 'Ambiente, horarios, pantalla',
    },
    newTab: 'abre una pestaña nueva',
    notHere: 'Esta página no existe para esta fiesta.',
    backHome: 'Volver al inicio de la fiesta',
    albumTitle: 'El álbum',
    albumIntro: 'Todas las fotos y vídeos publicados, en un archivo ZIP.',
    dangerTitle: 'Eliminar la fiesta',
  },
  /* The photo book's own page (spec 26): the live preview beside the settings. */
  bookPage: {
    back: 'Volver al evento',
    coverLegend: 'Portada',
    previewLabel: 'Vista previa del libro',
    previewNote: 'Vista previa: el diseño final se hace al crear el libro.',
    summary: (pages: number, photos: number, style: string) =>
      `${t.number(pages)} páginas · ${t.number(photos)} fotos · estilo ${style}`,
    refreshing: 'Actualizando la vista previa…',
    failed: 'No se pudo cargar la vista previa.',
    retry: 'Reintentar',
    empty:
      'Todavía no hay ninguna foto publicada. El libro se hace con las fotos publicadas: publique algunas desde la moderación.',
    unsupported: 'El libro de fotos no está disponible en este servidor.',
    prev: 'Páginas anteriores',
    next: 'Páginas siguientes',
    cover: 'Portada',
    inside: 'Interior de la portada',
    backCover: 'Contraportada',
    pageNumber: (n: number) => `Página ${n}`,
    pageNumbers: (a: number, b: number) => `Páginas ${a} y ${b}`,
    spreadPosition: (k: number, n: number) => `Doble página ${k} de ${n}`,
    stripLabel: 'Dobles páginas',
    stripItem: (label: string) => `Ir a: ${label}`,
    big: 'Ver en grande',
    queued: 'Esperando su turno…',
    running: 'Maquetando el libro en el servidor…',
    workingNote:
      'El servidor no indica el avance. Puede salir de la página: el libro estará listo aquí.',
  },

  titles: {
    print: 'Tarjetas de mesa y cartel',
    eventBook: 'Libro de fotos',
    join: 'Únase a la fiesta',
    upload: 'Envío de fotos',
    feed: 'Fotos de la velada',
    wall: 'Pantalla del evento',
    gallery: 'Álbum compartido',
    guestInvite: 'Invitación',
    guestInviteHost: 'Invitaciones',
    rsvps: 'Respuestas',
    about: 'Acerca de',
    notFound: 'Página no encontrada',
    login: 'Inicio de sesión',
    forgotPassword: 'Contraseña olvidada',
    resetPassword: 'Nueva contraseña',
    invitation: 'Invitación',
    changePassword: 'Cambiar la contraseña',
    security: 'Seguridad de la cuenta',
    deleteAccount: 'Eliminar mi cuenta',
    dashboard: 'Sus eventos',
    newEvent: 'Nuevo evento',
    event: 'Evento',
    eventAccess: 'Código QR y enlace',
    eventMissions: 'Misiones',
    eventModerators: 'Moderadores',
    eventAnnouncements: 'Anuncios',
    eventChallenge: 'Reto fotográfico',
    eventGuestbook: 'Libro de visitas',
    eventReveal: 'Revelado',
    eventTelegram: 'Telegram',
    eventGuests: 'Invitados',
    eventAlbum: 'Álbum',
    eventBestOf: 'Lo mejor',
    eventShare: 'Álbum compartido',
    eventBefore: 'Preparar la fiesta',
    eventDuring: 'Durante la fiesta',
    eventAfter: 'Después de la fiesta',
    moderation: 'Moderación',
    stats: 'Estadísticas de la fiesta',
    settings: 'Ajustes del evento',
    customAmbiance: 'Ambiente a medida',
    clientSpace: 'Espacio de cliente',
    site: 'Consola del operador',
    siteClient: 'Cliente',
    siteAccounts: 'Cuentas de la instancia',
    siteAudit: 'Registro de la instancia',
    siteTakedown: 'Retirada de contenido',
  },
}
