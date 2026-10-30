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
    loadFailed: 'Laden nicht möglich',
    retry: 'Erneut versuchen',
    cancel: 'Abbrechen',
    close: 'Schließen',
    save: 'Speichern',
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
    /* Navigation pass, batch A: leaving a wrong event, a code that opens nothing, the way to the organiser area. */
    notYourEvening: 'Das ist nicht Ihre Feier?',
    notOpenHint:
      'Falls Sie einen QR-Code gescannt haben: Die Galerie ist vielleicht noch nicht geöffnet, oder die Feier ist vorbei. Versuchen Sie es gleich noch einmal oder fragen Sie die Veranstalter.',
    organiserLink: 'Bereich für Veranstalter',
  },

  upload: {
    intro: 'Fügen Sie Ihre Fotos hinzu. Sie erscheinen nach der Freigabe auf dem Bildschirm.',
    addPhotos: 'Fotos hinzufügen',
    takePhoto: 'Foto aufnehmen',
    captionLabel: 'Bildunterschrift',
    captionHint: (max: number) => `Maximal ${t.number(max)} Zeichen. Optional.`,
    send: 'Senden',
    sendCount: (count: number) =>
      t.count(count, { one: 'Foto senden', other: `${t.number(count)} Fotos senden` }),
    queueEmpty: 'Noch keine Fotos ausgewählt.',
    itemPending: 'Wartet',
    itemUploading: 'Wird gesendet',
    itemDone: 'Gesendet',
    itemDuplicate: 'Bereits gesendet',
    itemFailed: 'Fehlgeschlagen',
    mine: 'Ihre Beiträge',
    statusPending: 'Wartet auf Freigabe',
    statusPublished: 'Auf dem Bildschirm',
    statusRejected: 'Nicht ausgewählt',
    statusHidden: 'Vom Bildschirm genommen',
    deleteOwn: 'Löschen',
    deleteOwnConfirm: 'Dieses Foto löschen? Das lässt sich nicht rückgängig machen.',
    eraseOpen: 'Alles löschen, was ich gesendet habe',
    eraseTitle: 'Alles löschen?',
    eraseBody:
      'Ihre Fotos, Videos, Bildunterschriften, Reaktionen und Ihr Vorname werden aus der Feier gelöscht: von der Leinwand, aus der Galerie und aus der Liste des Veranstalters. Das lässt sich nicht rückgängig machen.',
    eraseLimits:
      'Eine Kopie, die der Veranstalter bereits gespeichert hat oder die jemand per Screenshot gesichert hat, lässt sich nicht zurückholen.',
    eraseConfirm: 'Ja, alles löschen',
    eraseCancel: 'Nein, behalten',
    eraseFailed:
      'Das Löschen hat nicht geklappt. Versuchen Sie es erneut oder fragen Sie den Veranstalter.',
    eraseDoneTitle: 'Erledigt',
    eraseDone:
      'Alles, was Sie gesendet hatten, wurde aus der Feier gelöscht. Dieses Telefon ist dieser Veranstaltung nicht mehr zugeordnet.',
    eraseLostAccess:
      'Neues Telefon oder Zugang verloren? Bitten Sie den Veranstalter, Ihre Fotos zu löschen: Das kann er in seinem Bereich tun.',
    revokedTitle: 'Ihr Zugang wurde entfernt',
    revokedBody:
      'Der Veranstalter hat Ihren Zugang entfernt: Sie können keine Fotos mehr senden. Sie können aber weiterhin alles löschen, was Sie gesendet haben.',

    itemPreparing: 'Wird vorbereitet…',
    queueLabel: 'Fotos zum Senden',
    queueSummary: (done: number, total: number) =>
      `${t.number(done)} von ${t.number(total)} gesendet`,
    queueFailed: (count: number) =>
      t.count(count, {
        one: 'Ein Foto konnte nicht gesendet werden.',
        other: `${t.number(count)} Fotos konnten nicht gesendet werden.`,
      }),
    /**
     * What the pane says once every photo of the batch has arrived, in one line: how many, and
     * how many of them the event already held. The rows behind it keep each photo's own word.
     * Counted by `t.count`, so the agreement is the language's own, zero included.
     */
    queueDone: (arrived: number, already: number) => {
      if (already > 0 && already === arrived) {
        return t.count(arrived, {
          one: 'Dieses Foto war bereits vorhanden',
          other: `Diese ${t.number(arrived)} Fotos waren bereits vorhanden`,
        })
      }
      const sent = t.count(arrived, {
        one: `${t.number(arrived)} Foto gesendet`,
        other: `${t.number(arrived)} Fotos gesendet`,
      })
      if (already === 0) return sent
      const there = t.count(already, {
        one: `${t.number(already)} war bereits vorhanden`,
        other: `${t.number(already)} waren bereits vorhanden`,
      })
      return `${sent} (${there})`
    },
    queueViewMine: 'Meine Beiträge ansehen',
    queueDetails: 'Details',
    queueDismiss: 'Zusammenfassung ausblenden',
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
    mineFailed:
      'Die Liste Ihrer Beiträge konnte nicht aktualisiert werden. Versuchen Sie es erneut.',
    mineAlt: 'Ihr Foto',
    deleteOwnNumbered: (position: number) => `Foto ${t.number(position)} löschen`,
    notJoinedTitle: 'Treten Sie der Galerie bei, um Ihre Fotos zu senden',
    notJoinedHint: 'Scannen Sie den QR-Code erneut oder geben Sie den Code der Feier ein.',
    notJoinedAction: 'Code eingeben',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    galleryUnavailable:
      'Diese Galerie ist nicht mehr verfügbar. Sie können keine Fotos mehr senden.',
    galleryUnavailableAction: 'Code erneut eingeben',

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
      guestFeed:
        'Die anderen Gäste des Abends, auf ihrem Handy, unter „Fotos des Abends“: Sie sehen das auf dem Bildschirm gezeigte Foto, mit Ihrem Vornamen, falls Sie einen angegeben haben, und seiner Bildunterschrift.',
      organisers:
        'Der Veranstalter und sein Team, die alles sehen, was Sie senden, und die auf dem Bildschirm gezeigten Fotos herunterladen können.',
      sharedGallery:
        'Alle, denen der Veranstalter einen privaten Link zum Album schickt, falls er einen erstellt, und alle, an die dieser Link weitergeleitet wird: Sie können die auf dem Bildschirm gezeigten Fotos in voller Auflösung ansehen und herunterladen, bis der Link abläuft oder zurückgezogen wird.',
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
    noticeErasure: (action: string, section: string) =>
      `Sie können auch alles von Ihrem Telefon aus löschen: „${action}“ unter „${section}“.`,
    clipDoneImmediate: 'Video gesendet. Es erscheint jetzt auf dem Bildschirm.',

    /* ---- Added by guest reactions. ---- */

    reactionKinds: {
      love: 'Liebe',
      laugh: 'Haha',
      wow: 'Wow',
      cheers: 'Prost',
      clap: 'Applaus',
    },
    reactionsGroup: (position: number) => `Auf Foto ${t.number(position)} reagieren`,
    reactionsFailed: 'Die Reaktionen konnten nicht geladen werden.',
  },

  ui: {
    dialogClose: 'Fenster schließen',
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
    /* Navigation pass, batch B: the way home from a 404 or a crash, and the expired-session banner. */
    hostHome: 'Zu Ihren Veranstaltungen',
    sessionExpired: 'Ihre Sitzung ist abgelaufen.',
    sessionExpiredAction: 'Melden Sie sich erneut an',
    crashAutoRetry: 'Ein neuer Versuch startet automatisch in Kürze…',
  },

  errors: {
    'clientName.empty': 'Geben Sie dem Kunden einen Namen.',
    'clientName.tooLong': 'Dieser Name ist zu lang.',
    'clientName.invalid': 'Dieser Name enthält ein nicht zulässiges Zeichen.',
    'clientCeilings.maxEventsInvalid': 'Diese Anzahl von Veranstaltungen wird nicht akzeptiert.',
    'clientCeilings.maxEventsPerPeriodInvalid':
      'Diese Anzahl von Veranstaltungen pro Zeitraum wird nicht akzeptiert.',
    'clientCeilings.maxTotalBytesInvalid': 'Dieser Gesamtspeicher wird nicht akzeptiert.',
    'clientCeilings.maxEventQuotaBytesInvalid': 'Dieses Kontingent wird nicht akzeptiert.',
    'clientCeilings.maxRetentionDaysInvalid':
      'Diese Aufbewahrungsdauer wird nicht akzeptiert: von 1 bis 3.650 Tagen.',
    'clientCeilings.maxLiveDaysInvalid':
      'Diese Live-Dauer wird nicht akzeptiert: von 1 bis 365 Tagen.',
    'clientCeilings.periodStartedAtInvalid': 'Dieser Zeitraumbeginn wird nicht akzeptiert.',
    'clientCeilings.clipsAllowedInvalid': 'Diese Videoeinstellung wird nicht akzeptiert.',
    'clientCeilings.liveAllowedInvalid': 'Diese Öffnungseinstellung wird nicht akzeptiert.',
    'siteLookup.queryInvalid':
      'Geben Sie eine ID, einen Code, eine Adresse oder einen Veranstaltungsnamen ein (höchstens 300 Zeichen).',
    'audit.reasonInvalid':
      'Der Grund muss in eine Zeile mit höchstens 200 Zeichen passen, ohne E-Mail-Adresse.',
    'reset.mailerRequired':
      'Diese Instanz sendet keine E-Mails: Es kann kein Link zum Zurücksetzen ausgestellt werden.',
    'reset.mailNotSent':
      'Der Mailserver hat die Nachricht abgelehnt. Es wurde kein Link ausgestellt.',
    'reset.approverUnavailable':
      'Dieses Konto gehört keinem oder mehreren Kunden: Kein Inhaber kann die Anfrage genehmigen.',
    'reset.requestNotFound': 'Diese Anfrage existiert nicht oder wurde noch nicht genehmigt.',
    'reset.tooManyForAddress':
      'Diese Adresse hat bereits mehrere Zurücksetzungen erhalten. Versuchen Sie es in einer Stunde erneut.',
    'account.disabled': 'Dieses Konto ist deaktiviert.',
    'account.operatorProtected':
      'Das Konto eines Betreibers kann weder deaktiviert noch gelöscht werden.',
    'account.holdsEvents':
      'Dieses Konto besitzt eine Veranstaltung: Übergeben oder löschen Sie sie zuerst.',
    'account.holdsMedia':
      'Dieses Konto hat Fotos oder Videos hochgeladen, deren Dateien auf dem Datenträger blieben.',
    'account.holdsReviews': 'Dieses Konto hat Fotos geprüft, deren Zeilen seinen Namen tragen.',
    'account.lastClientOwner':
      'Dieses Konto ist der einzige Inhaber eines Kunden, der noch Mitglieder oder Veranstaltungen hat: Fügen Sie einen Inhaber hinzu oder beenden Sie die Zusammenarbeit mit dem Kunden.',
    'client.graceInvalid':
      'Diese Frist wird nicht akzeptiert. Geben Sie eine ganze Zahl von Tagen an.',
    'client.offboarding':
      'Die Zusammenarbeit mit diesem Kunden endet gerade: Seine Sperre lässt sich nicht aufheben.',
    unknown: 'Etwas ist schiefgelaufen. Versuchen Sie es gleich noch einmal.',
    network: 'Die Verbindung ist abgebrochen. Prüfen Sie Ihr Netz und versuchen Sie es erneut.',
    'request.invalid': 'Die gesendeten Angaben sind nicht gültig.',

    'auth.invalidCredentials': 'E-Mail-Adresse oder Passwort ist falsch.',
    'auth.required': 'Melden Sie sich an, um fortzufahren.',
    'auth.forbidden': 'Sie haben nicht die Rechte für diese Aktion.',
    'auth.passwordChangeRequired': 'Wählen Sie ein neues Passwort, bevor Sie fortfahren.',
    'auth.invalidToken': 'Dieser Link ist nicht mehr gültig. Fordern Sie einen neuen an.',
    'auth.invalidSecondFactor':
      'Dieser Code ist ungültig. Warten Sie auf den nächsten in Ihrer App oder nutzen Sie einen Wiederherstellungscode.',
    'auth.secondFactorExpired':
      'Diese Anmeldung ist abgelaufen. Beginnen Sie mit dem Passwort neu.',
    'auth.tooManySecondFactorAttempts':
      'Zu viele falsche Codes. Versuchen Sie es in einer Viertelstunde erneut.',
    'auth.secondFactorRequired':
      'Dieses Konto muss zuerst die Bestätigung in zwei Schritten bestehen.',
    'auth.stepUpRequired': 'Bestätigen Sie Ihre Identität, um fortzufahren.',
    'auth.secondFactorAlreadyEnrolled':
      'Die Bestätigung in zwei Schritten ist für dieses Konto bereits aktiv.',
    'auth.noEnrolmentInProgress': 'Es läuft keine Einrichtung. Beginnen Sie neu.',
    'auth.secondFactorUnavailable':
      'Dieser Server kann den Code der App im Moment nicht prüfen. Nutzen Sie einen Wiederherstellungscode.',
    'auth.totpCodeInvalid': 'Geben Sie die sechs Ziffern ein, die die App anzeigt.',
    'auth.secondFactorNotEnrolled':
      'Die Bestätigung in zwei Schritten ist für dieses Konto nicht aktiv.',
    'feature.unavailable': 'Diese Funktion ist auf diesem Server nicht verfügbar.',

    'event.notFound': 'Zu diesem Code gehört keine offene Galerie.',
    'event.notAcceptingUploads': 'Diese Galerie nimmt keine Fotos mehr an.',
    'event.quotaExceeded': 'Die Galerie ist voll. Sagen Sie dem Veranstalter Bescheid.',
    'event.slugUnavailable': 'Diese Adresse ist bereits vergeben.',
    'event.customSlugNotAllowed': 'Diese Instanz erlaubt keine eigene Adresswahl.',
    'event.creationRateLimited':
      'Sie haben zuletzt zu viele Veranstaltungen erstellt. Versuchen Sie es später erneut.',
    'event.quotaAboveCeiling':
      'Dieses Kontingent überschreitet das von diesem Server erlaubte Limit.',
    'event.creationNotAllowed':
      'Mit Ihrem Konto können auf diesem Server keine Veranstaltungen erstellt werden.',
    'client.notFound': 'Dieses Kundenkonto wurde nicht gefunden.',
    'client.ownerRequired': 'Nur ein Inhaber des Kontos kann das einsehen.',
    'client.ceilingReached': 'Ihr Konto hat die zulässige Anzahl an Veranstaltungen erreicht.',
    'client.storageFull': 'Die Galerie ist voll. Sagen Sie dem Veranstalter Bescheid.',
    'client.liveNotAllowed': 'Ihr Konto kann derzeit keine Veranstaltung öffnen.',
    'client.liveWindowOver':
      'Der Öffnungszeitraum dieser Veranstaltung ist abgelaufen: Sie kann nicht mehr erneut geöffnet werden.',
    'client.retentionAboveCeiling': 'Diese Aufbewahrungsdauer ist länger, als Ihr Konto erlaubt.',
    'client.clipsNotAllowed': 'Videos sind für diese Galerie nicht verfügbar.',
    'event.immutable': 'Diese Veranstaltung ist archiviert und kann nicht mehr geändert werden.',
    'event.illegalTransition': 'Dieser Statuswechsel ist nicht möglich.',

    'guest.revoked': 'Der Veranstalter hat Ihren Zugang entzogen.',
    'guestToken.expired': 'Ihr Zugang ist abgelaufen. Scannen Sie den QR-Code erneut.',
    'guestToken.malformed': 'Ihr Zugang ist nicht mehr gültig. Scannen Sie den QR-Code erneut.',
    'guestToken.badSignature': 'Ihr Zugang ist nicht mehr gültig. Scannen Sie den QR-Code erneut.',

    'photo.notFound': 'Dieses Foto gibt es nicht mehr.',
    'photo.illegalTransition': 'Diese Aktion ist bei diesem Foto nicht möglich.',

    'image.unsupportedFormat':
      'Diese Datei ist kein Foto. Zulässige Formate: JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'Dieses Foto scheint beschädigt zu sein. Versuchen Sie es mit einem anderen.',
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
    'invitation.tooManyForAddress':
      'An diese Adresse wurden bereits mehrere Einladungen gesendet. Versuchen Sie es in einer Stunde erneut.',
    'invitation.notFound':
      'Diese Einladung ist nicht mehr gültig. Bitten Sie die Person, die sie geschickt hat, um eine neue.',
    'invitation.signInRequired':
      'Die Adresse dieser Einladung gehört bereits zu einem Konto. Melden Sie sich mit diesem Konto an: Sie kehren dann hierher zurück, um die Einladung anzunehmen.',
    'terms.notAccepted': 'Um fortzufahren, setzen Sie das Häkchen bei den Nutzungsbedingungen.',
    'invitation.wrongAccount':
      'Diese Einladung wurde für eine andere E-Mail-Adresse als die dieses Kontos ausgestellt.',
    'invitation.credentialsRequired':
      'Melden Sie sich mit dem eingeladenen Konto an oder wählen Sie einen Namen und ein Passwort.',
    'accountName.empty': 'Geben Sie Ihren Namen ein.',
    'accountName.tooLong': 'Dieser Name ist zu lang.',

    'displayName.tooLong': 'Vorname zu lang.',
    'joinCode.wrongLength': 'Dieser Code hat nicht die richtige Anzahl an Zeichen.',
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
    'reaction.ownPhoto': 'Sie können nicht auf Ihr eigenes Foto reagieren.',
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
      'Diese Farbe ähnelt den Statusfarben der Anwendung zu sehr. Wählen Sie einen anderen Farbton.',
    'gallery.notAvailable': 'Dieser Link ist nicht mehr verfügbar.',
    'gallery.passwordRequired': 'Dieses Album ist durch ein Passwort geschützt.',
    'gallery.wrongPassword': 'Falsches Passwort.',
    'gallery.tooManyAttempts': 'Zu viele Versuche. Versuchen Sie es in einer Viertelstunde erneut.',
    'gallery.cursorInvalid': 'Die Liste der Fotos hat sich geändert. Laden Sie die Seite neu.',
    'shareLink.lifetimeInvalid': 'Wählen Sie eine Dauer zwischen 1 und 90 Tagen.',

    'upload.busy': 'Es laufen gerade viele Uploads. Versuchen Sie es gleich noch einmal.',
    'storage.boxFull':
      'Es ist kein Speicherplatz mehr frei, um diese Datei zu speichern. Sagen Sie dem Veranstalter Bescheid.',
    /* ---- The host's venue photograph (ADR 0010, decision 8). ---- */
    'venuePhoto.tooLarge': 'Dieses Foto ist auch verkleinert zu groß. Versuchen Sie ein anderes.',
    'venuePhoto.notFound': 'Dieses Foto gibt es nicht mehr.',
    'venuePhoto.saveFailed': 'Das Foto konnte nicht gespeichert werden. Versuchen Sie es erneut.',
  },

  moderation: {
    title: 'Moderation',
    // Navigation pass, batch C: the way to the other console.
    openMobile: 'Telefonversion, Foto für Foto',
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

  /* The guest's view of the evening: the published photographs, with the reactions. */
  feed: {
    title: 'Die Fotos des Abends',
    link: 'Fotos des Abends ansehen',
    back: 'Eigene Fotos senden',
    refresh: 'Aktualisieren',
    more: 'Weitere Fotos anzeigen',
    empty: 'Noch ist kein Foto auf dem Bildschirm.',
    emptyHint: 'Fotos, die die Veranstalter freigegeben haben, erscheinen hier.',
    failed: 'Die Fotos konnten nicht geladen werden. Versuchen Sie es erneut.',
    own: 'Ihr Foto',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    unavailable: 'Diese Galerie wird nicht mehr angezeigt.',
    unavailableHint:
      'Sie ist archiviert oder nicht mehr geöffnet, hier gibt es keine Fotos mehr zu sehen.',
  },

  wall: {
    empty: 'Die ersten Fotos kommen gleich',
    emptyHint: 'Scannen Sie den QR-Code und senden Sie Ihre eigenen Fotos.',
    joinPrompt: 'Treten Sie der Feier bei',
    offline: 'Neue Fotos warten auf das Netzwerk',
    paused: 'Diashow angehalten',

    codeLabel: 'Code der Feier',
    qrTitle: 'QR-Code für den Beitritt zur Feier',
    photoBy: (name: string) => `Foto, gesendet von ${name}`,
    photoByAnonymous: 'Foto, gesendet von einem Gast',
    errorTitle: 'Die Fotos konnten nicht geladen werden',
    errorHint:
      'Es wird erneut versucht. Prüfen Sie das Netz vor Ort, wenn der Bildschirm leer bleibt.',
    notServedTitle: 'Diese Anzeige wartet',
    notServedHint: 'Diese Anzeige schaltet sich von selbst ein, sobald die Feier geöffnet wird.',
    dismissJoinCard: 'Code-Hinweis ausblenden',
    shortcuts: 'Tastenkürzel',
    shortcutsHint:
      'Leertaste hält an, die Pfeiltasten wechseln das Foto, F schaltet auf Vollbild, L wechselt die Anordnung, Q blendet den QR-Code aus oder ein.',
    /* Navigation pass, batch A: how to leave the wall. */
    leaveHint: 'Zum Verlassen: Esc oder F beenden den Vollbildmodus, danach den Tab schließen.',

    /* ---- Before and after the evening (UX review 30/10, MUR-2 to MUR-9). Keep additions inside this block. ---- */
    // The corner card's title: what to do, in a verb a guest reads from ten metres.
    sendPrompt: 'Senden Sie Ihre Fotos auf die Leinwand',
    // Under the code, for the phone that cannot read the QR. Both holes are interpolated as given.
    typeCodeAt: (code: string, host: string) => `oder geben Sie ${code} auf ${host} ein`,
    // An empty wall of an event the host has closed: nobody can send a photo any more.
    emptyClosed: 'Danke fürs Kommen!',
    // In the shortcuts panel, only when the browser could not keep the screen awake itself.
    keepAwakeHint: 'Deaktivieren Sie den Ruhezustand dieses Computers.',

    layoutNames: {
      spotlight: 'Vollbild',
      mosaic: 'Mosaik',
      polaroid: 'Polaroid',
      filmstrip: 'Filmstreifen',
      collage: 'Collage',
      split: 'Nebeneinander',
      clothesline: 'Wäscheleine',
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
    events: 'Ihre Veranstaltungen',
    breadcrumbLabel: 'Brotkrumennavigation',
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
      'Die Wörter auf der Leinwand im Saal: „Treten Sie der Feier bei“, „Missionen“, die Wartemeldungen. Was Sie und Ihre Gäste schreiben — der Name der Veranstaltung, die Bildunterschriften, die Aufgaben — erscheint unverändert und wird nie übersetzt. Ihre Gäste wählen ihre eigene Sprache auf ihrem Telefon; diese Einstellung betrifft sie nicht.',

    theme: 'Erscheinungsbild',
    themeHint:
      'Sichtbar für Ihre Gäste und auf der Leinwand im Saal. Die angebotenen Farben bleiben auf zehn Meter lesbar.',
    themeAccent: 'Farbe',
    themeAccentNames: {
      violet: 'Kraftpapier (Standard)',
      rose: 'Rosa',
      azure: 'Blau',
      teal: 'Türkis',
    },
    themeFonts: 'Schrift',
    themeFontsHint: 'Gilt nur für die Leinwand im Saal.',
    themeFontsNames: {
      sans: 'Redaktionell',
      serif: 'Klassisch',
    },
    themeFrame: 'Fotorahmen',
    themeFrameNames: {
      soft: 'Abgerundete Ecken',
      square: 'Gerade Ecken',
      round: 'Stark abgerundete Ecken',
    },
    themeAmbiance: 'Ambiente',
    themeAmbianceHint:
      'Die Welt, die die Handys Ihrer Gäste, die Leinwand im Saal und die Seiten dieser Veranstaltung in Ihrer Konsole tragen.',
    themeAmbianceNames: {
      eventslide: 'EventSlide',
      guinguette: 'Guinguette',
      riviera: 'Riviera',
      champs: 'Goldene Felder',
      bivouac: 'Biwak',
      cabaret: 'Kabarett',
      noces: 'Hochzeit',
      custom: 'Maßgeschneidert',
    },

    template: 'Art der Veranstaltung',
    templateHint:
      'Ein Ausgangspunkt, passend zur Art des Abends. Alle diese Einstellungen bleiben jederzeit änderbar, vor wie während der Veranstaltung.',
    templateNone: 'Ohne Vorlage',
    templateNoneSummary:
      'Standardeinstellungen: jedes Foto wird freigegeben, bevor es auf den Bildschirm kommt; unbegrenzte Aufbewahrung.',
    templateChanges: 'Diese Vorlage stellt ein:',
    templatePreviewSample: 'Ihre Veranstaltung',
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

    loading: 'Ihre Veranstaltungen werden geladen…',
    eventLoading: 'Die Veranstaltung wird geladen…',
    eventsEmpty: 'Noch keine Veranstaltungen.',
    eventsEmptyHint: 'Drei Schritte, damit am Tag selbst alles bereit ist.',
    emptyStepCreate: 'Legen Sie die Veranstaltung an.',
    emptyStepTest:
      'Testen Sie den Bildschirm im Netzwerk des Veranstaltungsorts, mit einem Telefon, das nicht Ihres ist.',
    emptyStepPrint: 'Drucken Sie den QR-Code aus und legen Sie ihn auf die Tische.',
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
    settingsOwnerOnly: 'Nur der Eigentümer der Veranstaltung kann ihre Einstellungen ändern.',
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
    moderatorEmailHint:
      'Die Person erhält eine Einladung, sieben Tage gültig, nur für diese Veranstaltung.',
    inviteSubmit: 'Einladen',
    /** An invitation went out by e-mail: nothing to copy. */
    moderatorInviteSent: (email: string) => `Eine Einladung wurde an ${email} gesendet.`,
    /** No mail relay, or it refused: the link is for the host to pass on, once. */
    inviteLinkCreated: (email: string) =>
      `Dieser Link wurde nicht per E-Mail versendet. Geben Sie ihn selbst an ${email} weiter: Er ist nur einmal verwendbar und sieben Tage gültig.`,
    inviteLinkUrl: 'Link zum Weitergeben',
    inviteLinkCopy: 'Link kopieren',
    inviteLinkCopied: 'Link kopiert.',
    /** No clipboard (an address that is not secure) or a refusal: the field is selectable. */
    inviteLinkCopyFailed:
      'Kopieren ist hier nicht möglich: Markieren Sie den Link und kopieren Sie ihn selbst.',
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
    shareLink: 'Geteiltes Album',
    shareLinkHint:
      'Ein Link zum Verschicken nach der Feier: die veröffentlichten Fotos, in voller Auflösung zum Herunterladen.',
    shareLinkNone: 'Kein Link ist aktiv.',
    shareLinkActive: (date: string) => `Geöffnet bis ${date}`,
    shareLinkUnavailable:
      'Dieser Link öffnet sich nicht mehr: Er ist abgelaufen, oder die Person, die ihn erstellt hat, organisiert die Veranstaltung nicht mehr.',
    shareLinkProtected: 'Durch ein Passwort geschützt',
    shareLinkUnprotected: 'Ohne Passwort',
    shareLinkLifetime: 'Geöffnet für',
    shareLinkDays: (days: number) =>
      t.count(days, { one: `${t.number(days)} Tag`, other: `${t.number(days)} Tage` }),
    shareLinkPassword: 'Passwort',
    shareLinkPasswordHint: (min: number) =>
      `Mindestens ${t.number(min)} Zeichen. Schicken Sie es getrennt vom Link.`,
    shareLinkCreate: 'Link erstellen',
    shareLinkReplace: 'Durch einen neuen Link ersetzen',
    shareLinkReplaceHint: 'Der aktuelle Link funktioniert dann sofort nicht mehr.',
    shareLinkCreated:
      'Hier ist der Link. Kopieren Sie ihn jetzt: Er wird nicht noch einmal angezeigt.',
    shareLinkUrl: 'Adresse des Links',
    shareLinkCopy: 'Link kopieren',
    shareLinkCopied: 'Link kopiert.',
    // Navigation pass, batch C: a copy that failed, and the link that is never shown again.
    shareLinkCopyFailed:
      'Das Kopieren ist fehlgeschlagen. Die Adresse ist markiert: Kopieren Sie sie mit Strg+C (oder auf dem Telefon mit langem Drücken).',
    shareLinkLeaveWarning:
      'Diese Adresse wird nie wieder angezeigt und Sie haben sie nicht kopiert. Die Seite trotzdem verlassen?',
    shareLinkRevoke: 'Link deaktivieren',
    shareLinkRevokeTitle: 'Diesen Link deaktivieren?',
    shareLinkRevokeHint:
      'Niemand kann das Album mit diesem Link mehr öffnen, auch nicht mit dem Passwort. Sie können einen neuen erstellen.',
    shareLinkRevoked: 'Der Link wurde deaktiviert.',

    /* ---- The host's own photograph of their venue (ADR 0010, decision 8). ---- */
    venuePhoto: 'Foto Ihrer Location',
    venuePhotoHint:
      'Ersetzt das Foto des Ambientes hinter dem Bildschirm Ihrer Gäste und dem im Saal. Es wird verkleinert und von seinen Metadaten befreit, GPS-Position inklusive, und dann abgeschwächt, damit der Text lesbar bleibt.',
    venuePhotoPreviewAlt: 'Vorschau des Fotos Ihrer Location',
    venuePhotoDefault: 'Kein Foto Ihrer Location: Die Stimmung zeigt ihr Standardfoto.',
    venuePhotoChoose: 'Foto auswählen',
    venuePhotoReplace: 'Foto ersetzen',
    venuePhotoRemove: 'Zurück zum Standardfoto',
    venuePhotoBusy: 'Foto wird gesendet…',
    venuePhotoSaved: 'Das Foto Ihrer Location ist gespeichert.',
    venuePhotoRemoved: 'Das Standardfoto ist wieder da.',
    customAmbianceCreate: 'Meine eigene Stimmung erstellen',
    customAmbianceEdit: 'Meine Stimmung bearbeiten',
    customAmbianceEntryHint:
      'Ihr eigener Hintergrund, hell oder dunkel, nach Ihrem Geschmack getönt: Sie sehen ihn vor dem Speichern auf echten Bildschirmen.',
    customAmbianceTitle: 'Ihre eigene Stimmung',
    customAmbianceCrumb: 'Eigene Stimmung',
    customAmbianceIntro:
      'Wählen Sie einen hellen oder dunklen Hintergrund, seine Tönung, Ihre Akzentfarbe und eine Schrift. Die Vorschauen zeigen die echten Bildschirme mit Ihrer Auswahl; gespeichert wird erst mit „Speichern“.',
    customGround: 'Hintergrund',
    customGroundNames: { light: 'Hell', dark: 'Dunkel' },
    customGroundHue: 'Tönung des Hintergrunds',
    customGroundHueHint:
      'Von 0° bis 359°: Sie wählen nur die Tönung, die Helligkeit ist fest, damit alles lesbar bleibt.',
    customAccentHue: 'Akzentfarbe',
    customAccentHueHint:
      'Alle Farbtöne sind erlaubt, auch solche, die an das Grün, Gelb oder Rot der Anwendung erinnern: Die Schrift auf der Schaltfläche bleibt bei jedem lesbar, und eine Warnung trägt immer ein Symbol und ein Wort.',
    customFaces: 'Schrift',
    customFacesHint:
      'Die Schriften und Schaltflächenecken einer der sechs Stimmungen, jede in ihrer eigenen Schrift gezeigt.',
    customPreview: 'Vorschau',
    customPreviewHint:
      'Eine Illustration dessen, was Ihre Gäste und der Saal sehen werden, mit Beispielfotos.',
    customPreviewPhone: 'Bildschirm Ihrer Gäste',
    customPreviewWall: 'Bildschirm im Saal',
    customPreviewCaption: 'Was für ein schöner Abend!',
    customPreviewAuthor: 'Lea',
    customKept:
      'Ihre Auswahl bleibt so, wie Sie sie verlassen haben: ändern Sie sie und speichern Sie erneut.',
    customSaved: 'Ihre Stimmung ist gespeichert.',
  },

  auth: {
    title: 'Anmeldung',
    email: 'E-Mail-Adresse',
    password: 'Passwort',
    submit: 'Anmelden',
    logout: 'Abmelden',
    changePassword: 'Passwort ändern',
    currentPassword: 'Aktuelles Passwort',
    newPassword: 'Neues Passwort',
    newPasswordHint: (min: number) =>
      `Mindestens ${min} Zeichen. Ein Satz ist sicherer als ein Wort.`,
    confirmPassword: 'Neues Passwort bestätigen',

    changePasswordIntro: 'Wählen Sie ein Passwort, das Sie nirgendwo sonst verwenden.',
    passwordSaved: 'Passwort gespeichert.',
    passwordIncorrect: 'Das Passwort ist falsch.',
    deleteAccount: 'Mein Konto löschen',
    deleteAccountIntro:
      'Beim Löschen werden Ihre Adresse, Ihr Passwort und Ihre Zugänge gelöscht. Veranstaltungen, die Ihnen noch gehören, müssen zuerst gelöscht oder an jemand anderen übergeben werden. Höchstens einige Tage lang bleiben bereits geöffnete Sitzungen bestehen, und das Prüfprotokoll behält anonyme Zeilen: eine Kennung, die auf niemanden mehr verweist, ohne Ihren Namen und Ihre Adresse. Das lässt sich nicht rückgängig machen.',
    deleteAccountConfirm: 'Geben Sie zur Bestätigung Ihr Passwort ein.',
    deleteAccountSubmit: 'Mein Konto endgültig löschen',
    deleteAccountDone: 'Ihr Konto wurde gelöscht.',
    deleteAccountCode: 'Code aus Ihrer Authentifizierungs-App',
    deleteAccountCodeHint:
      'Nur ausfüllen, wenn Sie einen zweiten Faktor aktiviert haben; sonst leer lassen.',
    deleteAccountHoldsEvents:
      'Ihnen gehört noch mindestens eine Veranstaltung. Löschen Sie sie oder übergeben Sie sie an jemand anderen und versuchen Sie es dann erneut. Hilfe nötig? Wenden Sie sich an den Betreiber der Seite.',
    deleteAccountHoldsMedia:
      'Sie haben Fotos oder Videos in eine Veranstaltung hochgeladen, daher kann Ihr Konto nicht selbst gelöscht werden. Wenden Sie sich an den Betreiber der Seite.',
    deleteAccountHoldsReviews:
      'Sie haben Fotos moderiert, daher kann Ihr Konto nicht selbst gelöscht werden. Wenden Sie sich an den Betreiber der Seite.',
    deleteAccountLastOwner:
      'Sie sind der einzige Eigentümer Ihres Bereichs, der noch Mitglieder oder Veranstaltungen hat. Fügen Sie einen weiteren Eigentümer hinzu oder wenden Sie sich an den Betreiber der Seite.',

    /* ---- Added by G2-13: the second factor. ---- */
    secondFactorTitle: 'Bestätigung in zwei Schritten',
    secondFactorIntro: 'Geben Sie den sechsstelligen Code ein, den Ihre Authenticator-App anzeigt.',
    secondFactorCode: 'Sechsstelliger Code',
    secondFactorSubmit: 'Prüfen',
    secondFactorRecoveryToggle: 'Wiederherstellungscode verwenden',
    secondFactorAppToggle: 'Code aus der App verwenden',
    secondFactorRecoveryIntro:
      'Geben Sie einen der Wiederherstellungscodes ein, die Sie bei der Aktivierung erhalten haben. Jeder gilt nur einmal.',
    recoveryCode: 'Wiederherstellungscode',
    secondFactorRestart: 'Mit dem Passwort neu beginnen',
    securityTitle: 'Kontosicherheit',
    securityUnavailable:
      'Auf diesem Server ist kein Schlüssel für die Bestätigung in zwei Schritten eingerichtet. Bitten Sie die Administration, ihn zu hinterlegen.',
    setupIntro:
      'Eine Authenticator-App (Aegis, 1Password, Google Authenticator …) erzeugt einen sechsstelligen Code, der zu Ihrem Passwort hinzukommt.',
    setupStart: 'Bestätigung aktivieren',
    setupScan:
      'Scannen Sie diesen QR-Code mit Ihrer App. Ohne Kamera geben Sie den Schlüssel von Hand ein.',
    setupQrLabel: 'QR-Code zur Einrichtung',
    setupKeyLabel: 'Einrichtungsschlüssel',
    setupConfirm: 'Bestätigen',
    recoveryCodesTitle: 'Wiederherstellungscodes',
    recoveryCodesIntro:
      'Wenn Sie Ihr Telefon verlieren, öffnet Ihnen jeder dieser zehn Codes einmal die Tür. Notieren Sie sie jetzt: Sie werden nicht noch einmal angezeigt.',
    recoveryCodesCopy: 'Codes kopieren',
    recoveryCodesCopied: 'Codes kopiert.',
    recoveryCodesSaved: 'Ich habe sie notiert',
    securityEnabled: 'Die Bestätigung in zwei Schritten ist für dieses Konto aktiv.',
    securityManageIntro:
      'Um Ihre Wiederherstellungscodes zu erneuern oder die Bestätigung auszuschalten, bestätigen Sie zuerst Ihre Identität.',
    stepUpSubmit: 'Meine Identität bestätigen',
    stepUpDone: 'Identität für fünf Minuten bestätigt.',
    recoveryCodesRegenerate: 'Neue Wiederherstellungscodes erzeugen',
    secondFactorDisable: 'Bestätigung ausschalten',
    secondFactorDisabled: 'Bestätigung in zwei Schritten ausgeschaltet.',

    /* ---- Added by G2-10: the invitation page, the reset by e-mail and the account menu. ---- */
    invitationTitle: 'Einladung',
    invitationToModerate: (name: string) =>
      `Sie wurden eingeladen, die Veranstaltung „${name}“ zu moderieren.`,
    invitationToOwn: (name: string) =>
      `Sie wurden eingeladen, die Veranstaltungen von „${name}“ zu erstellen und zu verwalten.`,
    invitationToJoin: (name: string) =>
      `Sie wurden eingeladen, dem Team von „${name}“ beizutreten.`,
    invitationExpires: (when: string) => `Gültig bis ${when}.`,
    invitationChoose:
      'Wählen Sie Ihren Namen und ein Passwort: Mit dem Absenden dieses Formulars wird Ihr Konto angelegt.',
    invitationName: 'Ihr Name',
    invitationNameHint: 'Er erscheint in der Liste der Personen mit Zugriff.',
    invitationConfirmPassword: 'Passwort bestätigen',
    invitationSubmit: 'Konto anlegen und annehmen',
    invitationAccepted: 'Einladung angenommen.',
    invitationHaveAccount: 'Sie haben bereits ein Konto?',
    invitationSignedInAs: (email: string) => `Sie sind als ${email} angemeldet.`,
    invitationAcceptAs: 'Mit diesem Konto annehmen',
    invitationUseAnother: 'Anderes Konto verwenden',
    /* ---- Added by G2-20: the terms of use an invitation's acceptance agrees to. ---- */
    invitationAcceptTerms: (version: string) =>
      `Ich akzeptiere die Nutzungsbedingungen (Version ${version}), einschließlich der Klauseln zur Auftragsverarbeitung.`,
    invitationReadTerms: 'Nutzungsbedingungen lesen',
    deadLinkTitle: 'Dieser Link ist ungültig',
    forgotLink: 'Passwort vergessen?',
    forgotTitle: 'Passwort vergessen',
    forgotIntro:
      'Geben Sie die E-Mail-Adresse Ihres Kontos ein. Wenn ein Konto sie verwendet, erhalten Sie einen Link, um ein neues Passwort zu wählen.',
    forgotSubmit: 'Link senden',
    forgotSentTitle: 'Prüfen Sie Ihr Postfach',
    forgotSent:
      'Wenn ein Konto diese Adresse verwendet, wurde soeben eine Nachricht mit einem Link gesendet. Der Link ist eine Stunde gültig und funktioniert nur einmal.',
    forgotUnavailable:
      'Dieser Server kann keine E-Mails senden, daher lässt sich das Passwort hier nicht auf diesem Weg zurücksetzen. Fragen Sie die Person, die ihn betreibt.',
    backToLogin: 'Zurück zur Anmeldung',
    resetTitle: 'Neues Passwort',
    resetIntro:
      'Wählen Sie ein Passwort, das Sie sonst nirgends verwenden. Sie werden auf allen Ihren Geräten abgemeldet.',
    resetSubmit: 'Passwort ändern',
    resetDoneTitle: 'Passwort geändert',
    resetDone: 'Alle Ihre Sitzungen wurden beendet. Melden Sie sich mit Ihrem neuen Passwort an.',
    resetAskAgain: 'Neuen Link anfordern',
    accountMenu: 'Konto',
    accountSignedInAs: (email: string) => `Angemeldet als ${email}`,
    logoutEverywhere: 'Überall abmelden',
    logoutEverywhereTitle: 'Überall abmelden?',
    logoutEverywhereHint:
      'Ihre Sitzung wird auf allen Geräten beendet, auch auf diesem, und Sie müssen sich erneut anmelden. Sinnvoll, wenn Sie ein Gerät verloren oder einen gemeinsam genutzten Computer verwendet haben.',

    /* ---- Navigation pass, batch D: accounts and sign-in. ---- */
    alreadySignedIn: 'Sie sind bereits angemeldet. Weiterleitung …',
    forgotNoMail:
      'Passwort vergessen? Dieser Server versendet keine E-Mails: Bitten Sie die Person, die ihn betreibt, es zurückzusetzen.',
    changePasswordForced:
      'Ihr Passwort wurde für Sie festgelegt: Ersetzen Sie es, bevor Sie weitermachen. Danach geht es dort weiter, wohin Sie wollten.',
    menuMustChange:
      'Ändern Sie zuerst Ihr Passwort: Der Rest der Konsole bleibt bis dahin geschlossen.',
    securityBack: 'Zurück',
    secondFactorEnabled: 'Bestätigung in zwei Schritten aktiviert.',
    recoveryCodesLeaveTitle: 'Verlassen, ohne die Codes notiert zu haben?',
    recoveryCodesLeaveHint:
      'Diese Codes werden nur einmal angezeigt: Wenn Sie die Seite verlassen, können Sie sie nicht mehr lesen. Neue Codes erhalten Sie nur nach erneuter Bestätigung Ihrer Identität.',
    recoveryCodesLeaveStay: 'Bleiben und Codes notieren',
    recoveryCodesLeaveGo: 'Trotzdem verlassen',
    deadInvitationSignIn:
      'Falls Sie sie schon angenommen haben, besteht Ihr Konto bereits: Melden Sie sich an.',
    deadInvitationSignedIn:
      'Sie sind bereits angemeldet: Falls Sie sie mit diesem Konto angenommen haben, finden Sie Ihre Veranstaltungen dort.',
  },

  mobileModeration: {
    title: 'Moderation am Telefon',
    // Navigation pass, batch C: the way to the other console.
    openConsole: 'Vollständige Konsole für den Computer',
    intro: 'Wischen Sie das Foto nach rechts zum Freigeben, nach links zum Ablehnen.',
    releaseToPublish: 'Loslassen zum Freigeben',
    releaseToReject: 'Loslassen zum Ablehnen',
    nowDeciding: (photo: string) => `Foto zur Moderation. ${photo}`,
    undoLast: 'Letzte Entscheidung rückgängig machen',
    undoUnavailable: 'Nur eine Freigabe lässt sich rückgängig machen.',
  },
  gallery: {
    title: 'Geteiltes Album',
    opening: 'Album wird geöffnet…',
    unavailableTitle: 'Dieser Link ist nicht mehr verfügbar',
    unavailableHint:
      'Er ist vielleicht abgelaufen oder wurde deaktiviert. Bitten Sie die Person, die ihn Ihnen geschickt hat, um einen neuen.',
    lockedTitle: 'Geschütztes Album',
    lockedHint: 'Geben Sie das Passwort ein, das Sie mit dem Link erhalten haben.',
    passwordLabel: 'Passwort',
    unlock: 'Album öffnen',
    photoCount: (count: number) =>
      t.count(count, { one: `${t.number(count)} Foto`, other: `${t.number(count)} Fotos` }),
    availableUntil: (date: string) => `Verfügbar bis ${date}`,
    privacyNote: 'Die Fotos werden in voller Auflösung heruntergeladen, ohne ihre Standortdaten.',
    downloadAll: 'Alles herunterladen (.zip)',
    download: 'Original herunterladen',
    downloadClip: 'Video herunterladen',
    openPhoto: (position: number) => `Foto ${t.number(position)} vergrößern`,
    photoAlt: (position: number) => `Foto ${t.number(position)} des Albums`,
    clipBadge: 'Video',
    empty: 'In diesem Album wurde noch kein Foto veröffentlicht.',
    loadMore: 'Weitere Fotos anzeigen',
    viewerTitle: (position: number, total: number) =>
      `Foto ${t.number(position)} von ${t.number(total)}`,
  },
  about: {
    sourceCode: 'Quellcode (AGPL-3.0)',
    opensInNewTab: 'öffnet einen neuen Tab',
    aboutLink: 'Info',
    /* Navigation pass, batch A: a way back from the page. */
    back: 'Zurück',
    home: 'Startseite',

    title: 'Über EventSlide',
    intro:
      'EventSlide ist freie Software: Sie können den Quellcode nach den Bedingungen der Lizenz einsehen, ändern und weitergeben.',
    versionLabel: 'Version',
    licenseLabel: 'Lizenz',
    sourceLabel: 'Quellcode',
    sourceNote: 'Dieser Link führt zum Quellcode der oben angezeigten Version.',
    noticesLabel: 'Lizenzen Dritter',
    noticesLink: 'Hinweise zu den enthaltenen Bibliotheken',
    noticesNote: 'Die Lizenztexte der freien Bibliotheken, die diese Anwendung enthält.',

    supportLink: 'Das Projekt unterstützen',
    supportTitle: 'Das Projekt lebt von Spenden',
    supportIntro: 'EventSlide ist freie Software, kostenlos und werbefrei.',
    supportNoCounterpart: 'Eine Spende schaltet nichts frei: Der Dienst ist für alle derselbe.',
    budgetLink: 'Das öffentliche Budget ansehen',
    supportDismiss: 'Diesen Hinweis ausblenden',

    termsLink: 'Nutzungsbedingungen',
    privacyLink: 'Datenschutzerklärung',
    legalNoticeLink: 'Impressum',
    helpLink: 'Hilfe',
    reportLink: 'Inhalt melden',
    operatorTitle: 'Wer diese Instanz betreibt',
    operatorNameLabel: 'Betreiber',
    operatorContactLabel: 'Kontakt',
    operatorHostedBy: 'Gehostet von',
  },
  clientSpace: {
    bannerLabel: 'Grenzen Ihres Kontos',
    warningTitle: 'Sie nähern sich einer Grenze Ihres Kontos',
    reachedTitle: 'Eine Grenze Ihres Kontos ist erreicht',
    eventsMeter: (used: number, max: number) => `Veranstaltungen: ${used} von ${max}`,
    eventsPerPeriodMeter: (used: number, max: number) =>
      `In diesem Zeitraum angelegte Veranstaltungen: ${used} von ${max}`,
    storageMeter: (used: string, max: string) => `Speicher: ${used} von ${max}`,
    liveNotAllowed: 'Neue Veranstaltungen zu öffnen ist für Ihr Konto ausgesetzt.',
    contactHint: 'Um eine Grenze aufzuheben, wenden Sie sich an Ihren Betreiber.',
    contactAction: 'Betreiber kontaktieren',
    suspendedTitle: 'Ihr Konto ist gesperrt',
    suspendedBody:
      'Ihre Alben bleiben einsehbar und exportierbar. Solange die Sperre dauert, können Sie keine Veranstaltung anlegen, öffnen oder ändern, und das Publikum sieht Ihre Bildschirme nicht mehr.',
    spaceLink: 'Kundenbereich',
    spaceTitle: 'Kundenbereich',
    limitsTitle: 'Grenzen und Nutzung',
    noLimits: 'Ihr Betreiber hat für Ihr Konto keine Grenze festgelegt.',
    // Navigation pass, batch C: an account that belongs to no client.
    noClient: 'Ihr Konto gehört zu keinem Kunden.',
    noClientHint:
      'Hier gibt es also weder Grenzen noch Nutzung einzusehen. Ihre Veranstaltungen finden Sie auf der Seite „Ihre Veranstaltungen“.',
    roleOwner: 'Inhaber',
    roleMember: 'Mitglied',
    pendingTitle: 'Wartet auf Ihre Zustimmung',
    pendingHint:
      'Ihr Betreiber hat diese Personen in Ihr Konto eingeladen. Sie kommen nur mit der Zustimmung eines Inhabers hinein.',
    pendingEmpty: 'Nichts wartet auf Ihre Zustimmung.',
    pendingValidUntil: (date: string) => `Gültig bis ${date}`,
    approve: 'Zustimmen',
    approved: 'Einladung genehmigt.',
    auditTitle: 'Aktionsprotokoll',
    auditHint:
      'Alles, was Ihr Betreiber, das System oder Ihr Team auf Ihrem Konto getan hat, das Neueste zuerst.',
    auditEmpty: 'Bisher wurde keine Aktion aufgezeichnet.',
    auditMore: 'Ältere Aktionen anzeigen',
    actorOperator: 'Betreiber',
    actorMember: 'Ihr Team',
    actorSystem: 'System',
    actorIntegration: 'Integration',
    actionCeilingsChanged: 'Ihre Grenzen wurden geändert.',
    actionPeriodReset: 'Ihr Zeitraum wurde erneuert.',
    actionInvitationIssued: 'Eine Einladung wurde ausgestellt.',
    actionInvitationIssuedPending:
      'Eine Einladung wurde ausgestellt; sie wartet auf Ihre Zustimmung.',
    actionInvitationApproved: 'Eine Einladung wurde genehmigt.',
    actionResetRequested: 'Für ein Mitglied wurde ein Zurücksetzen des Passworts angefordert.',
    actionResetApproved: 'Ein Zurücksetzen des Passworts wurde genehmigt.',
    actionResetMailed: 'Ein Link zum Zurücksetzen wurde an das Mitglied gesendet.',
    actionResetShown: 'Ein Link zum Zurücksetzen wurde dem Betreiber übergeben.',
    actionTermsAccepted:
      'Eine Person hat die Nutzungsbedingungen akzeptiert, indem sie eine Einladung angenommen hat.',
    actionOther: 'Eine Aktion wurde aufgezeichnet.',
    liveWindowEnd: (date: string) => `Das Live-Fenster endet am ${date}.`,
  },

  site: {
    menuLink: 'Betreiber-Konsole',
    consoleTitle: 'Betreiber-Konsole',
    consoleIntro:
      'Sie sehen hier Formen und Größen, nie das, was Ihre Kunden erstellt haben: kein Foto, keinen Namen einer Veranstaltung.',
    navLabel: 'Bereiche der Konsole',
    navClients: 'Kunden',
    navAccounts: 'Konten',
    navAudit: 'Protokoll',
    factorTitle: 'Bestätigung in zwei Schritten erforderlich',
    factorEnrol:
      'Diese Instanz verlangt sie vom Betreiber, und Ihr Konto hat sie noch nicht eingerichtet. Richten Sie sie ein und kehren Sie dann hierher zurück.',
    factorEnrolLink: 'Bestätigung in zwei Schritten einrichten',
    factorSignIn:
      'Diese Anmeldung hat die Bestätigung in zwei Schritten nicht durchlaufen. Melden Sie sich erneut an und geben Sie den Code Ihrer App ein.',
    factorSignOut: 'Erneut anmelden',
    stepUpTitle: 'Bestätigen Sie Ihre Identität',
    stepUpIntro:
      'Diese Aktion ändert eine gemeinsam genutzte Instanz. Geben Sie Ihr Passwort ein, und den Code Ihrer App, falls Sie eine haben: Die Bestätigung gilt fünf Minuten.',
    more: 'Mehr anzeigen',

    clientsTitle: 'Kunden',
    clientsHint:
      'Ein Kunde ist ein Konto, seine Veranstaltungen und seine Grenzen. Sie lesen seine Größen, nie seine Inhalte.',
    newClient: 'Neuer Kunde',
    clientsEmpty: 'Noch kein Kunde.',
    clientsEmptyHint:
      'Eröffnen Sie einen Kunden: Der Inhaber erhält eine Einladung und wählt sein Passwort selbst.',
    clientsTableLabel: 'Die Kunden der Instanz',
    clientColumn: 'Kunde',
    statusColumn: 'Status',
    eventsColumn: 'Veranstaltungen',
    membersColumn: 'Mitglieder',
    storageColumn: 'Speicher',
    createdColumn: 'Eröffnet am',
    statusActive: 'Aktiv',
    statusSuspended: 'Gesperrt',
    statusOffboarding: 'Wird beendet',
    eventsCell: (total: number, live: number) => `${t.number(total)} (${t.number(live)} live)`,
    storageOf: (used: string, max: string) => `${used} von ${max}`,
    noCeiling: 'Keine Grenze',

    newClientTitle: 'Einen Kunden eröffnen',
    newClientIntro:
      'Der Kunde wird ohne Mitglied und ohne Veranstaltung eröffnet, und sein Inhaber wird per E-Mail eingeladen, oder über einen Link, den Sie weitergeben, wenn die Instanz keine E-Mails senden kann. Sie wählen nie sein Passwort.',
    clientName: 'Name des Kunden',
    ownerEmail: 'E-Mail-Adresse des Inhabers',
    inviteLanguage: 'Sprache der Einladung',
    defaultsHint:
      'Die Grenzen sind die, die diese Instanz einem neuen Kunden standardmäßig gibt. Leeren Sie ein Feld, um keine Grenze zu setzen.',
    createClient: 'Kunden eröffnen',
    clientCreated: 'Kunde eröffnet.',

    invitationMailed: (email: string) => `Eine Einladung wurde an ${email} gesendet.`,
    invitationPending:
      'Die Einladung ist geschrieben, gilt aber erst, wenn ein Inhaber des Kunden zustimmt.',
    invitationLinkTitle: 'Es wurde keine E-Mail gesendet',
    invitationLinkBody:
      'Diese Instanz kann keine E-Mails senden, oder der Mailserver hat diese abgelehnt. Dieser Link ist die einzige Kopie: Geben Sie ihn an den Empfänger weiter und schließen Sie dann dieses Feld.',
    invitationLinkLabel: 'Einladungslink',
    copyLink: 'Link kopieren',
    linkCopied: 'Link kopiert.',
    invitationValidUntil: (date: string) => `Gültig bis ${date}.`,

    ceilingsLegend: 'Grenzen',
    maxEvents: 'Veranstaltungen, höchstens',
    maxEventsPerPeriod: 'Veranstaltungen pro Zeitraum, höchstens',
    maxTotalGigabytes: 'Gesamtspeicher in GB',
    maxEventQuotaGigabytes: 'Kontingent einer Veranstaltung in GB',
    maxRetentionDays: 'Aufbewahrung nach dem Ende, in Tagen, höchstens',
    maxLiveDays: 'Dauer einer Live-Veranstaltung, in Tagen, höchstens',
    clipsAllowed: 'Videos erlaubt',
    liveAllowed: 'Öffnen von Veranstaltungen erlaubt',
    renewPeriod: 'Zeitraum jetzt erneuern',
    renewPeriodHint: 'Setzt den Zähler der im Zeitraum erstellten Veranstaltungen auf null.',
    emptyMeansNone: 'Leer: keine Grenze.',
    notANumber: 'Geben Sie eine positive Zahl ein.',

    allClients: 'Alle Kunden',
    memberCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Mitglied`,
        other: `${t.number(count)} Mitglieder`,
      }),
    periodEvents: (count: number) => `Im Zeitraum erstellt: ${t.number(count)}`,
    suspendedSince: (date: string) => `Gesperrt seit ${date}.`,
    purgeOn: (date: string) => `Die Alben werden spätestens am ${date} gelöscht.`,
    suspend: 'Sperren',
    suspendTitle: 'Diesen Kunden sperren?',
    suspendBody:
      'Gäste können seinen Veranstaltungen nicht mehr beitreten und keine Fotos mehr senden, die Öffentlichkeit sieht seine Bildschirme und Galerien nicht mehr, und seine Mitglieder können nichts mehr ändern. Nichts wird gelöscht, und kein Konto wird deaktiviert.',
    suspended: 'Kunde gesperrt.',
    resume: 'Sperre aufheben',
    resumeTitle: 'Sperre aufheben?',
    resumeBody:
      'Die Bildschirme und Galerien des Kunden sind sofort wieder sichtbar, und seine Gäste können wieder beitreten und Fotos senden.',
    resumed: 'Sperre aufgehoben.',
    rename: 'Umbenennen',
    renameTitle: 'Name des Kunden',
    renamed: 'Kunde umbenannt.',
    ceilingsTitle: 'Grenzen',
    ceilingsReason: 'Grund der Änderung',
    ceilingsReasonHint:
      'Ein Satz in einer Zeile, höchstens 200 Zeichen, ohne E-Mail-Adresse. Er steht im Protokoll des Betreibers, der Kunde liest ihn nicht. Nur nichtfinanzielle Gründe: Größe einer Veranstaltung, Kapazität, Missbrauch.',
    ceilingsSave: 'Grenzen speichern',
    ceilingsSaved: 'Grenzen gespeichert.',
    ceilingsUnchanged: 'Keine Grenze hat sich geändert.',
    inviteTitle: 'In diesen Kunden einladen',
    inviteIntro:
      'Eine Person tritt dem Konto des Kunden bei, nie einer Veranstaltung. Hat der Kunde bereits Veranstaltungen oder Mitglieder, muss ein Inhaber die Einladung genehmigen.',
    inviteEmail: 'E-Mail-Adresse',
    inviteRole: 'Rolle',
    inviteSend: 'Einladen',
    roleOwner: 'Inhaber',
    roleMember: 'Mitglied',
    eventsTitle: 'Veranstaltungen',
    eventsHint: 'Nur Formen und Größen: kein Name, keine Adresse, kein Foto.',
    eventsEmpty: 'Dieser Kunde hat keine Veranstaltung.',
    eventsTableLabel: 'Die Veranstaltungen des Kunden',
    eventColumn: 'Veranstaltung',
    eventStatusColumn: 'Status',
    photosColumn: 'Fotos',
    usedColumn: 'Belegter Speicher',
    startsColumn: 'Geplanter Beginn',
    eventLabel: (short: string) => `Veranstaltung ${short}`,
    eventStatuses: {
      draft: 'Entwurf',
      live: 'Live',
      closed: 'Beendet',
      archived: 'Archiviert',
    },
    photoCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto`,
        other: `${t.number(count)} Fotos`,
      }),
    auditLink: 'Protokoll dieses Kunden ansehen',

    accountsTitle: 'Konten',
    accountsHint:
      'Die Adressen der Personen, die ein Konto auf dieser Instanz haben, und sonst nichts: kein Anzeigename, kein Passwort.',
    accountsEmpty: 'Noch kein Konto.',
    accountsTableLabel: 'Die Konten der Instanz',
    addressColumn: 'Adresse',
    roleColumn: 'Rolle auf der Instanz',
    accountStateColumn: 'Status',
    lastLoginColumn: 'Letzte Anmeldung',
    termsColumn: 'Akzeptierte Bedingungen',
    termsNone: 'Kein Nachweis',
    termsAccepted: (version: string, at: string) => `Version ${version}, am ${at}`,
    ownedColumn: 'Eigene Veranstaltungen',
    clientsColumn: 'Kunden',
    siteRoleOperator: 'Betreiber',
    accountActive: 'Aktiv',
    accountDisabled: 'Deaktiviert',
    neverSignedIn: 'Nie',
    mustChange: 'Passwort muss geändert werden',
    resetPassword: 'Passwort zurücksetzen',
    resetTitle: 'Dieses Passwort zurücksetzen?',
    resetBody:
      'Ein Link, der eine Stunde gültig ist, geht an die Adresse des Kontos und nirgendwohin sonst: Sie sehen ihn nur auf einer Instanz, die keine E-Mails sendet.',
    resetSent: 'Der Link wurde an die Adresse des Kontos gesendet.',
    resetPending: 'Wartet auf einen Inhaber',
    resetPendingBody:
      'Diese Instanz sendet keine E-Mails. Ein anderer Inhaber des Kunden muss die Anfrage genehmigen, bevor Ihnen der Link übergeben wird.',
    resetFetch: 'Genehmigten Link abrufen',
    resetLinkTitle: 'Link zum Zurücksetzen',
    resetLinkBody:
      'Er funktioniert nur einmal. Geben Sie ihn an den Kontoinhaber weiter und schließen Sie dann dieses Feld.',

    auditTitle: 'Protokoll',
    auditHint:
      'Alles, was auf der Instanz getan wurde, das Neueste zuerst. Der Grund einer Änderung der Grenzen ist der eigene Satz des Betreibers.',
    auditEmpty: 'Noch keine Aktion aufgezeichnet.',
    auditMore: 'Ältere Aktionen anzeigen',
    auditShowAll: 'Gesamtes Protokoll anzeigen',

    /* ---- Navigation pass, batch D: the console's links and the invitation link. ---- */
    exitsLabel: 'Konsole verlassen',
    accountsLink: 'Alle Konten ansehen',
    noClient: 'Keine',
    auditFilteredFor: (name: string) => `Protokoll des Kunden „${name}“.`,
    auditToClient: 'Diesen Kunden ansehen',
    linkLeaveTitle: 'Verlassen, ohne den Link kopiert zu haben?',
    linkLeaveHint:
      'Es wurde keine E-Mail gesendet: Dieser Link wird nur hier angezeigt, ein einziges Mal. Wenn Sie die Seite verlassen, können Sie ihn nicht mehr kopieren; Sie müssen einen neuen ausstellen.',
    linkLeaveStay: 'Bleiben und Link kopieren',
    linkLeaveGo: 'Trotzdem verlassen',
    auditReason: (reason: string) => `Grund: ${reason}`,
    auditAccount: (short: string) => `Konto ${short}`,
    actors: {
      operator: 'Betreiber',
      member: 'Mitglied',
      system: 'System',
      integration: 'Integration',
    },
    actions: {
      'client.created': 'Kunde eröffnet.',
      'client.renamed': 'Kunde umbenannt.',
      'client.ceilingsChanged': 'Grenzen geändert.',
      'client.periodReset': 'Zeitraum erneuert.',
      'client.suspended': 'Kunde gesperrt.',
      'client.resumed': 'Sperre aufgehoben.',
      'invitation.issued': 'Einladung ausgestellt.',
      'invitation.approved': 'Einladung von einem Inhaber genehmigt.',
      'account.resetRequested': 'Zurücksetzen des Passworts angefordert.',
      'account.resetApproved': 'Zurücksetzen von einem Inhaber genehmigt.',
      'account.resetIssued': 'Zurücksetzen ausgestellt.',
      'account.disabled': 'Konto deaktiviert.',
      'client.offboarded': 'Ende der Zusammenarbeit eingeleitet.',
      'client.finalized': 'Kunde nach dem Ende der Zusammenarbeit gelöscht.',
      'account.enabled': 'Konto reaktiviert.',
      'account.deleted': 'Konto gelöscht.',
      'account.termsAccepted': 'Nutzungsbedingungen akzeptiert.',
      'account.secondFactorEnrolled': 'Bestätigung in zwei Schritten eingerichtet.',
      'account.secondFactorDisabled': 'Bestätigung in zwei Schritten ausgeschaltet.',
      'account.recoveryCodesRegenerated': 'Wiederherstellungscodes erneuert.',
      'account.recoveryCodeUsed': 'Ein Wiederherstellungscode wurde verwendet.',
    },
    actionInvitationIssuedPending:
      'Einladung ausgestellt; sie wartet auf die Zustimmung eines Inhabers.',
    actionOther: 'Eine Aktion wurde aufgezeichnet.',
    accountActionsColumn: 'Aktionen für das Konto',
    disableAccount: 'Deaktivieren',
    enableAccount: 'Reaktivieren',
    deleteAccount: 'Löschen',
    disableTitle: (address: string) => `Konto von ${address} deaktivieren?`,
    disableBody:
      'Alle seine Sitzungen enden sofort, und die Person kann sich nicht mehr anmelden. Nichts wird gelöscht: Beim Reaktivieren bekommt sie den Zugang zurück, muss sich aber neu anmelden.',
    accountDisabledDone: 'Konto deaktiviert.',
    accountEnabledDone: 'Konto reaktiviert.',
    deleteTitle: (address: string) => `Konto von ${address} löschen?`,
    deleteBody:
      'Das beantwortet eine Löschanfrage. Das Konto, seine Zugehörigkeiten, die an es gerichteten Einladungen, sein zweiter Faktor und die von ihm erstellten Freigabelinks verschwinden. Die von ihm geschriebenen Protokollzeilen bleiben, ohne seinen Namen, ebenso die von ihm ausgestellten Einladungen. Seine Adresse bleibt in seinen laufenden Sitzungen (höchstens sieben Tage) und in bereits ausgestellten Links bis zu deren Ablauf. Das lässt sich nicht rückgängig machen.',
    accountDeletedDone: 'Konto gelöscht.',
    offboardTitle: 'Ende der Zusammenarbeit',
    offboardIntro:
      'Live-Veranstaltungen werden beendet, Entwürfe archiviert, der Kunde wird gesperrt, und seine Alben werden spätestens nach der von Ihnen gesetzten Frist gelöscht: So lange hat der Kunde Zeit, zu exportieren, was er behalten will (die Aufbewahrung einer Veranstaltung oder die Grenzen des Kunden können früher löschen). Danach werden die Konten, die nur ihm gehörten und sonst nichts halten, gelöscht, und mit ihnen der Kunde.',
    graceDays: 'Frist bis zur Löschung, in Tagen',
    graceDaysHint: 'Eine ganze Zahl von Tagen: Die Grenzen setzt der Server.',
    offboardAction: 'Zusammenarbeit beenden',
    offboardConfirmTitle: 'Die Zusammenarbeit mit diesem Kunden beenden?',
    offboardConfirmBody: (days: number) =>
      t.count(days, {
        one: `Spätestens in ${t.number(days)} Tag werden die Alben dieses Kunden gelöscht, danach der Kunde mit den Konten, die nur ihm gehörten und sonst nichts halten. Unwiderruflich: Weder das Datum noch die Sperre lassen sich ändern. Bis dahin werden seine Live-Veranstaltungen beendet, seine Entwürfe archiviert und der Kunde gesperrt.`,
        other: `Spätestens in ${t.number(days)} Tagen werden die Alben dieses Kunden gelöscht, danach der Kunde mit den Konten, die nur ihm gehörten und sonst nichts halten. Unwiderruflich: Weder das Datum noch die Sperre lassen sich ändern. Bis dahin werden seine Live-Veranstaltungen beendet, seine Entwürfe archiviert und der Kunde gesperrt.`,
      }),
    offboardedDone: 'Ende der Zusammenarbeit eingeleitet.',
    offboardingRunning:
      'Diese Zusammenarbeit endet: Die Alben werden spätestens an dem oben genannten Datum gelöscht.',
    daysNotWhole: 'Geben Sie eine ganze Zahl von Tagen an.',
    takedownNav: 'Entfernen',
    takedownTitle: 'Entfernen, ohne hinzusehen',
    takedownIntro:
      'Nehmen Sie ein gemeldetes Foto oder eine Veranstaltung anhand ihrer ID offline, ohne sie je zu öffnen: Diese Konsole zeigt weder Vorschaubild noch Bildunterschrift, Gästenamen oder Medienadresse. Jede Handlung verlangt einen Grund, der im Protokoll der Instanz steht und den der Kunde nicht liest. Das Entfernen stoppt die Löschung nicht: Um den Inhalt als Beweis zu behalten, entfernen Sie ihn und sperren dann seine Löschung.',
    takedownEventTitle: 'Eine Veranstaltung',
    takedownEventIntro:
      'Suchen Sie die gemeldete Veranstaltung über ihre Adresse, ihren Beitrittscode oder ihren genauen Namen. Sie sehen von ihr nur die ID und den Zustand.',
    takedownEventLabel: 'Adresse, Code oder genauer Name',
    takedownEventAction: 'Veranstaltung suchen',
    takedownEventNone:
      'Keine Veranstaltung passt. Der Name muss genau stimmen: ein Teil eines Namens genügt nicht.',
    takedownEventHeading: (id: string) => `Veranstaltung ${id}`,
    takedownClient: 'Kunde öffnen',
    takedownNoClient: 'Ohne Kunde',
    takedownStateDown: 'Entfernt',
    takedownStateUp: 'Online',
    takedownStateHeld: 'Löschung gesperrt',
    takedownStateFree: 'Normale Löschung',
    takedownEventDown: 'Veranstaltung entfernen',
    takedownEventUp: 'Wieder online stellen',
    takedownHold: 'Löschung sperren',
    takedownRelease: 'Löschung freigeben',
    takedownPhotoTitle: 'Ein Foto',
    takedownPhotoIntro:
      'Fügen Sie die Foto-ID ein, wie die Meldung sie nennt (der letzte Teil ihrer Adresse vor dem Variantennamen). Sie sehen nur die zugehörige Veranstaltung und den Zustand.',
    takedownPhotoLabel: 'Foto-ID',
    takedownPhotoAction: 'Foto suchen',
    takedownPhotoNone: 'Kein Foto hat diese ID.',
    takedownPhotoHeading: (id: string) => `Foto ${id}`,
    takedownPhotoOf: (id: string) => `In Veranstaltung ${id}`,
    takedownPhotoDown: 'Foto entfernen',
    takedownPhotoUp: 'Foto wiederherstellen',
    takedownReason: 'Grund',
    takedownReasonHint:
      'Ein Satz in einer Zeile, höchstens 200 Zeichen, ohne E-Mail-Adresse. Er wird im Protokoll der Instanz festgehalten.',
    takedownUnknown:
      'Zustand unbekannt: Die Handlung ist möglicherweise erfolgt, suchen Sie erneut, um es zu erfahren.',
    takedownDone: 'Erledigt.',
    takedownOps: {
      eventDown: {
        title: 'Diese Veranstaltung entfernen?',
        body: 'Die Wand, der Gästefeed, der Galerielink und die Konsole des Gastgebers antworten, als gäbe es die Veranstaltung nicht, und offene Bildschirme schließen sich. Nichts wird gelöscht. Die Aufbewahrung läuft weiter: Um den Inhalt als Beweis zu behalten, sperren Sie auch seine Löschung.',
        confirm: 'Veranstaltung entfernen',
      },
      eventUp: {
        title: 'Diese Veranstaltung wieder online stellen?',
        body: 'Wand, Gäste, Galerie und Gastgeber bekommen sie so zurück, wie sie war.',
        confirm: 'Wieder online stellen',
      },
      purgeHold: {
        title: 'Die Löschung dieser Veranstaltung sperren?',
        body: 'Die Aufbewahrungsroutine überspringt sie, und weder der Gastgeber noch ein Gast kann die Veranstaltung oder ein Foto mehr löschen. Nichts wird verborgen: Die Sperre ist im Saal nicht zu sehen. Sicherungen werden nicht gesperrt.',
        confirm: 'Löschung sperren',
      },
      purgeRelease: {
        title: 'Die Löschung dieser Veranstaltung freigeben?',
        body: 'Die Veranstaltung wird zu ihrem eigenen Termin wieder löschbar, der schon vorbei sein kann: Der nächste Durchlauf löscht sie dann.',
        confirm: 'Löschung freigeben',
      },
      photoDown: {
        title: 'Dieses Foto entfernen?',
        body: 'Es verschwindet sofort von der Wand, aus dem Gästefeed, vom Galerielink und von den Bildschirmen des Gastgebers, und offene Bildschirme vergessen es. Die Datei bleibt erhalten. Der Gastgeber kann es nicht zurückholen.',
        confirm: 'Foto entfernen',
      },
      photoUp: {
        title: 'Dieses Foto wiederherstellen?',
        body: 'Es erscheint wieder mit dem Status, den der Gastgeber ihm gegeben hatte.',
        confirm: 'Foto wiederherstellen',
      },
    },
  },

  titles: {
    join: 'Der Galerie beitreten',
    upload: 'Fotos senden',
    feed: 'Fotos des Abends',
    wall: 'Bildschirm der Veranstaltung',
    gallery: 'Geteiltes Album',
    about: 'Info',
    notFound: 'Seite nicht gefunden',
    login: 'Anmeldung',
    forgotPassword: 'Passwort vergessen',
    resetPassword: 'Neues Passwort',
    invitation: 'Einladung',
    changePassword: 'Passwort ändern',
    security: 'Kontosicherheit',
    deleteAccount: 'Mein Konto löschen',
    dashboard: 'Ihre Veranstaltungen',
    newEvent: 'Neue Veranstaltung',
    event: 'Veranstaltung',
    moderation: 'Moderation',
    mobileModeration: 'Moderation am Telefon',
    settings: 'Einstellungen der Veranstaltung',
    customAmbiance: 'Eigene Stimmung',
    clientSpace: 'Kundenbereich',
    site: 'Betreiber-Konsole',
    siteClient: 'Kunde',
    siteAccounts: 'Konten der Instanz',
    siteAudit: 'Protokoll der Instanz',
    siteTakedown: 'Inhalt entfernen',
  },
}
