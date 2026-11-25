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
    title: 'Der Feier beitreten',
    codeLabel: 'Code der Feier',
    codeHint: 'Sechs Zeichen, sie stehen auf der Karte oder beim QR-Code.',
    nameLabel: 'Ihr Vorname',
    nameHint: 'Er erscheint unter Ihren Fotos. Sie können das Feld auch leer lassen.',
    submit: 'Beitreten',
    submitting: 'Wird verbunden…',
    welcome: (eventName: string) => `Willkommen bei ${eventName}`,
    logoAlt: (eventName: string) => `Logo von ${eventName}`,
    anonymous: 'Anonym bleiben',
    /* Navigation pass, batch A: leaving a wrong event, a code that opens nothing, the way to the organiser area. */
    notYourEvening: 'Das ist nicht Ihre Feier?',
    notOpenHint:
      'Falls Sie einen QR-Code gescannt haben: Die Feier ist vielleicht noch nicht geöffnet oder schon vorbei. Versuchen Sie es gleich noch einmal oder fragen Sie die Veranstalter.',
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
    foldPane: 'Einklappen',
    openPane: 'Foto senden',
    openPaneReady: (count: number) =>
      t.count(count, {
        one: 'Bereich öffnen: 1 Foto bereit',
        other: `Bereich öffnen: ${t.number(count)} Fotos bereit`,
      }),
    itemPending: 'Bereit',
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
      'Ihre Fotos, Videos, Bildunterschriften, Reaktionen und Ihr Vorname werden aus der Feier gelöscht: von der Leinwand, aus dem Album und aus der Liste des Veranstalters. Das lässt sich nicht rückgängig machen.',
    eraseLimits:
      'Eine Kopie, die der Veranstalter oder ein anderer Gast bereits gespeichert hat oder die jemand per Screenshot gesichert hat, lässt sich nicht zurückholen.',
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
    /* "Levez les yeux" (UX review 2026-10-30): a photo of the guest's goes from waiting to on the wall. */
    photoDeveloped: 'Freigegeben! Es erscheint gleich auf der Leinwand: Blick nach oben.',
    photoDevelopedAway: 'Es war auf der Leinwand zu sehen.',
    deleteOwnNumbered: (position: number) => `Foto ${t.number(position)} löschen`,
    notJoinedTitle: 'Treten Sie der Feier bei, um Ihre Fotos zu senden',
    notJoinedHint: 'Scannen Sie den QR-Code erneut oder geben Sie den Code der Feier ein.',
    notJoinedAction: 'Code eingeben',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    galleryUnavailable: 'Diese Feier ist nicht mehr verfügbar. Sie können keine Fotos mehr senden.',
    galleryUnavailableAction: 'Code erneut eingeben',

    missionsTitle: 'Missionen',
    missionsHint: 'Tippen Sie auf eine Mission und senden Sie dann Ihr Foto.',
    missionDone: 'Erledigt',
    missionDoneByRoom: 'Schon fotografiert',
    missionFor: (prompt: string) => `Diese Fotos zählen für „${prompt}“.`,

    itemQueued: 'Wird gesendet, sobald das Netz wieder da ist',
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

    /* Guest traps and end-of-evening pass (revue UX 30/10: INV-1, 4, 7, 8). */
    offlineHintNoSync:
      'Sie sind auf Ihrem Telefon gespeichert und werden gesendet, sobald die Verbindung wieder da ist. Lassen Sie diese Seite bis dahin geöffnet.',
    queueReady: (count: number) =>
      t.count(count, {
        one: 'Ein Foto ist bereit: Tippen Sie auf „Senden“.',
        other: `${t.number(count)} Fotos sind bereit: Tippen Sie auf „Senden“.`,
      }),
    leaveWaitCount: (done: number, total: number) =>
      `Bitte warten, Senden läuft (${t.number(done)}/${t.number(total)})`,
    leaveWait: 'Bitte warten, Senden läuft…',
    endedTitle: 'Für heute Abend ist Schluss.',
    endedThanks: (count: number) =>
      t.count(count, {
        one: 'Danke für Ihr Foto!',
        other: `Danke für Ihre ${t.number(count)} Fotos!`,
      }),
    endedThanksNone: 'Danke, dass Sie dabei waren!',
    endedAlbum: 'Die Veranstalter teilen das Album.',

    installTitle: 'Die Feier immer griffbereit',
    installHint:
      'Fügen Sie sie zu Ihrem Startbildschirm hinzu, um die Feier später wiederzufinden, ohne den QR-Code zu suchen.',
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
    /**
     * The trim screen (spec 16), opened in place of a "too long" refusal. Nothing on it
     * can be wrong: the handles keep the range valid, so there is no error sentence here.
     */
    clipTrimTitle: (seconds: number) =>
      `Wählen Sie die ${t.number(seconds)} Sekunden, die bleiben sollen`,
    clipTrimStart: 'Anfang des Ausschnitts',
    clipTrimEnd: 'Ende des Ausschnitts',
    clipTrimValue: (seconds: number) => `${t.number(seconds)} Sekunden`,
    clipTrimSummary: (seconds: number, maxSeconds: number) =>
      `Ausschnitt: ${t.number(seconds)} s von höchstens ${t.number(maxSeconds)} s`,
    clipTrimPlay: 'Ausschnitt abspielen',
    clipTrimPause: 'Ausschnitt anhalten',
    clipTrimNoPreview: 'Keine Vorschau auf diesem Gerät. Der Ausschnitt wird trotzdem geschnitten.',
    clipTrimWholeFileSent:
      'Das ganze Video wird gesendet; nur der gewählte Ausschnitt wird behalten.',
    clipSendTrimmed: 'Diesen Ausschnitt senden',
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
    mineMission: (prompt: string) => `Mission: ${prompt}`,
    mineChallenge: 'Challenge',
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
    /** Said after the audiences, only on an evening where saving is on (spec 24). */
    noticeGuestSave:
      'Die anderen Gäste können Ihr Foto auf ihrem Handy speichern, ohne Ort und ohne Angabe der Kamera. Eine gespeicherte Kopie lässt sich nicht zurückholen.',
    noticeRetentionDays: (days: number) =>
      t.count(days, {
        one: `Die Fotos werden ${t.number(days)} Tag, nachdem der Veranstalter die Feier beendet hat, automatisch gelöscht.`,
        other: `Die Fotos werden ${t.number(days)} Tage, nachdem der Veranstalter die Feier beendet hat, automatisch gelöscht.`,
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
    tourStep: (step: number, total: number) => `Schritt ${step} von ${total}`,
    tourNext: 'Weiter',
    tourPrevious: 'Zurück',
    tourSkip: 'Überspringen',
    tourFinish: 'Fertig',
    tourLater: 'Später',
    tourStart: 'Rundgang starten',
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
      'Diese Dauer einer laufenden Veranstaltung wird nicht akzeptiert: von 1 bis 365 Tagen.',
    'clientCeilings.periodStartedAtInvalid': 'Dieser Zeitraumbeginn wird nicht akzeptiert.',
    'clientCeilings.clipsAllowedInvalid': 'Diese Videoeinstellung wird nicht akzeptiert.',
    'clientCeilings.channelsAllowedInvalid': 'Diese Messenger-Einstellung wird nicht akzeptiert.',
    'clientCeilings.booksAllowedInvalid': 'Diese Fotobuch-Einstellung wird nicht akzeptiert.',
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

    'event.notFound': 'Zu diesem Code gehört keine offene Feier.',
    'event.notAcceptingUploads': 'Diese Feier nimmt keine Fotos mehr an.',
    'event.quotaExceeded':
      'Der Speicher dieser Feier ist voll. Sagen Sie dem Veranstalter Bescheid.',
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
    'client.storageFull':
      'Der Speicher dieser Feier ist voll. Sagen Sie dem Veranstalter Bescheid.',
    'client.liveNotAllowed': 'Ihr Konto kann derzeit keine Veranstaltung öffnen.',
    'client.liveWindowOver':
      'Der Öffnungszeitraum dieser Veranstaltung ist abgelaufen: Sie kann nicht mehr erneut geöffnet werden.',
    'client.retentionAboveCeiling': 'Diese Aufbewahrungsdauer ist länger, als Ihr Konto erlaubt.',
    'client.clipsNotAllowed': 'Videos sind für diese Feier nicht verfügbar.',
    'event.immutable': 'Diese Veranstaltung ist archiviert und kann nicht mehr geändert werden.',
    'event.illegalTransition': 'Dieser Statuswechsel ist nicht möglich.',

    'guest.revoked': 'Der Veranstalter hat Ihren Zugang entzogen.',
    'guestToken.expired': 'Ihr Zugang ist abgelaufen. Scannen Sie den QR-Code erneut.',
    'guestToken.malformed': 'Ihr Zugang ist nicht mehr gültig. Scannen Sie den QR-Code erneut.',
    'guestToken.badSignature': 'Ihr Zugang ist nicht mehr gültig. Scannen Sie den QR-Code erneut.',

    'photo.notFound': 'Dieses Foto gibt es nicht mehr.',
    'photo.illegalTransition': 'Diese Aktion ist bei diesem Foto nicht möglich.',
    'highlight.notPublished': 'Nur ein veröffentlichtes Foto kann ein Favorit sein.',
    'highlight.empty': 'Noch keine Favoriten.',
    'book.alreadyRunning': 'Ein Fotobuch wird bereits vorbereitet.',
    'book.empty': 'Noch kein veröffentlichtes Foto: Es gibt kein Fotobuch zu erstellen.',
    'book.dailyLimitReached':
      'Sie haben das Tageslimit für Fotobücher erreicht. Versuchen Sie es morgen wieder.',
    'book.unavailable': 'Fotobücher sind im Moment nicht verfügbar.',
    'book.notAllowed': 'Ihr Bereich enthält keine Fotobücher.',
    'book.notFound': 'Dieses Fotobuch ist nicht mehr verfügbar. Erstellen Sie es neu.',
    'book.titleEmpty': 'Geben Sie dem Fotobuch einen Titel.',
    'book.titleTooLong': 'Dieser Titel ist zu lang.',
    'book.subtitleTooLong': 'Dieser Untertitel ist zu lang.',
    'export.alreadyRunning': 'Ein Archiv wird bereits vorbereitet.',
    'export.notClosed': 'Das Archiv lässt sich vorbereiten, sobald die Veranstaltung beendet ist.',
    'export.noRoom':
      'Der Server hat nicht genug Platz, um das Archiv vorzubereiten. Laden Sie das Album direkt herunter oder informieren Sie den Betreiber.',
    'export.tooLarge':
      'Das Archiv wäre größer, als der Server vorzubereiten bereit ist. Laden Sie das Album direkt herunter.',
    'export.dailyLimitReached':
      'Die Tagesgrenze für Archive dieser Veranstaltung ist erreicht. Versuchen Sie es morgen erneut oder laden Sie das Album direkt herunter.',
    'export.unavailable':
      'Die Archivvorbereitung ist auf diesem Server abgeschaltet. Laden Sie das Album direkt herunter.',
    'export.notFound': 'Dieses Archiv ist nicht mehr verfügbar. Bereiten Sie es neu vor.',
    'reel.notEnoughPhotos': 'Für ein Video braucht es mindestens drei veröffentlichte Favoriten.',
    'reel.tooManyPhotos': 'Zu viele Favoriten für ein Video: Entfernen Sie einige.',
    'reel.alreadyRunning': 'Ein Video wird bereits erstellt.',
    'reel.queueFull': 'Viele Videos warten. Versuchen Sie es in einigen Minuten erneut.',
    'reel.notAllowed': 'Das Highlight-Video ist nicht in Ihrem Tarif enthalten.',
    'reel.transcoderUnavailable': 'Das Highlight-Video ist auf diesem Server nicht verfügbar.',
    'reel.notReady': 'Das Video ist nicht fertig.',
    'reel.eventUnavailable': 'Dieses Event ist nicht mehr verfügbar.',
    'reel.renderFailed': 'Das Video konnte nicht erstellt werden. Versuchen Sie es erneut.',
    'reel.storageFailed': 'Das Video konnte nicht gespeichert werden. Versuchen Sie es erneut.',
    'reel.timedOut': 'Das Video hat zu lange gedauert. Versuchen Sie es erneut.',
    'reel.cancelled': 'Das Video wurde unterbrochen. Versuchen Sie es erneut.',

    'image.unsupportedFormat':
      'Diese Datei ist kein Foto. Zulässige Formate: JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'Dieses Foto scheint beschädigt zu sein. Versuchen Sie es mit einem anderen.',
    'image.animated': 'Animierte Bilder werden nicht angenommen.',
    'image.renderFailed':
      'Dieses Foto konnte nicht verarbeitet werden. Versuchen Sie es mit einem anderen.',
    'image.renderUnavailable':
      'Dieses Foto konnte gerade nicht verarbeitet werden: Der Server ist vorübergehend nicht verfügbar. Versuchen Sie es gleich noch einmal.',
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
    'logo.tooLarge': 'Dieses Logo ist auch verkleinert zu schwer. Versuchen Sie ein anderes.',
    'logo.notFound': 'Dieses Logo gibt es nicht mehr.',
    'logo.saveFailed': 'Das Logo konnte nicht gespeichert werden. Versuchen Sie es erneut.',
    'eventSettings.welcomeInvalid': 'Diese Nachricht ist nicht gültig.',
    'eventSettings.welcomeTooLong': 'Diese Nachricht ist zu lang.',
    'eventSettings.welcomeTooManyLines': 'Diese Nachricht hat zu viele Zeilen.',
    'eventSettings.saveFailed':
      'Die Einstellungen konnten nicht gespeichert werden. Versuchen Sie es erneut.',
    'eventSettings.revealInPast': 'Die Enthüllung muss in der Zukunft liegen.',
    'eventSettings.revealDone':
      'Der Abend ist bereits enthüllt: die Uhrzeit lässt sich nicht mehr verschieben oder löschen.',
    'eventSettings.revealInstantInvalid': 'Diese Uhrzeit für die Enthüllung ist ungültig.',
    'eventSettings.graceSecondsInvalid': 'Diese Löschfrist ist nicht zulässig.',
    'eventSettings.retentionDaysInvalid': 'Diese Aufbewahrungsdauer ist nicht zulässig.',
    'eventSettings.maxPhotosPerGuestInvalid': 'Diese Anzahl an Fotos pro Gast ist nicht zulässig.',
    'wallMixed.wallTooShort':
      'Die Zeit auf der Wand muss zwischen 30 Sekunden und 60 Minuten liegen.',
    'wallMixed.wallTooLong':
      'Die Zeit auf der Wand muss zwischen 30 Sekunden und 60 Minuten liegen.',
    'wallMixed.slideshowTooShort':
      'Die Zeit der Diashow muss zwischen 15 Sekunden und 30 Minuten liegen.',
    'wallMixed.slideshowTooLong':
      'Die Zeit der Diashow muss zwischen 15 Sekunden und 30 Minuten liegen.',
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

    'event.captionsNotAllowed': 'Bildunterschriften sind für diese Feier nicht aktiviert.',
    'event.reactionsDisabled': 'Reaktionen sind für diese Feier nicht aktiviert.',
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

    'event.scheduleOutOfOrder': 'Das Ende muss nach der Öffnung liegen.',
    'event.scheduleInPast':
      'Dieser Zeitpunkt ist bereits vorbei. Prüfen Sie das Datum: Für das Ende des Abends wählen Sie den nächsten Tag.',
    'event.scheduleInvalid': 'Diese Datumsangaben sind nicht lesbar. Wählen Sie sie erneut.',

    'event.clipsNotAllowed': 'Videos sind für diese Feier nicht aktiviert.',
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
    'clip.trimInvalid': 'Dieser Ausschnitt ist nicht gültig. Wählen Sie einen anderen.',
    'clip.trimOutOfRange':
      'Der gewählte Ausschnitt reicht über das Ende des Videos hinaus. Wählen Sie einen anderen.',
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
    'challenge.alreadyRunning':
      'Es läuft bereits eine Challenge. Stoppen Sie sie, bevor Sie eine neue starten.',
    'challenge.limit': 'Diese Veranstaltung hat die zulässige Anzahl an Challenges erreicht.',
    'challenge.eventNotOpen':
      'Eine Challenge kann nur starten, solange die Veranstaltung geöffnet ist.',
    'challenge.durationInvalid': 'Diese Dauer ist nicht gültig.',
    'announcement.textInvalid': 'Schreiben Sie den Text der Ansage (höchstens 80 Zeichen).',
    'announcement.atInvalid': 'Diese Uhrzeit ist schon vorbei. Nutzen Sie „Jetzt starten“.',
    'announcement.kindInvalid': 'Diese Art der Ansage ist nicht gültig.',
    'announcement.durationInvalid': 'Diese Dauer ist für diese Art der Ansage nicht gültig.',
    'announcement.countdownInvalid': 'Dieser Countdown ist für diese Art der Ansage nicht gültig.',
    'announcement.notFound': 'Diese Ansage gibt es nicht mehr. Laden Sie die Seite neu.',
    'announcement.overlap': 'Zu dieser Zeit ist schon eine andere Ansage geplant.',
    'announcement.showing': 'Es ist schon eine Ansage auf dem Bildschirm.',
    'announcement.locked':
      'Diese Ansage ist auf dem Bildschirm: Nehmen Sie sie herunter, um sie zu korrigieren.',
    'announcement.limit': 'Sie haben 50 Ansagen erreicht. Löschen Sie einige.',
    'announcement.eventNotOpen': 'Die Feier ist nicht geöffnet: Die Ansage wird nicht gezeigt.',

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
    /* ---- Added by spec 29: the host's invitation form. ---- */
    'guestInvite.titleTooLong': 'Dieser Titel ist zu lang: höchstens 80 Zeichen.',
    'guestInvite.titleInvalid': 'Dieser Titel ist ungültig.',
    'guestInvite.venueTooLong': 'Dieser Ortsname ist zu lang: höchstens 80 Zeichen.',
    'guestInvite.venueInvalid': 'Dieser Ortsname ist ungültig.',
    'guestInvite.addressTooLong': 'Diese Adresse ist zu lang: höchstens 160 Zeichen.',
    'guestInvite.addressTooManyLines': 'Die Adresse darf höchstens zwei Zeilen haben.',
    'guestInvite.addressInvalid': 'Diese Adresse ist ungültig.',
    'guestInvite.messageTooLong': 'Ihre Nachricht ist zu lang: höchstens 500 Zeichen.',
    'guestInvite.messageTooManyLines': 'Ihre Nachricht darf höchstens acht Zeilen haben.',
    'guestInvite.messageInvalid': 'Diese Nachricht ist ungültig.',
    'guestInvite.startsAtInvalid': 'Dieses Startdatum ist ungültig.',
    'guestInvite.endsAtInvalid': 'Dieses Enddatum ist ungültig.',
    'guestInvite.endBeforeStart': 'Das Ende muss nach dem Beginn liegen.',
    'guestInvite.tooLong': 'Das Ende muss innerhalb von 7 Tagen nach dem Beginn liegen.',
    'guestInvite.endNeedsStart': 'Fügen Sie einen Beginn vor dem Ende hinzu.',
    'guestInvite.badTimeZone': 'Diese Zeitzone wird nicht erkannt.',
    'guestInvite.timeZoneRequired': 'Wählen Sie die Zeitzone der Feier.',
    'guestInvite.languageInvalid': 'Diese Sprache wird nicht angeboten.',
    'guestInvite.needsDate': 'Fügen Sie das Startdatum hinzu, bevor Sie die Einladung aktivieren.',
    'guestInvite.eventArchived':
      'Die Veranstaltung ist archiviert: Die Einladung kann sich nicht mehr ändern.',
    'rsvp.notFound': 'Diese Antwort gibt es nicht mehr.',
    'rsvp.closed': 'Die Antworten sind geschlossen.',
    'rsvp.off': 'Die Gastgeber bitten derzeit nicht um Antworten.',
    'rsvp.tooMany': 'Diese Einladung hat die Höchstzahl an Antworten erreicht.',
    'rsvp.inviteRequired': 'Speichere zuerst die Einladung.',
    'rsvp.nameEmpty': 'Gib deinen Vor- und Nachnamen an.',
    'rsvp.nameInvalid': 'Dieser Name ist nicht gültig.',
    'rsvp.nameTooLong': 'Dieser Name ist zu lang: höchstens 60 Zeichen.',
    'rsvp.answerInvalid': 'Wähle eine Antwort.',
    'rsvp.maybeNotOffered': '„Vielleicht“ wird für diese Feier nicht angeboten.',
    'rsvp.adultsRequired': 'Es braucht mindestens eine erwachsene Person.',
    'rsvp.partyTooBig': 'Ihr seid zu viele für dieses Formular.',
    'rsvp.countInvalid': 'Diese Personenzahl ist nicht gültig.',
    'rsvp.dietInvalid': 'Dieser Text ist nicht gültig.',
    'rsvp.dietTooLong': 'Dieser Text ist zu lang: höchstens 120 Zeichen.',
    'rsvp.messageInvalid': 'Dieses Wort ist nicht gültig.',
    'rsvp.messageTooLong': 'Dieses Wort ist zu lang: höchstens 280 Zeichen.',
    'rsvp.messageTooManyLines': 'Dieses Wort passt auf höchstens vier Zeilen.',
    'rsvp.enabledInvalid': 'Diese Einstellung ist nicht gültig.',
    'rsvp.deadlineInvalid': 'Diese Frist ist nicht gültig.',
    'rsvp.deadlineNeedsDate': 'Füge zuerst das Startdatum der Einladung hinzu.',
    'rsvp.deadlineAfterStart': 'Die Frist darf nicht nach dem Tag der Feier liegen.',
    'rsvp.formInvalid': 'Diese Formulareinstellung ist nicht gültig.',
    'rsvp.partyMaxInvalid': 'Die Personenzahl reicht von 1 bis 10.',
    'rsvp.companionsInvalid': 'Diese Vornamen sind ungültig.',
    'rsvp.companionTooLong': 'Ein Vorname ist zu lang: höchstens 40 Zeichen.',
    'rsvp.companionsTooMany': 'Es sind zu viele Vornamen für die Personenzahl.',
    'rsvp.mealsInvalid': 'Diese Menüs sind ungültig: 2 bis 6 Menüs, alle verschieden.',
    'rsvp.mealsTooMany': 'Es gibt mehr Menüs als Personen.',
    'rsvp.mealNotOffered':
      'Die Menüs haben sich geändert: Die Seite wurde gerade aktualisiert. Bitte wählen Sie erneut.',
    'rsvp.answersInvalid': 'Diese Antworten sind ungültig.',
    'rsvp.answerTooLong': 'Eine Antwort ist zu lang: höchstens 120 Zeichen.',
    'rsvp.answerNotAnOption':
      'Die Auswahl hat sich geändert: Die Seite wurde gerade aktualisiert. Bitte wählen Sie erneut.',
    'rsvp.questionsInvalid':
      'Diese Fragen sind ungültig: höchstens drei, und 2 bis 6 Auswahlmöglichkeiten bei einer Auswahlfrage.',
    'rsvp.momentsInvalid': 'Diese Programmpunkte sind ungültig: höchstens vier, alle verschieden.',
    'rsvp.momentsRequired': 'Wähle mindestens einen Programmpunkt.',
    'household.momentsInvalid': 'Diese Programmpunkte sind für diesen Haushalt ungültig.',
    'rsvp.capacityInvalid': 'Die Platzzahl geht von 1 bis 2000.',
    'rsvp.full':
      'Für diese Zahl sind nicht genug Plätze übrig: Verringere sie oder sprich die Gastgeber an.',
    'household.nameEmpty': 'Geben Sie einen Namen für den Haushalt an.',
    'household.nameInvalid': 'Dieser Haushaltsname ist nicht gültig.',
    'household.nameTooLong': 'Dieser Name ist zu lang: höchstens 80 Zeichen.',
    'household.placesInvalid': 'Die Anzahl der Plätze reicht von 1 bis 10.',
    'household.placesExceeded': 'Diese Antwort zählt mehr Personen, als der Haushalt Plätze hat.',
    'household.tooMany': 'Die Liste ist voll: höchstens 500 Haushalte.',
    'household.notFound': 'Dieser Haushalt existiert nicht mehr.',
    'household.alreadyAnswered': 'Diesem Haushalt ist schon eine andere Antwort zugeordnet.',
    'household.importTooLong': 'Die Liste ist zu lang: höchstens 300 Zeilen.',
    'household.importInvalid': 'Diese Liste ist nicht gültig.',
    'household.tokenInvalid': 'Dieser Haushaltslink ist nicht gültig.',
    'guestInvite.notFound': 'Diese Einladung gibt es noch nicht. Speichern Sie sie zuerst.',
  },

  /** The guestbook, guest side (spec 01). What guests and hosts write is never translated. */
  guestbook: {
    title: 'Gästebuch',
    helpManual: 'Ein paar Worte zum Abend. Der Veranstalter liest sie, bevor er sie zeigt.',
    helpAuto: 'Ihre Nachricht erscheint im Gästebuch.',
    open: 'Eine Nachricht hinterlassen',
    label: 'Ihre Nachricht',
    placeholder: 'Ihre Nachricht…',
    counter: (length: number, max: number) => `${t.number(length)} / ${t.number(max)}`,
    counterNear: (left: number) =>
      t.count(left, {
        one: 'Noch 1 Zeichen.',
        other: `Noch ${t.number(left)} Zeichen.`,
      }),
    counterFull: 'Grenze erreicht.',
    send: 'Meine Nachricht senden',
    cancel: 'Abbrechen',
    thanksManual: 'Danke! Ihre Nachricht erscheint, sobald der Veranstalter sie freigegeben hat.',
    thanksAuto: 'Danke! Ihre Nachricht steht im Gästebuch.',
    mine: 'Meine Nachrichten',
    statusPending: 'Wartet auf Freigabe',
    statusPublished: 'Auf dem Bildschirm',
    statusPublishedNotOnWall: 'Veröffentlicht, nicht auf dem Bildschirm',
    statusRejected: 'Nicht ausgewählt',
    statusHidden: 'Vom Bildschirm genommen',
    remove: 'Diese Nachricht entfernen',
    removeTitle: 'Diese Nachricht endgültig entfernen?',
    removeConfirm: 'Entfernen',
    removeCancel: 'Behalten',
    removed: 'Nachricht entfernt.',
    tooLong: (max: number) => `Nachricht zu lang (höchstens ${t.number(max)} Zeichen).`,
    errors: {
      'guestbook.empty': 'Schreiben Sie mindestens ein Wort.',
      'guestbook.invalid': 'Diese Nachricht kann so nicht gesendet werden.',
      'guestbook.tooManyLines': 'Nachricht zu hoch: Bitte fassen Sie sich kürzer.',
      'guestbook.limitReached':
        'Sie haben bereits 3 Nachrichten hinterlassen, als Text oder als Sprache. Entfernen Sie eine, um eine neue zu hinterlassen.',
      'guestbook.voiceDisabled': 'Sprachnachrichten sind im Moment ausgeschaltet.',
      'guestbook.voiceEventFull': 'Das Gästebuch ist voll.',
      'voice.queueFull': 'Versuchen Sie es gleich noch einmal.',
      'voice.unsupportedFormat': 'Diese Datei ist keine lesbare Sprachnachricht.',
      'voice.notAudio': 'Diese Datei ist keine lesbare Sprachnachricht.',
      'voice.corrupt': 'Diese Datei ist keine lesbare Sprachnachricht.',
      'voice.tooLong': 'Diese Sprachnachricht ist zu lang.',
      'voice.tooShort': 'Diese Sprachnachricht ist zu kurz.',
      'guestbook.eventFull': 'Das Gästebuch ist voll.',
      'guestbook.disabled': 'Das Gästebuch ist im Moment nicht geöffnet.',
      'event.notAcceptingUploads': 'Das Gästebuch ist im Moment nicht geöffnet.',
      'guestbook.deleteForbidden':
        'Diese Nachricht kann nicht mehr entfernt werden. Wenden Sie sich an den Veranstalter: Er kann sie löschen.',
      'event.guestSelfDeleteDisabled':
        'Der Veranstalter hat das Entfernen nicht aktiviert. Fragen Sie ihn: Er kann eine Nachricht löschen.',
      'guestbook.notFound': 'Diese Nachricht gibt es nicht mehr.',
      'guestbook.deleteFailed':
        'Das Entfernen hat nicht geklappt. Versuchen Sie es erneut oder fragen Sie den Veranstalter.',
      'rate.limited': 'Zu viele Nachrichten auf einmal, versuchen Sie es in einer Minute erneut.',
    },
    eraseBody:
      'Ihre Fotos, Videos, Bildunterschriften, Gästebuch-Nachrichten einschließlich Ihrer Sprachnachrichten, Reaktionen und Ihr Vorname werden aus der Feier gelöscht: von der Leinwand, aus dem Album und aus der Liste des Veranstalters. Das lässt sich nicht rückgängig machen.',
    noticeWhatHappens: 'Was mit Ihren Fotos und Nachrichten geschieht',
    noticeWhoSees: 'Wer Ihre Fotos und Nachrichten sieht',
    noticeHowLong: 'Wie lange sie aufbewahrt werden',
    noticeRemoval: 'Etwas entfernen lassen',
    noticeMessagePublication: {
      afterReview:
        'Eine Gästebuch-Nachricht wird vom Veranstalter gelesen, bevor sie auf den Bildschirm kommen kann.',
      immediate:
        'Eine Gästebuch-Nachricht kann sofort nach dem Senden auf den Bildschirm kommen. Der Veranstalter kann sie jederzeit entfernen.',
    },
    noticeMessageAudience:
      'Ihre Nachrichten werden vom Veranstalter und seinem Team gelesen und können auf dem Bildschirm des Abends gezeigt werden. Sie erscheinen nicht unter „Fotos des Abends“.',
    noticeMessageBook:
      'Der Veranstalter kann Ihre Worte mit Ihrem Vornamen in das Fotobuch des Abends aufnehmen und es drucken lassen.',
    noticeMessageRetention:
      'Ihre Nachrichten werden so lange aufbewahrt wie die Fotos und mit ihnen gelöscht.',
    noticeMessageRemoval:
      'Eine Nachricht wird wie ein Foto entfernt, unter „Meine Nachrichten“ und unter denselben Bedingungen.',
  },

  /**
   * The voice message of the guestbook, guest side (spec 25): recording it, listening before sending,
   * where it stands afterwards and what the privacy notice says about it. What a guest says is never
   * translated and never appears here, only the words around it. Never "IA", "intelligent" or
   * "transcription" in a sentence of this table: nothing listens to a voice but the organiser.
   */
  guestbookVoice: {
    open: 'Sprachnachricht hinterlassen',
    record: 'Aufnehmen',
    stop: 'Stopp',
    clock: (elapsed: string, max: string) => `${elapsed} / ${max}`,
    recordingAnnounce: 'Aufnahme läuft',
    nearEnd: 'Noch 10 Sekunden',
    recordedAnnounce: (duration: string) => `Aufnahme beendet, ${duration}`,
    closeToTheMicrophone:
      'Sprechen Sie nah ans Telefon: Menschen um Sie herum sind eventuell zu hören',
    listen: 'Anhören',
    listenPause: 'Pause',
    restart: 'Neu aufnehmen',
    send: 'Meine Sprachnachricht senden',
    cancel: 'Abbrechen',
    captionLabel: 'Ein paar Worte dazu',
    micBlocked:
      'Das Mikrofon ist blockiert. Erlauben Sie es in den Browsereinstellungen und kommen Sie dann hierher zurück.',
    micUnavailableHere:
      'Das Mikrofon ist auf dieser Seite nicht verfügbar. Öffnen Sie den Link zur Veranstaltung erneut.',
    micMissing:
      'Auf diesem Gerät ließ sich kein Mikrofon verwenden. Sie können stattdessen eine Nachricht schreiben.',
    tooShort: 'Zu kurz: Sprechen Sie mindestens eine Sekunde.',
    writeInstead: 'Stattdessen eine Nachricht schreiben',
    openInBrowser:
      'Um eine Sprachnachricht zu hinterlassen, öffnen Sie diese Seite in Safari oder Chrome.',
    previewFailed: 'Die Vorschau lässt sich hier nicht abspielen, Sie können trotzdem senden',
    interrupted: (duration: string) =>
      `Die Aufnahme wurde beendet, weil die Seite verlassen wurde. Sie dauert ${duration}.`,
    notKept:
      'Die Aufnahme konnte nicht auf Ihrem Telefon gespeichert werden. Bitte nehmen Sie sie neu auf.',
    helpManual: 'Der Veranstalter entscheidet, ob Ihre Nachricht behalten wird.',
    helpAuto:
      'Ihre Nachricht wird im Gästebuch aufbewahrt. Nur der Veranstalter und sein Team können sie anhören.',
    thanksManual: 'Danke! Der Veranstalter entscheidet, ob Ihre Nachricht behalten wird.',
    thanksAuto: 'Danke! Ihre Sprachnachricht ist angekommen.',
    waitingNetwork: 'Ihre Sprachnachricht wartet auf ein Netz.',
    offlineHintKeepOpen:
      'Lassen Sie diese Seite geöffnet: Ihre Fotos und Ihre Sprachnachricht werden gesendet, sobald das Netz wieder da ist.',
    keptOnPhone: 'Ihre Aufnahme bleibt auf Ihrem Telefon.',
    messageLabel: (duration: string | null) =>
      duration === null ? 'Sprachnachricht' : `Sprachnachricht, ${duration}`,
    statusProcessing: 'Wird verarbeitet',
    statusPublished: 'Im Gästebuch',
    failed: 'Ihre Sprachnachricht konnte nicht gespeichert werden. Bitte nehmen Sie sie neu auf.',
    retry: 'Erneut versuchen',
    localWaiting: 'Wartet auf ein Netz',
    localBlocked: 'Auf Ihrem Telefon behalten',
    saveToPhone: 'Auf meinem Telefon speichern',
    deleteLocal: 'Löschen',
    noticeVoiceAudience: 'Ihre Sprachnachricht können nur der Veranstalter und sein Team anhören.',
    noticeVoiceNeverRoom:
      'Sie wird nie auf der Leinwand im Saal abgespielt und von den anderen Gästen nicht gehört.',
    noticeVoicePublication: {
      afterReview: 'Der Veranstalter entscheidet, ob Ihre Nachricht behalten wird.',
      immediate: 'Ihre Nachricht wird sofort im Album aufbewahrt, ohne vorher angehört zu werden.',
    },
    noticeVoiceRetention:
      'Sie wird wie Ihre Fotos aufbewahrt und kommt in das Album, das der Veranstalter herunterlädt.',
    noticeVoiceRetentionDays: (count: number) =>
      t.count(count, {
        one: 'Sie wird wie Ihre Fotos aufbewahrt (1 Tag nach Abschluss des Abends) und kommt in das Album, das der Veranstalter herunterlädt.',
        other: `Sie wird wie Ihre Fotos aufbewahrt (${t.number(count)} Tage nach Abschluss des Abends) und kommt in das Album, das der Veranstalter herunterlädt.`,
      }),
    noticeVoiceMicrophone:
      'Das Mikrofon läuft nur während der Aufnahme. Die Aufnahme bleibt auf Ihrem Telefon, bis Sie sie senden.',
    noticeVoiceSealed:
      'Sprachnachrichten bleiben bis zum Ende des Abends geheim, außer der Veranstalter entscheidet anders.',
    noticeVoiceRemovalSeconds: (count: number) =>
      t.count(count, {
        one: 'Sie können Ihre Sprachnachricht innerhalb einer Sekunde nach dem Senden entfernen.',
        other: `Sie können Ihre Sprachnachricht innerhalb von ${t.number(count)} Sekunden nach dem Senden entfernen.`,
      }),
    noticeVoiceRemovalMinutes: (count: number) =>
      t.count(count, {
        one: 'Sie können Ihre Sprachnachricht innerhalb einer Minute nach dem Senden entfernen.',
        other: `Sie können Ihre Sprachnachricht innerhalb von ${t.number(count)} Minuten nach dem Senden entfernen.`,
      }),
    noticeVoiceRemovalHours: (count: number) =>
      t.count(count, {
        one: 'Sie können Ihre Sprachnachricht innerhalb einer Stunde nach dem Senden entfernen.',
        other: `Sie können Ihre Sprachnachricht innerhalb von ${t.number(count)} Stunden nach dem Senden entfernen.`,
      }),
    noticeVoiceRemovalAskHost:
      'Um eine Sprachnachricht entfernen zu lassen, fragen Sie den Veranstalter.',
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
    shortcutsHint:
      'J / K zum Blättern, P zum Freigeben, R zum Ablehnen, Z zum Rückgängigmachen der letzten Entscheidung.',

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
    statePublished: 'Auf dem Bildschirm',
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
        one: `${t.number(count)} Foto vom Bildschirm genommen. Es bleibt in Ihrem Album.`,
        other: `${t.number(count)} Fotos vom Bildschirm genommen. Sie bleiben in Ihrem Album.`,
      }),
    highlight: 'Favorit',
    highlightAddHint: 'Als Favorit markieren',
    highlightRemoveHint: 'Aus den Favoriten entfernen',
    shortcutsFavourite: 'F, um als Favorit zu markieren.',
    decisionFailed: 'Die Entscheidung konnte nicht gespeichert werden. Versuchen Sie es erneut.',
    undoFailed: 'Das Rückgängigmachen konnte nicht gespeichert werden. Versuchen Sie es erneut.',
    dimensions: (width: number, height: number) => `${width} × ${height} Pixel`,
    noCaption: 'Ohne Bildunterschrift',

    /* ---- Moderation traps pass (MOD-1, MOD-4, MOD-9, MOD-13). Keep additions inside this block. ---- */
    nothingToUndo: 'Nichts rückgängig zu machen.',
    undoPublish: 'Entfernen',
    seeRejected: 'In „Abgelehnt“ ansehen',
    republish: 'Wieder auf den Bildschirm',
    republishPhoto: (author: string) => `Foto von ${author} wieder auf den Bildschirm bringen`,
    publishAnyway: 'Trotzdem freigeben',
    publishAnywayPhoto: (author: string) => `Foto von ${author} trotzdem freigeben`,
    alreadyOnScreen: 'Dieses Foto ist schon auf dem Bildschirm.',
    alreadyRefused: 'Dieses Foto ist schon abgelehnt.',
    notOnScreen: 'Dieses Foto ist nicht auf dem Bildschirm.',
    decisionsExplained:
      'Vom Bildschirm nehmen: Das Foto bleibt in Ihrem Album. Ablehnen: Es verlässt das Album, und der Gast sieht „Nicht ausgewählt“.',
    filterRejectedHint: 'Nicht mehr im Album. Der Gast sieht „Nicht ausgewählt“.',
    filterHiddenHint: 'Vom Bildschirm genommen. Sie bleiben in Ihrem Album.',
    confirmRejectTitle: (count: number) => `${t.number(count)} Fotos ablehnen?`,
    confirmRejectBody:
      'Die Gäste sehen „Nicht ausgewählt“, und die Fotos verlassen das Album. Das lässt sich nicht rückgängig machen.',
    confirmRejectLabel: (count: number) => `${t.number(count)} Fotos ablehnen`,

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
    /* Spec 15: the guestbook's tab in the console. Its own block, at the end. */
    tabPhotos: 'Fotos',
    tabMessages: 'Nachrichten',
    tabsLabel: 'Was Sie moderieren',
    tabCounted: (label: string, count: number) => `${label}, ${t.number(count)} zu prüfen`,
    tabFresh: (label: string, count: number) => `${label}, ${t.number(count)} neu zum Lesen`,
    messagesPendingAnnounce: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Nachricht wartet`,
        other: `${t.number(count)} Nachrichten warten`,
      }),
    messagesEmpty: 'Im Moment ist nichts zu prüfen.',
    messagesEmptyHint: 'Die Zeilen Ihrer Gäste erscheinen hier automatisch.',
    messagePublished: (author: string) => `Nachricht von ${author} veröffentlicht.`,
    messageRejected: (author: string) => `Nachricht von ${author} abgelehnt.`,
    messageHidden: (author: string) => `Nachricht von ${author} vom Bildschirm genommen.`,
    messagesListLabel: 'Gästebuch-Nachrichten',
    messagesLoadFailed: 'Die Nachrichten konnten nicht geladen werden.',
    /* Spec 15, phone console: messages. */
    messageOf: (author: string) => `Nachricht von ${author}`,
    onScreenMessagesTitle: 'Letzte Nachrichten auf dem Bildschirm',
    onScreenMessagesEmpty: 'Noch keine Nachricht auf dem Bildschirm.',
    publishMessageOf: (author: string) => `Nachricht von ${author} veröffentlichen`,
    rejectMessageOf: (author: string) => `Nachricht von ${author} ablehnen`,
    readMessage: 'Lesen',
    readMessageOf: (author: string) => `Nachricht von ${author} lesen`,
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
    unavailable: 'Diese Feier wird nicht mehr angezeigt.',
    unavailableHint:
      'Die Feier ist vorbei, hier gibt es keine Fotos mehr zu sehen. Fragen Sie die Veranstalter nach dem Link zum Album.',
    /* Spec 24: saving a photograph from the feed. */
    saving: 'Wird gespeichert…',
    saveReady: 'Tippen Sie, um es zu speichern',
    /** The accessible name of a save button: its word, then the photograph it is under. */
    saveNamed: (action: string, description: string) => `${action}: ${description}`,
    saveDownloaded: 'Foto heruntergeladen.',
    saveNetworkFailed:
      'Das Foto konnte nicht abgerufen werden. Versuchen Sie es erneut, wenn das Netz wieder da ist.',
    saveBusy: 'Viele Gäste speichern gerade gleichzeitig. Versuchen Sie es gleich noch einmal.',
    saveGone: 'Dieses Foto ist nicht mehr verfügbar.',
    saveMediaMissing: 'Das Foto konnte nicht abgerufen werden.',
    saveDisabled: 'Der Veranstalter hat das Speichern deaktiviert.',
    saveRevoked: 'Der Veranstalter hat Ihren Zugang entfernt.',
    /** A lapsed access reads by the state of the evening: open, the code reopens it; over, only the album's link is left. */
    saveExpiredOpen:
      'Ihr Zugang zur Feier ist abgelaufen. Öffnen Sie die Feier erneut mit dem Code oder dem Link, den Sie erhalten haben.',
    saveExpiredClosed:
      'Ihr Zugang zur Feier ist abgelaufen. Fragen Sie die Veranstalter nach dem Link zum Album.',
    saveHelpSheet: 'Wählen Sie im geöffneten Menü „Bild sichern“, um es in Fotos abzulegen.',
    saveHelpFiles:
      'Das Foto liegt in der App „Dateien“, im Ordner „Downloads“. Damit es in Fotos landet, öffnen Sie die Feier in Safari: Tippen Sie in der Messenger-App auf Teilen und dann auf „In Safari öffnen“.',
  },

  wall: {
    empty: 'Die ersten Fotos kommen gleich',
    emptyHint: 'Scannen Sie den QR-Code und senden Sie Ihre eigenen Fotos.',
    joinPrompt: 'Treten Sie der Feier bei',
    offline: 'Neue Fotos warten auf das Netzwerk',
    paused: 'Diashow angehalten',

    /* ---- Spec 11: the souvenir counter and the new-photo signal. Keep additions inside this block. ---- */
    souvenirCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Erinnerung geteilt`,
        other: `${t.number(count)} Erinnerungen geteilt`,
      }),
    arrivalPhoto: 'Neues Foto hinzugefügt',
    arrivalClip: 'Neues Video hinzugefügt',
    arrivalPhotos: (count: number) => `${t.number(count)} neue Fotos`,
    arrivalClips: (count: number) => `${t.number(count)} neue Videos`,
    arrivalMixed: (count: number) => `${t.number(count)} neue Erinnerungen`,

    /* ---- Spec 21: scheduled announcements on the wall. The text inside is the host's, never translated. ---- */
    announcementSay: (text: string) => `Ansage: ${text}.`,
    announcementIn: (time: string) => `in ${time}`,
    announcementImminent: (time: string) => `gleich · ${time}`,
    /* A discreet announcement's pill (spec 21): rounded up to the minute, two minutes and over; the last minute has its own words. */
    announcementMinutesLeft: (minutes: number) => `noch ${minutes} Min.`,
    announcementLastMinute: 'noch unter 1 Min.',

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
    mixedHint:
      'Die Wand wechselt zwischen Übersicht und großem Foto: L (oder ?layout=) legt auf diesem Bildschirm ein Layout fest und beendet das Wechseln, bis die Seite neu geladen wird.',
    /* Spec 12: the muted-speaker icon, and the S key in the shortcuts. */
    soundActivate: 'Ton auf diesem Bildschirm aktivieren',
    soundShortcutHint:
      'S aktiviert den Ton auf diesem Bildschirm, falls er in den Einstellungen eingeschaltet ist.',
    /* "Levez les yeux" (UX review 2026-10-30): the line under a guest's first photo on the wall. */
    firstPhotoOf: (name: string) => `Erstes Foto von ${name}`,

    /* ---- Before and after the evening (UX review 30/10, MUR-2 to MUR-9). Keep additions inside this block. ---- */
    // The corner card's title: what to do, in a verb a guest reads from ten metres.
    sendPrompt: 'Senden Sie Ihre Fotos auf die Leinwand',
    // Under the code, for the phone that cannot read the QR. Both holes are interpolated as given.
    typeCodeAt: (code: string, host: string) => `oder geben Sie ${code} auf ${host} ein`,
    invitePrompt: {
      tile: 'Ihr Foto hier',
      cell: 'Das nächste ist Ihres',
      print: 'Ihr Foto hier',
      tag: 'Hängen Sie Ihres dazu',
      seam: 'Senden Sie Ihre Fotos',
    },
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

    /* ---- The settings panel on the wall (spec 13). Keep additions to it inside this block. ---- */
    panel: {
      open: 'Einstellungen',
      pause: 'Pause',
      resume: 'Fortsetzen',
      fullscreen: 'Vollbild',
      /* Spec 17: what the owner bar's icons say on hover and on focus, with their key. */
      openTip: 'Einstellungen (R)',
      pauseTip: 'Pause (Leertaste)',
      resumeTip: 'Fortsetzen (Leertaste)',
      fullscreenTip: 'Vollbild (F)',
      /* Spec 17: the drawer's section row and the current value under each section's title. */
      sectionJump: 'Zum Abschnitt springen',
      summaryNone: 'Keine',
      summaryHidden: 'Ausgeblendet',
      summaryOff: 'Aus',
      rhythmAuto: 'Auto',
      summaryRhythm: (n: number) => `${n} s`,
      barLabel: 'Steuerung der Wand',
      panelLabel: 'Einstellungen der Wand',
      title: 'Einstellungen',
      close: 'Einstellungen schließen',
      sectionDisplay: 'Anzeige',
      sectionAmbiance: 'Ambiente',
      sectionQr: 'QR-Code',
      forAll: 'Für alle Bildschirme',
      thisScreen: 'Nur dieser Bildschirm',
      thisScreenHint:
        'Diese Schaltflächen ändern nur diesen Bildschirm und gehen beim Neuladen der Seite verloren.',
      screenLayout: (name: string) => `Anordnung dieses Bildschirms: ${name} (Taste L)`,
      screenShows: (name: string) => `Dieser Bildschirm zeigt ${name} (Taste L)`,
      backToEvent: 'Zurück zur Einstellung der Veranstaltung',
      hideQr: 'QR-Karte ausblenden',
      showQr: 'QR-Karte anzeigen',
      saving: 'Wird gespeichert…',
      saved: 'Gespeichert',
      saveFailed: 'Speichern nicht möglich, bitte erneut versuchen',
      sessionExpired:
        'Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an, um die Wand einzustellen.',
      signIn: 'Anmelden',
      signInToSet: 'Anmelden, um diese Wand einzustellen',
      openHint: 'R öffnet die Einstellungen der Wand.',
      /* Spec 12: the state of this screen's speakers, in the "Son" section. */
      soundScreenOn: 'Dieser Bildschirm: Ton aktiv.',
      soundScreenOff: 'Dieser Bildschirm: Ton aus.',
    },

    videoBy: (name: string) => `Video, gesendet von ${name}`,
    videoByAnonymous: 'Video, gesendet von einem Gast',

    /** The signature under a guestbook card (spec 01) when the guest gave no name. */
    guestbookAnonymous: 'Ein Gast',

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
    joinCode: 'Code der Feier',
    rotateJoinCode: 'Code ändern',
    rotateJoinCodeHint:
      'Bereits gedruckte QR-Codes und der bereits verschickte Link funktionieren nicht mehr: Sie müssen sie neu drucken und den Link erneut senden. Bereits verbundene Gäste bleiben verbunden.',
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
    stats: {
      title: 'Statistik der Veranstaltung',
      tile: 'Statistik',
      loading: 'Statistik wird geladen…',
      empty:
        'Noch nichts zu zählen. Die Zahlen erscheinen, sobald Gäste der Veranstaltung beitreten.',
      emptyAction: 'QR-Code anzeigen',
      figureUploads: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} Upload erhalten`,
          other: `${t.number(count)} Uploads erhalten`,
        }),
      figureGuests: (count: number) =>
        t.count(count, { one: `${t.number(count)} Gast`, other: `${t.number(count)} Gäste` }),
      figureHere: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} gerade da`,
          other: `${t.number(count)} gerade da`,
        }),
      figurePending: (count: number) =>
        t.count(count, { one: `${t.number(count)} wartend`, other: `${t.number(count)} wartend` }),
      timelineTitle: 'Uploads im Zeitverlauf',
      timelineCaption: 'Uploads pro Stunde',
      hourColumn: 'Stunde',
      uploadsColumn: 'Uploads',
      timelineEmpty: 'Noch keine Uploads.',
      peak: (hour: string, count: number) =>
        `Spitze: ${hour}, ${t.count(count, { one: `${t.number(count)} Upload`, other: `${t.number(count)} Uploads` })}`,
      statusTitle: 'Uploads nach Status',
      statusPublished: 'Veröffentlicht',
      statusPending: 'Wartend',
      statusRejected: 'Abgelehnt',
      statusHidden: 'Ausgeblendet',
      publishedShare: 'Anteil veröffentlichter Uploads',
      guestsTitle: 'Gäste',
      guestsJoined: 'Beigetreten',
      guestsContributors: 'Mindestens eine Datei gesendet',
      guestsRevoked: 'Von Ihnen entfernt',
      reactionsTitle: 'Reaktionen',
      reactionsTotal: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} Reaktion`,
          other: `${t.number(count)} Reaktionen`,
        }),
      topTitle: 'Wer am meisten geteilt hat',
      topEmpty: 'Noch hat niemand einen Upload veröffentlicht.',
      topLine: (photos: number, reactions: number) =>
        `${t.count(photos, { one: `${t.number(photos)} veröffentlichter Upload`, other: `${t.number(photos)} veröffentlichte Uploads` })} · ${t.count(reactions, { one: `${t.number(reactions)} erhaltene Reaktion`, other: `${t.number(reactions)} erhaltene Reaktionen` })}`,
      anonymous: (guests: number, photos: number) =>
        `Gäste ohne Vornamen werden zusammengefasst: ${t.count(guests, { one: `${t.number(guests)} Gast`, other: `${t.number(guests)} Gäste` })}, ${t.count(photos, { one: `${t.number(photos)} Upload`, other: `${t.number(photos)} Uploads` })}.`,
      engagementTitle: 'Nach der Feier',
      engagementNone:
        'Noch nicht gemessen: kein Albumlink geöffnet, kein ZIP gestartet und kein Foto gespeichert.',
      albumOpens: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} Öffnung des Albumlinks`,
          other: `${t.number(count)} Öffnungen des Albumlinks`,
        }),
      zipLaunches: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} ZIP gestartet`,
          other: `${t.number(count)} ZIPs gestartet`,
        }),
      guestSaves: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} von Gästen gespeichertes Foto`,
          other: `${t.number(count)} von Gästen gespeicherte Fotos`,
        }),
      measuredSince: (date: string) => `Gemessen seit ${date}. Davor wurde nichts gezählt.`,
      engagementNote:
        'Eine Öffnung ist das Laden der Albumseite, keine Person. Ein gestartetes ZIP ist nicht zwingend abgeschlossen. Ein Speichern ist eine angenommene Anfrage, nicht zwingend ein Foto, das auf dem Handy angekommen ist. Diese Zahlen sind Richtwerte.',
      retention:
        'Diese Zahlen verschwinden mit der Veranstaltung, bei ihrer Löschung oder zum Ende der Aufbewahrungsfrist.',
    },
    storageUsed: (used: string, total: string) => `${used} von ${total}`,
    settings: 'Einstellungen',
    moderationMode: 'Moderation',
    moderationManual: 'Jedes Foto freigeben',
    moderationAuto: 'Automatisch freigeben',
    moderationAutoWarning:
      'Fotos, Videos und Gästebuch-Nachrichten erscheinen ohne Freigabe auf dem Bildschirm. Nur für Veranstaltungen im engen Kreis.',
    allowCaptions: 'Bildunterschriften erlauben',
    allowReactions: 'Reaktionen erlauben',
    allowClips: 'Videos erlauben',
    allowClipsHint:
      'Gäste können zusätzlich zu Fotos kurze Videos senden. Ohne Haken werden Videos abgelehnt: weil Sie den Haken entfernt haben, weil die bei der Erstellung gewählte Vorlage es so eingestellt hat, oder weil die Veranstaltung älter ist als diese Funktion. Setzen Sie den Haken, um Videos zu erlauben.',
    /** The host's switch over saving from the feed (spec 24). */
    allowGuestSave: 'Gäste dürfen die Fotos des Abends speichern',
    allowGuestSaveHint:
      'Jeder Gast kann ein auf dem Bildschirm gezeigtes Foto in hoher Qualität auf dem eigenen Handy behalten, ohne Ort und ohne Angabe der Kamera. Sie behalten die Kontrolle über das Album: Ein Foto, das Sie entfernen, lässt sich nicht mehr speichern, aber ein bereits gespeichertes Foto bleibt auf dem Handy der Person, und das Kopieren eines einzelnen Fotos können Sie nur verhindern, indem Sie es entfernen. Wenn Sie diese Einstellung während des Abends ändern, müssen die Gäste die Angaben vor ihrem nächsten Foto erneut lesen. Nach dem Ende der Feier kann ein Gast, dessen Zugang abgelaufen ist, nicht mehr speichern: Schicken Sie ihm den Link zum Album, der auch die volle Auflösung liefert.',
    allowGuestbook: 'Gästebuch öffnen',
    allowGuestbookHint:
      'Gäste hinterlassen eine kurze Nachricht. Ohne Haken: das Gästebuch ist geschlossen, bereits geschriebene Nachrichten bleiben erhalten.',
    guestbookOnWall: 'Nachrichten auf dem Bildschirm im Saal zeigen',
    guestbookOnWallHint:
      'Ohne Haken: veröffentlichte Nachrichten bleiben im Gästebuch, erscheinen aber nicht auf dem Bildschirm.',
    allowGuestSelfDelete: 'Gästen erlauben, ihre Fotos zu löschen',

    wallLanguage: 'Sprache der Leinwand im Saal',
    wallLanguageHint:
      'Die Wörter auf der Leinwand im Saal: „Treten Sie der Feier bei“, „Missionen“, die Wartemeldungen. Was Sie und Ihre Gäste schreiben — der Name der Veranstaltung, die Bildunterschriften, die Aufgaben — erscheint unverändert und wird nie übersetzt. Ihre Gäste wählen ihre eigene Sprache auf ihrem Telefon; diese Einstellung betrifft sie nicht.',

    /* ---- Wall display block of the settings page (spec 13). Keep additions to it inside this block. ---- */
    wallDisplay: {
      title: 'Anzeige der Wand',
      forAll: 'Für alle Bildschirme',
      hint: 'Diese Einstellungen gelten für die Veranstaltung: jeder Bildschirm im Raum folgt ihnen.',
      layout: 'Anordnung',
      layoutHint:
        'Die Taste L oder eine Adresse mit ?layout= hat auf dem jeweiligen Bildschirm weiterhin Vorrang.',
      layoutUnset: 'Jeder Bildschirm entscheidet selbst',
      interval: 'Tempo',
      intervalHint: 'Wie lange jedes Foto auf dem Bildschirm bleibt.',
      intervalDefault: 'Standard (ein Foto alle 8 s)',
      intervalSeconds: (n: number) => `Ein Foto alle ${n} s`,
      mixed: 'Wand und Diashow abwechseln',
      mixedHint: 'Die Wand zeigt abwechselnd eine Übersicht und ein großes Foto.',
      mixedWall: 'Zeit auf der Wand',
      mixedSlideshow: 'Zeit in der Diashow',
      freshLane: 'Neue Fotos zuerst',
      freshLaneHint: 'Ein veröffentlichtes Foto kommt als nächstes, höchstens drei hintereinander.',
      tilt: 'Leicht geneigte Fotos',
      tiltHint: 'Polaroids und Wäscheleine: ein fester Winkel von wenigen Grad.',
      showTime: 'Sendezeit unter dem Foto',
      showTimeHint:
        'Die Uhrzeit, zu der das Foto gesendet wurde, nach der Uhr des Bildschirms im Raum.',
      // Spec 11.
      onScreen: 'Auf dem Bildschirm',
      souvenirCounter: 'Erinnerungszähler anzeigen',
      souvenirCounterHint:
        'Ein dezenter Zähler oben in der Mitte: „17 Erinnerungen geteilt“. Er zählt die auf der Wand sichtbaren Fotos und Videos.',
      newPhotoSignal: 'Neue Fotos ankündigen',
      newPhotoSignalHint:
        'Eine kurze Meldung oben in der Mitte, wenn ein Foto oder Video gerade auf der Wand erschienen ist. Nie der Name des Gastes.',
      // Spec 14: the invitation card.
      qrTitle: 'QR-Code',
      qrVisible: 'QR-Code auf der Wand zeigen',
      qrVisibleHint:
        'Spät ankommende Gäste haben dann keinen QR-Code mehr. Die leere Wand behält ihre Einladung.',
      qrSize: 'Größe des QR-Codes',
      qrSizeValue: (n: number) => `× ${String(Math.round(n * 100) / 100).replace('.', ',')}`,
      qrSizeSmall: 'Klein',
      qrSizeMedium: 'Mittel',
      qrSizeLarge: 'Groß',
      qrSizeHint: 'Der QR-Code wird nie kleiner als lesbar: ein langer Link hält ihn größer.',
      qrPlacement: 'Position',
      qrCorners: {
        'top-start': 'Oben links',
        'top-end': 'Oben rechts',
        'bottom-start': 'Unten links',
        'bottom-end': 'Unten rechts',
      },
      qrPlacementHint:
        'Die Ecke gilt für das Layout Vollbild. Die anderen setzen den QR-Code in ihre eigene Komposition: eine Kachel des Mosaiks, einen Abzug, ein Etikett an der Leine…',
    },
    wallSound: {
      title: 'Ton',
      hint: 'Ein kurzer Ton, wenn ein Foto oder Clip an der Wand erscheint. Standardmäßig aus.',
      enable: 'Ein Ton bei jedem neuen Foto',
      enableHint:
        'Jeder Bildschirm muss vor Ort zusätzlich aktiviert werden: ein Klick auf die Wand (oder die Taste S) genügt.',
      tone: 'Ton',
      toneNames: { chime: 'Glockenspiel', bell: 'Glocke', drop: 'Tropfen', pop: 'Pop' },
      tonePlay: (name: string) => `Anhören: ${name}`,
      volume: 'Lautstärke',
      volumeValue: (n: number) => `Lautstärke ${n} %`,
      test: 'Testen',
      testHint: 'Spielt den gewählten Ton auf diesem Computer in dieser Lautstärke ab.',
    },

    theme: 'Erscheinungsbild',
    themeHint:
      'Sichtbar für Ihre Gäste und auf der Leinwand im Saal. Die angebotenen Farben bleiben auf zehn Meter lesbar.',
    themeAccent: 'Farbe',
    themeAccentNames: {
      violet: 'Ambiente-Farbe (Standard)',
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
      'Die Welt, die die Handys Ihrer Gäste, die Leinwand im Saal und die Seiten dieser Veranstaltung in Ihrem Bereich tragen.',
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
    templateSelfDeleteOn: 'Einzelne Fotos löschen erlaubt',
    templateSelfDeleteOff: 'Einzelne Fotos löschen deaktiviert',
    templateGuestSaveOn: 'Gäste können Fotos speichern',
    templateGuestSaveOff: 'Speichern von Fotos für Gäste deaktiviert',
    templateVoiceOn: 'Sprachnachrichten im Gästebuch aktiviert',
    templateVoiceOff: 'Sprachnachrichten deaktiviert',
    templateVoiceSealed: 'Sprachnachrichten geheim gehalten bis zur Enthüllung',
    templateNames: {
      wedding: 'Hochzeit',
      birthday: 'Geburtstag',
      conference: 'Konferenz',
      party: 'Party',
      disposable: 'Einwegkamera',
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
    eventsEmptyHint: 'Fünf Schritte, damit am Tag selbst alles bereit ist.',
    emptyStepCreate: 'Legen Sie die Veranstaltung an.',
    emptyStepPrint: 'Drucken Sie den QR-Code aus und legen Sie ihn auf die Tische.',
    emptyStepScreen:
      'Schließen Sie den Bildschirm des Veranstaltungsorts an und öffnen Sie ihn: Er wartet auf die Öffnung.',
    emptyStepOpen: 'Öffnen Sie die Veranstaltung für Gäste.',
    emptyStepTest:
      'Testen Sie mit einem Telefon, das nicht Ihres ist, im Netzwerk des Veranstaltungsorts.',
    create: 'Veranstaltung anlegen',
    slugHint: 'Optional. Leer lassen, dann wird sie aus dem Namen abgeleitet.',
    slugPreviewLabel: 'Adresse für Ihre Gäste',
    slugPreviewEmpty: 'Geben Sie einen Namen ein, um die Adresse zu sehen.',
    eventCreated: (name: string) =>
      `${name} ist bereit. Drucken Sie den QR-Code, wann immer Sie wollen.`,
    joinLink: 'Link für Ihre Gäste',
    printQr: 'QR-Code drucken',
    qrScanPrompt: 'Scannen Sie, um Ihre Fotos zu senden.',
    qrAlt: (eventName: string) => `QR-Code zum Beitritt zu ${eventName}`,
    printKitTitle: 'Tischkarten und Plakat',
    printKitCrumb: 'Karten und Plakat',
    printKitIntro:
      'Drucken Sie etwas für die Tische aus: den QR-Code, den Ersatzcode und drei Zeilen Anleitung.',
    printKitFormat: 'Format',
    printKitInk: 'Farbe des QR-Codes',
    printInkBlack: 'Schwarz (am sichersten)',
    printInkEvent: 'Farbe der Veranstaltung',
    printKitLogo: 'Logo der Veranstaltung in der Mitte des QR-Codes',
    printKitLogoHint:
      'Der QR-Code nutzt die höchste Fehlerkorrektur: Er bleibt lesbar, wird aber etwas dichter.',
    printFormatA4: 'A4-Plakat (1 pro Blatt)',
    printFormatA5: 'A5-Plakat (2 pro Blatt)',
    printFormatCard: 'A6-Tischkarten (4 pro Blatt)',
    printKitLanguage: 'Sprache des Drucks',
    printKitLanguageHint: 'Das ist die Sprache des Abends, nicht die Ihres Bildschirms.',
    printKitPrint: 'Drucken',
    printKitPrinting: 'Code wird aktualisiert …',
    printKitHelp:
      'Wählen Sie im Druckfenster A4, Maßstab 100 %, ohne Kopf- und Fußzeilen. Ihr Browser bietet dort auch „Als PDF speichern“ an. Nutzen Sie die Schaltfläche Drucken: Strg+P prüft den Code nicht.',
    printKitCodeChanged:
      'Der Code des Abends hat sich geändert: Das Blatt unten ist aktuell. Werfen Sie die alten weg.',
    printKitClosed:
      'Dieser Abend ist beendet: Gäste, die scannen, können nicht mehr beitreten. Wenn Sie ihn wieder öffnen, gilt derselbe Code wieder.',
    printKitDraft: 'Gäste können erst beitreten, wenn der Abend eröffnet wird.',
    printKitArchived: 'Diese Veranstaltung ist archiviert: Ihr QR-Code führt nirgendwohin mehr.',
    printKitBack: 'Zurück zur Veranstaltung',
    printKitLongLink: 'Der Link ist lang, der QR-Code wird klein. Nehmen Sie lieber das Plakat.',
    printKitPreview: 'Vorschau des Blatts',
    /* Spec 28: the designs of the printed card and what the host writes on it. */
    printDesignNames: {
      essentiel: 'Schlicht',
      classique: 'Klassisch',
      ticket: 'Kassenbon',
      bd: 'Comic',
      magazine: 'Magazin',
      souvenir: 'Erinnerung',
      postale: 'Postkarte',
      billet: 'Eintrittskarte',
      embarquement: 'Bordkarte',
      jetable: 'Einwegkamera',
      affiche: 'Plakat',
      confettis: 'Konfetti',
      seventies: 'Siebziger',
      nuit: 'Nacht',
      guirlande: 'Girlande',
    },
    printSwatchNames: {
      coral: 'Koralle',
      raspberry: 'Himbeere',
      plum: 'Pflaume',
      lavender: 'Lavendel',
      navy: 'Nachtblau',
      ocean: 'Ozean',
      fir: 'Tanne',
      olive: 'Oliv',
      mustard: 'Senf',
      terracotta: 'Terrakotta',
      charcoal: 'Anthrazit',
    },
    printKitDesign: 'Vorlage',
    printKitTexts: 'Texte der Karte',
    printKitTitleField: 'Titel',
    printKitTitleHint: 'Leer gelassen steht hier der Name der Veranstaltung.',
    printKitTagline: 'Aufmacher',
    printKitNote: 'Kurze Nachricht',
    printKitDate: 'Datum und Ort',
    printKitTable: 'Tisch',
    printKitDateExample: '14. Juni 2026 · Gut Lindenhof',
    printKitTableHint: 'Nummer oder Name, optional.',
    printKitOptional: 'Optional.',
    printKitSteps: 'Die drei Schritte, auf den Vorlagen mit Platz dafür',
    printKitPhoto: 'Foto',
    printKitPhotoChoose: 'Foto auswählen',
    printKitPhotoRemove: 'Foto entfernen',
    printKitPhotoHint:
      'Das Foto bleibt in diesem Browser: Es wird nicht hochgeladen, und ein anderes Gerät sieht es nicht.',
    printKitPhotoFailed:
      'Dieses Bild kann nicht gelesen werden. Versuchen Sie ein JPEG- oder PNG-Foto.',
    printKitFocusX: 'Ausschnitt waagerecht',
    printKitFocusY: 'Ausschnitt senkrecht',
    printKitColour: 'Farbe der Karte',
    printKitColourEvent: 'Farbe der Veranstaltung',
    printKitColourCustom: 'Andere Farbe',
    printKitInkHeavy: 'Vollflächiger Hintergrund: Diese Vorlage braucht viel Tinte.',
    printWorkshopLabel: 'Karteneinstellungen',
    printPanelTexts: 'Texte',
    printPanelColours: 'Farben',
    printPanelPrint: 'Drucken',
    printKitColoursHint: 'Karte und QR-Code zusammen: Sie beurteilen den Kontrast auf einen Blick.',
    printFormatShortCard: 'A6-Karten ×4',
    printFormatShortA5: 'A5 ×2',
    printFormatShortA4: 'A4-Plakat',
    printToolbarLabel: 'Format und Druck',
    printViewLabel: 'Vorschau',
    printViewCard: 'Eine Karte',
    printViewSheet: 'Der Bogen',
    printSeeBig: 'Groß ansehen',
    printCloseBig: 'Vorschau schließen',
    printPhotoDragHint:
      'Ziehen Sie das Foto auf der Karte, um den Ausschnitt zu wählen, oder nutzen Sie die Regler.',
    printPanelPrintLead:
      'Prüfen Sie den Bogen und drucken Sie dann über die Leiste über der Vorschau.',
    storageLabel: 'Belegter Speicher für Fotos',
    storage: (used: string) => `${used} belegt`,
    rotateJoinCodeTitle: 'Code der Feier ändern?',
    codeRotated: 'Neuer Code aktiv. Der alte funktioniert nicht mehr.',
    settingsReadOnly:
      'Diese Veranstaltung ist archiviert: Die Einstellungen können nicht mehr geändert werden.',
    settingsOwnerOnly: 'Nur der Eigentümer der Veranstaltung kann ihre Einstellungen ändern.',
    /* The settings page in sections, saved as the host changes it. */
    settingsPage: {
      guests: 'Gäste',
      guestbook: 'Gästebuch',
      wall: 'Bildschirm im Saal',
      schedule: 'Zeitplan und Aufbewahrung',
      autosave: 'Jede Änderung wird sofort gespeichert.',
      saving: 'Wird gespeichert…',
      saved: 'Änderungen gespeichert',
      saveFailed: 'Die letzte Änderung wurde nicht gespeichert.',
      manual: 'Jedes Foto wird geprüft',
      auto: 'Automatische Veröffentlichung',
      clipsOn: 'Videos erlaubt',
      clipsOff: 'keine Videos',
      guestSaveOn: 'Fotos speicherbar',
      guestSaveOff: 'Fotos nicht speicherbar',
      open: 'Offen',
      closed: 'Geschlossen',
      onWall: 'Nachrichten auf dem Bildschirm',
      voice: 'Sprachnachrichten',
      on: 'Aktiviert',
      off: 'Deaktiviert',
      timed: 'Enthüllung zu fester Uhrzeit',
      byHand: 'Enthüllung von Hand',
      qrOn: 'QR sichtbar',
      qrOff: 'ohne QR',
      sound: 'Ton bei jedem Foto',
      logo: 'mit Logo',
      venuePhoto: 'Foto des Ortes',
      opensAt: 'Öffnung geplant',
      opensByHand: 'Öffnung von Hand',
      closesAt: 'Ende geplant',
      closesByHand: 'Ende von Hand',
      keptForever: 'Fotos unbegrenzt aufbewahrt',
      deletedAfter: (days: number) =>
        t.count(days, {
          one: `Fotos ${t.number(days)} Tag nach dem Ende gelöscht`,
          other: `Fotos ${t.number(days)} Tage nach dem Ende gelöscht`,
        }),
      confirmAutoTitle: 'Automatisch veröffentlichen?',
      confirmRevealTitle: 'Die Einwegkamera jetzt aktivieren?',
    },
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
    guestsEmpty: 'Noch niemand ist der Feier beigetreten.',
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
    /* ---- Added by the host lifecycle pass (revue UX 30/10). ---- */
    noticeOpened: 'Veranstaltung für Gäste geöffnet.',
    noticeClosed: 'Veranstaltung beendet. Gäste können keine Fotos mehr senden.',
    noticeReopened: 'Veranstaltung wieder geöffnet: Gäste können wieder Fotos senden.',
    noticeArchived: 'Veranstaltung archiviert. Das Album bleibt herunterladbar.',
    noticeArchivedDraft: 'Veranstaltung archiviert.',
    archiveTitle: (eventName: string) => `${eventName} archivieren?`,
    archiveHint:
      'Der Bildschirm stoppt, die Einstellungen werden eingefroren, und das ist endgültig. Das Album bleibt herunterladbar.',
    archiveDraftHint:
      'Die Einstellungen werden eingefroren, und die Veranstaltung kann nie mehr geöffnet werden: Das ist endgültig.',
    openTitle: (eventName: string) => `${eventName} für Gäste öffnen?`,
    openHint:
      'Alle mit dem QR-Code können dann Fotos senden. Eine Rückkehr zum Entwurf ist nicht mehr möglich.',
    wallDraftHint: 'Schaltet sich von selbst ein, sobald die Veranstaltung für Gäste öffnet',
    codeRotatedAction: 'Neuen QR-Code drucken',
    afterShare: 'Album teilen',
    nowDraftEyebrow: 'Vor dem Abend',
    nowDraftTitle: 'Alles bereit?',
    nowDraftSettings: 'Stimmung und Zeiten wählen',
    nowDraftPrint: 'Tischkarten drucken',
    nowDraftWall: 'Die Leinwand am Beamer testen',
    nowDraftModerators: 'Jemanden zum Mitmoderieren einladen',
    nowLiveEyebrow: 'Live',
    nowLiveTitle: 'Der Abend läuft',
    nowClosedEyebrow: 'Abend beendet',
    nowClosedTitle: 'Zeit für die Erinnerungen',
    nowArchivedEyebrow: 'Veranstaltung archiviert',
    nowArchivedTitle: 'Das Album bleibt Ihnen',
    moderationWaiting: (count: number) =>
      count === 1 ? '1 Foto wartet auf Ihre Freigabe' : `${count} Fotos warten auf Ihre Freigabe`,
    moderationNothingWaiting: 'Nichts wartet auf Ihre Freigabe',
    wallTileHint: 'In einem neuen Tab, für den Beamer',
    downloadHint: 'Das ganze Album als eine ZIP-Datei',
    shareHint: 'Ein Link für alle, die nicht dabei waren',
    accessTitle: 'Zum Abend dazukommen',
    copyJoinLink: 'Link kopieren',
    joinLinkCopied: 'Link kopiert.',
    joinLinkCopyFailed: 'Der Link konnte nicht kopiert werden: Markieren Sie ihn von Hand.',
    qrEnlarge: 'QR-Code groß anzeigen',
    qrEnlargedHint: 'Ihre Gäste scannen diesen Bildschirm oder tippen den Code ein.',
    /* The first visit's guided tour of this page (features/admin/eventTour.ts). */
    tourButton: 'Rundgang',
    tourWelcomeTitle: 'Willkommen bei Ihrer Veranstaltung',
    tourWelcomeBody: (name: string) =>
      `Hier bereiten Sie „${name}“ vor, steuern den Abend selbst und holen danach das Album. Sollen wir uns die Seite kurz ansehen?`,
    tourWelcomeModeratorTitle: 'Willkommen im Team',
    tourWelcomeModeratorBody: (name: string) =>
      `Sie moderieren „${name}“. Sollen wir uns kurz ansehen, was Sie hier finden?`,
    tourNowTitle: 'Was jetzt zählt',
    tourNowBody:
      'Diese Karte folgt dem Abend: vorher, was noch vorzubereiten ist; währenddessen Moderation und Bildschirm; danach das Album. Fangen Sie immer hier an.',
    tourAccessTitle: 'Ihre Gäste hereinlassen',
    tourAccessBody:
      'Sie scannen diesen QR-Code oder tippen den Code ein: keine App, kein Konto. Drucken Sie die Tischkarten oder zeigen Sie den QR-Code am Abend groß an.',
    tourOpenTitle: 'Vor dem Öffnen geht nichts hinaus',
    tourOpenBody:
      'Solange die Veranstaltung ein Entwurf ist, kann niemand ein Foto senden. Öffnen Sie sie hier, wenn es so weit ist, oder planen Sie die Öffnung in den Einstellungen.',
    tourCloseTitle: 'Den Abend zur richtigen Zeit beenden',
    tourCloseBody:
      'Gäste senden Fotos, bis Sie die Veranstaltung hier beenden oder bis zu der in den Einstellungen geplanten Zeit.',
    tourAfterTitle: 'Erneut öffnen oder archivieren',
    tourAfterBody:
      'Der Abend ist vorbei: Es kann nichts mehr gesendet werden. Öffnen Sie ihn bei Bedarf erneut oder archivieren Sie ihn, sobald das Album gesichert ist.',
    tourEveningTitle: 'Die zwei Handgriffe am Abend',
    tourEveningBodyManual:
      'Moderieren: Jedes Foto wartet auf Ihre Freigabe, bevor es erscheint, am Laptop oder am Handy. Bildschirm öffnen: die Seite, die im Vollbild über den Beamer läuft.',
    tourEveningBodyAuto:
      'Moderieren: Fotos erscheinen, sobald sie ankommen, und Sie nehmen mit einem Handgriff herunter, was nicht auf den Bildschirm gehört. Bildschirm öffnen: die Seite, die im Vollbild über den Beamer läuft.',
    tourOverviewTitle: 'Alles andere ist hier',
    tourOverviewBody:
      'Gästebuch, Foto-Challenge, Gäste, Album … Das Menü ordnet die ganze Veranstaltung in drei Momente: Vorbereiten, die Feier, danach. Jedes Thema hat seine eigene Seite.',
    tourEndTitle: 'Jetzt sind Sie dran',
    tourEndBody:
      'Mit dieser Schaltfläche starten Sie den Rundgang jederzeit neu. Einen schönen Abend!',
    overviewHints: {
      guestbook: 'Die Worte Ihrer Gäste',
      challenge: 'Eine Foto-Challenge auf Zeit',
      missions: 'Fotoideen zum Umsetzen',
      moderators: 'Gemeinsam moderieren',
      bestOf: 'Ihre Lieblingsfotos',
      book: 'Ein Fotobuch zum Drucken',
      stats: 'Wer was gepostet hat, und wann',
      settings: 'Stimmung, Zeiten, Leinwand',
    },
    autoOpenAt: (time: string) => `Öffnet automatisch um ${time}`,
    autoOpenOn: (dateTime: string) => `Öffnet automatisch am ${dateTime}`,
    autoCloseAt: (time: string) => `Endet automatisch um ${time}`,
    autoCloseOn: (dateTime: string) => `Endet automatisch am ${dateTime}`,
    autoEdit: 'Zeitplan ändern',
    scheduleDiscardedAction: 'Neuen Zeitplan festlegen',

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
    bestOf: 'Best-of',
    bestOfHint: 'Ihre Lieblingsfotos zum Mitnehmen nach dem Fest.',
    bestOfCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Favorit`,
        other: `${t.number(count)} Favoriten`,
      }),
    bestOfNone:
      'Noch keine Favoriten. Markieren Sie Ihre Lieblingsfotos in der Moderation mit einem Stern.',
    bestOfPreselect: 'Beliebteste Fotos vorauswählen',
    bestOfPreselected: (limit: number) =>
      `Die ${t.number(limit)} beliebtesten Fotos sind jetzt Favoriten. Sie können welche entfernen oder hinzufügen.`,
    bestOfPreselectNothing:
      'Nichts hinzuzufügen: Die beliebtesten Fotos sind bereits Favoriten, oder noch niemand hat reagiert.',
    bestOfDownload: 'Favoriten herunterladen (ZIP)',
    exportBusy: (seconds: number | null) =>
      seconds === null
        ? 'Für Ihr Konto läuft bereits ein Export.'
        : `Für Ihr Konto läuft bereits ein Export. ${t.count(seconds, {
            one: `Versuchen Sie es in ${t.number(seconds)} Sekunde erneut.`,
            other: `Versuchen Sie es in ${t.number(seconds)} Sekunden erneut.`,
          })}`,
    exportNotReady: (seconds: number | null) =>
      seconds === null
        ? 'Der Server bereitet bereits andere Exporte vor.'
        : `Der Server bereitet bereits andere Exporte vor. ${t.count(seconds, {
            one: `Versuchen Sie es in ${t.number(seconds)} Sekunde erneut.`,
            other: `Versuchen Sie es in ${t.number(seconds)} Sekunden erneut.`,
          })}`,
    exportFailed:
      'Der Download konnte nicht gestartet werden. Versuchen Sie es gleich noch einmal.',
    // Spec 04: the photo book (a PDF of the published album) on the event page.
    book: 'Fotobuch',
    bookHint: 'Ein PDF-Buch mit dem Album, bereit zum Versenden oder zum Drucken.',
    bookStyleLegend: 'Stil',
    bookStyleNames: {
      classique: 'Klassisch',
      magazine: 'Magazin',
      souvenir: 'Souvenir',
    },
    bookStyleHints: {
      classique: 'Schlicht, elfenbeinfarbenes Papier',
      magazine: 'Große Fotos, große Titel',
      souvenir: 'Polaroids und handgeschriebene Worte',
    },
    bookStyleFromWall: 'Nach dem Ambiente Ihrer Leinwand gewählt.',
    bookTitle: 'Titel',
    bookSubtitle: 'Untertitel',
    bookSubtitleHint: 'Leer gelassen: das Datum des Abends.',
    bookPhotosLegend: 'Fotos',
    bookSelectionAll: (count: number) => `Alle Fotos (${t.number(count)})`,
    bookSelectionAllTooMany: (max: number) =>
      `Mehr als ${t.number(max)} Fotos: Wählen Sie eine Auswahl.`,
    bookSelectionBest: 'Eine Auswahl',
    bookSelectionBestHint:
      'Die mit einem Stern markierten Fotos, mindestens eines pro Fotograf, dann die beliebtesten, über den ganzen Abend verteilt.',
    bookLengthLegend: 'Umfang der Auswahl',
    bookLengthNames: {
      short: 'Kurz',
      medium: 'Mittel',
      long: 'Lang',
    },
    bookLengthChip: (name: string, photos: number) => `${name} · ${t.number(photos)} Fotos`,
    bookOptionsLegend: 'Inhalt',
    bookShowAuthors: 'Vornamen',
    bookShowAuthorsHint: 'Unter den Fotos, unter den Gästebuch-Worten und auf der Dankesseite.',
    bookShowCaptions: 'Bildunterschriften',
    bookGuestbook: 'Worte aus dem Gästebuch',
    bookGuestbookHint: (count: number, max: number) =>
      `${t.count(count, { one: '1 geschriebene Nachricht', other: `${t.number(count)} geschriebene Nachrichten` })}.${count > max ? ` Die ersten ${t.number(max)} kommen ins Buch.` : ''} Sprachnachrichten kommen nicht ins Buch.`,
    bookPrintVersion: 'Version für die Druckerei',
    bookPrintVersionHint:
      'Zwei zusätzliche Dateien mit Beschnitt, zum Senden an eine Online-Druckerei.',
    bookFormNote:
      'Nur veröffentlichte Fotos sind enthalten. Die Seitenzahl wird angegeben, sobald das Buch fertig ist.',
    bookCreate: 'Fotobuch erstellen',
    bookRebuild: 'Fotobuch neu erstellen',
    bookRecreate: 'Fotobuch erneut erstellen',
    bookWorking: 'Das Fotobuch wird vorbereitet …',
    bookWorkingDetail: (style: string, target: number | null) =>
      `Stil ${style}, ${target === null ? 'alle Fotos' : `etwa ${t.number(target)} Fotos`}. Sie können diese Seite verlassen.`,
    bookDone: (photos: number, ofAlbum: number | null, pages: number, until: string | null) =>
      `Fotobuch fertig: ${t.count(pages, { one: `${t.number(pages)} Seite`, other: `${t.number(pages)} Seiten` })}, ${t.count(photos, { one: `${t.number(photos)} Foto`, other: `${t.number(photos)} Fotos` })}${ofAlbum === null ? '' : ` (das Album enthält jetzt ${t.number(ofAlbum)})`}.${until === null ? '' : ` Verfügbar bis ${until}.`}`,
    bookDownload: 'Fotobuch herunterladen',
    bookDownloadMeta: (size: string) => `PDF · ${size}`,
    bookDownloadPrintInterior: 'Druckversion: Innenteil',
    bookDownloadPrintCover: 'Druckversion: Umschlag',
    bookPrintSkippedTooManyPages: (pages: number, max: number) =>
      `Druckversion nicht erstellt: Das Buch hat ${t.number(pages)} Seiten, Druckereien nehmen höchstens ${t.number(max)} an. Wählen Sie eine kürzere Auswahl und erstellen Sie das Buch erneut.`,
    bookPrintSkippedTooLarge:
      'Druckversion nicht erstellt: Die Dateien sind zu groß. Wählen Sie eine kürzere Auswahl und erstellen Sie das Buch erneut.',
    bookHelpLink: 'Wie lasse ich es drucken?',
    bookHelpIntro: 'Die Druckversion besteht aus zwei Dateien desselben Buchs.',
    bookHelpStep1:
      'Wählen Sie eine Online-Druckerei, die ein PDF für ein quadratisches Buch von 21 × 21 cm mit festem Einband annimmt.',
    bookHelpStep2:
      'Senden Sie Innenteil und Umschlag. Die Umschlagdatei enthält zwei Seiten: erst die Rückseite, dann die Vorderseite.',
    bookHelpStep3:
      'Gestalten Sie den Buchrücken mit dem Werkzeug der Druckerei und bestellen Sie zuerst ein Probeexemplar.',
    bookDelete: 'Fotobuch löschen',
    bookDeleteTitle: 'Fotobuch löschen?',
    bookDeleteHint:
      'Die Datei wird vom Server gelöscht. Sie können ein neues erstellen, höchstens drei pro Tag.',
    bookStale:
      'Das Fotobuch wurde zurückgezogen, weil ein Inhalt entfernt oder eine Bildunterschrift geändert wurde. Erstellen Sie es erneut: Ihre Auswahl bleibt erhalten.',
    bookFailed: 'Das Fotobuch konnte nicht erstellt werden. Versuchen Sie es gleich noch einmal.',
    bookFailedTooLarge: 'Das Album ist zu groß für ein einzelnes Fotobuch.',
    // Spec 08, step 2: the highlight video.
    reelTitle: 'Highlight-Video',
    reelHint: 'Ein Diashow-Video Ihrer Favoriten, das älteste zuerst.',
    reelCreate: 'Video erstellen',
    reelRedo: 'Erneut erstellen',
    reelQueued: 'Das Video wartet auf seinen Durchlauf…',
    reelRunning: 'Das Video wird erstellt, das kann einige Minuten dauern…',
    reelFailed: 'Das Video konnte nicht erstellt werden.',
    reelStale:
      'Ihre Favoriten haben sich geändert: Dieses Video ist veraltet. Erstellen Sie es erneut.',
    reelDownload: 'Video herunterladen (MP4)',
    reelPlayer: 'Vorschau des Highlight-Videos',
    reelAsked: 'Das Video wurde gestartet.',
    reelReady: (count: number) => `Video fertig, ${t.number(count)} Fotos.`,
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
    welcomeMessage: 'Willkommensnachricht',
    welcomeMessageHint:
      'Ein paar Worte, die Ihre Gäste sehen, wenn sie der Feier beitreten. Schreiben Sie in der Sprache Ihrer Gäste: Dieser Text wird nicht übersetzt. Jeder mit dem QR-Code kann ihn lesen, schreiben Sie also nichts Privates hinein.',
    welcomeMessagePlaceholder:
      'Willkommen! Machen Sie Fotos, wir sehen sie auf dem Bildschirm im Saal.',
    welcomeMessageClear: 'Nachricht löschen',
    welcomeMessageCount: (count, max) => `${count} / ${max}`,
    logo: 'Logo der Veranstaltung',
    logoHint:
      'Ein Logo oder Monogramm, am besten als PNG mit transparentem Hintergrund (PNG, JPEG oder WebP). Es erscheint auf der Seite Ihrer Gäste und auf dem Bildschirm, nie auf den Fotos.',
    logoPreviewAlt: 'Vorschau des Veranstaltungslogos',
    logoNone: 'Noch kein Logo.',
    logoChoose: 'Logo auswählen',
    logoReplace: 'Logo ersetzen',
    logoRemove: 'Logo entfernen',
    logoBusy: 'Logo wird hochgeladen…',
    logoSaved: 'Das Logo ist gespeichert.',
    logoRemoved: 'Das Logo ist entfernt.',
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

  /** The guestbook, host side (spec 01). What guests write is never translated. */
  guestbookHost: {
    title: 'Gästebuch',
    hint: 'Die Nachrichten Ihrer Gäste. Sie erscheinen je nach Einstellung auf dem Bildschirm.',
    empty: 'Noch keine Nachrichten.',
    anonymous: 'Gast ohne Namen',
    pending: (count: number) =>
      t.count(count, {
        one: '1 wartet',
        other: `${t.number(count)} warten`,
      }),
    statusPending: 'Wartet',
    statusPublished: 'Auf dem Bildschirm',
    statusRejected: 'Nicht übernommen',
    statusHidden: 'Vom Bildschirm genommen',
    copyId: 'Kennung kopieren',
    idCopied: 'Kennung kopiert.',
    copyFailed: 'Kopieren nicht möglich: Markieren Sie die Kennung von Hand.',
    openMessages: 'Nachrichten moderieren',
    onWall: (count: number) => `${t.number(count)} auf dem Bildschirm`,
  },

  /**
   * The voice messages in the host's console and settings (spec 25): the card, the secret, the
   * action that keeps what waits, and the settings section. What a guest says is never here.
   * The interface says "gardé secret" / "kept secret", never the code's word for it. Never "IA",
   * "intelligent" or "transcription" in a sentence of this table.
   */
  guestbookVoiceHost: {
    cardLabel: (author: string, duration: string) => `Sprachnachricht von ${author}, ${duration}`,
    duration: (duration: string) => `Dauer: ${duration}`,
    voiceBadge: 'Sprachnachricht',
    processing: 'Wird verarbeitet',
    processingCount: (count: number) =>
      t.count(count, {
        one: '1 Sprachnachricht wird verarbeitet',
        other: `${t.number(count)} Sprachnachrichten werden verarbeitet`,
      }),
    sealedCard: 'Geheim gehalten bis zum Ende des Abends',
    sealedCardReveal: 'Geheim gehalten bis zur Enthüllung des Abends',
    sealedUntil: (time: string) => `Geheim gehalten bis ${time}`,
    sealedUntilOrReveal: (time: string) =>
      `Geheim gehalten bis ${time} oder bis zur Enthüllung des Abends`,
    notListened: 'Sie haben diese Nachricht nicht angehört',
    cannotHide: 'Eine Sprachnachricht lässt sich nicht ausblenden: Sie ist nie auf dem Bildschirm.',
    keepPending: (count: number) =>
      t.count(count, {
        one: 'Die wartende Nachricht behalten',
        other: `Die ${t.number(count)} wartenden Nachrichten behalten`,
      }),
    keepConfirm: 'Sie haben nicht alle diese Nachrichten angehört. Im Album behalten?',
    keepConfirmLabel: 'Behalten',
    kept: (count: number) =>
      t.count(count, {
        one: '1 Sprachnachricht behalten.',
        other: `${t.number(count)} Sprachnachrichten behalten.`,
      }),
    settingsEnabled: 'Sprachnachrichten',
    settingsEnabledHint:
      'Wenn Sie Sprachnachrichten im Lauf des Abends einschalten, muss jeder Gast vor seiner nächsten Nachricht den Hinweis erneut lesen: besser vorher einschalten.',
    settingsSealed: 'Sprachnachrichten bis zum Ende des Abends geheim halten',
    settingsSealedReveal: 'Sprachnachrichten bis zur Enthüllung geheim halten',
    settingsSealedHint:
      'Sie können sie bis dahin nicht anhören. Sie können trotzdem entscheiden, sie zu behalten oder abzulehnen.',
    settingsSealedRevealHint:
      'Bei einem Abend, der erst später entwickelt wird, öffnen sie sich, wenn Sie den Abend enthüllen, oder an seinem Ende. Vorher können Sie sie nicht anhören. Sie können trotzdem entscheiden, sie zu behalten oder abzulehnen.',
    openNow: 'Jetzt öffnen',
    openConfirmTitle: 'Sprachnachrichten öffnen?',
    openConfirmBody: 'Sie können sie sofort anhören. Das lässt sich nicht rückgängig machen.',
    opened: 'Die Sprachnachrichten sind geöffnet.',
    insecure: 'Diese Adresse ist nicht sicher: Ihre Gäste können nichts aufnehmen',
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
    recoveryCodesCopyFailed:
      'Kopieren ist hier nicht möglich: Markieren Sie die Codes und kopieren Sie sie selbst.',
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
      'Ändern Sie zuerst Ihr Passwort: Der Rest Ihres Bereichs bleibt bis dahin geschlossen.',
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
    openConsole: 'Vollständige Ansicht für den Computer',
    intro: 'Wischen Sie das Foto nach rechts zum Freigeben, nach links zum Ablehnen.',
    releaseToPublish: 'Loslassen zum Freigeben',
    releaseToReject: 'Loslassen zum Ablehnen',
    nowDeciding: (photo: string) => `Foto zur Moderation. ${photo}`,
    undoLast: 'Letzte Entscheidung rückgängig machen',
    undoUnavailable: 'Nur eine Freigabe lässt sich rückgängig machen.',

    /* ---- Moderation traps pass (MOD-2). Keep additions inside this block. ---- */
    onScreenTitle: 'Neueste Fotos auf dem Bildschirm',
    onScreenHint: 'Tippen Sie auf ein Foto, um es vom Bildschirm zu nehmen.',
    onScreenEmpty: 'Gerade ist nichts auf dem Bildschirm.',
    openOnScreen: (author: string) => `Foto von ${author} ansehen, auf dem Bildschirm`,
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
    liveWindowEnd: (date: string) => `Die Veranstaltung endet am ${date}.`,
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
    eventsCell: (total: number, live: number) => `${t.number(total)} (${t.number(live)} laufend)`,
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
    linkCopyFailed:
      'Kopieren ist hier nicht möglich: Markieren Sie den Link und kopieren Sie ihn selbst.',
    invitationValidUntil: (date: string) => `Gültig bis ${date}.`,

    ceilingsLegend: 'Grenzen',
    maxEvents: 'Veranstaltungen, höchstens',
    maxEventsPerPeriod: 'Veranstaltungen pro Zeitraum, höchstens',
    maxTotalGigabytes: 'Gesamtspeicher in GB',
    maxEventQuotaGigabytes: 'Kontingent einer Veranstaltung in GB',
    maxRetentionDays: 'Aufbewahrung nach dem Ende, in Tagen, höchstens',
    maxLiveDays: 'Dauer einer laufenden Veranstaltung, in Tagen, höchstens',
    clipsAllowed: 'Videos erlaubt',
    booksAllowed: 'Fotobücher (PDF) erlaubt',
    channelsAllowed: 'Messenger-Gruppen (Telegram) erlaubt',
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
      'Gäste können seinen Veranstaltungen nicht mehr beitreten und keine Fotos mehr senden, die Öffentlichkeit sieht seine Bildschirme und Alben nicht mehr, und seine Mitglieder können nichts mehr ändern. Nichts wird gelöscht, und kein Konto wird deaktiviert.',
    suspended: 'Kunde gesperrt.',
    resume: 'Sperre aufheben',
    resumeTitle: 'Sperre aufheben?',
    resumeBody:
      'Die Bildschirme und Alben des Kunden sind sofort wieder sichtbar, und seine Gäste können wieder beitreten und Fotos senden.',
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
      live: 'Läuft',
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
      'Laufende Veranstaltungen werden beendet, Entwürfe archiviert, der Kunde wird gesperrt, und seine Alben werden spätestens nach der von Ihnen gesetzten Frist gelöscht: So lange hat der Kunde Zeit, zu exportieren, was er behalten will (die Aufbewahrung einer Veranstaltung oder die Grenzen des Kunden können früher löschen). Danach werden die Konten, die nur ihm gehörten und sonst nichts halten, gelöscht, und mit ihnen der Kunde.',
    graceDays: 'Frist bis zur Löschung, in Tagen',
    graceDaysHint: 'Eine ganze Zahl von Tagen: Die Grenzen setzt der Server.',
    offboardAction: 'Zusammenarbeit beenden',
    offboardConfirmTitle: 'Die Zusammenarbeit mit diesem Kunden beenden?',
    offboardConfirmBody: (days: number) =>
      t.count(days, {
        one: `Spätestens in ${t.number(days)} Tag werden die Alben dieses Kunden gelöscht, danach der Kunde mit den Konten, die nur ihm gehörten und sonst nichts halten. Unwiderruflich: Weder das Datum noch die Sperre lassen sich ändern. Bis dahin werden seine laufenden Veranstaltungen beendet, seine Entwürfe archiviert und der Kunde gesperrt.`,
        other: `Spätestens in ${t.number(days)} Tagen werden die Alben dieses Kunden gelöscht, danach der Kunde mit den Konten, die nur ihm gehörten und sonst nichts halten. Unwiderruflich: Weder das Datum noch die Sperre lassen sich ändern. Bis dahin werden seine laufenden Veranstaltungen beendet, seine Entwürfe archiviert und der Kunde gesperrt.`,
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
      'Suchen Sie die gemeldete Veranstaltung über ihre Adresse, den Code der Feier oder ihren genauen Namen. Sie sehen von ihr nur die ID und den Zustand.',
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
    takedownGuestbookTitle: 'Eine Gästebuch-Nachricht',
    takedownGuestbookIntro:
      'Fügen Sie die Kennung der Nachricht so ein, wie die Meldung sie angibt. Sie sehen nur die Veranstaltung, zu der sie gehört, und ihren Zustand, nie ihren Text.',
    takedownGuestbookLabel: 'Kennung der Nachricht',
    takedownGuestbookAction: 'Nachricht suchen',
    takedownGuestbookNone: 'Keine Nachricht hat diese Kennung.',
    takedownGuestbookHeading: (id: string) => `Nachricht ${id}`,
    takedownGuestbookOf: (id: string) => `In der Veranstaltung ${id}`,
    takedownGuestbookDown: 'Nachricht entfernen',
    takedownGuestbookUp: 'Nachricht wiederherstellen',
    takedownReason: 'Grund',
    takedownReasonHint:
      'Ein Satz in einer Zeile, höchstens 200 Zeichen, ohne E-Mail-Adresse. Er wird im Protokoll der Instanz festgehalten.',
    takedownUnknown:
      'Zustand unbekannt: Die Handlung ist möglicherweise erfolgt, suchen Sie erneut, um es zu erfahren.',
    takedownDone: 'Erledigt.',
    takedownOps: {
      eventDown: {
        title: 'Diese Veranstaltung entfernen?',
        body: 'Die Wand, der Gästefeed, der Albumlink und der Bereich des Gastgebers antworten, als gäbe es die Veranstaltung nicht, und offene Bildschirme schließen sich. Nichts wird gelöscht. Die Aufbewahrung läuft weiter: Um den Inhalt als Beweis zu behalten, sperren Sie auch seine Löschung.',
        confirm: 'Veranstaltung entfernen',
      },
      eventUp: {
        title: 'Diese Veranstaltung wieder online stellen?',
        body: 'Wand, Gäste, Album und Gastgeber bekommen sie so zurück, wie sie war.',
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
        body: 'Es verschwindet sofort von der Wand, aus dem Gästefeed, vom Albumlink und von den Bildschirmen des Gastgebers, und offene Bildschirme vergessen es. Die Datei bleibt erhalten. Der Gastgeber kann es nicht zurückholen.',
        confirm: 'Foto entfernen',
      },
      photoUp: {
        title: 'Dieses Foto wiederherstellen?',
        body: 'Es erscheint wieder mit dem Status, den der Gastgeber ihm gegeben hatte.',
        confirm: 'Foto wiederherstellen',
      },
      guestbookDown: {
        title: 'Diese Nachricht entfernen?',
        body: 'Sie verschwindet sofort von der Wand, aus der Liste der Gastgeberin oder des Gastgebers und aus der Liste ihres Autors; geöffnete Bildschirme vergessen sie. Der Text bleibt erhalten. Der Gastgeber kann sie nicht zurückholen, und ihr Autor bekommt den Platz nicht zurück.',
        confirm: 'Nachricht entfernen',
      },
      guestbookUp: {
        title: 'Diese Nachricht wiederherstellen?',
        body: 'Sie erscheint wieder in dem Zustand, den der Gastgeber ihr gegeben hatte.',
        confirm: 'Nachricht wiederherstellen',
      },
    },
  },

  /** The text on the printed sheet, in the language of the evening (spec 02). */
  printKit: {
    title: 'Teilen Sie Ihre Fotos vom Abend',
    step1: 'Scannen Sie den QR-Code mit der Kamera Ihres Handys.',
    step2: 'Senden Sie Ihre Fotos.',
    step3: 'Sie erscheinen auf dem Bildschirm des Abends.',
    fallback: (code: string, address: string) =>
      `Kein QR-Code? Geben Sie den Code ${code} auf ${address} ein.`,
    /* Spec 28: the words the designs print around the host's own. */
    table: (name: string) => `Tisch ${name}`,
    ourEvening: 'unser Abend',
    scanMe: 'Scannen Sie mich!',
    greetings: 'Grüße aus',
    seeYou: 'Bis gleich auf dem Bildschirm!',
    toScreen: 'An: den Bildschirm im Saal',
    ticketGuest: 'Gästekarte',
    freeEntry: 'Freier Eintritt',
    dateLabel: 'Datum',
    tableLabel: 'Tisch',
    seatLabel: 'Platz',
    everywhere: 'Überall',
    freeSeat: 'Frei',
    tonight: 'Heute Abend',
    scan: 'Scannen',
    stubLine: 'Ihre Fotos erscheinen auf dem Bildschirm des Abends.',
    boarding: 'Bordkarte',
    partyClass: 'Partyklasse',
    fromCode: 'TEL',
    toCode: 'BSM',
    fromName: 'Ihr Telefon',
    toName: 'Der Bildschirm im Saal',
    flight: 'Sonderflug',
    gate: 'Gate',
    allGates: 'Alle',
    boardingTime: 'Einsteigen',
    now: 'Jetzt',
    shortSteps: '1. Scannen · 2. Senden · 3. Auf den Bildschirm schauen',
    shots: 'Endloser Film',
    partyIso: 'ISO Party',
    issue: 'Sonderausgabe',
    headline: 'Titelgeschichte',
    freeIssue: 'Gratis',
    forAll: 'für alle',
    coverCta: 'Scannen, posten: Sie kommen aufs Titelbild',
    receipt1: 'Fotos des Abends',
    receipt2: 'Lachanfälle',
    receipt3: 'Missglückte Selfies',
    receipt4: 'Tanzschritte',
    price: '0,00',
    total: 'Summe',
    unlimited: 'Unbegrenzt',
    receiptFoot: 'Bon Nr. 000142 · Danke!',
    boom: 'Scannen!',
    meanwhileTable: (table: string) => `Währenddessen, an Tisch ${table}…`,
    meanwhile: 'Währenddessen, auf dem Bildschirm…',
  },
  /** The timed photo challenge (spec 10): the console's panel. The prompt inside it is content, never translated. */
  challenge: {
    title: 'Foto-Challenge',
    hint: 'Schreiben Sie, was Sie vom Saal verlangen. Der Text erscheint erst beim Start.',
    prompt: 'Text der Challenge',
    /** The text box's counter: how much of the sixty characters is used. */
    promptCount: (used: number, max: number) => `${t.number(used)} / ${t.number(max)}`,
    recent: 'Letzte Challenges',
    ideasTitle: 'Ideen',
    /** Ready-made challenges the host may take as they are or correct; each is at most 60 characters. */
    ideas: [
      'Ein Selfie mit Ihrem Tischnachbarn',
      'Der ganze Tisch auf einem Foto',
      'Das schönste Lächeln des Abends',
      'Ein Foto Ihrer Füße auf der Tanzfläche',
      'Ein Prosit in die Kamera',
      'Alle zusammen eine Grimasse',
    ],
    fromMission: 'Eine meiner Missionen',
    duration: 'Dauer',
    minutes: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Minute`,
        other: `${t.number(count)} Minuten`,
      }),
    launch: 'Als Challenge starten',
    stop: 'Stoppen',
    remaining: (time: string) => `Challenge läuft · ${time}`,
    notOpen: 'Eine Challenge lässt sich starten, sobald die Veranstaltung geöffnet ist.',
    ended: 'Challenge beendet',
    answers: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto`,
        other: `${t.number(count)} Fotos`,
      }),
    /** Said once to a screen reader when a challenge begins; the prompt in it is content. */
    announceStart: (prompt: string) => `Foto-Challenge gestartet: ${prompt}`,
    /** The box above "Envoyer" while a challenge runs (spec 18): checked, the photo answers it. */
    participate: 'Ich nehme an der Challenge teil',
    announceEnd: 'Foto-Challenge beendet',
  },
  /** The disposable camera (spec 23): the host's section, band and confirmation. The guest's and the wall's sentences come with their own surfaces. */
  reveal: {
    title: 'Einwegkamera',
    hint: 'Die Fotos bleiben für Gäste und Saal verborgen, bis sie enthüllt werden. Sie selbst sehen sie sofort nach dem Eintreffen.',
    enabled: 'Einwegkamera aktivieren',
    timed: 'Zu einer bestimmten Uhrzeit enthüllen',
    timedHint:
      'Ohne Uhrzeit enthüllen Sie selbst, mit der Schaltfläche „Jetzt enthüllen“ auf der Seite der Veranstaltung.',
    at: 'Uhrzeit der Enthüllung',
    atLocked: 'Der Abend ist bereits enthüllt: die Uhrzeit lässt sich nicht mehr verschieben.',
    shots: 'Aufnahmen pro Gast',
    shotsHint:
      'Eine Aufnahme ist ein gesendetes Foto. Ohne Limit schickt jeder Gast so viele Fotos, wie er möchte. Dieses Limit gilt auch ohne Enthüllung.',
    film: 'Filmlook',
    filmHint:
      'Auf den Bildschirmen sehen die Fotos aus wie von einem Film. Ihre Originale und Downloads bleiben unverändert.',
    liveWarning:
      'Es sind schon Fotos eingetroffen: die, die gerade auf dem Bildschirm sind, verschwinden bis zur Enthüllung.',
    countdown: (hours: number, minutes: number) =>
      hours > 0
        ? `Enthüllung in ${t.number(hours)} Std. ${String(minutes).padStart(2, '0')} Min.`
        : `Enthüllung in ${t.number(minutes)} Min.`,
    soon: 'Enthüllung in weniger als einer Minute',
    manual: 'Die Fotos bleiben verborgen, bis Sie sie enthüllen.',
    scheduledFor: (when: string) => `Enthüllung geplant für ${when}`,
    waiting: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} veröffentlichtes Foto wartet auf die Enthüllung`,
        other: `${t.number(count)} veröffentlichte Fotos warten auf die Enthüllung`,
      }),
    revealNow: 'Jetzt enthüllen',
    editTime: 'Uhrzeit ändern',
    revealedAt: (time: string) => `Enthüllt um ${time}`,
    revealedOn: (when: string) => `Enthüllt am ${when}`,
    confirmTitle: 'Jetzt enthüllen?',
    confirmPublished: (count: number) =>
      count === 0
        ? 'Noch kein Foto ist veröffentlicht.'
        : t.count(count, {
            one: 'Das veröffentlichte Foto erscheint an der Wand und auf den Handys.',
            other: `Die ${t.number(count)} veröffentlichten Fotos erscheinen an der Wand und auf den Handys.`,
          }),
    confirmPending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto wartet noch auf eine Entscheidung: es bleibt verborgen.`,
        other: `${t.number(count)} Fotos warten noch auf eine Entscheidung: sie bleiben verborgen.`,
      }),
    definitive: 'Dies lässt sich nicht rückgängig machen.',
    closeTitle: (name: string) => `„${name}“ beenden?`,
    closeHeld:
      'Die Fotos wurden noch nicht enthüllt. Nach dem Ende des Events bleiben sie verborgen, bis Sie sie enthüllen, und die Aufbewahrungsfrist der Fotos beginnt mit dem Abschluss.',
    closedNotRevealed:
      'Die Fotos wurden nicht enthüllt. Die Veranstaltung ist beendet: sie bleiben verborgen, bis Sie sie enthüllen.',
    closesBefore:
      'Das geplante Ende liegt vor der Enthüllung. Ohne Enthüllung bleiben die Fotos verborgen.',
    templateOn: 'Fotos verborgen bis zur Enthüllung',
    templateOff: 'Keine verzögerte Enthüllung',
    templateFilmOn: 'Filmlook auf dem Bildschirm',
    templateFilmOff: 'Kein Filmlook',
    wallAt: (time: string) => `Enthüllung um ${time}`,
    wallOn: (when: string) => `Enthüllung am ${when}`,
    wallSoon: 'Enthüllung bald',
    developing: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto wird entwickelt`,
        other: `${t.number(count)} Fotos werden entwickelt`,
      }),
    /* The guest's phone (spec 23): the roll, the veiled photographs, the hour and the moment of the reveal. */
    poses: (count: number) =>
      t.count(count, {
        one: `Noch ${t.number(count)} Aufnahme übrig`,
        other: `Noch ${t.number(count)} Aufnahmen übrig`,
      }),
    freshRoll: (count: number) =>
      t.count(count, {
        one: `Neuer Film: ${t.number(count)} Aufnahme`,
        other: `Neuer Film: ${t.number(count)} Aufnahmen`,
      }),
    rollEmpty: 'Film voll: Ihre Kamera ist leer',
    rollKept: (kept: number) =>
      t.count(kept, {
        one: 'Sie hatten noch 1 Aufnahme, das erste Foto wird behalten.',
        other: `Sie hatten noch ${t.number(kept)} Aufnahmen, die ersten ${t.number(kept)} Fotos werden behalten.`,
      }),
    undeveloped: 'Wird bei der Enthüllung entwickelt',
    guestAt: (time: string) => `Enthüllung um ${time}`,
    guestOn: (when: string) => `Enthüllung am ${when}`,
    guestLeft: (hours: number, minutes: number) =>
      hours > 0
        ? `in ${t.number(hours)} h ${String(minutes).padStart(2, '0')}`
        : `in ${t.number(minutes)} min`,
    guestSoon: 'in weniger als einer Minute',
    guestManual: 'Die Gastgeber enthüllen die Fotos im Laufe des Abends.',
    bannerManual: 'Enthüllung per Knopfdruck',
    bannerWaiting: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto wartet`,
        other: `${t.number(count)} Fotos warten`,
      }),
    guestIntro: 'Machen Sie Ihre Fotos: Sie werden bei der Enthüllung entwickelt.',
    guestIntroAt: (time: string) =>
      `Machen Sie Ihre Fotos: Sie werden bei der Enthüllung um ${time} entwickelt.`,
    guestIntroOn: (when: string) =>
      `Machen Sie Ihre Fotos: Sie werden bei der Enthüllung am ${when} entwickelt.`,
    noticeHeld: {
      afterReview:
        'Der Veranstalter gibt jedes Foto frei, und freigegebene Fotos erscheinen erst bei der Enthüllung auf dem Bildschirm. Er und seine Moderatoren sehen sie sofort nach dem Eintreffen.',
      immediate:
        'Die Fotos erscheinen erst bei der Enthüllung auf dem Bildschirm. Der Veranstalter und seine Moderatoren sehen sie sofort nach dem Eintreffen und können jedes davon jederzeit entfernen.',
    },
    noticeShots: (count: number) =>
      t.count(count, {
        one: `Sie haben ${t.number(count)} Aufnahme: Eine Aufnahme ist ein gesendetes Foto.`,
        other: `Sie haben ${t.number(count)} Aufnahmen: Eine Aufnahme ist ein gesendetes Foto.`,
      }),
    noticeFilm:
      'Der Filmlook existiert nur auf dem Bildschirm: Ihr Originalfoto bleibt unverändert gespeichert.',
    wallDeveloping: 'Die Fotos werden bei der Enthüllung entwickelt',
    developedNow: (count: number) =>
      t.count(count, {
        one: 'Ihr Foto wurde gerade entwickelt.',
        other: `Ihre ${t.number(count)} Fotos wurden gerade entwickelt.`,
      }),
    feedAt: (time: string) => `Die Fotos werden um ${time} enthüllt`,
    feedOn: (when: string) => `Die Fotos werden am ${when} enthüllt`,
    feedSoon: 'Die Fotos werden bald enthüllt',
    feedHint: 'Sie erscheinen hier bei der Enthüllung. Ihre eigenen Fotos bleiben in Ihrer Liste.',
    /* The shared gallery (spec 23): a link that opens before the reveal, and what a download is. */
    galleryHeld: (when: string) => `Die Fotos werden am ${when} enthüllt.`,
    galleryHeldSoon: 'Die Fotos werden bald enthüllt.',
    galleryOriginal: 'Der Download ist das Original, ohne Filmlook.',
  },
  /** Messaging channels (spec 27): the settings switch, the "Telegram group" panel and the badge of the moderation console. The group's title is content, never translated. */
  channels: {
    settingsSection: 'Messenger',
    allowTelegram: 'Fotos aus einer Telegram-Gruppe empfangen',
    allowTelegramHint:
      'Fotos und Videos aus der Gruppe laufen über Telegram, bevor sie hier ankommen; gespeichert werden nur der Vorname und ein Fingerabdruck des Telegram-Kontos. Sie folgen demselben Freigabemodus wie die Fotos Ihrer Gäste.',
    on: 'Aktiv',
    off: 'Inaktiv',
    notAllowed: 'In Ihrem Tarif nicht enthalten',
    noBot: 'Diese Installation hat keinen Telegram-Bot: Die Betreiber müssen einen einrichten.',
    notLive: 'Eine Gruppe lässt sich nur verbinden, solange die Veranstaltung geöffnet ist.',
    title: 'Telegram-Gruppe',
    hint: 'Fotos, die in einer Telegram-Gruppe gepostet werden, kommen hier an, wie die Fotos Ihrer Gäste.',
    step1: (bot: string) => `Fügen Sie @${bot} Ihrer Telegram-Gruppe hinzu.`,
    step2: 'Senden Sie in der Gruppe:',
    /** The word that connects a group, as the bot's profile lists it in this language (the bot accepts them all). */
    bindCommand: 'feier',
    copyCommand: 'Befehl kopieren',
    copied: 'Befehl kopiert',
    copyFailed:
      'Der Befehl konnte nicht kopiert werden: Markieren Sie ihn und kopieren Sie ihn von Hand.',
    visibility:
      'Der Bot muss die Fotos sehen können: Machen Sie ihn zum Administrator der Gruppe oder nutzen Sie einen Bot mit ausgeschaltetem Datenschutzmodus (diese Einstellung gilt nur für Gruppen, denen der Bot danach beitritt: Entfernen Sie ihn und fügen Sie ihn erneut hinzu).',
    listTitle: 'Verbundene Gruppen',
    none: 'Noch keine Gruppe verbunden.',
    boundOn: (date: string) => `verbunden am ${date}`,
    photos: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Foto empfangen`,
        other: `${t.number(count)} Fotos empfangen`,
      }),
    unlink: 'Trennen',
    ownerOnlyUnlink: 'Nur der Inhaber der Veranstaltung kann eine Gruppe trennen.',
    unlinkConfirmTitle: 'Diese Gruppe trennen?',
    unlinkConfirmBody: (title: string) =>
      `Der Bot nimmt keine Fotos mehr aus „${title}“ an. Er sagt es in der Gruppe und bleibt dort: Sie können ihn selbst entfernen.`,
    unlinked: 'Gruppe getrennt',
    viaTelegram: 'über Telegram',
  },
  /** Scheduled announcements (spec 21): the host's panel and the wall drawer's section. The text inside is content, never translated. */
  announcement: {
    title: 'Ansagen',
    hint: 'Ein Satz für den ganzen Saal, zur gewählten Uhrzeit. Er erscheint erst, wenn es so weit ist.',
    text: 'Text der Ansage',
    /** The text box's counter: how much of the eighty characters is used. */
    textCount: (used, max) => `${t.number(used)} / ${t.number(max)}`,
    ideasTitle: 'Ideen',
    /** Ready-made texts for a full-screen card; each is at most 80 characters. */
    ideas: ['Torte', 'Reden', 'Eröffnungstanz', 'Buffet eröffnet', 'Letztes Lied'],
    /** The same for a discreet one, which says something that stays true for a while; each at most 80 characters. */
    ideasDiscreet: [
      'Das Buffet ist eröffnet',
      'Der Fotobooth wartet auf Sie',
      'Letzte Runde an der Bar',
    ],
    time: 'Uhrzeit',
    timeHint: 'Leer lassen, um „Jetzt starten“ zu nutzen.',
    /** The line that says which moment the typed time is: the day, the time, and how far away it is. */
    resolvedToday: (time, lead) => `Heute ${time}, in ${lead}`,
    resolvedTomorrow: (time, lead) => `Morgen ${time}, in ${lead}`,
    resolvedOn: (date, time, lead) => `${date} ${time}, in ${lead}`,
    /** How far away, from whole minutes: "1 h 12", "45 min". */
    lead: (minutes) => {
      if (minutes <= 0) return 'einem Augenblick'
      if (minutes < 60) return `${minutes} Min.`
      const rest = minutes % 60
      const hours = Math.floor(minutes / 60)
      return rest === 0 ? `${hours} Std.` : `${hours} Std. ${String(rest).padStart(2, '0')} Min.`
    },
    far: 'Mehr als 12 Stunden entfernt: Prüfen Sie Uhrzeit und Tag.',
    kind: 'Art der Ansage',
    kindFullscreen: 'Vollbild',
    kindFullscreenHelp: 'Eine Karte in der Mitte des Bildschirms, für einige Sekunden.',
    kindDiscreet: 'Dezent',
    kindDiscreetHelp: 'Ein dezenter Text über den Fotos, 5 bis 30 Minuten lang.',
    countdown: 'Countdown',
    countdownNone: 'Keiner',
    duration: 'Dauer auf dem Bildschirm',
    /** A span of seconds as the chips say it: under a minute in seconds, from a minute in minutes. */
    span: (seconds) => (seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} Min.`),
    schedule: 'Planen',
    launchNow: 'Jetzt starten',
    save: 'Speichern',
    cancel: 'Abbrechen',
    edit: 'Bearbeiten',
    relaunch: 'Erneut starten',
    remove: 'Löschen',
    withdraw: 'Vom Bildschirm nehmen',
    editing: 'Ansage bearbeiten',
    textOnly: 'Diese Ansage ist auf dem Bildschirm: Nur ihr Text kann sich ändern.',
    listLabel: 'Ansagen der Feier',
    empty: 'Noch keine Ansagen.',
    loadFailed: 'Die Ansagen konnten nicht geladen werden.',
    notLive:
      'Die Feier ist noch nicht geöffnet: Die Ansage wird erst gezeigt, sobald der Bildschirm geöffnet ist.',
    /** The state the row is in, in words: never by colour alone. */
    states: {
      upcoming: 'Bevorstehend',
      counting: 'Countdown läuft',
      showing: 'Auf dem Bildschirm',
      over: 'Vorbei',
    },
  },
  exportPurge: {
    title: 'Löschung des Albums',
    deletesOn: (date: string, days: number) =>
      `Dieses Album wird am ${date} gelöscht (${t.count(days, { one: 'in 1 Tag', other: `in ${t.number(days)} Tagen` })}).`,
    deletesToday: (date: string) => `Dieses Album wird heute gelöscht, am ${date}.`,
    passed: 'Das vorgesehene Löschdatum ist verstrichen.',
    downloadFirst: 'Laden Sie es vorher herunter: Danach existiert es nirgends mehr.',
    downloadAlbum: 'Album herunterladen',
    directNote:
      'Der Server kann diesen direkten Download nicht prüfen: Mit der enthaltenen Datei MANIFEST.sha256 prüfen Sie ihn selbst.',
    prepare: 'Geprüftes Archiv vorbereiten',
    downloadArchive: 'Archiv herunterladen',
    rebuild: 'Archiv neu erstellen',
    working:
      'Archiv wird vorbereitet. Sie können diese Seite verlassen: Sie aktualisiert sich selbst.',
    digest: 'SHA-256-Prüfsumme',
    ready: (entries: number, size: string, sealedOn: string, until: string | null) =>
      `Archiv bereit: ${t.count(entries, { one: `${t.number(entries)} Datei`, other: `${t.number(entries)} Dateien` })}, ${size}, geprüft am ${sealedOn}.${until === null ? '' : ` Verfügbar bis ${until}.`}`,
    sent: (date: string) =>
      `Archiv am ${date} vollständig gesendet. Prüfen Sie Ihre Datei, bevor Sie irgendetwas löschen.`,
    incomplete: (missing: number) =>
      `Archiv bereit, aber ${t.count(missing, { one: `${t.number(missing)} Datei fehlte`, other: `${t.number(missing)} Dateien fehlten` })} auf dem Datenträger des Servers: ${t.count(missing, { one: 'sie ist nicht enthalten.', other: 'sie sind nicht enthalten.' })}`,
    voiceSecret: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Sprachnachricht wird noch geheim gehalten und würde ungehört gelöscht.`,
        other: `${t.number(count)} Sprachnachrichten werden noch geheim gehalten und würden ungehört gelöscht.`,
      }),
    voicePending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} Sprachnachricht wartet auf Ihre Entscheidung und wird nicht im Album sein.`,
        other: `${t.number(count)} Sprachnachrichten warten auf Ihre Entscheidung und werden nicht im Album sein.`,
      }),
    retired:
      'Das Archiv wurde zurückgezogen, weil ein Foto gelöscht wurde. Bereiten Sie es neu vor.',
    changed:
      'Das Album hat sich seit der Erstellung des Archivs geändert, deshalb wird es nicht mehr angeboten. Bereiten Sie es neu vor.',
    noRoom:
      'Der Server hat nicht genug Platz, um das Archiv vorzubereiten. Laden Sie das Album direkt herunter oder informieren Sie den Betreiber.',
    tooLarge:
      'Das Archiv wäre größer, als der Server vorzubereiten bereit ist. Laden Sie das Album direkt herunter.',
    failed:
      'Das Archiv konnte nicht vorbereitet werden. Versuchen Sie es erneut; wenn es sich wiederholt, wenden Sie sich an den Betreiber.',
    deleteNow: 'Jetzt löschen',
    deleteWithout: 'Ohne Archiv löschen …',
    needsArchive:
      'Um das Album jetzt zu löschen, bereiten Sie zuerst das geprüfte Archiv vor und laden es vollständig herunter.',
    needsDownload:
      'Um das Album jetzt zu löschen, laden Sie zuerst das Archiv vollständig herunter.',
    needsComplete:
      'Das Archiv ist unvollständig: Dateien fehlten auf dem Datenträger des Servers. Sie können das Album trotzdem löschen, nach einer Bestätigung.',
    wordPrompt: (word: string) =>
      `Dieses Album wurde nicht vollständig archiviert. Um es trotzdem zu löschen, tippen Sie ${word}.`,
    confirmWord: 'LÖSCHEN',
    wordLabel: 'Bestätigungswort',
  },
  /* Added by spec 29 (guest invitations): the page a guest opens from an invitation. */
  guestInvite: {
    page: {
      eyebrow: 'Einladung',
      when: 'Wann',
      where: 'Wo',
      itinerary: 'Route',
      agenda: 'Zu meinem Kalender hinzufügen',
      join: 'Zur Fotowand',
      live: 'Die Feier hat begonnen',
      tonight:
        'Kommen Sie am Abend auf diese Seite zurück, um Ihre Fotos auf der Fotowand der Feier zu teilen.',
      notOpen: 'Die Fotowand ist noch nicht geöffnet.',
      over: 'Diese Feier ist zu Ende. Danke fürs Kommen.',
      gone: 'Diese Einladung ist nicht mehr verfügbar',
      goneSub: 'Der Link wurde vielleicht vom Veranstalter geändert. Fragen Sie nach dem neuen.',
      report: 'Diese Einladung melden',
      madeWith: 'Einladung erstellt mit EventSlide',
      otherTz: (when: string, place: string) => `Das ist ${when} in ${place}`,
      loading: 'Einladung wird geladen',
      failed: 'Die Einladung konnte nicht geladen werden. Prüfen Sie Ihre Verbindung.',
      busy: 'Gerade öffnen viele Menschen diese Einladung. Versuchen Sie es gleich noch einmal.',
      retry: 'Erneut versuchen',
      logoAlt: (title: string) => `Logo von ${title}`,
    },
    host: {
      crumb: 'Einladungen',
      title: 'Einladungen',
      formTitle: 'Der Text',
      titleLabel: 'Titel',
      titleHint: (name: string) => `Standard: ${name}`,
      startLabel: 'Beginn',
      endLabel: 'Ende',
      zoneLine: (zone: string) => `Zeitzone: ${zone}`,
      zoneChange: 'Zeitzone ändern',
      zoneLabel: 'Zeitzone',
      zoneHint:
        'Die des Ortes der Feier: Die Uhrzeit der Einladung wird in dieser Zeitzone gelesen, wo auch immer der Gast ist. Beim Ändern der Zeitzone bleiben die eingegebenen Zeiten, wie sie sind.',
      venueLabel: 'Ort',
      addressLabel: 'Adresse',
      addressHint: '2 Zeilen',
      addressWarning:
        'Jeder, der den Link der Einladung hat, sieht diese Adresse bis zum Ende der Feier.',
      messageLabel: 'Ihre Nachricht',
      messageCount: (count: number, max: number) => `${count} / ${max}`,
      lineCount: (count: number, max: number) => `${count} / ${max} Zeilen`,
      languageLabel: 'Sprache der Einladung',
      languageHint: 'nur feste Beschriftungen',
      linkIntro: 'Nach dem Aktivieren hat die Einladung einen Link und einen QR-Code.',
      activate: 'Einladung aktivieren',
      activateNeedsDate: 'Fügen Sie das Startdatum hinzu, um die Einladung aktivieren zu können.',
      linkLabel: 'Adresse des Links',
      copy: 'Kopieren',
      copied: 'Link kopiert.',
      copyFailed:
        'Der Browser hat das Kopieren verweigert. Markieren Sie den Link und kopieren Sie ihn von Hand.',
      rotate: 'Link ändern',
      rotateTitle: 'Link der Einladung ändern?',
      rotateBody:
        'Der alte Link und bereits gedruckte QR-Codes funktionieren nicht mehr. Denken Sie daran, neu zu drucken und den neuen Link zu senden. Der Code der Feier ändert sich nicht.',
      rotateConfirm: 'Link ändern',
      rotated: 'Neuer Link. Der alte funktioniert nicht mehr.',
      disable: 'Deaktivieren',
      disabled:
        'Einladung deaktiviert. Die Seite antwortet „nicht verfügbar“; beim erneuten Aktivieren gilt derselbe Link.',
      enabled: 'Einladung aktiviert. Link und QR-Code sind da.',
      openNote:
        'Sobald Sie die Feier öffnen, auch zum Testen, zeigt die Einladungsseite die Schaltfläche zur Fotowand.',
      formatsLabel: 'Formate der Einladung',
      tabPrint: 'Gedruckte Karte',
      tabImage: 'Bild zum Teilen',
      tabEmail: 'E-Mail',
      locked: 'Fügen Sie das Datum hinzu und aktivieren Sie die Einladung, um sie zu teilen.',
      nonexistentHour:
        'Diese Uhrzeit gibt es an diesem Tag in dieser Zeitzone nicht (Umstellung auf Sommerzeit). Wählen Sie eine andere.',
      loadFailed: 'Die Einladungen konnten nicht geladen werden.',
      ownerOnly: 'Nur der Inhaber der Veranstaltung schreibt die Einladung.',
      printFormatLegend: 'Format',
      printFormatCard: 'Karte A6 · 4 pro A4',
      printFormatA5: 'A5 · 2 pro A4',
      shortLabel: 'Nachricht auf der Karte',
      shortCount: (count: number, max: number) => `${count} / ${max}`,
      shortAuto: 'automatisch',
      shortHint: 'Die ganze Nachricht steht auf der Einladungsseite.',
      shortReset: 'Zurück zum automatischen Text',
      printA5Help:
        'Für A5 drucken Sie aus Chrome, Edge oder Firefox: Safari kann das Blatt nicht drehen.',
      photoHint:
        'Das Foto bleibt in diesem Browser: EventSlide schickt es nirgendwohin, und ein anderes Gerät sieht es nicht.',
      photoNotKept:
        'Das Foto konnte nicht auf diesem Gerät gespeichert werden: Es ist weg, sobald Sie die Seite verlassen.',
      printButton: 'Drucken',
      previewLabel: 'Vorschau der Karte',
      printPerHouseholdLegend: 'Karten für die Haushalte',
      printPerHouseholdFailed: 'Die Liste der Haushalte konnte nicht gelesen werden.',
      printPerHouseholdStale:
        'Die Liste der Haushalte konnte nicht neu gelesen werden: Es wurde nichts gedruckt. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
      printHouseholdQrAlt: (name: string) => `QR-Code des persönlichen Links von ${name}`,
      printPerHousehold: 'Eine Karte pro Haushalt',
      printPerHouseholdHint: (households: number, sheets: number) =>
        `${households} ${households === 1 ? 'Karte' : 'Karten'} zu drucken, auf ${sheets} ${sheets === 1 ? 'Blatt' : 'Blättern'}. Der Name des Haushalts steht auf der Karte.`,
      printPerHouseholdPrivacy:
        'Der QR-Code jeder Karte öffnet den persönlichen Link ihres Haushalts: Geben Sie die Karte nur diesem Haushalt. Der geheime Link steht nirgends im Klartext.',
      printPerHouseholdPreview: 'Die Vorschau zeigt das erste Blatt; gedruckt werden alle.',
      printHelp:
        'Wählen Sie im Druckdialog einen Maßstab von 100 % und keine Ränder. Die Adresse steht auf der Karte: Geben Sie sie nur den Gästen, die Sie ausgewählt haben.',
      commonBadge: 'gilt für alle Formate',
      lookTitle: 'Das Aussehen',
      lookBadge: 'Karte und Bild',
      statusOn: 'Einladung aktiv',
      statusOff: 'Einladung deaktiviert',
      statusBarLabel: 'Link der Einladung',
      saving: 'Wird gespeichert …',
      savedAuto: 'Gespeichert',
      saveFailed: 'Die letzte Änderung wurde nicht gespeichert.',
      saveRetry: 'Erneut versuchen',
      leaveWarning: 'Änderungen an der Einladung sind noch nicht gespeichert. Seite verlassen?',
      lockedTitle: 'Ihre Einladung ist noch nicht bereit',
      lockedStepDate: 'Startdatum hinzufügen',
      lockedStepActivate: 'Einladung aktivieren',
      lockedDateFocus: 'Datum eingeben',
      lockedDateSave: 'Dieses Datum speichern',
      tabGuest: 'Seite für Gäste',
      optionsLabel: 'Einstellungen des Formats',
      guestStateLegend: 'Zeitpunkt',
      guestStateUpcoming: 'Vor dem Fest',
      guestStateJoinable: 'Währenddessen',
      guestStateOver: 'Danach',
      guestHelp:
        'Das sieht ein Gast, der den QR-Code scannt oder den Link öffnet. Am Abend selbst führt die Seite zur Fotowand.',
      guestOpen: 'Seite öffnen',
      guestCopy: 'Link kopieren',
      guestPreviewLabel: 'Vorschau der Seite für Gäste',
      previewEnlarge: 'Vorschau in voller Größe ansehen',
      previewClose: 'Vorschau schließen',
      lookLocked: 'Design, Farbe und Foto stellen Sie hier ein, sobald die Einladung bereit ist.',
    },
    image: {
      sameLook: 'Design, Farbe und Foto stellen Sie links unter „Das Aussehen“ ein.',
      formatLegend: 'Format',
      formatSquare: 'Quadrat',
      formatStory: 'Story',
      addressLegend: 'Adresse auf dem Bild',
      addressLabel: 'Adresse zeigen',
      addressHint:
        'Eine Story sehen alle Ihre Follower: ohne Adresse sehen sie nur Personen mit dem Link.',
      textLabel: 'Text zum Bild',
      textNote: 'nur dieses Mal',
      share: 'Teilen',
      download: 'Bild herunterladen',
      copy: 'Text kopieren',
      rendering: 'Bild wird vorbereitet…',
      copied: 'Text kopiert.',
      copiedBeforeShare:
        'Text kopiert: Fügen Sie ihn unter dem Bild ein, falls die App ihn nicht übernommen hat.',
      copyFailed: 'Der Text konnte nicht kopiert werden: Markieren Sie ihn im Feld.',
      renderFailed: 'Das Bild konnte auf diesem Gerät nicht erstellt werden.',
      retry: 'Erneut versuchen',
      revertText: 'Zurück zum automatischen Text',
      downloaded: 'Bild heruntergeladen.',
      shareFailed:
        'Das Teilen hat nicht geklappt: Laden Sie das Bild herunter und senden Sie es von Ihrem Handy.',
      previewLabel: 'Bildvorschau',
      help: 'Auf dem Handy öffnet „Teilen“ WhatsApp, Instagram, Nachrichten … mit Bild und Text. Der Text wird auch kopiert, falls die App ihn vergisst.',
      fileName: 'einladung',
    },
    email: {
      subjectLabel: 'Betreff',
      bodyLabel: 'Nachricht',
      bodyNote: 'nur dieses Mal',
      counter: (length: number, max: number) => `mailto-Link: ${length} / ${max} kodierte Zeichen`,
      counterCut: 'Text gekürzt, das Ende verweist auf die Seite',
      open: 'In meinem Mailprogramm öffnen',
      copy: 'Text kopieren',
      copied: 'Text kopiert.',
      copyFailed: 'Der Text konnte nicht kopiert werden: Markieren Sie ihn im Feld.',
      download: 'Bild herunterladen',
      rendering: 'Bild wird vorbereitet…',
      renderFailed: 'Das Bild konnte auf diesem Gerät nicht erstellt werden.',
      retry: 'Erneut versuchen',
      revertText: 'Zurück zum automatischen Text',
      size: (kilobytes: number) => `${kilobytes} KB`,
      bccAdvice:
        'Setzen Sie Ihre Gäste in Blindkopie (Bcc), damit sie ihre Adressen nicht gegenseitig sehen. EventSlide verschickt nichts und speichert keine Adresse.',
      previewLabel: 'Vorschau der Nachricht',
      previewHeader: 'Neue Nachricht',
      previewTo: 'An',
      previewToValue: 'Sie selbst',
      previewBcc: 'Bcc',
      previewBccValue: 'Ihre Gäste',
      attachmentNote: '(wenn Sie es anhängen)',
      fileName: 'einladung',
    },
    card: {
      eyebrow: 'Einladung',
      more: 'Alle Einzelheiten auf der Einladungsseite.',
      link: (link: string) => `Infos und Fotowand: ${link}`,
      entry: 'Eintritt: Sie',
      hourLabel: 'Uhrzeit',
      placeLabel: 'Ort',
      stubLine: 'Alle Details, und am Abend die Fotowand.',
      startLabel: 'Beginn',
      endLabel: 'Ende',
      storyTop: 'Sie sind eingeladen',
      infos: 'Infos und Fotowand',
      shareIntro: (title: string) => `${title}: Sie sind eingeladen.`,
      mailHello: 'Hallo,',
      mailIntro: (title: string) => `${title} – und Sie sind eingeladen.`,
      whenLabel: 'Wann',
      whereLabel: 'Wo',
      mailDetails: 'Alle Details und am Abend die Fotowand der Feier:',
      mailSubject: (title: string, day: string) => `Einladung: ${title}, ${day}`,
      mailMore: '(mehr auf der Einladungsseite)',
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
      title: 'Bist du dabei?',
      deadline: (day: string) => `Bitte antworte bis zum ${day}.`,
      yes: 'Ich komme',
      maybe: 'Vielleicht',
      no: 'Ich kann nicht',
      nameLabel: 'Dein Vor- und Nachname',
      namePlaceholder: 'Damit die Gastgeber dich erkennen',
      howManyLabel: 'Wie viele seid ihr?',
      howManyHint: (max: number) => `dich eingeschlossen, höchstens ${max}`,
      adults: 'Erwachsene',
      people: 'Personen',
      kids: 'Kinder',
      kidsHint: 'unter 12 Jahren',
      less: 'Weniger',
      more: 'Mehr',
      dietLabel: 'Allergien oder Ernährung',
      dietHint: 'freiwillig, nur für die Gastgeber sichtbar',
      dietPlaceholder: 'Z. B. glutenfrei',
      messageLabel: 'Ein Wort an die Gastgeber',
      optional: 'freiwillig',
      send: 'Antwort senden',
      save: 'Änderungen speichern',
      cancel: 'Abbrechen',
      notice:
        'Deine Antwort sehen nur die Gastgeber. Sie wird spätestens zwei Monate nach der Feier gelöscht. Mit deinem Link kannst du sie ändern oder löschen.',
      showNameLabel: 'Meinen Vornamen anderen Gästen zeigen',
      noticeNames:
        'Deine Antwort sehen die Gastgeber. Nur dein Vorname kann jeder Person gezeigt werden, die den Einladungslink hat, wenn du das Kästchen ankreuzt. Sie wird spätestens zwei Monate nach der Feier gelöscht. Mit deinem Link kannst du sie ändern oder löschen.',
      noticeCount:
        'Deine Antwort sehen die Gastgeber. Die Zahl der Personen, die kommen, wird jeder Person gezeigt, die den Einladungslink hat. Sie wird spätestens zwei Monate nach der Feier gelöscht. Mit deinem Link kannst du sie ändern oder löschen.',
      showNameShown: (first: string) => `Wird gezeigt: „${first}“ (das erste Wort deines Namens)`,
      recapShowName: 'Dein Vorname wird den anderen Gästen gezeigt',
      doneYes: (first: string) => `Notiert, ${first}`,
      doneMaybe: 'Notiert: vielleicht',
      doneNo: (first: string) => `Schade, ${first}`,
      maybeSub: 'Die Gastgeber zählen vor der Feier auf eine feste Antwort.',
      noSub:
        'Die Gastgeber haben deine Antwort erhalten. Du kannst es dir anders überlegen, solange Antworten möglich sind.',
      recapYes: 'Du kommst',
      recapMaybe: 'Vielleicht',
      person: { one: 'Person', other: 'Personen' },
      child: { one: 'Kind', other: 'Kinder' },
      recapKids: (count: number, label: string) => `davon ${count} ${label}`,
      proofCountOne: '1 Person hat zugesagt',
      proofCount: (count: number) => `${count} Personen haben zugesagt`,
      proofNameOne: (name: string) => `${name} kommt`,
      proofNames: (names: string) => `${names} kommen`,
      proofNamesAndOne: (names: string) => `${names} und 1 weitere Person kommen`,
      proofNamesAndMany: (names: string, others: number) => `${names} und ${others} weitere kommen`,
      recapNo: 'Du kommst nicht',
      recapDiet: (diet: string) => `Ernährung: ${diet}`,
      recapMessage: (message: string) => `Dein Wort: ${message}`,
      edit: 'Antwort ändern',
      delete: 'Antwort löschen',
      deleteAsk: 'Antwort löschen?',
      deleteSub:
        'Die Gastgeber sehen sie dann nicht mehr. Du kannst erneut antworten, solange Antworten möglich sind.',
      deleteYes: 'Ja, löschen',
      deleted: 'Deine Antwort ist gelöscht.',
      linkTitle: 'Dein Link, um von einem anderen Gerät zu ändern',
      linkHint:
        'Behalte ihn, um von einem anderen Gerät zu ändern. Dieses Gerät merkt ihn sich selbst.',
      copy: 'Kopieren',
      copied: 'Link kopiert',
      closedTitle: 'Die Antworten sind geschlossen',
      closedSub: 'Eine Änderung? Sag den Gastgebern direkt Bescheid.',
      earlier: (summary: string) => `Du hattest geantwortet: ${summary}`,
      failed:
        'Die Antwort konnte nicht gesendet werden. Prüfe deine Verbindung und versuche es erneut.',
      busy: 'Gerade antworten viele Leute. Versuche es gleich noch einmal.',
      householdGreeting: (name: string) => `Hallo ${name}`,
      householdPlaces: (n: number) =>
        n === 1 ? 'Ein Platz für Sie reserviert' : `${n} Plätze für Sie reserviert`,
      householdFailed:
        'Der Link Ihres Haushalts konnte nicht gelesen werden. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
      householdRetry: 'Erneut versuchen',
      householdIncomplete:
        'Dieser Haushaltslink ist unvollständig: Er wurde wohl unterwegs abgeschnitten. Kopieren Sie ihn vollständig oder fragen Sie die Gastgeber danach.',
      householdNotYours: 'Nicht Ihr Haushalt?',
      replyNotYours: 'Nicht Ihre Antwort?',
      olderReply: (name: string) =>
        `Dieses Gerät speichert außerdem eine Antwort unter dem Namen „${name}“.`,
      olderReplyDelete: 'Diese Antwort löschen',
      householdGone:
        'Dieser Haushaltslink funktioniert nicht mehr. Bitten Sie die Gastgeber um einen neuen oder antworten Sie unten.',
      forgotten:
        'Dieses Gerät findet deine Antwort nicht mehr: Sie wurde gelöscht oder der Link hat sich geändert.',
      companionsLabel: 'Vornamen derer, die mit Ihnen kommen',
      companionLabel: (n: number) => `Begleitung ${n}`,
      companionPlaceholder: 'Vorname',
      mealsLabel: 'Menüs',
      mealFor: (who: string) => `Menü für ${who}`,
      personFallback: (n: number) => `Person ${n}`,
      answerPick: 'Wählen',
      recapCompanions: (names: string) => `Mit Ihnen: ${names}`,
      recapMeals: (meals: string) => `Menüs: ${meals}`,
      recapAnswer: (label: string, value: string) => `${label}: ${value}`,
      momentsLabel: 'Bei welchen Programmpunkten bist du dabei?',
      momentsHint: 'mindestens einer',
      recapMoments: (moments: string) => `Programmpunkte: ${moments}`,
      momentsGone: 'Der gewählte Programmpunkt existiert nicht mehr: bitte wähle einen.',
      fullTitle: 'Es ist voll',
      fullSub:
        'Es ist kein Platz mehr frei. Du kannst dich auf die Warteliste setzen lassen: Die Gastgeber melden sich, wenn ein Platz frei wird.',
      waitlistJoin: 'Auf die Warteliste',
      doneWaitlist: 'Du stehst auf der Warteliste',
      waitlistSub:
        'Die Gastgeber melden sich, wenn ein Platz frei wird. Du kannst deine Meinung ändern, solange Antworten möglich sind.',
      recapWaitlist: 'Auf der Warteliste',
      limitedPlaces: 'Die Plätze sind begrenzt.',
      stayWaitlist: 'Du bleibst auf der Warteliste, bis die Gastgeber dich nachrücken lassen.',
      stayWaitlistChoice: 'Auf der Warteliste bleiben',
      trap: 'Dieses Feld leer lassen',
      tooLarge: 'Ihre Antwort ist zu lang zum Senden. Bitte kürzen Sie Ihre Texte.',
    },
    host: {
      absentNote: 'Absagende dürfen eine Nachricht im Gästebuch hinterlassen',
      absentNoteHint:
        'Wer absagt, kann eine Nachricht hinterlassen, die über die Moderation des Gästebuchs läuft. Das Gästebuch muss geöffnet sein.',
      title: 'Antworten der Gäste',
      stateOff: 'Nicht erfragt',
      stateOpen: 'Erfragt',
      stateClosed: 'Geschlossen',
      needsInvite:
        'Speichere zuerst die Einladung (Titel und Datum): Antworten werden auf ihrer Seite erfragt.',
      askLabel: 'Um eine Antwort bitten',
      askHint: 'Der Block „Bist du dabei?“ erscheint auf der Seite der Einladung.',
      deadlineLabel: 'Frist',
      deadlineHint:
        'Den Gästen angezeigt. Die Antworten bleiben bis zum Ende dieses Tages offen und schließen dann: ändere das Datum, um sie wieder zu öffnen.',
      deadlineClear: 'Frist entfernen',
      closeAction: 'Antworten schließen',
      reopenAction: 'Antworten wieder öffnen',
      closedNote: 'Geschlossen: Die Einladungsseite sagt „Die Antworten sind geschlossen“.',
      closesOn: (date: string) =>
        `Ohne Frist schließen die Antworten zu Beginn der Feier, am ${date}.`,
      erasedOn: (date: string) => `Die Antworten werden am ${date} gelöscht.`,
      asksTitle: 'Was du erfragst',
      presetLabel: 'Art der Feier',
      presetParty: 'Feier',
      presetWedding: 'Hochzeit',
      presetCustom: 'Eigene Wahl',
      presetHint:
        'Eine Hochzeit bietet kein „Vielleicht“ an, nimmt 6 Personen pro Antwort und fragt nach den Vornamen der Begleitung; eine Feier das Gegenteil.',
      maybeLabel: '„Vielleicht“ anbieten',
      maybeHint: 'Praktisch für einen Geburtstag, bei einer Hochzeit oft weggelassen.',
      sizeLabel: 'Anzahl der Personen',
      sizeHint: 'Der Gast sagt, wie viele kommen, ihn eingeschlossen.',
      sizeMax: 'Höchstens',
      sizeUnit: 'pro Antwort',
      sizeRange: (min: number, max: number) => `Zwischen ${min} und ${max}`,
      kidsLabel: 'Kinder getrennt zählen',
      kidsHint: 'Nützlich für den Caterer und Kindermenüs.',
      dietLabel: 'Allergien und Ernährung',
      dietHint:
        'Freier Text, freiwillig. Gesundheitsdaten: nur du siehst sie, sie werden mit den Antworten gelöscht.',
      saving: 'Wird gespeichert …',
      saved: 'Gespeichert',
      retry: 'Erneut versuchen',
      loadFailed: 'Die Einstellungen der Antworten konnten nicht geladen werden.',
      fewTitle: 'Warum so wenig Pflicht ist',
      few: 'Name und Antwort genügen. Jedes weitere Feld kostet Antworten: Die Fragen kommen nach dem „Ja“, auf demselben Bildschirm.',
      noContactTitle: 'Keine Adresse, keine Nummer',
      noContact:
        'EventSlide verschickt weder E-Mails noch SMS. Die Gäste behalten ihren privaten Link; du erinnerst mit deinen eigenen Apps.',
      erasedTitle: 'Nach der Feier gelöscht',
      erased:
        'Die Antworten verschwinden 30 Tage nach dem Schließen des Abends oder 60 Tage nach seinem Beginn. Exportiere sie vorher.',
      previewName: 'Camille',
      archived: 'Das Event ist archiviert: Die Einstellungen können sich nicht mehr ändern.',
      openUntil: (day: string) => `Die Antworten sind bis einschließlich ${day} offen.`,
      closedByDate: 'Durch die Frist geschlossen: ändere sie, um die Antworten wieder zu öffnen.',
      reopenNeedsDate: 'Die Frist ist abgelaufen: ändere sie, um wieder öffnen zu können.',
      stateFull: 'Voll',
      companionsLabel: 'Vornamen der Begleitung',
      companionsHint: 'Die Gäste tragen den Vornamen jeder Person ein, die mit ihnen kommt.',
      companionsNeedSize:
        'Vornamen werden für jede Person neben dem Gast abgefragt: Schalten Sie auch die Personenzahl ein.',
      visibilityLabel: 'Wer kommt',
      visibilityHint:
        'Was die Einladungsseite über die Antworten sagt, jeder Person mit dem Link. Nie die „Nein“, die „Vielleicht“, die Nachrichten oder die Ernährungsangaben. Bei einer kleinen Feier kann die Zahl die Antwort einer einzelnen Person verraten. Wer „Vornamen“ verlässt, nimmt die gesetzten Häkchen zurück: Die Gäste müssen erneut ankreuzen.',
      visibilityOff: 'Nichts',
      visibilityCount: 'Die Zahl der Personen, die kommen',
      visibilityNames: 'Die Zahl und die Vornamen derer, die zustimmen',
      mealsLabel: 'Menüauswahl',
      mealsHint: 'Ein Menü pro Person, nur bei denen gefragt, die kommen.',
      mealsOptionsLabel: 'Die Menüs',
      mealsOptionsHint: 'Eines pro Zeile, 2 bis 6.',
      questionsTitle: 'Ihre Fragen',
      questionsHint:
        'Höchstens drei, gestellt bei „Ja“ oder „Vielleicht“. Eine Frage zu entfernen löscht die bereits gegebenen Antworten nicht.',
      questionAdd: 'Frage hinzufügen',
      questionLabelLabel: 'Die Frage',
      questionKindLabel: 'Art der Antwort',
      questionKindText: 'Freitext',
      questionKindChoice: 'Auswahl',
      questionOptionsLabel: 'Die Auswahlmöglichkeiten',
      questionOptionsHint: 'Eine pro Zeile, 2 bis 6.',
      questionRemove: (label: string) => `Frage „${label}“ entfernen`,
      questionConfirm: 'Frage hinzufügen',
      questionsFull: 'Höchstens drei Fragen.',
      momentsTitle: 'Mehrere Programmpunkte',
      momentsHint:
        'Zum Beispiel ein Brunch und ein Abend. Höchstens vier. Jeder Gast kreuzt an, wo er dabei ist; ein Haushalt kann auch nur zu einigen eingeladen werden. Wird ein Programmpunkt entfernt, entfallen die Angaben der Gäste dazu.',
      momentAdd: 'Programmpunkt hinzufügen',
      momentLabelLabel: (n: number) => `Programmpunkt ${n}`,
      momentPlaceholder: 'Z. B. Sonntagsbrunch',
      momentRemove: (label: string) => `Programmpunkt „${label}“ entfernen`,
      momentsFull: 'Höchstens vier Programmpunkte.',
      momentRemoveTitle: (label: string) => `Programmpunkt „${label}“ entfernen?`,
      momentRemoveBody: (count: number) =>
        count === 0
          ? 'Keine Antwort hat diesen Programmpunkt gewählt. Um einen Namen zu korrigieren, benenne den Programmpunkt um, statt ihn zu entfernen.'
          : `${count} ${count === 1 ? 'Antwort hat' : 'Antworten haben'} diesen Programmpunkt gewählt und verlieren diese Auswahl. Um einen Namen zu korrigieren, benenne den Programmpunkt um, statt ihn zu entfernen.`,
      momentRemoveUnknown:
        'Bereits gegebene Antworten verlieren die Auswahl dieses Programmpunkts. Um einen Namen zu korrigieren, benenne den Programmpunkt um, statt ihn zu entfernen.',
      momentRemoveYes: 'Programmpunkt entfernen',
      capacityLabel: 'Begrenzte Plätze',
      capacityHint:
        'Über der festgelegten Personenzahl landet ein „Ja“ auf der Warteliste, und Sie befördern es von Hand. Was Sie selbst eintragen, ist nicht begrenzt.',
      capacityField: 'Höchstens Personen',
      capacityFieldHint: 'von 1 bis 2000, Kinder eingeschlossen',
      presetConfirmTitle: 'Einstellungen ersetzen?',
      presetConfirm: (kind: string) =>
        `Ihre Auswahl bei „Vielleicht“, Personenzahl, Kindern und Vornamen der Begleitung wird durch die ${kind} ersetzt.`,
      presetConfirmYes: 'Ersetzen',
      presetKindParty: 'einer Feier',
      presetKindWedding: 'einer Hochzeit',
    },
    /** The host's replies page (spec 30, lot 1). */
    absent: {
      offer: 'Eine Nachricht im Gästebuch hinterlassen',
      title: 'Eine Nachricht im Gästebuch',
      hint: 'Ihre Nachricht wird mit Ihrem Vornamen unterschrieben und läuft über die Moderation der Veranstaltung, bevor sie gelesen wird.',
      label: 'Ihre Nachricht',
      signatureLabel: 'Unterschrift',
      signatureHint:
        'Ihr Vorname, den Sie ändern können. Leeren Sie das Feld, um mit „Ein verhinderter Gast“ zu unterschreiben.',
      anonymous: 'Ein verhinderter Gast',
      send: 'Nachricht senden',
      sent: 'Danke, Ihre Nachricht ist gesendet.',
      sentSub: 'Der Gastgeber wird sie lesen.',
      unavailable: 'Das Gästebuch nimmt im Moment keine Nachrichten an.',
      already: 'Sie haben bereits eine Nachricht hinterlassen.',
    },
    push: {
      // What the service worker shows (it has no locale table of its own: `lib/push/pushNotice.ts` holds the
      // same words, and a test holds the two together).
      noticeOne: 'Eine neue Antwort',
      noticeMany: (count: number) => `${count} neue Antworten`,
      noticeSome: 'Neue Antworten',
      label: 'Browser-Benachrichtigung',
      hint: 'Dieser Browser meldet Ihnen, wenn Antworten eingehen, ohne zu sagen, wer geantwortet hat oder was.',
      unsupported: 'Dieser Browser kann keine Benachrichtigungen anzeigen.',
      addToHomeScreen:
        'Fügen Sie EventSlide auf dem iPhone zuerst zum Home-Bildschirm hinzu und öffnen Sie es über sein Symbol: Benachrichtigungen gibt es nur in der installierten App.',
      denied:
        'Benachrichtigungen sind für diese Seite blockiert: Erlauben Sie sie in den Browsereinstellungen und kommen Sie dann zurück.',
      failed:
        'Die Benachrichtigung konnte nicht aktiviert werden. Versuchen Sie es gleich noch einmal.',
      offFailed:
        'Die Benachrichtigung konnte nicht deaktiviert werden. Versuchen Sie es gleich noch einmal.',
    },
    list: {
      crumb: 'Antworten',
      title: 'Antworten',
      loadFailed: 'Die Antworten konnten nicht geladen werden.',
      retry: 'Erneut versuchen',
      settings: 'Einstellungen',
      reply: { one: 'Antwort', other: 'Antworten' },
      person: { one: 'Person', other: 'Personen' },
      adult: { one: 'Erwachsener', other: 'Erwachsene' },
      child: { one: 'Kind', other: 'Kinder' },
      expected: { one: 'Person erwartet', other: 'Personen erwartet' },
      line: { one: 'Zeile', other: 'Zeilen' },
      menuNew: { one: 'neue Antwort', other: 'neue Antworten' },
      deadlineSub: (d: string) => `Frist am ${d}`,
      closedSub: 'Antworten geschlossen',
      tilesLabel: 'Die Zahlen',
      tileYes: 'Kommen',
      tileMaybe: 'Vielleicht',
      tileNo: 'Kommen nicht',
      tileMaybeDetail: (replies: string, people: string) => `${replies} · ${people}`,
      adultsKids: (a: string, k: string) => `${a}, ${k}`,
      barSummary: (parts: string) => `Verteilung der Antworten: ${parts}`,
      legendItem: (label: string, count: number, unit: string) => `${label}: ${count} ${unit}`,
      barUpTo: (n: number) => `, bis zu ${n} mit den „Vielleicht“`,
      tabsLabel: 'Antworten filtern',
      tabAll: 'Alle',
      tabYes: 'Kommen',
      tabMaybe: 'Vielleicht',
      tabNo: 'Kommen nicht',
      searchLabel: 'Namen suchen',
      add: 'Antwort hinzufügen',
      export: 'Exportieren (Tabelle)',
      colName: 'Name',
      colAnswer: 'Antwort',
      colPeople: 'Pers.',
      colDiet: 'Ernährung',
      colCompanions: 'Mit',
      colMeals: 'Menüs',
      colMessage: 'Nachricht',
      colReceived: 'Erhalten',
      answerYes: 'Kommt',
      answerMaybe: 'Vielleicht',
      answerNo: 'Kommt nicht',
      answerWaitlist: 'Warteliste',
      none: '—',
      peopleKids: (a: number, k: number) => `${a} + ${k} Kinder`,
      showMore: (n: number) => `Die ${n} weiteren anzeigen`,
      rowsOf: (s: number, t: number) => `${s} von ${t}.`,
      rowsAll: (n: number, w: string) =>
        `${n} ${w}. Eine Antwort am Telefon oder mündlich erhalten? „Antwort hinzufügen“ über der Tabelle.`,
      noneHere: 'Hier ist keine Antwort.',
      emptyTitle: 'Noch keine Antwort',
      emptyBody:
        'Die Antworten erscheinen hier, sobald deine Gäste antworten, ohne die Seite neu zu laden.',
      emptyOff:
        'Du fragst noch keine Antworten ab. Schalte sie in den Einstellungen der Einladung ein.',
      detailPeople: 'Personen',
      detailDiet: 'Ernährung',
      detailCompanions: 'Begleitung',
      detailMeals: 'Menüs',
      detailShowName: 'Vorname den Gästen gezeigt',
      detailYes: 'Ja',
      detailMessage: 'Nachricht',
      detailReceived: 'Erhalten',
      sourceOpen: 'gemeinsamer Link',
      sourceHost: 'von dir eingetragen',
      sourceHousehold: 'Link des Haushalts',
      receivedVia: (d: string, s: string) => `${d} · ${s}`,
      edit: 'Bearbeiten',
      remove: 'Löschen',
      deleteNote:
        'Löschen ist für Doppelte und Scherzantworten: der gemeinsame Link identifiziert niemanden. Der private Link des Gastes funktioniert dann nicht mehr.',
      closeDetail: 'Schließen',
      formAddTitle: 'Antwort hinzufügen',
      formEditTitle: 'Antwort bearbeiten',
      formHint:
        'Das Formular des Gastes, von dir ausgefüllt: für eine Antwort per Telefon oder mündlich. Die Platzgrenzen gelten für dich nicht.',
      formName: 'Name',
      formAnswer: 'Antwort',
      formAdults: 'Erwachsene',
      formKids: 'Kinder',
      formDiet: 'Ernährung oder Allergie',
      formCompanion: (n: number) => `Begleitung ${n}`,
      formMeal: (who: string) => `Menü für ${who}`,
      formQuestionNone: '—',
      formMessage: 'Nachricht',
      formSave: 'Speichern',
      formSaving: 'Wird gespeichert…',
      deleteTitle: (n: string) => `Antwort von ${n} löschen?`,
      deleteBody:
        'Sie verschwindet aus der Liste und aus den Zahlen. Das lässt sich nicht rückgängig machen.',
      deleteYes: 'Löschen',
      latestTitle: 'Letzte Antworten',
      latestYes: (n: string) => `${n} kommt`,
      latestYesMany: (n: string, p: number) => `${n} kommt mit ${p} Personen`,
      latestMaybe: (n: string) => `${n} kommt vielleicht`,
      latestNo: (n: string) => `${n} kommt nicht`,
      notifyTitle: 'Benachrichtigt werden',
      notifyApp: 'Zähler in der App',
      notifyAppHint:
        'Die Zahl der neuen Antworten am Eintrag „Antworten“ im Menü der Veranstaltung.',
      notifyLive: 'Tabelle live',
      notifyLiveHint: 'Solange sie offen ist, aktualisiert sie sich bei jeder Antwort selbst.',
      notifyNoEmail: 'Keine E-Mails: die gehostete Instanz versendet keine E-Mails.',
      catererTitle: 'Catering',
      catererHint: 'Was dem Caterer zu sagen ist: wer kommt, ohne die „Vielleicht“.',
      catererAdults: 'Erwachsene',
      catererKids: 'Kinder',
      catererMaybe: 'Vielleicht (nicht gezählt)',
      catererMeals: 'Menüs',
      catererNoMeals: 'Noch kein Menü gewählt.',
      catererDiets: 'Ernährung und Allergien',
      catererPrivate: 'Gesundheitsdaten: nur für dich sichtbar, nie auf der Seite der Gäste.',
      catererExport: 'Für den Caterer exportieren (CSV)',
      catererPrint: 'Liste drucken',
      printTitle: (event: string) => `Gäste, die kommen · ${event}`,
      printConfidential: 'Vertrauliches Dokument: Es enthält Ernährungsangaben.',
      printTotals: (adults: number, kids: number) => `Erwachsene: ${adults} · Kinder: ${kids}`,
      printPeople: (n: number) => `Personen: ${n}`,
      colMoments: 'Programmpunkte',
      detailMoments: 'Programmpunkte',
      formMoments: 'Programmpunkte',
      momentsTitle: 'Pro Programmpunkt',
      momentLine: (label: string, yes: string, maybe: string | null) =>
        `${label}: ${yes}${maybe === null ? '' : ` (+ ${maybe} mit „Vielleicht“)`}`,
      catererMoments: 'Pro Programmpunkt',
      printMoments: 'Programmpunkte',
      momentNoneLine: (people: string) => `Ohne Programmpunkt: ${people}`,
      formMomentsHint: 'mindestens einer, für alle, die kommen',
      tabWaitlist: 'Warteliste',
      tileWaitlist: 'Warteliste',
      promote: 'Befördern',
      detailWaitlistHint: 'Auf der Warteliste: Diese Antwort zählt nicht zu den Plätzen.',
      promoteOver: (capacity: number) =>
        `Diese Beförderung übersteigt die Kapazität von ${capacity}.`,
      promoteAnyway: 'Trotzdem befördern',
      overCapacity: (capacity: number) => `über der Kapazität von ${capacity}`,
      waitlistOrderHint: 'Älteste zuerst: In dieser Reihenfolge befördern.',
      tileNoReply: 'Ohne Antwort',
      tileNoReplyDetail: (households: string, places: number) => `${households} · ${places} Plätze`,
      household: { one: 'Haushalt', other: 'Haushalte' },
      guests: 'Gästeliste',
      detailHousehold: 'Haushalt',
      detailHouseholdNone: 'Kein Haushalt',
      detailHouseholdHint: 'Ordnen Sie diese Antwort einem Haushalt Ihrer Liste zu.',
      detailHouseholdFile: 'Zuordnen',
      detailHouseholdUnfile: 'Lösen',
    },
    households: {
      title: 'Gästeliste',
      backToReplies: 'Antworten',
      intro:
        'Optional. Tragen Sie Ihre Haushalte ein (ein Name und eine Anzahl Plätze, nie eine E-Mail-Adresse oder Telefonnummer). Jeder Haushalt erhält seinen persönlichen Link. EventSlide sendet nichts: Sie erinnern aus Ihren eigenen Apps.',
      loadFailed: 'Die Liste konnte nicht geladen werden.',
      retry: 'Erneut versuchen',
      summary: (households: number, places: number) =>
        `${households} ${households === 1 ? 'Haushalt' : 'Haushalte'} · ${places} ${places === 1 ? 'Platz' : 'Plätze'}`,
      filtersLabel: 'Liste filtern',
      filterAll: 'Alle',
      filterPending: 'Ohne Antwort',
      filterAnswered: 'Haben geantwortet',
      searchLabel: 'Haushalt suchen',
      add: 'Haushalt hinzufügen',
      importList: 'Liste einfügen',
      remindAll: (n: number) => `Die ${n} ohne Antwort erinnern`,
      colMoments: 'Programmpunkte',
      momentsAll: 'Alle',
      formMoments: 'Eingeladen zu',
      formMomentsHint: 'Standardmäßig ist ein Haushalt zu allen Programmpunkten eingeladen.',
      colHousehold: 'Haushalt',
      colPlaces: 'Plätze',
      colStatus: 'Antwort',
      colLink: 'Persönlicher Link',
      statusPending: 'Ohne Antwort',
      statusReminded: (date: string) => `Erinnert am ${date}`,
      statusYes: (people: number) => `Kommt · ${people}`,
      statusMaybe: (people: number) => `Vielleicht · ${people}`,
      statusNo: 'Kommt nicht',
      statusWaitlist: 'Warteliste',
      copyLink: 'Link kopieren',
      linkCopied: 'Link kopiert.',
      copyFailed: (link: string) =>
        `Das Kopieren hat nicht geklappt. Kopieren Sie den Link von Hand: ${link}`,
      edit: 'Bearbeiten',
      remove: 'Löschen',
      rotate: 'Link ändern',
      viewReply: 'Antwort ansehen',
      noneHere: 'Hier ist kein Haushalt.',
      emptyTitle: 'Noch kein Haushalt',
      emptyBody:
        'Fügen Sie einen Haushalt hinzu oder fügen Sie Ihre Liste auf einmal ein: eine Zeile pro Haushalt, „Familie Martin ; 4“.',
      noInvite: 'Speichern Sie zuerst die Einladung: Der Link jedes Haushalts hängt davon ab.',
      noInviteLink: 'Einladung öffnen',
      formAddTitle: 'Haushalt hinzufügen',
      formEditTitle: 'Haushalt bearbeiten',
      formHint: 'Ein Name und die Anzahl Plätze, die Sie für ihn freihalten. Sonst nichts.',
      formName: 'Name des Haushalts',
      formNamePlaceholder: 'z. B. Familie Martin',
      formPlaces: 'Plätze',
      formPlacesHint: 'von 1 bis 10',
      formSave: 'Speichern',
      formSaving: 'Wird gespeichert…',
      importTitle: 'Liste einfügen',
      importHint:
        'Eine Zeile pro Haushalt: „Familie Martin ; 4“. Eine aus einer Tabelle kopierte Liste geht auch (der Name, ein Tabulator, die Plätze). Ohne Zahl hat ein Haushalt einen Platz. Höchstens 300 Zeilen.',
      importLabel: 'Ihre Liste',
      importPlaceholder: 'Familie Martin ; 4\nLea Durand ; 2',
      importSubmit: 'Diese Haushalte hinzufügen',
      importSending: 'Wird hinzugefügt…',
      importDone: (n: number) =>
        n === 1 ? '1 Haushalt hinzugefügt.' : `${n} Haushalte hinzugefügt.`,
      importNothing: 'Kein Haushalt hinzuzufügen.',
      importSkippedTitle: 'Übergangene Zeilen',
      importSkippedLine: (line: number, reason: string) => `Zeile ${line}: ${reason}`,
      importReasons: {
        name: 'leerer Name oder mehr als 80 Zeichen',
        places: 'Plätze als Zahl von 1 bis 10 schreiben',
        duplicate: 'Name steht schon in der Liste',
      },
      importClose: 'Schließen',
      deleteTitle: (name: string) => `„${name}“ löschen?`,
      deleteBody:
        'Der Haushalt verlässt die Liste und sein Link funktioniert nicht mehr. Seine Antwort, falls er eine gegeben hat, bleibt unter den Antworten.',
      deleteYes: 'Haushalt löschen',
      rotateTitle: (name: string) => `Link von „${name}“ ändern?`,
      rotateBody:
        'Der alte Link und eine damit gedruckte Karte funktionieren sofort nicht mehr. Die Antwort des Haushalts bleibt.',
      rotateYes: 'Link ändern',
      reminderTitle: 'Geführte Erinnerung',
      reminderProgress: (i: number, n: number) => `${i} von ${n} ohne Antwort`,
      reminderMessageLabel: 'Nachricht',
      reminderEditable: 'änderbar',
      reminderWhatsapp: 'WhatsApp',
      reminderSms: 'SMS',
      reminderEmail: 'E-Mail',
      reminderCopy: 'Kopieren',
      reminderCopied: 'Nachricht kopiert.',
      reminderPrevious: 'Zurück',
      reminderNext: 'Weiter',
      reminderNote:
        'WhatsApp, SMS und E-Mail öffnen sich mit der fertigen Nachricht: Sie wählen den Kontakt in Ihrer App. EventSlide kennt weder Nummer noch Adresse.',
      reminderArchived: 'Die Veranstaltung ist archiviert: Erinnerungen sind nicht mehr möglich.',
      reminderLoading: 'Die Einladung wird geladen…',
      reminderInviteFailed: 'Die Einladung konnte nicht gelesen werden.',
      reminderNoteMarked:
        'Die Notiz „erinnert“ wird gespeichert, sobald Sie auf einen Kanal klicken.',
      reminderAllDone: 'Alle haben geantwortet.',
      reminderNoLink: 'Speichern Sie zuerst die Einladung: Ohne Link gibt es nichts zu senden.',
      reminderNoteFailed: 'Die Notiz „erinnert“ konnte nicht gespeichert werden.',
      reminderSubject: (title: string) => `Kleine Erinnerung: ${title}`,
      reminderMessage: (
        name: string,
        title: string,
        deadline: string | null,
        link: string | null,
      ) =>
        `Hallo ${name}, eine kleine Erinnerung: ${title}. Könnt ihr uns sagen, ob ihr kommt${deadline === null ? '' : ` (bis ${deadline})`}? Zwei Klicks genügen:${link === null ? '' : `\n${link}`}`,
    },
  },

  eventMenu: {
    label: 'Menü der Feier',
    tabBar: 'Navigation der Feier',
    home: 'Start',
    /** Beside the moment the event is in. */
    current: 'jetzt',
    moments: {
      before: 'Vorbereiten',
      during: 'Während der Feier',
      after: 'Nach der Feier',
    },
    /** The phone's tab bar, where four words share one line. */
    momentsShort: {
      before: 'Vorbereiten',
      during: 'Feier',
      after: 'Danach',
    },
    momentIntros: {
      before: 'Was vor der Ankunft der Gäste vorbereitet wird.',
      during: 'Was während der Feier passiert.',
      after: 'Was Sie von der Feier behalten.',
    },
    sections: {
      access: 'QR-Code und Link',
      print: 'Karten und Plakat',
      invitations: 'Einladungen',
      rsvps: 'Antworten',
      missions: 'Missionen',
      moderators: 'Moderatoren',
      moderation: 'Moderation',
      wall: 'Bildschirm im Saal',
      announcements: 'Durchsagen',
      challenge: 'Foto-Challenge',
      guestbook: 'Gästebuch',
      reveal: 'Enthüllung',
      telegram: 'Telegram',
      guests: 'Gäste',
      album: 'Album',
      bestOf: 'Best-of',
      book: 'Fotobuch',
      share: 'Geteiltes Album',
      stats: 'Statistiken',
      settings: 'Einstellungen',
    },
    /** One line under each entry, on the lists of the moments' pages. */
    hints: {
      access: 'Code, Link und QR-Code zum Mitmachen',
      print: 'Der QR-Code für die Tische',
      invitations: 'Die Einladung und ihr Link',
      rsvps: 'Wer kommt, und wie viele',
      missions: 'Fotoideen zum Mitmachen',
      moderators: 'Zu mehreren moderieren',
      moderation: 'Was auf den Bildschirm kommt',
      wall: 'Auf dem Beamer öffnen',
      announcements: 'Eine Nachricht für den ganzen Saal',
      challenge: 'Eine Foto-Challenge auf Zeit',
      guestbook: 'Die Worte Ihrer Gäste',
      reveal: 'Wann die Fotos erscheinen',
      telegram: 'Die verknüpfte Gruppe',
      guests: 'Wer der Feier beigetreten ist',
      album: 'Alle Fotos in einer Datei',
      bestOf: 'Ihre Lieblingsfotos',
      book: 'Ein Fotobuch zum Drucken',
      share: 'Ein Link für alle, die nicht dabei waren',
      stats: 'Wer was wann gepostet hat',
      settings: 'Stimmung, Zeiten, Bildschirm',
    },
    newTab: 'öffnet einen neuen Tab',
    notHere: 'Diese Seite gibt es für diese Feier nicht.',
    backHome: 'Zurück zur Startseite der Feier',
    albumTitle: 'Das Album',
    albumIntro: 'Alle veröffentlichten Fotos und Videos in einer ZIP-Datei.',
    dangerTitle: 'Feier löschen',
  },
  /* The photo book's own page (spec 26): the live preview beside the settings. */
  bookPage: {
    back: 'Zurück zur Veranstaltung',
    coverLegend: 'Umschlag',
    previewLabel: 'Vorschau des Buchs',
    previewNote: 'Vorschau: Das endgültige Layout entsteht bei der Erstellung.',
    summary: (pages: number, photos: number, style: string) =>
      `${t.number(pages)} Seiten · ${t.number(photos)} Fotos · Stil ${style}`,
    refreshing: 'Vorschau wird aktualisiert…',
    failed: 'Die Vorschau konnte nicht geladen werden.',
    retry: 'Erneut versuchen',
    empty:
      'Noch ist kein Foto veröffentlicht. Das Buch entsteht aus veröffentlichten Fotos: Veröffentlichen Sie welche in der Moderation.',
    unsupported: 'Das Fotobuch ist auf diesem Server nicht verfügbar.',
    prev: 'Vorherige Seiten',
    next: 'Nächste Seiten',
    cover: 'Umschlag',
    inside: 'Umschlaginnenseite',
    backCover: 'Rückseite',
    pageNumber: (n: number) => `Seite ${n}`,
    pageNumbers: (a: number, b: number) => `Seiten ${a} und ${b}`,
    spreadPosition: (k: number, n: number) => `Doppelseite ${k} von ${n}`,
    stripLabel: 'Doppelseiten',
    stripItem: (label: string) => `Gehe zu: ${label}`,
    big: 'Größer anzeigen',
    queued: 'Wartet auf seinen Platz…',
    running: 'Das Buch wird auf dem Server gesetzt…',
    workingNote:
      'Der Server meldet keinen Fortschritt. Sie können die Seite verlassen: Das Buch ist danach hier fertig.',
  },

  titles: {
    print: 'Tischkarten und Plakat',
    eventBook: 'Fotobuch',
    join: 'Der Feier beitreten',
    upload: 'Fotos senden',
    feed: 'Fotos des Abends',
    wall: 'Bildschirm der Veranstaltung',
    gallery: 'Geteiltes Album',
    guestInvite: 'Einladung',
    guestInviteHost: 'Einladungen',
    rsvps: 'Antworten',
    rsvpGuests: 'Gästeliste',
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
    eventAccess: 'QR-Code und Link',
    eventMissions: 'Missionen',
    eventModerators: 'Moderatoren',
    eventAnnouncements: 'Durchsagen',
    eventChallenge: 'Foto-Challenge',
    eventGuestbook: 'Gästebuch',
    eventReveal: 'Enthüllung',
    eventTelegram: 'Telegram',
    eventGuests: 'Gäste',
    eventAlbum: 'Album',
    eventBestOf: 'Best-of',
    eventShare: 'Geteiltes Album',
    eventBefore: 'Feier vorbereiten',
    eventDuring: 'Während der Feier',
    eventAfter: 'Nach der Feier',
    moderation: 'Moderation',
    stats: 'Statistik der Veranstaltung',
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
