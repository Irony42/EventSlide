import { formattersFor } from './formatters'
import type { UiText } from './translations'

/**
 * Spanish, for the guest surface.
 *
 * Only the sections a guest can read: `translations.ts` explains why the admin and
 * moderation consoles stay French, and the type on this table is what enforces it — a
 * host-facing section added here is an excess property and fails the build.
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
    loading: 'Cargando…',
    retry: 'Reintentar',
    cancel: 'Cancelar',
    close: 'Cerrar',
    save: 'Guardar',
    back: 'Volver',
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
  },

  upload: {
    title: 'Sus fotos',
    intro: 'Añada sus fotos. Aparecerán en la pantalla una vez aprobadas.',
    addPhotos: 'Añadir fotos',
    takePhoto: 'Hacer una foto',
    captionLabel: 'Pie de foto',
    captionHint: (max: number) => `${t.number(max)} caracteres como máximo. Opcional.`,
    send: 'Enviar',
    sending: 'Enviando…',
    sendCount: (count: number) =>
      t.count(count, { one: 'Enviar la foto', other: `Enviar las ${t.number(count)} fotos` }),
    queueEmpty: 'Todavía no ha seleccionado ninguna foto.',
    itemPending: 'En espera',
    itemUploading: 'Enviando',
    itemDone: 'Enviada',
    itemDuplicate: 'Ya enviada',
    itemFailed: 'Error',
    remove: 'Quitar',
    mine: 'Sus envíos',
    statusPending: 'Pendiente de aprobación',
    statusPublished: 'En la pantalla',
    statusRejected: 'No seleccionada',
    statusHidden: 'Retirada de la pantalla',
    deleteOwn: 'Eliminar',
    deleteOwnConfirm: '¿Eliminar esta foto? Esta acción es definitiva.',
    graceOver: 'Ha terminado el plazo para eliminar esta foto por su cuenta.',
    thanks: 'Gracias, sus fotos han llegado correctamente.',
    sendMore: 'Enviar más fotos',

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
    mineFailed: 'No se han podido mostrar sus envíos. Inténtelo de nuevo.',
    mineAlt: 'Su foto',
    deleteOwnNumbered: (position: number) => `Eliminar la foto ${t.number(position)}`,
    notJoinedTitle: 'Únase a la galería para enviar sus fotos',
    notJoinedHint: 'Vuelva a escanear el código QR o introduzca el código de la fiesta.',
    notJoinedAction: 'Introducir el código',

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
    noticeWhatHappens: 'Qué pasa con ellas',
    noticeWhoSees: 'Quién las ve',
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
      room: 'Todos los presentes, una vez que la foto está en la pantalla.',
      organisers:
        'El organizador y su equipo, que ven todo lo que usted envía y pueden descargar las fotos mostradas en la pantalla.',
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
        one: `Puede eliminar una usted mismo durante ${t.number(seconds)} segundo después de enviarla, mientras no esté en la pantalla.`,
        other: `Puede eliminar una usted mismo durante ${t.number(seconds)} segundos después de enviarla, mientras no esté en la pantalla.`,
      }),
    noticeRemovalMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `Puede eliminar una usted mismo durante ${t.number(minutes)} minuto después de enviarla, mientras no esté en la pantalla.`,
        other: `Puede eliminar una usted mismo durante ${t.number(minutes)} minutos después de enviarla, mientras no esté en la pantalla.`,
      }),
    noticeRemovalHours: (hours: number) =>
      t.count(hours, {
        one: `Puede eliminar una usted mismo durante ${t.number(hours)} hora después de enviarla, mientras no esté en la pantalla.`,
        other: `Puede eliminar una usted mismo durante ${t.number(hours)} horas después de enviarla, mientras no esté en la pantalla.`,
      }),
    noticeRemovalOtherwise: 'Si no, pídaselo al organizador: puede eliminar cualquier foto.',
    noticeRemovalAskHost: 'Pídaselo al organizador: puede eliminar cualquier foto.',
    clipDoneImmediate: 'Vídeo enviado. Ya pasa a la pantalla.',
  },

  ui: {
    dialogClose: 'Cerrar la ventana',
    notifications: 'Notificaciones',
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
    comingSoon: 'Esta pantalla estará disponible próximamente.',
  },

  errors: {
    unknown: 'Se ha producido un error. Inténtelo de nuevo en un momento.',
    network: 'Se ha interrumpido la conexión. Revise su red e inténtelo de nuevo.',
    'request.invalid': 'Los datos enviados no son válidos.',

    'auth.invalidCredentials': 'La dirección de correo o la contraseña no son correctas.',
    'auth.required': 'Inicie sesión para continuar.',
    'auth.forbidden': 'No tiene permisos para esta acción.',

    'event.notFound': 'Este código no corresponde a ninguna galería abierta.',
    'event.notAcceptingUploads': 'Esta galería ya no acepta fotos.',
    'event.quotaExceeded': 'La galería ha alcanzado su capacidad. Avise al organizador.',
    'event.slugTaken': 'Esta dirección ya está en uso.',
    'event.immutable': 'Este evento está archivado y ya no se puede modificar.',
    'event.illegalTransition': 'Este cambio de estado no es posible.',

    'guest.wrongEvent': 'Su acceso no corresponde a esta galería.',
    'guest.revoked': 'El organizador ha retirado su acceso.',
    'guestToken.expired': 'Su acceso ha caducado. Vuelva a escanear el código QR.',
    'guestToken.malformed': 'Su acceso ya no es válido. Vuelva a escanear el código QR.',
    'guestToken.badSignature': 'Su acceso ya no es válido. Vuelva a escanear el código QR.',

    'photo.notFound': 'Esta foto ya no existe.',
    'photo.illegalTransition': 'Esta acción no es posible en esta foto.',
    'photo.tooManyForGuest': 'Ha alcanzado el número de fotos permitido.',

    'image.unsupportedFormat':
      'Este archivo no es una foto. Formatos aceptados: JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'Esta foto parece dañada. Pruebe con otra.',
    'image.tooManyPixels': 'Esta foto es demasiado grande. Redúzcala e inténtelo de nuevo.',
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

    'displayName.tooLong': 'El nombre es demasiado largo.',
    'joinCode.wrongLength': 'El código tiene seis caracteres.',
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
      'Ese color se parece demasiado a los colores de estado de la aplicación. Elija otro.',
  },

  moderation: {
    title: 'Moderación',
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
    shortcutsHint: 'J / K para navegar, P para publicar, R para rechazar, Z para deshacer.',

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
    statePublished: 'Publicada',
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
        one: `${t.number(count)} foto retirada de la pantalla.`,
        other: `${t.number(count)} fotos retiradas de la pantalla.`,
      }),
    decisionFailed: 'No se ha podido guardar la decisión. Inténtelo de nuevo.',
    undoFailed: 'No se ha podido deshacer la decisión. Inténtelo de nuevo.',
    dimensions: (width: number, height: number) => `${width} × ${height} píxeles`,
    noCaption: 'Sin pie de foto',

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

  wall: {
    empty: 'Las primeras fotos llegarán enseguida',
    emptyHint: 'Escanee el código QR para enviar las suyas.',
    joinPrompt: 'Únase a la galería',
    reactions: 'Reacciones',
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
    dismissJoinCard: 'Ocultar el aviso del código',
    shortcuts: 'Atajos de teclado',
    shortcutsHint:
      'Espacio pausa, las flechas cambian de foto, F pasa a pantalla completa, L cambia la disposición.',

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
    title: 'Administración',
    events: 'Sus eventos',
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
      violet: 'Violeta',
      rose: 'Rosa',
      azure: 'Azul',
      teal: 'Turquesa',
    },
    themeFonts: 'Tipografía',
    /** The honest scope, said once: a guest phone downloads nothing for this. */
    themeFontsHint: 'Se aplica solo a la pantalla de la sala.',
    themeFontsNames: {
      sans: 'Moderna',
      serif: 'Clásica',
    },
    themeFrame: 'Marco de las fotos',
    themeFrameNames: {
      soft: 'Esquinas redondeadas',
      square: 'Esquinas rectas',
      round: 'Esquinas muy redondeadas',
    },
    themeMaterial: 'Material de los paneles',
    themeMaterialHint:
      'El cristal deja entrever lo que pasa por debajo; la superficie lisa es opaca. La diferencia es sutil y solo afecta a la pantalla de envío de sus invitados: su consola de moderación y la pantalla de la sala no cambian.',
    themeMaterialNames: {
      glass: 'Cristal esmerilado',
      plain: 'Superficie lisa',
    },

    template: 'Tipo de evento',
    templateHint:
      'Un punto de partida, adaptado al tipo de fiesta. Todos estos ajustes se pueden modificar en cualquier momento, antes y durante el evento.',
    templateNone: 'Sin plantilla',
    templateNoneSummary:
      'Ajustes por defecto: cada foto se aprueba antes de llegar a la pantalla, conservación ilimitada.',
    templateChanges: 'Esta plantilla ajusta:',
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
    inviteModerator: 'Invitar a un moderador',

    loading: 'Cargando sus eventos…',
    loadFailed: 'No se ha podido cargar',
    eventLoading: 'Cargando el evento…',
    eventsEmpty: 'Todavía no hay ningún evento.',
    eventsEmptyHint:
      'Cree su primer evento y luego imprima su código QR para ponerlo en las mesas.',
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
    moderatorEmailHint: 'Recibirá permisos solo sobre este evento.',
    moderatorPassword: 'Contraseña temporal',
    /**
     * Said plainly, because the host is the delivery mechanism: nothing is sent by
     * e-mail, and a host who types a password and waits has already lost the invitee.
     */
    moderatorPasswordHint: (min: number) =>
      `Al menos ${min} caracteres. No se envía ningún correo: dígale esta contraseña al moderador. Elegirá otra en su primer inicio de sesión.`,
    inviteSubmit: 'Invitar',
    moderatorInvited: (email: string) =>
      `${email} ya puede moderar este evento. Dígale la contraseña temporal.`,
    /** The address already had an account, so the password just typed was not used. */
    moderatorInvitedExisting: (email: string) =>
      `${email} ya puede moderar este evento. Esta cuenta ya existía: conserva su contraseña habitual.`,
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
  },

  auth: {
    title: 'Inicio de sesión',
    email: 'Dirección de correo',
    password: 'Contraseña',
    submit: 'Iniciar sesión',
    submitting: 'Iniciando sesión…',
    logout: 'Cerrar sesión',
    changePassword: 'Cambiar la contraseña',
    currentPassword: 'Contraseña actual',
    newPassword: 'Contraseña nueva',
    newPasswordHint: (min: number) =>
      `Al menos ${min} caracteres. Una frase es más segura que una palabra.`,
    confirmPassword: 'Confirmar la contraseña nueva',
    mustChangePassword: 'Elija una contraseña antes de continuar.',

    changePasswordIntro: 'Elija una contraseña que no use en ningún otro sitio.',
    passwordSaved: 'Contraseña guardada.',
  },

  mobileModeration: {
    title: 'Moderación en el teléfono',
    intro: 'Deslice la foto hacia la derecha para publicar y hacia la izquierda para rechazar.',
    releaseToPublish: 'Suelte para publicar',
    releaseToReject: 'Suelte para rechazar',
    nowDeciding: (photo: string) => `Foto por moderar. ${photo}`,
    /** Named more fully than `moderation.undo`; both are on screen at once here. */
    undoLast: 'Deshacer la última decisión',
    /** A refusal cannot be taken back, so the console says what it can do instead. */
    undoUnavailable: 'Solo se puede deshacer una publicación.',
  },
}
