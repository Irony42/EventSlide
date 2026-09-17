import { formattersFor } from './formatters'
import type { GuestTranslations } from './translations'

/**
 * German, for the guest surface.
 *
 * Only the sections a guest can read: `translations.ts` explains why the admin and
 * moderation consoles stay French, and the type on this table is what enforces it — a
 * host-facing section added here is an excess property and fails the build.
 *
 * Register: Siezen throughout. The app speaks in the voice of the host to a guest at
 * somebody else’s wedding, so `du` appears nowhere, not even on a button. Sentence
 * case, no exclamation marks, and a refusal names the next step.
 *
 * Typography: real umlauts and `ß`, never the `ae`/`oe`/`ue`/`ss` transliterations; the
 * apostrophe is U+2019 (’); quotation marks are the German pair „ … “ and never the
 * straight ASCII one. `orthography.test.ts` checks all three, in every language.
 */

const t = formattersFor('de')

export const de: GuestTranslations = {
  app: {
    name: 'EventSlide',
    loading: 'Wird geladen…',
    retry: 'Erneut versuchen',
    cancel: 'Abbrechen',
    close: 'Schließen',
    save: 'Speichern',
    back: 'Zurück',
    confirm: 'Bestätigen',
    language: 'Sprache',
  },

  join: {
    title: 'Der Galerie beitreten',
    codeLabel: 'Code der Feier',
    codeHint: 'Sechs Zeichen, sie stehen auf der Karte oder beim QR-Code.',
    nameLabel: 'Ihr Vorname',
    nameHint: 'Er erscheint unter Ihren Fotos. Sie können das Feld auch leer lassen.',
    submit: 'Beitreten',
    submitting: 'Wird verbunden…',
    welcome: (eventName: string) => `Willkommen bei ${eventName}`,
    anonymous: 'Anonym bleiben',
  },

  upload: {
    title: 'Ihre Fotos',
    intro: 'Fügen Sie Ihre Fotos hinzu. Sie erscheinen nach der Freigabe auf dem Bildschirm.',
    addPhotos: 'Fotos hinzufügen',
    takePhoto: 'Foto aufnehmen',
    captionLabel: 'Bildunterschrift',
    captionHint: (max: number) => `Maximal ${t.number(max)} Zeichen. Optional.`,
    send: 'Senden',
    sending: 'Wird gesendet…',
    sendCount: (count: number) =>
      t.count(count, { one: 'Foto senden', other: `${t.number(count)} Fotos senden` }),
    queueEmpty: 'Noch keine Fotos ausgewählt.',
    itemPending: 'Wartet',
    itemUploading: 'Wird gesendet',
    itemDone: 'Gesendet',
    itemDuplicate: 'Bereits gesendet',
    itemFailed: 'Fehlgeschlagen',
    remove: 'Entfernen',
    mine: 'Ihre Beiträge',
    statusPending: 'Wartet auf Freigabe',
    statusPublished: 'Auf dem Bildschirm',
    statusRejected: 'Nicht ausgewählt',
    statusHidden: 'Vom Bildschirm genommen',
    deleteOwn: 'Löschen',
    deleteOwnConfirm: 'Dieses Foto löschen? Das lässt sich nicht rückgängig machen.',
    graceOver: 'Die Frist, dieses Foto selbst zu löschen, ist abgelaufen.',
    thanks: 'Danke, Ihre Fotos sind angekommen.',
    sendMore: 'Weitere Fotos senden',

    itemPreparing: 'Wird vorbereitet…',
    queueLabel: 'Fotos zum Senden',
    queueSummary: (done: number, total: number) =>
      `${t.number(done)} von ${t.number(total)} gesendet`,
    queueFailed: (count: number) =>
      t.count(count, {
        one: 'Ein Foto konnte nicht gesendet werden.',
        other: `${t.number(count)} Fotos konnten nicht gesendet werden.`,
      }),
    itemAlt: (position: number) => `Foto ${t.number(position)} zum Senden`,
    itemProgress: (position: number) => `Foto ${t.number(position)} wird gesendet`,
    removeItem: (position: number) => `Foto ${t.number(position)} entfernen`,
    retryItem: (position: number) => `Foto ${t.number(position)} erneut senden`,
    /**
     * German inflects nothing here: `Zeichen` is its own plural and `übrig` does not
     * agree. Both forms are written out all the same — the shape is what the table
     * promises, and `Intl.PluralRules` still chooses between them.
     */
    captionRemaining: (remaining: number) =>
      t.count(remaining, {
        one: `Noch ${t.number(remaining)} Zeichen übrig.`,
        other: `Noch ${t.number(remaining)} Zeichen übrig.`,
      }),
    signedAs: (name: string) => `Ihre Fotos erscheinen unter dem Namen ${name}.`,
    signedAnonymous: 'Ihre Fotos erscheinen ohne Namen.',
    mineEmpty: 'Sie haben noch keine Fotos gesendet.',
    mineFailed: 'Ihre Beiträge konnten nicht angezeigt werden. Versuchen Sie es erneut.',
    mineAlt: 'Ihr Foto',
    deleteOwnNumbered: (position: number) => `Foto ${t.number(position)} löschen`,
    notJoinedTitle: 'Treten Sie der Galerie bei, um Ihre Fotos zu senden',
    notJoinedHint: 'Scannen Sie den QR-Code erneut oder geben Sie den Code der Feier ein.',
    notJoinedAction: 'Code eingeben',

    itemQueued: 'Wartet auf das Netz',
    itemExpiredHint:
      'Dieses Foto konnte nicht gesendet werden. Senden Sie es erneut, falls Sie es noch haben.',
    offlineTitle: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto wartet auf das Netz`,
        other: `${t.number(count)} Fotos warten auf das Netz`,
      }),
    offlineHint:
      'Sie sind auf Ihrem Telefon gespeichert und werden gesendet, sobald die Verbindung wieder da ist. Sie können diese Seite schließen.',
    offlineSending: 'Wartende Fotos werden gesendet…',
    offlineRetry: 'Jetzt senden',

    installTitle: 'Die Galerie immer griffbereit',
    installHint:
      'Fügen Sie sie zu Ihrem Startbildschirm hinzu, um die Galerie später wiederzufinden, ohne den QR-Code zu suchen.',
    installIosHint: 'Öffnen Sie das Teilen-Menü und wählen Sie „Zum Home-Bildschirm“.',
    installAction: 'Zum Startbildschirm hinzufügen',
    installDismiss: 'Diesen Vorschlag ausblenden',

    clipSection: 'Video',
    addClip: 'Video hinzufügen',
    recordClip: 'Video aufnehmen',
    clipHint: (seconds: number, megabytes: number) =>
      `Maximal ${t.number(seconds)} Sekunden und ${t.number(megabytes)} MB. Das Video wird ohne Ton gezeigt.`,
    clipSend: 'Video senden',
    clipChange: 'Anderes Video wählen',
    clipDiscard: 'Dieses Video entfernen',
    clipCancel: 'Senden abbrechen',
    clipAlreadySent:
      'Dieses Video ist bereits auf dem Server. Es wird verarbeitet und dann dem Veranstalter vorgelegt.',
    clipChosen: 'Video bereit zum Senden',
    clipSize: (megabytes: number) => `${t.number(megabytes)} MB`,
    clipTooLarge: (megabytes: number) =>
      `Dieses Video ist größer als ${t.number(megabytes)} MB. Nehmen Sie ein kürzeres Video auf.`,
    clipTooLong: (seconds: number) =>
      `Dieses Video ist länger als ${t.number(seconds)} Sekunden. Nehmen Sie ein kürzeres Video auf.`,
    clipNotAVideo: 'Diese Datei ist kein Video.',
    clipUploading: 'Video wird gesendet…',
    clipQueued: 'In der Warteschlange…',
    clipRunning: 'Video wird verarbeitet…',
    clipDone: 'Video gesendet. Es erscheint nach der Freigabe auf dem Bildschirm.',
    clipProgress: 'Video wird gesendet',
    clipQueueFullRetry: (seconds: number) =>
      seconds <= 1
        ? 'Es werden gerade viele Videos verarbeitet. Versuchen Sie es gleich noch einmal.'
        : `Es werden gerade viele Videos verarbeitet. Versuchen Sie es in ${t.number(seconds)} Sekunden erneut.`,
    clipQueueFreed: 'Die Warteschlange ist wieder frei. Sie können das Video erneut senden.',
    clipStillWorking:
      'Die Verarbeitung dieses Videos dauert länger als erwartet. Laden Sie die Seite in ein paar Minuten neu, um zu sehen, ob das Video angekommen ist.',
    clipNotQueued:
      'Videos werden auf Ihrem Telefon nicht zwischengespeichert: Sie sind zu groß. Versuchen Sie es erneut, sobald die Verbindung wieder da ist.',
    mineClipAlt: 'Ihr Video',
    mineClipBadge: 'Video',
    mineClipLength: (seconds: number) => `Video · ${t.number(seconds)} s`,
  },

  ui: {
    dialogClose: 'Fenster schließen',
    notifications: 'Benachrichtigungen',
    dismissNotification: 'Diese Benachrichtigung ausblenden',
    percent: (value: number) => t.percent(value),
    optional: 'Optional',
  },

  shell: {
    skipToContent: 'Zum Hauptinhalt springen',
    sessionChecking: 'Ihre Sitzung wird geprüft…',
    sessionFailed:
      'Ihre Sitzung konnte nicht geprüft werden. Prüfen Sie Ihr Netz und versuchen Sie es erneut.',
    crashTitle: 'Dieser Bildschirm wurde unerwartet beendet',
    crashHint:
      'Nichts ist verloren: Ihre Fotos liegen auf dem Server. Versuchen Sie es erneut, um weiterzumachen.',
    notFoundTitle: 'Seite nicht gefunden',
    notFoundHint:
      'Diese Adresse gibt es nicht. Prüfen Sie den Link oder gehen Sie zurück zum Anfang.',
    notFoundHome: 'Zurück zum Anfang',
    comingSoon: 'Dieser Bildschirm kommt bald.',
  },

  errors: {
    unknown: 'Etwas ist schiefgelaufen. Versuchen Sie es gleich noch einmal.',
    network: 'Die Verbindung ist abgebrochen. Prüfen Sie Ihr Netz und versuchen Sie es erneut.',
    'request.invalid': 'Die gesendeten Angaben sind nicht gültig.',

    'auth.invalidCredentials': 'E-Mail-Adresse oder Passwort ist falsch.',
    'auth.required': 'Melden Sie sich an, um fortzufahren.',
    'auth.forbidden': 'Sie haben nicht die Rechte für diese Aktion.',

    'event.notFound': 'Zu diesem Code gehört keine offene Galerie.',
    'event.notAcceptingUploads': 'Diese Galerie nimmt keine Fotos mehr an.',
    'event.quotaExceeded': 'Die Galerie ist voll. Sagen Sie dem Veranstalter Bescheid.',
    'event.slugTaken': 'Diese Adresse ist bereits vergeben.',
    'event.immutable': 'Diese Veranstaltung ist archiviert und kann nicht mehr geändert werden.',
    'event.illegalTransition': 'Dieser Statuswechsel ist nicht möglich.',

    'guest.wrongEvent': 'Ihr Zugang gehört nicht zu dieser Galerie.',
    'guest.revoked': 'Der Veranstalter hat Ihren Zugang entzogen.',
    'guestToken.expired': 'Ihr Zugang ist abgelaufen. Scannen Sie den QR-Code erneut.',
    'guestToken.malformed': 'Ihr Zugang ist nicht mehr gültig. Scannen Sie den QR-Code erneut.',
    'guestToken.badSignature': 'Ihr Zugang ist nicht mehr gültig. Scannen Sie den QR-Code erneut.',

    'photo.notFound': 'Dieses Foto gibt es nicht mehr.',
    'photo.illegalTransition': 'Diese Aktion ist bei diesem Foto nicht möglich.',
    'photo.tooManyForGuest': 'Sie haben die erlaubte Anzahl an Fotos erreicht.',

    'image.unsupportedFormat':
      'Diese Datei ist kein Foto. Zulässige Formate: JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'Dieses Foto scheint beschädigt zu sein. Versuchen Sie es mit einem anderen.',
    'image.tooManyPixels':
      'Dieses Foto ist zu groß. Verkleinern Sie es und versuchen Sie es erneut.',
    'image.animated': 'Animierte Bilder werden nicht angenommen.',
    'image.renderFailed':
      'Dieses Foto konnte nicht verarbeitet werden. Versuchen Sie es mit einem anderen.',
    'upload.tooLarge': 'Dieses Foto überschreitet die maximale Größe.',
    'upload.tooManyFiles': 'Zu viele Fotos auf einmal. Senden Sie sie in mehreren Schritten.',

    'caption.tooLong': 'Bildunterschrift zu lang.',
    'caption.empty': 'Die Bildunterschrift ist leer.',

    'password.tooShort': 'Passwort zu kurz.',
    'password.tooLong': 'Passwort zu lang.',
    'password.tooCommon': 'Dieses Passwort ist zu verbreitet.',
    'password.sameAsEmail': 'Das Passwort darf nicht Ihre E-Mail-Adresse sein.',
    'password.sameAsName': 'Das Passwort darf nicht Ihr Name sein.',
    'password.tooRepetitive': 'Dieses Passwort wiederholt sich zu stark.',
    'password.unchanged': 'Wählen Sie ein anderes Passwort als das bisherige.',
    'password.mismatch': 'Die beiden Passwörter stimmen nicht überein.',

    'eventName.empty': 'Geben Sie Ihrer Veranstaltung einen Namen.',
    'eventName.tooShort': 'Dieser Name ist zu kurz.',
    'eventName.tooLong': 'Dieser Name ist zu lang.',
    'slug.tooShort': 'Die Adresse muss mindestens zwei Zeichen haben.',
    'slug.tooLong': 'Diese Adresse ist zu lang.',
    'slug.malformed':
      'Für die Adresse sind nur Buchstaben ohne Umlaute, Ziffern und Bindestriche erlaubt.',
    'slug.reserved': 'Diese Adresse ist reserviert. Wählen Sie eine andere.',
    'eventSettings.graceSecondsInvalid': 'Diese Löschfrist ist nicht zulässig.',
    'eventSettings.retentionDaysInvalid': 'Diese Aufbewahrungsdauer ist nicht zulässig.',
    'eventSettings.maxPhotosPerGuestInvalid': 'Diese Anzahl an Fotos pro Gast ist nicht zulässig.',
    'email.malformed': 'Diese E-Mail-Adresse ist nicht gültig.',
    'user.notFound': 'Zu dieser E-Mail-Adresse gibt es kein Konto.',
    'membership.alreadyExists': 'Diese Person moderiert diese Veranstaltung bereits.',

    'displayName.tooLong': 'Vorname zu lang.',
    'joinCode.wrongLength': 'Der Code hat sechs Zeichen.',
    'joinCode.malformed': 'Dieser Code enthält ein unerwartetes Zeichen.',

    'reaction.rateLimited':
      'Nicht so schnell — warten Sie einen Moment, bevor Sie wieder reagieren.',
    'rate.limited': 'Zu viele Versuche. Warten Sie einen Moment.',

    'event.captionsNotAllowed': 'Bildunterschriften sind für diese Galerie nicht aktiviert.',
    'event.reactionsDisabled': 'Reaktionen sind für diese Galerie nicht aktiviert.',
    'event.guestSelfDeleteDisabled':
      'Der Veranstalter erlaubt Gästen nicht, ihre Fotos zu löschen.',
    'photo.captionEditForbidden': 'Diese Bildunterschrift kann nicht mehr geändert werden.',
    'photo.deleteForbidden': 'Sie können dieses Foto nicht mehr selbst löschen.',
    'reaction.alreadyExists': 'So haben Sie auf dieses Foto bereits reagiert.',
    'reaction.notPublished': 'Dieses Foto ist noch nicht auf dem Bildschirm.',
    'reaction.notFound': 'Diese Reaktion gibt es nicht mehr.',
    'upload.noFiles':
      'Es ist kein Foto angekommen. Wählen Sie eines aus und versuchen Sie es erneut.',
    'upload.unexpectedField': 'Diese Datei konnte nicht gelesen werden. Versuchen Sie es erneut.',
    'request.csrfMissing':
      'Diese Seite ist abgelaufen. Laden Sie sie neu und versuchen Sie es erneut.',
    'request.csrfMismatch':
      'Diese Seite ist abgelaufen. Laden Sie sie neu und versuchen Sie es erneut.',

    'event.photoLimitReached': 'Sie haben die erlaubte Anzahl an Fotos erreicht.',
    'photo.pixelBudgetExceeded':
      'Dieses Foto ist zu groß. Verkleinern Sie es und versuchen Sie es erneut.',
    'upload.rejected': 'Diese Datei konnte nicht gelesen werden. Versuchen Sie es erneut.',
    'event.notModeratable': 'Diese Veranstaltung ist archiviert: Entscheidungen gelten nicht mehr.',
    'membership.lastOwner': 'Eine Veranstaltung muss mindestens einen Eigentümer behalten.',
    'membership.notFound': 'Diese Person moderiert diese Veranstaltung nicht.',
    'guest.notFound': 'Dieser Gast steht nicht mehr in der Liste. Aktualisieren Sie die Seite.',

    'event.scheduleOutOfOrder': 'Das Ende muss nach dem Beginn liegen.',
    'event.scheduleInPast':
      'Dieser Zeitpunkt ist bereits vorbei. Prüfen Sie das Datum: Für das Ende des Abends wählen Sie den nächsten Tag.',
    'event.scheduleInvalid': 'Diese Datumsangaben sind nicht lesbar. Wählen Sie sie erneut.',

    'event.clipsNotAllowed': 'Videos sind für diese Galerie nicht aktiviert.',
    'clip.queueFull':
      'Es werden gerade viele Videos verarbeitet. Versuchen Sie es in einer Minute erneut.',
    'clip.transcoderUnavailable':
      'Dieser Server kann keine Videos verarbeiten. Sagen Sie dem Veranstalter Bescheid.',
    'clip.unsupportedFormat': 'Diese Datei ist kein Video. Zulässige Formate: MP4, MOV, WebM.',
    'clip.corrupt': 'Dieses Video scheint beschädigt zu sein. Versuchen Sie es mit einem anderen.',
    'clip.noVideoStream': 'Diese Datei enthält kein Bild. Versuchen Sie es mit einer anderen.',
    'clip.durationUnknown':
      'Die Länge dieses Videos ist nicht lesbar. Versuchen Sie es mit einem anderen.',
    'clip.tooShort': 'Dieses Video ist zu kurz.',
    'clip.tooLong': 'Dieses Video ist zu lang. Nehmen Sie ein kürzeres Video auf.',
    'clip.transcodeFailed':
      'Dieses Video konnte nicht verarbeitet werden. Versuchen Sie es mit einem anderen.',
    'clip.transcodeTimedOut':
      'Dieses Video ist zu aufwendig zu verarbeiten. Versuchen Sie es mit einem anderen.',
    'clip.storageFailed': 'Dieses Video konnte nicht gespeichert werden. Versuchen Sie es erneut.',
    'clip.sourceMissing': 'Dieses Video ist nicht mehr verfügbar. Senden Sie es erneut.',
    'clip.stageFailed': 'Dieses Video konnte nicht empfangen werden. Versuchen Sie es erneut.',
    'clip.abandoned': 'Die Verarbeitung dieses Videos wurde abgebrochen. Senden Sie es erneut.',
    'clip.sourceByteSizeInvalid': 'Diese Datei ist leer. Wählen Sie eine andere.',
    'clip.transcodeCancelled':
      'Die Verarbeitung dieses Videos wurde unterbrochen. Sie wird automatisch fortgesetzt.',
    'clip.probeUnreadable': 'Dieses Video konnte nicht analysiert werden. Versuchen Sie es erneut.',
    'clip.pixelBudgetExceeded':
      'Dieses Video ist zu groß. Nehmen Sie es in einer niedrigeren Auflösung auf.',
    'clipJob.notFound': 'Dieses Video gibt es nicht mehr.',
    'clipJob.illegalTransition': 'Diese Aktion ist bei diesem Video nicht möglich.',
    'photo.rangeNotSatisfiable': 'Diesen Teil der Datei gibt es nicht.',
  },
}
