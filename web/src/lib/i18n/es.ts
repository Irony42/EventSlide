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
    title: 'Únase a la galería',
    codeLabel: 'Código de la fiesta',
    codeHint: 'Seis caracteres, indicados en la tarjeta o en el código QR.',
    nameLabel: 'Su nombre',
    nameHint: 'Aparecerá debajo de sus fotos. Puede dejarlo en blanco.',
    submit: 'Unirse',
    submitting: 'Conectando…',
    welcome: (eventName: string) => `Le damos la bienvenida a ${eventName}`,
    anonymous: 'Mantener el anonimato',
    /* Navigation pass, batch A: leaving a wrong event, a code that opens nothing, the way to the organiser area. */
    notYourEvening: '¿No es su fiesta?',
    notOpenHint:
      'Si ha escaneado un código QR, puede que la galería aún no esté abierta o que la fiesta haya terminado. Inténtelo de nuevo en un momento o pregunte a la organización.',
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
    itemPending: 'En espera',
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
      'Sus fotos, vídeos, leyendas, reacciones y su nombre se borrarán de la fiesta: de la pantalla, de la galería y de la lista del organizador. Es definitivo.',
    eraseLimits:
      'Una copia que el organizador ya haya guardado, o que alguien haya capturado de la pantalla, no se puede recuperar.',
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
    deleteOwnNumbered: (position: number) => `Eliminar la foto ${t.number(position)}`,
    notJoinedTitle: 'Únase a la galería para enviar sus fotos',
    notJoinedHint: 'Vuelva a escanear el código QR o introduzca el código de la fiesta.',
    notJoinedAction: 'Introducir el código',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    galleryUnavailable: 'Esta galería ya no está disponible. Ya no puede enviar fotos.',
    galleryUnavailableAction: 'Introducir de nuevo el código',

    missionsTitle: 'Misiones',
    missionsHint: 'Toque una misión y luego envíe su foto.',
    missionDone: 'Hecho',
    missionDoneByRoom: 'Ya fotografiada',
    missionFor: (prompt: string) => `Estas fotos contarán para «${prompt}».`,

    itemQueued: 'Esperando conexión',
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

    installTitle: 'Tenga la galería siempre a mano',
    installHint:
      'Añádala a su pantalla de inicio para volver a la galería más tarde, sin buscar el código QR.',
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
    noticeRetentionDays: (days: number) =>
      t.count(days, {
        one: `Se borran automáticamente ${t.number(days)} día después del cierre de la galería.`,
        other: `Se borran automáticamente ${t.number(days)} días después del cierre de la galería.`,
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
    'clientCeilings.maxLiveDaysInvalid': 'Esta duración de directo no se acepta: de 1 a 365 días.',
    'clientCeilings.periodStartedAtInvalid': 'Este inicio de periodo no se acepta.',
    'clientCeilings.clipsAllowedInvalid': 'Este ajuste de vídeos no se acepta.',
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

    'event.notFound': 'Este código no corresponde a ninguna galería abierta.',
    'event.notAcceptingUploads': 'Esta galería ya no acepta fotos.',
    'event.quotaExceeded': 'La galería ha alcanzado su capacidad. Avise al organizador.',
    'event.slugUnavailable': 'Esta dirección ya está en uso.',
    'event.customSlugNotAllowed': 'Esta instancia no permite elegir su propia dirección.',
    'event.creationRateLimited':
      'Ha creado demasiados eventos recientemente. Inténtelo de nuevo más tarde.',
    'event.quotaAboveCeiling': 'Esta cuota supera el límite que permite este servidor.',
    'event.creationNotAllowed': 'Su cuenta no puede crear eventos en este servidor.',
    'client.notFound': 'No se encuentra esta cuenta de cliente.',
    'client.ownerRequired': 'Solo un propietario de la cuenta puede consultar esto.',
    'client.ceilingReached': 'Su cuenta ha alcanzado el número de eventos permitido.',
    'client.storageFull': 'La galería ha alcanzado su capacidad. Avise al organizador.',
    'client.liveNotAllowed': 'Su cuenta no puede abrir un evento por ahora.',
    'client.liveWindowOver':
      'El periodo de apertura de este evento ha terminado: ya no se puede reabrir.',
    'client.retentionAboveCeiling': 'Este periodo de conservación supera el que permite su cuenta.',
    'client.clipsNotAllowed': 'Los vídeos no están disponibles en esta galería.',
    'event.immutable': 'Este evento está archivado y ya no se puede modificar.',
    'event.illegalTransition': 'Este cambio de estado no es posible.',

    'guest.revoked': 'El organizador ha retirado su acceso.',
    'guestToken.expired': 'Su acceso ha caducado. Vuelva a escanear el código QR.',
    'guestToken.malformed': 'Su acceso ya no es válido. Vuelva a escanear el código QR.',
    'guestToken.badSignature': 'Su acceso ya no es válido. Vuelva a escanear el código QR.',

    'photo.notFound': 'Esta foto ya no existe.',
    'photo.illegalTransition': 'Esta acción no es posible en esta foto.',

    'image.unsupportedFormat':
      'Este archivo no es una foto. Formatos aceptados: JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'Esta foto parece dañada. Pruebe con otra.',
    'image.animated': 'No se aceptan imágenes animadas.',
    'image.renderFailed': 'Esta foto no se ha podido procesar. Pruebe con otra.',
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
    'eventSettings.graceSecondsInvalid': 'Este plazo de eliminación no se admite.',
    'eventSettings.retentionDaysInvalid': 'Este plazo de conservación no se admite.',
    'eventSettings.maxPhotosPerGuestInvalid': 'Este número de fotos por invitado no se admite.',
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

    'event.captionsNotAllowed': 'Los pies de foto no están activados en esta galería.',
    'event.reactionsDisabled': 'Las reacciones no están activadas en esta galería.',
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

    'event.scheduleOutOfOrder': 'El cierre debe ser posterior a la apertura.',
    'event.scheduleInPast':
      'Esta hora ya ha pasado. Compruebe la fecha: para el final de la fiesta, elija el día siguiente.',
    'event.scheduleInvalid': 'Estas fechas no se pueden leer. Elíjalas de nuevo.',

    'event.clipsNotAllowed': 'Los vídeos no están activados en esta galería.',
    'clip.queueFull': 'Se están procesando muchos vídeos. Inténtelo de nuevo dentro de un minuto.',
    'clip.transcoderUnavailable': 'Este servidor no puede procesar vídeos. Avise al organizador.',
    'clip.unsupportedFormat': 'Este archivo no es un vídeo. Formatos aceptados: MP4, MOV, WebM.',
    'clip.corrupt': 'Este vídeo parece dañado. Pruebe con otro.',
    'clip.noVideoStream': 'Este archivo no contiene imagen. Pruebe con otro.',
    'clip.durationUnknown': 'No se puede leer la duración de este vídeo. Pruebe con otro.',
    'clip.tooShort': 'Este vídeo es demasiado corto.',
    'clip.tooLong': 'Este vídeo es demasiado largo. Grabe una secuencia más corta.',
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
    unavailable: 'Esta galería ya no se muestra.',
    unavailableHint: 'Está archivada o ya no está abierta, así que aquí no hay fotos que ver.',
  },

  wall: {
    empty: 'Las primeras fotos llegarán enseguida',
    emptyHint: 'Escanee el código QR para enviar las suyas.',
    joinPrompt: 'Únase a la galería',
    offline: 'Conexión perdida — se está reintentando',
    paused: 'Presentación en pausa',

    codeLabel: 'Código de la fiesta',
    // Read by nothing in the room: the wall is also opened on a laptop while a host
    // sets the projector up.
    qrTitle: 'Código QR para unirse a la galería',
    photoBy: (name: string) => `Foto enviada por ${name}`,
    photoByAnonymous: 'Foto enviada por un invitado',
    errorTitle: 'No se han podido cargar las fotos',
    errorHint: 'Se está reintentando. Revise la red del local si la pantalla sigue vacía.',
    notServedTitle: 'Esta galería no se muestra',
    notServedHint: 'No está abierta o se ha archivado. Si se abre, la pantalla se reanudará sola.',
    dismissJoinCard: 'Ocultar el aviso del código',
    shortcuts: 'Atajos de teclado',
    shortcutsHint:
      'Espacio pausa, las flechas cambian de foto, F pasa a pantalla completa, L cambia la disposición.',
    /* Navigation pass, batch A: how to leave the wall. */
    leaveHint: 'Para salir: Esc o F salen de la pantalla completa; después cierre la pestaña.',

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

    videoBy: (name: string) => `Vídeo enviado por ${name}`,
    videoByAnonymous: 'Vídeo enviado por un invitado',

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
    joinCode: 'Código de acceso',
    rotateJoinCode: 'Cambiar el código',
    rotateJoinCodeHint:
      'Los invitados ya conectados siguen conectados. El código nuevo sustituye al anterior de inmediato.',
    qrCode: 'Código QR',
    qrCodeHint: 'Para imprimir y poner en las mesas.',
    openWall: 'Abrir la pantalla',
    openModeration: 'Moderar',
    download: 'Descargar el álbum',
    statusDraft: 'Borrador',
    statusLive: 'En curso',
    statusClosed: 'Finalizado',
    statusArchived: 'Archivado',
    goLive: 'Abrir a los invitados',
    closeEvent: 'Cerrar el evento',
    reopenEvent: 'Reabrir',
    archiveEvent: 'Archivar',
    photos: (count: number) =>
      t.count(count, { one: `${t.number(count)} foto`, other: `${t.number(count)} fotos` }),
    guests: (count: number) =>
      t.count(count, { one: `${t.number(count)} invitado`, other: `${t.number(count)} invitados` }),
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
      'Las fotos y los vídeos aparecerán en la pantalla sin aprobación. Resérvelo para eventos entre personas de confianza.',
    allowCaptions: 'Permitir los pies de foto',
    allowReactions: 'Permitir las reacciones',
    allowClips: 'Permitir los vídeos',
    allowClipsHint:
      'Los invitados pueden enviar vídeos cortos, además de fotos. Cuando la casilla está desmarcada, los vídeos se rechazan: porque usted la ha desmarcado, porque la plantilla elegida al crear el evento lo dejó así, o porque la galería es anterior a esta función. Márquela para permitirlos.',
    allowGuestSelfDelete: 'Permitir que los invitados eliminen sus fotos',

    /**
     * Named for the screen it changes, and for nothing else. The hint says what the
     * setting deliberately does not do: it never translates what a host or a guest
     * wrote, and it has no effect on the language a guest picks on their own phone.
     */
    wallLanguage: 'Idioma de la pantalla de la sala',
    wallLanguageHint:
      'Las palabras de la pantalla de la sala: «Únase a la galería», «Misiones», los mensajes de espera. Lo que usted y sus invitados escriben — el nombre del evento, los pies de foto, los textos de las misiones — se muestra tal cual y nunca se traduce. Sus invitados eligen su propio idioma en su teléfono; este ajuste no les afecta.',

    theme: 'Apariencia',
    themeHint:
      'Visible para sus invitados y en la pantalla de la sala. Los colores propuestos siguen siendo legibles a diez metros.',
    themeAccent: 'Color',
    themeAccentNames: {
      violet: 'Kraft (predeterminado)',
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
      'El mundo que visten los móviles de sus invitados, la pantalla de la sala y las páginas de este evento en su consola.',
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
    templateNames: {
      wedding: 'Boda',
      birthday: 'Cumpleaños',
      conference: 'Conferencia',
      party: 'Fiesta',
    },

    retention: 'Eliminación automática',
    retentionNever: 'Nunca',
    /** «Desde el cierre», because the retention clock starts when the host closes. */
    retentionDays: (days: number) =>
      t.count(days, {
        one: `${t.number(days)} día después del cierre`,
        other: `${t.number(days)} días después del cierre`,
      }),
    retentionUnlimited: 'Conservación ilimitada',
    moderators: 'Moderadores',

    loading: 'Cargando sus eventos…',
    eventLoading: 'Cargando el evento…',
    eventsEmpty: 'Todavía no hay ningún evento.',
    eventsEmptyHint: 'Tres pasos para estar listo el día del evento.',
    emptyStepCreate: 'Cree el evento.',
    emptyStepTest: 'Pruebe la pantalla en la red del lugar, desde un teléfono que no sea el suyo.',
    emptyStepPrint: 'Imprima el código QR y colóquelo en las mesas.',
    create: 'Crear el evento',
    slugHint: 'Opcional. Déjelo en blanco para deducirla del nombre.',
    slugPreviewLabel: 'Dirección de la galería',
    slugPreviewEmpty: 'Escriba un nombre para ver la dirección.',
    eventCreated: (name: string) => `${name} está listo. Imprima el código QR cuando quiera.`,
    joinCodeHint: 'Para dárselo a los invitados que no puedan escanear el código QR.',
    eventControls: 'Control del evento',
    joinLink: 'Enlace de invitación',
    printQr: 'Imprimir el código QR',
    qrScanPrompt: 'Escanee para enviar sus fotos.',
    qrAlt: (eventName: string) => `Código QR de acceso a ${eventName}`,
    storageLabel: 'Espacio de fotos utilizado',
    storage: (used: string) => `${used} utilizados`,
    statusSaved: 'El nuevo estado se ha guardado.',
    rotateJoinCodeTitle: '¿Cambiar el código de acceso?',
    codeRotated: 'El código de acceso ha cambiado. El anterior ya no funciona.',
    settingsSaved: 'Ajustes guardados.',
    settingsReadOnly: 'Este evento está archivado: sus ajustes ya no se pueden modificar.',
    settingsOwnerOnly: 'Solo el propietario del evento puede modificar sus ajustes.',
    retentionHint: 'Las fotos se eliminan pasado ese plazo desde el cierre del evento.',
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
    guestsEmpty: 'Todavía nadie se ha unido a la galería.',
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

    schedule: 'Apertura y cierre automáticos',
    scheduleHint:
      'Déjelo en blanco para abrir y cerrar usted mismo. Las horas son las de su ordenador, es decir, las del lugar de la fiesta.',
    scheduleOpenAt: 'Abrir a los invitados el',
    scheduleCloseAt: 'Cerrar el evento el',
    scheduleCloseAtHint: 'Las fotos y el álbum se conservan: cerrar no borra nada.',
    scheduleSaved: 'El horario se ha guardado.',
    scheduleNone: 'Sin horario: usted abre y cierra el evento.',
    scheduleArmed: (opensAt: string, closesAt: string) =>
      `Apertura el ${opensAt}, cierre el ${closesAt}.`,
    scheduleOpensOnly: (opensAt: string) => `Apertura el ${opensAt}. Usted cerrará el evento.`,
    scheduleClosesOnly: (closesAt: string) => `Cierre el ${closesAt}. Usted abrirá el evento.`,
    scheduleSave: 'Guardar el horario',
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
      'Cambie primero su contraseña: el resto de la consola permanece cerrado hasta entonces.',
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
    openConsole: 'Consola completa, para ordenador',
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
    liveWindowEnd: (date: string) => `La ventana en directo termina el ${date}.`,
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
    eventsCell: (total: number, live: number) =>
      `${t.number(total)} (${t.number(live)} en directo)`,
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
    invitationValidUntil: (date: string) => `Válida hasta el ${date}.`,

    ceilingsLegend: 'Límites',
    maxEvents: 'Eventos, como máximo',
    maxEventsPerPeriod: 'Eventos creados por periodo, como máximo',
    maxTotalGigabytes: 'Almacenamiento total, en GB',
    maxEventQuotaGigabytes: 'Cuota de un evento, en GB',
    maxRetentionDays: 'Conservación tras el cierre, en días, como máximo',
    maxLiveDays: 'Duración de un directo, en días, como máximo',
    clipsAllowed: 'Vídeos permitidos',
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
      'Los invitados ya no pueden unirse a sus eventos ni enviar fotos, el público deja de ver sus pantallas y sus galerías, y sus miembros ya no pueden modificar nada. No se elimina nada y no se desactiva ninguna cuenta.',
    suspended: 'Cliente suspendido.',
    resume: 'Levantar la suspensión',
    resumeTitle: '¿Levantar la suspensión?',
    resumeBody:
      'Las pantallas y las galerías del cliente vuelven a ser visibles de inmediato, y sus invitados pueden volver a unirse y enviar fotos.',
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
      live: 'En directo',
      closed: 'Cerrado',
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
      'Los eventos en directo se cierran, los borradores se archivan, el cliente se suspende y sus álbumes se eliminan como muy tarde al terminar el plazo que usted fija: es el tiempo que tiene el cliente para exportar lo que quiere conservar (la retención propia de un evento o los límites del cliente pueden eliminarlos antes). Después se eliminan las cuentas que solo le pertenecían y no tienen nada más, y el cliente con ellas.',
    graceDays: 'Plazo antes de la eliminación, en días',
    graceDaysHint: 'Un número entero de días: los límites son los del servidor.',
    offboardAction: 'Poner fin a la colaboración',
    offboardConfirmTitle: '¿Poner fin a la colaboración con este cliente?',
    offboardConfirmBody: (days: number) =>
      t.count(days, {
        one: `Dentro de ${t.number(days)} día como muy tarde, los álbumes de este cliente se eliminarán y después el propio cliente, con las cuentas que solo le pertenecían y no tienen nada más. No hay vuelta atrás: ni la fecha ni la suspensión podrán cambiarse. Hasta entonces sus eventos en directo se cierran, sus borradores se archivan y el cliente se suspende.`,
        other: `Dentro de ${t.number(days)} días como muy tarde, los álbumes de este cliente se eliminarán y después el propio cliente, con las cuentas que solo le pertenecían y no tienen nada más. No hay vuelta atrás: ni la fecha ni la suspensión podrán cambiarse. Hasta entonces sus eventos en directo se cierran, sus borradores se archivan y el cliente se suspende.`,
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
      'Busque el evento denunciado por su dirección, su código de invitación o su nombre exacto. De él solo ve su identificador y su estado.',
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
    takedownReason: 'Motivo',
    takedownReasonHint:
      'Una frase en una sola línea, de 200 caracteres como máximo, sin dirección de correo. Se escribe en el registro de la instancia.',
    takedownUnknown:
      'Estado desconocido: el acto puede haberse realizado o no, repita la búsqueda para saberlo.',
    takedownDone: 'Hecho.',
    takedownOps: {
      eventDown: {
        title: '¿Retirar este evento?',
        body: 'El muro, el flujo de los invitados, el enlace de la galería y la consola del anfitrión responden como si el evento no existiera, y las pantallas abiertas se cierran. No se borra nada. La conservación sigue: para guardar el contenido como prueba, congele también su purga.',
        confirm: 'Retirar el evento',
      },
      eventUp: {
        title: '¿Volver a poner este evento en línea?',
        body: 'El muro, los invitados, la galería y el anfitrión lo recuperan tal como estaba.',
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
        body: 'Desaparece al instante del muro, del flujo de los invitados, del enlace de la galería y de las pantallas del anfitrión, y las pantallas abiertas la olvidan. El archivo se conserva. El anfitrión no puede devolverla.',
        confirm: 'Retirar la foto',
      },
      photoUp: {
        title: '¿Restituir esta foto?',
        body: 'Reaparece con el estado que le había dado el anfitrión.',
        confirm: 'Restituir la foto',
      },
    },
  },

  titles: {
    join: 'Únase a la galería',
    upload: 'Envío de fotos',
    feed: 'Fotos de la velada',
    wall: 'Pantalla del evento',
    gallery: 'Álbum compartido',
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
    moderation: 'Moderación',
    mobileModeration: 'Moderación en el teléfono',
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
