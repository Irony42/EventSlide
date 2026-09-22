import { formattersFor } from './formatters'
import type { UiText } from './translations'

/**
 * German, for every surface: the guest’s phone, the host’s and the moderators’
 * consoles, and the projected wall.
 *
 * The type on this table is `UiText` — the whole of `fr.ts`, every literal widened to
 * `string` — so a key added to the French table fails the build here until this one
 * carries it. `translations.ts` has the argument, including the guest-only one it
 * reversed.
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

export const de: UiText = {
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

    missionsTitle: 'Missionen',
    missionsHint: 'Tippen Sie auf eine Mission und senden Sie dann Ihr Foto.',
    missionDone: 'Erledigt',
    missionDoneByRoom: 'Schon fotografiert',
    missionFor: (prompt: string) => `Diese Fotos zählen für „${prompt}“.`,

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
    introImmediate: 'Fügen Sie Ihre Fotos hinzu. Die Fotos erscheinen sofort auf dem Bildschirm.',
    noticeLink: 'Wie Ihre Fotos verwendet werden',
    noticeTitle: 'Vor Ihrem ersten Foto',
    noticeChangedTitle: 'Diese Angaben haben sich geändert',
    noticeChangedHint:
      'Der Veranstalter hat eine Einstellung geändert, seit Sie diese Angaben zuletzt gelesen haben.',
    noticeAcknowledge: 'Verstanden',
    noticeWhatHappens: 'Was mit Ihren Fotos geschieht',
    noticeWhoSees: 'Wer Ihre Fotos sieht',
    noticeHowLong: 'Wie lange die Fotos aufbewahrt werden',
    noticeRemoval: 'Ein Foto entfernen lassen',
    noticeMetadataStripped:
      'Standort und Geräteangaben werden beim Eintreffen aus jedem Foto entfernt.',
    noticePublication: {
      afterReview: 'Der Veranstalter gibt jedes Foto frei, bevor es auf dem Bildschirm erscheint.',
      immediate:
        'Die Fotos erscheinen sofort nach dem Eintreffen auf dem Bildschirm. Der Veranstalter kann jedes davon jederzeit wieder entfernen.',
    },
    noticeAudiences: {
      wall: 'Alle, die den Bildschirm der Veranstaltung sehen, im Saal oder über seinen Link, sobald ein Foto darauf erscheint.',
      organisers:
        'Der Veranstalter und sein Team, die alles sehen, was Sie senden, und die auf dem Bildschirm gezeigten Fotos herunterladen können.',
    },
    noticeRetentionDays: (days: number) =>
      t.count(days, {
        one: `Die Fotos werden ${t.number(days)} Tag nach dem Schließen der Galerie automatisch gelöscht.`,
        other: `Die Fotos werden ${t.number(days)} Tage nach dem Schließen der Galerie automatisch gelöscht.`,
      }),
    noticeRetentionNone:
      'Eine automatische Löschung ist nicht vorgesehen: Die Fotos bleiben, bis der Veranstalter sie löscht.',
    noticeRemovalSeconds: (seconds: number) =>
      t.count(seconds, {
        one: `Sie können ein Foto innerhalb von ${t.number(seconds)} Sekunde nach dem Senden selbst löschen, solange es noch nicht freigegeben wurde.`,
        other: `Sie können ein Foto innerhalb von ${t.number(seconds)} Sekunden nach dem Senden selbst löschen, solange es noch nicht freigegeben wurde.`,
      }),
    noticeRemovalMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `Sie können ein Foto innerhalb von ${t.number(minutes)} Minute nach dem Senden selbst löschen, solange es noch nicht freigegeben wurde.`,
        other: `Sie können ein Foto innerhalb von ${t.number(minutes)} Minuten nach dem Senden selbst löschen, solange es noch nicht freigegeben wurde.`,
      }),
    noticeRemovalHours: (hours: number) =>
      t.count(hours, {
        one: `Sie können ein Foto innerhalb von ${t.number(hours)} Stunde nach dem Senden selbst löschen, solange es noch nicht freigegeben wurde.`,
        other: `Sie können ein Foto innerhalb von ${t.number(hours)} Stunden nach dem Senden selbst löschen, solange es noch nicht freigegeben wurde.`,
      }),
    noticeRemovalOtherwise:
      'Andernfalls wenden Sie sich an den Veranstalter: Er kann jedes Foto löschen.',
    noticeRemovalAskHost: 'Wenden Sie sich an den Veranstalter: Er kann jedes Foto löschen.',
    clipDoneImmediate: 'Video gesendet. Es erscheint jetzt auf dem Bildschirm.',
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
    'eventSettings.wallLanguageInvalid':
      'Diese Sprache ist nicht verfügbar. Wählen Sie eine aus der Liste.',
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

    'mission.notFound': 'Diese Mission gibt es nicht mehr. Laden Sie die Seite neu.',
    'mission.duplicate': 'Diese Mission gibt es bereits.',
    'mission.limitReached': 'Sie haben die maximale Anzahl an Missionen erreicht.',
    'mission.promptEmpty': 'Schreiben Sie, worum die Mission bittet.',
    'mission.promptTooLong': 'Dieser Text ist zu lang für den Bildschirm.',
    'mission.promptInvalid': 'Dieser Text ist nicht gültig.',

    'eventTheme.accentHueInvalid': 'Diese Farbe ist unbekannt. Wählen Sie eine aus der Liste.',
    'eventTheme.accentUnreadable':
      'Diese Farbe wäre auf der Leinwand im Saal nicht lesbar. Wählen Sie eine aus der Liste.',
    'eventTheme.accentTooCloseToStatus':
      'Diese Farbe ähnelt den Statusfarben der Anwendung zu sehr. Wählen Sie eine andere.',
  },

  moderation: {
    title: 'Moderation',
    intro: 'Nichts erscheint ohne Ihre Freigabe auf dem Bildschirm.',
    pending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto wartet auf Freigabe`,
        other: `${t.number(count)} Fotos warten auf Freigabe`,
      }),
    empty: 'Im Moment gibt es nichts freizugeben.',
    emptyHint: 'Neue Fotos erscheinen hier automatisch.',
    publish: 'Freigeben',
    reject: 'Ablehnen',
    hide: 'Vom Bildschirm nehmen',
    undo: 'Rückgängig',
    undone: 'Entscheidung rückgängig gemacht.',
    selectAll: 'Alle auswählen',
    clearSelection: 'Auswahl aufheben',
    bulkPublish: (count: number) => `Freigeben (${t.number(count)})`,
    bulkReject: (count: number) => `Ablehnen (${t.number(count)})`,
    bulkSkipped: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto übersprungen: Aktion nicht möglich.`,
        other: `${t.number(count)} Fotos übersprungen: Aktion nicht möglich.`,
      }),
    filterAll: 'Alle',
    filterPending: 'Wartend',
    filterPublished: 'Auf dem Bildschirm',
    filterRejected: 'Abgelehnt',
    filterHidden: 'Entfernt',
    by: (name: string) => `von ${name}`,
    byAnonymous: 'Anonymer Gast',
    shortcuts: 'Tastenkürzel',
    shortcutsHint: 'J / K zum Blättern, P zum Freigeben, R zum Ablehnen, Z zum Rückgängigmachen.',

    shortcutsMore:
      'H zum Entfernen vom Bildschirm, Leertaste zum Auswählen, Esc zum Aufheben der Auswahl.',
    queueLabel: 'Fotos zur Moderation',
    filterLabel: 'Nach Status filtern',
    emptyFiltered: 'Keine Fotos in dieser Kategorie.',
    emptyFilteredHint: 'Wechseln Sie den Filter, um die anderen Fotos zu sehen.',
    loadFailed: 'Die Moderationsliste konnte nicht geladen werden.',
    live: 'Live-Aktualisierung',
    liveLost: 'Verbindung unterbrochen — es wird erneut versucht.',
    statePending: 'Wartet',
    statePublished: 'Freigegeben',
    stateRejected: 'Abgelehnt',
    stateHidden: 'Vom Bildschirm genommen',
    selected: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto ausgewählt`,
        other: `${t.number(count)} Fotos ausgewählt`,
      }),
    anonymousInName: 'einem anonymen Gast',
    selectPhoto: (author: string) => `Foto von ${author} auswählen`,
    publishPhoto: (author: string) => `Foto von ${author} freigeben`,
    rejectPhoto: (author: string) => `Foto von ${author} ablehnen`,
    hidePhoto: (author: string) => `Foto von ${author} vom Bildschirm nehmen`,
    enlargePhoto: (author: string) => `Foto von ${author} vergrößern`,
    photoOf: (author: string) => `Foto von ${author}`,
    photoAlt: (author: string) => `Foto, gesendet von ${author}`,
    photoAltWithCaption: (caption: string, author: string) =>
      `${caption} — Foto, gesendet von ${author}`,
    previousPhoto: 'Vorheriges Foto',
    nextPhoto: 'Nächstes Foto',
    bulkHide: (count: number) => `Vom Bildschirm nehmen (${t.number(count)})`,
    published: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto freigegeben.`,
        other: `${t.number(count)} Fotos freigegeben.`,
      }),
    refused: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto abgelehnt.`,
        other: `${t.number(count)} Fotos abgelehnt.`,
      }),
    removed: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto vom Bildschirm genommen.`,
        other: `${t.number(count)} Fotos vom Bildschirm genommen.`,
      }),
    decisionFailed: 'Die Entscheidung konnte nicht gespeichert werden. Versuchen Sie es erneut.',
    undoFailed: 'Das Rückgängigmachen konnte nicht gespeichert werden. Versuchen Sie es erneut.',
    dimensions: (width: number, height: number) => `${width} × ${height} Pixel`,
    noCaption: 'Ohne Bildunterschrift',

    videoBadge: 'Video',
    videoLength: (seconds: number) => `Video · ${seconds} s`,
    watchVideo: (author: string) => `Video von ${author} ansehen`,
    playVideo: (author: string) => `Video von ${author} abspielen`,
    pauseVideo: (author: string) => `Video von ${author} anhalten`,
    videoOf: (author: string) => `Video von ${author}`,
    videoAlt: (author: string) => `Video, gesendet von ${author}`,
    videoAltWithCaption: (caption: string, author: string) =>
      `${caption} — Video, gesendet von ${author}`,
    videoMuted: 'Der Ton ließ sich nicht einschalten: Dieses Video läuft ohne Ton.',
    videoUnplayable:
      'Dieses Video kann hier nicht abgespielt werden. Zu sehen ist nur das Vorschaubild.',
  },

  wall: {
    empty: 'Die ersten Fotos kommen gleich',
    emptyHint: 'Scannen Sie den QR-Code und senden Sie Ihre eigenen Fotos.',
    joinPrompt: 'Treten Sie der Galerie bei',
    reactions: 'Reaktionen',
    offline: 'Verbindung unterbrochen — es wird erneut versucht',
    paused: 'Diashow angehalten',

    codeLabel: 'Code der Feier',
    qrTitle: 'QR-Code für den Beitritt zur Galerie',
    photoBy: (name: string) => `Foto, gesendet von ${name}`,
    photoByAnonymous: 'Foto, gesendet von einem Gast',
    errorTitle: 'Die Fotos konnten nicht geladen werden',
    errorHint:
      'Es wird erneut versucht. Prüfen Sie das Netz vor Ort, wenn der Bildschirm leer bleibt.',
    dismissJoinCard: 'Code-Hinweis ausblenden',
    shortcuts: 'Tastenkürzel',
    shortcutsHint:
      'Leertaste hält an, die Pfeiltasten wechseln das Foto, F schaltet auf Vollbild, L wechselt die Anordnung.',

    layoutNames: {
      spotlight: 'Vollbild',
      mosaic: 'Mosaik',
      polaroid: 'Polaroid',
      filmstrip: 'Filmstreifen',
      collage: 'Collage',
      split: 'Nebeneinander',
    },
    layoutOrder: (names: readonly string[]) =>
      `Anordnungen, in dieser Reihenfolge: ${names.join(', ')}.`,

    videoBy: (name: string) => `Video, gesendet von ${name}`,
    videoByAnonymous: 'Video, gesendet von einem Gast',

    missionsTitle: 'Missionen',
    missionDone: 'Erledigt',
    missionGuests: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Gast`,
        other: `${t.number(count)} Gäste`,
      }),
  },

  admin: {
    title: 'Verwaltung',
    events: 'Ihre Veranstaltungen',
    newEvent: 'Neue Veranstaltung',
    eventName: 'Name der Veranstaltung',
    eventNameHint: 'Für Ihre Gäste sichtbar, zum Beispiel „Camille & Sacha“.',
    slug: 'Adresse',
    joinCode: 'Zugangscode',
    rotateJoinCode: 'Code ändern',
    rotateJoinCodeHint:
      'Bereits verbundene Gäste bleiben verbunden. Der neue Code ersetzt den alten sofort.',
    qrCode: 'QR-Code',
    qrCodeHint: 'Zum Ausdrucken und Aufstellen auf den Tischen.',
    openWall: 'Bildschirm öffnen',
    openModeration: 'Moderieren',
    download: 'Album herunterladen',
    statusDraft: 'Entwurf',
    statusLive: 'Läuft',
    statusClosed: 'Beendet',
    statusArchived: 'Archiviert',
    goLive: 'Für Gäste öffnen',
    closeEvent: 'Veranstaltung beenden',
    reopenEvent: 'Erneut öffnen',
    archiveEvent: 'Archivieren',
    photos: (count: number) =>
      t.count(count, { one: `${t.number(count)} Foto`, other: `${t.number(count)} Fotos` }),
    guests: (count: number) =>
      t.count(count, { one: `${t.number(count)} Gast`, other: `${t.number(count)} Gäste` }),
    storageUsed: (used: string, total: string) => `${used} von ${total}`,
    settings: 'Einstellungen',
    moderationMode: 'Moderation',
    moderationManual: 'Jedes Foto freigeben',
    moderationAuto: 'Automatisch freigeben',
    moderationAutoWarning:
      'Fotos und Videos erscheinen ohne Freigabe auf dem Bildschirm. Nur für Veranstaltungen im engen Kreis.',
    allowCaptions: 'Bildunterschriften erlauben',
    allowReactions: 'Reaktionen erlauben',
    allowClips: 'Videos erlauben',
    allowClipsHint:
      'Gäste können zusätzlich zu Fotos kurze Videos senden. Ohne Haken werden Videos abgelehnt: weil Sie den Haken entfernt haben, weil die bei der Erstellung gewählte Vorlage es so eingestellt hat, oder weil die Galerie älter ist als diese Funktion. Setzen Sie den Haken, um Videos zu erlauben.',
    allowGuestSelfDelete: 'Gästen erlauben, ihre Fotos zu löschen',

    wallLanguage: 'Sprache der Leinwand im Saal',
    wallLanguageHint:
      'Die Wörter auf der Leinwand im Saal: „Treten Sie der Galerie bei“, „Missionen“, die Wartemeldungen. Was Sie und Ihre Gäste schreiben — der Name der Veranstaltung, die Bildunterschriften, die Aufgaben — erscheint unverändert und wird nie übersetzt. Ihre Gäste wählen ihre eigene Sprache auf ihrem Telefon; diese Einstellung betrifft sie nicht.',

    theme: 'Erscheinungsbild',
    themeHint:
      'Sichtbar für Ihre Gäste und auf der Leinwand im Saal. Die angebotenen Farben bleiben auf zehn Meter lesbar.',
    themeAccent: 'Farbe',
    themeAccentNames: {
      violet: 'Violett',
      rose: 'Rosa',
      azure: 'Blau',
      teal: 'Türkis',
    },
    themeFonts: 'Schrift',
    themeFontsHint: 'Gilt nur für die Leinwand im Saal.',
    themeFontsNames: {
      sans: 'Modern',
      serif: 'Klassisch',
    },
    themeFrame: 'Fotorahmen',
    themeFrameNames: {
      soft: 'Abgerundete Ecken',
      square: 'Gerade Ecken',
      round: 'Stark abgerundete Ecken',
    },
    themeMaterial: 'Material der Flächen',
    themeMaterialHint:
      'Glas lässt ahnen, was darunter liegt; die einfarbige Fläche ist undurchsichtig. Der Unterschied ist dezent, und er betrifft nur die Seite, auf der Ihre Gäste ihre Fotos senden: Ihre Moderationskonsole und die Leinwand im Saal ändern sich nicht.',
    themeMaterialNames: {
      glass: 'Milchglas',
      plain: 'Einfarbige Fläche',
    },

    template: 'Art der Veranstaltung',
    templateHint:
      'Ein Ausgangspunkt, passend zur Art des Abends. Alle diese Einstellungen bleiben jederzeit änderbar, vor wie während der Veranstaltung.',
    templateNone: 'Ohne Vorlage',
    templateNoneSummary:
      'Standardeinstellungen: jedes Foto wird freigegeben, bevor es auf den Bildschirm kommt; unbegrenzte Aufbewahrung.',
    templateChanges: 'Diese Vorlage stellt ein:',
    templateClipsOn: 'Videos erlaubt',
    templateClipsOff: 'Videos deaktiviert',
    templateNames: {
      wedding: 'Hochzeit',
      birthday: 'Geburtstag',
      conference: 'Konferenz',
      party: 'Party',
    },

    retention: 'Automatische Löschung',
    retentionNever: 'Nie',
    retentionDays: (days: number) =>
      t.count(days, {
        one: `${t.number(days)} Tag nach dem Ende`,
        other: `${t.number(days)} Tage nach dem Ende`,
      }),
    retentionUnlimited: 'Unbegrenzte Aufbewahrung',
    moderators: 'Moderatoren',
    inviteModerator: 'Moderator einladen',

    loading: 'Ihre Veranstaltungen werden geladen…',
    loadFailed: 'Laden nicht möglich',
    eventLoading: 'Die Veranstaltung wird geladen…',
    eventsEmpty: 'Noch keine Veranstaltungen.',
    eventsEmptyHint:
      'Legen Sie Ihre erste Veranstaltung an und drucken Sie dann ihren QR-Code für die Tische aus.',
    create: 'Veranstaltung anlegen',
    slugHint: 'Optional. Leer lassen, dann wird sie aus dem Namen abgeleitet.',
    slugPreviewLabel: 'Adresse der Galerie',
    slugPreviewEmpty: 'Geben Sie einen Namen ein, um die Adresse zu sehen.',
    eventCreated: (name: string) =>
      `${name} ist bereit. Drucken Sie den QR-Code, wann immer Sie wollen.`,
    joinCodeHint: 'Für Gäste, die den QR-Code nicht scannen können.',
    eventControls: 'Steuerung der Veranstaltung',
    joinLink: 'Einladungslink',
    printQr: 'QR-Code drucken',
    qrScanPrompt: 'Scannen Sie, um Ihre Fotos zu senden.',
    qrAlt: (eventName: string) => `QR-Code für den Zugang zu ${eventName}`,
    storageLabel: 'Belegter Speicher für Fotos',
    storage: (used: string) => `${used} belegt`,
    statusSaved: 'Der neue Status ist gespeichert.',
    rotateJoinCodeTitle: 'Zugangscode ändern?',
    codeRotated: 'Der Zugangscode wurde geändert. Der alte funktioniert nicht mehr.',
    settingsSaved: 'Einstellungen gespeichert.',
    settingsReadOnly:
      'Diese Veranstaltung ist archiviert: Die Einstellungen können nicht mehr geändert werden.',
    retentionHint: 'Die Fotos werden nach dieser Frist ab dem Ende der Veranstaltung gelöscht.',
    selfDeleteGrace: 'Löschfrist',
    selfDeleteGraceHint: 'Innerhalb dieser Frist kann ein Gast sein Foto selbst löschen.',
    graceNone: 'Keine Frist',
    graceSeconds: (seconds: number) =>
      t.count(seconds, {
        one: `${t.number(seconds)} Sekunde`,
        other: `${t.number(seconds)} Sekunden`,
      }),
    graceMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `${t.number(minutes)} Minute`,
        other: `${t.number(minutes)} Minuten`,
      }),
    graceHours: (hours: number) =>
      t.count(hours, { one: `${t.number(hours)} Stunde`, other: `${t.number(hours)} Stunden` }),
    maxPhotosPerGuest: 'Fotos pro Gast',
    maxPhotosUnlimited: 'Ohne Limit',
    guestList: 'Gäste',
    guestsEmpty: 'Noch niemand ist der Galerie beigetreten.',
    guestsEmptyHint: 'Gäste erscheinen hier, sobald sie den QR-Code scannen.',
    lastSeen: (when: string) => `Letzte Aktivität: ${when}`,
    dateUnknown: 'Datum unbekannt',
    guestRevokedBadge: 'Zugang entzogen',
    revokeGuest: 'Zugang entziehen',
    revokeGuestTitle: 'Diesem Gast den Zugang entziehen?',
    revokeGuestHint:
      'Die bereits freigegebenen Fotos bleiben auf dem Bildschirm. Neue Fotos kann dieser Gast nicht mehr senden.',
    guestRevoked: 'Der Zugang wurde entzogen.',
    moderatorsEmpty: 'Sie moderieren diese Veranstaltung allein.',
    moderatorEmail: 'E-Mail-Adresse des Moderators',
    moderatorEmailHint: 'Die Rechte gelten nur für diese Veranstaltung.',
    moderatorPassword: 'Vorläufiges Passwort',
    moderatorPasswordHint: (min: number) =>
      `Mindestens ${min} Zeichen. Es wird keine E-Mail versendet: Nennen Sie dem Moderator dieses Passwort. Bei der ersten Anmeldung wählt er ein eigenes.`,
    inviteSubmit: 'Einladen',
    moderatorInvited: (email: string) =>
      `${email} kann diese Veranstaltung ab jetzt moderieren. Geben Sie dieser Person das vorläufige Passwort weiter.`,
    moderatorInvitedExisting: (email: string) =>
      `${email} kann diese Veranstaltung ab jetzt moderieren. Dieses Konto gab es bereits: Es behält sein bisheriges Passwort.`,
    revokeModerator: 'Entfernen',
    revokeModeratorTitle: 'Diesen Moderator entfernen?',
    revokeModeratorHint:
      'Er verliert den Zugang zu dieser Veranstaltung. Seine bisherigen Entscheidungen bleiben erhalten.',
    moderatorRevoked: 'Der Moderator wurde entfernt.',
    roleOwner: 'Veranstalter',
    roleModerator: 'Moderator',
    lastOwnerHint: 'Der letzte Veranstalter kann nicht entfernt werden.',
    purge: 'Veranstaltung löschen',
    purgeTitle: 'Diese Veranstaltung endgültig löschen?',
    purgeWarning:
      'Alle Fotos, alle Gäste und das Album werden gelöscht. Das lässt sich nicht rückgängig machen.',
    purgeConfirmLabel: 'Adresse der Veranstaltung',
    purgeConfirmHint: (slug: string) => `Geben Sie „${slug}“ ein, um die Löschung zu bestätigen.`,
    purged: (name: string) => `${name} wurde gelöscht.`,

    schedule: 'Automatisches Öffnen und Beenden',
    scheduleHint:
      'Leer lassen, wenn Sie selbst öffnen und beenden wollen. Die Zeiten richten sich nach Ihrem Computer, also nach dem Ort der Feier.',
    scheduleOpenAt: 'Für Gäste öffnen am',
    scheduleCloseAt: 'Veranstaltung beenden am',
    scheduleCloseAtHint: 'Fotos und Album bleiben erhalten: Beenden löscht nichts.',
    scheduleSaved: 'Die Zeitplanung wurde gespeichert.',
    scheduleNone: 'Keine Zeitplanung: Sie öffnen und beenden selbst.',
    scheduleArmed: (opensAt: string, closesAt: string) =>
      `Öffnung am ${opensAt}, Ende am ${closesAt}.`,
    scheduleOpensOnly: (opensAt: string) => `Öffnung am ${opensAt}. Sie beenden selbst.`,
    scheduleClosesOnly: (closesAt: string) => `Ende am ${closesAt}. Sie öffnen selbst.`,
    scheduleSave: 'Zeitplanung speichern',
    scheduleDiscarded: (when: string) =>
      `Die automatische Zeitplanung konnte am ${when} nicht greifen: Die Veranstaltung konnte zu diesem Zeitpunkt den Status nicht wechseln. Sie wurde gelöscht. Speichern Sie eine neue, wenn Sie eine wollen.`,

    missionsTitle: 'Missionen',
    missionsHint:
      'Eine kurze Liste von Aufgaben, die Ihre Gäste als Checkliste sehen und die in einer Ecke der Leinwand im Saal erscheint.',
    missionsEmpty: 'Noch keine Missionen.',
    missionPrompt: 'Aufgabe',
    missionPromptHint: (max: number) =>
      `Höchstens ${t.number(max)} Zeichen. In der Sprache des Abends geschrieben: Sie wird nicht übersetzt.`,
    missionScope: 'Zu erfüllen',
    missionScopeGuest: 'Pro Gast',
    missionScopeEvent: 'Einmal für den Abend',
    missionScopeHint:
      'Pro Gast: Jeder kann sie erfüllen. Einmal: Das erste freigegebene Foto hakt sie für alle ab.',
    missionAdd: 'Mission hinzufügen',
    missionSave: 'Speichern',
    missionCancel: 'Abbrechen',
    missionEditShort: 'Bearbeiten',
    missionDeleteShort: 'Löschen',
    missionEdit: (prompt: string) => `„${prompt}“ bearbeiten`,
    missionDelete: (prompt: string) => `„${prompt}“ löschen`,
    missionDeleteTitle: 'Diese Mission löschen?',
    missionDeleteAction: 'Mission löschen',
    missionDeleteConfirm:
      'Die bereits gesendeten Fotos bleiben im Album: Sie zählen nur nicht mehr für diese Mission.',
    missionAdded: 'Die Mission wurde hinzugefügt.',
    missionSaved: 'Die Mission wurde gespeichert.',
    missionDeleted: 'Die Mission wurde gelöscht.',
    missionAnswered: (photos: number, guests: number) =>
      `${t.count(photos, {
        one: `${t.number(photos)} Foto`,
        other: `${t.number(photos)} Fotos`,
      })}, ${t.count(guests, {
        one: `${t.number(guests)} Gast`,
        other: `${t.number(guests)} Gäste`,
      })}`,
    missionUnanswered: 'Noch nicht erfüllt',
    missionsFull: (max: number) =>
      `Höchstens ${t.number(max)} Missionen: So bleibt die Liste auf zehn Meter lesbar.`,
  },

  auth: {
    title: 'Anmeldung',
    email: 'E-Mail-Adresse',
    password: 'Passwort',
    submit: 'Anmelden',
    submitting: 'Wird angemeldet…',
    logout: 'Abmelden',
    changePassword: 'Passwort ändern',
    currentPassword: 'Aktuelles Passwort',
    newPassword: 'Neues Passwort',
    newPasswordHint: (min: number) =>
      `Mindestens ${min} Zeichen. Ein Satz ist sicherer als ein Wort.`,
    confirmPassword: 'Neues Passwort bestätigen',
    mustChangePassword: 'Wählen Sie ein Passwort, bevor Sie fortfahren.',

    changePasswordIntro: 'Wählen Sie ein Passwort, das Sie nirgendwo sonst verwenden.',
    passwordSaved: 'Passwort gespeichert.',
  },

  mobileModeration: {
    title: 'Moderation am Telefon',
    intro: 'Wischen Sie das Foto nach rechts zum Freigeben, nach links zum Ablehnen.',
    releaseToPublish: 'Loslassen zum Freigeben',
    releaseToReject: 'Loslassen zum Ablehnen',
    nowDeciding: (photo: string) => `Foto zur Moderation. ${photo}`,
    undoLast: 'Letzte Entscheidung rückgängig machen',
    undoUnavailable: 'Nur eine Freigabe lässt sich rückgängig machen.',
  },
}
