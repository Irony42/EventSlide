import { formattersFor } from './formatters'
import type { GuestTranslations } from './translations'

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

export const es: GuestTranslations = {
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
  },
}
