/**
 * Every user-facing string, in one place.
 *
 * Two rules the rest of the app depends on:
 *
 * 1. **The server never sends French.** It sends a stable machine code
 *    (`photo.notFound`, `event.quotaExceeded`); this file decides the wording. 1.0
 *    hardcoded French inside route handlers, so the wording could not change without
 *    editing the server and could not be translated at all.
 * 2. **Vouvoiement throughout.** A guest is somebody else's guest at somebody else's
 *    wedding — the app is the host's voice, not a friend's. Mixed registers read as
 *    sloppy, so the choice is made once, here.
 *
 * Tone: sentence case, no exclamation-mark inflation, and an error says what to do
 * next rather than what went wrong internally.
 */

export const fr = {
  app: {
    name: 'EventSlide',
    loading: 'Chargement…',
    retry: 'Réessayer',
    cancel: 'Annuler',
    close: 'Fermer',
    save: 'Enregistrer',
    back: 'Retour',
    confirm: 'Confirmer',
  },

  join: {
    title: 'Rejoindre la galerie',
    codeLabel: 'Code de la soirée',
    codeHint: 'Six caractères, indiqués sur le carton ou le QR code.',
    nameLabel: 'Votre prénom',
    nameHint: 'Il apparaîtra sous vos photos. Vous pouvez le laisser vide.',
    submit: 'Rejoindre',
    submitting: 'Connexion…',
    welcome: (eventName: string) => `Bienvenue à ${eventName}`,
    anonymous: 'Rester anonyme',
  },

  upload: {
    title: 'Vos photos',
    intro: 'Ajoutez vos photos, elles apparaîtront sur l’écran après validation.',
    addPhotos: 'Ajouter des photos',
    takePhoto: 'Prendre une photo',
    captionLabel: 'Légende',
    captionHint: (max: number) => `${max} caractères maximum. Facultatif.`,
    send: 'Envoyer',
    sending: 'Envoi…',
    sendCount: (count: number) =>
      count === 1 ? 'Envoyer la photo' : `Envoyer les ${count} photos`,
    queueEmpty: 'Aucune photo sélectionnée pour le moment.',
    itemPending: 'En attente',
    itemUploading: 'Envoi en cours',
    itemDone: 'Envoyée',
    itemDuplicate: 'Déjà envoyée',
    itemFailed: 'Échec',
    remove: 'Retirer',
    // The guest's own photos, whatever the host decided: being told a photo is waiting
    // beats wondering whether the upload worked.
    mine: 'Vos envois',
    statusPending: 'En attente de validation',
    statusPublished: 'À l’écran',
    statusRejected: 'Non retenue',
    statusHidden: 'Retirée de l’écran',
    deleteOwn: 'Supprimer',
    deleteOwnConfirm: 'Supprimer cette photo ? Cette action est définitive.',
    graceOver: 'Le délai pour supprimer vous-même cette photo est passé.',
    thanks: 'Merci, vos photos sont bien arrivées.',
    sendMore: 'Envoyer d’autres photos',

    /* ---------- guest surface: features/join + features/guest-upload ---------- */

    itemPreparing: 'Préparation…',
    queueLabel: 'Photos à envoyer',
    queueSummary: (done: number, total: number) =>
      `${done} envoyée${done > 1 ? 's' : ''} sur ${total}`,
    queueFailed: (count: number) =>
      count === 1 ? 'Un envoi a échoué.' : `${count} envois ont échoué.`,
    itemAlt: (position: number) => `Photo ${position} à envoyer`,
    itemProgress: (position: number) => `Envoi de la photo ${position}`,
    removeItem: (position: number) => `Retirer la photo ${position}`,
    retryItem: (position: number) => `Réessayer l’envoi de la photo ${position}`,
    captionRemaining: (remaining: number) => `${remaining} caractères restants.`,
    signedAs: (name: string) => `Vos photos apparaîtront sous le nom ${name}.`,
    signedAnonymous: 'Vos photos apparaîtront sans nom.',
    mineEmpty: 'Vous n’avez encore envoyé aucune photo.',
    mineFailed: 'Vos envois n’ont pas pu être affichés. Réessayez.',
    mineAlt: 'Votre photo',
    deleteOwnNumbered: (position: number) => `Supprimer la photo ${position}`,
    notJoinedTitle: 'Rejoignez la galerie pour envoyer vos photos',
    notJoinedHint: 'Scannez à nouveau le QR code, ou saisissez le code de la soirée.',
    notJoinedAction: 'Saisir le code',

    /* ---- Added by the offline outbox. Keep additions inside this block. ---- */

    /**
     * The state a saturated venue Wi-Fi produces, said as reassurance rather than as an
     * error. A guest told "Échec" sends the photo again; a guest told it is on its way
     * puts the phone back in their pocket, which is the entire point of the feature.
     */
    itemQueued: 'En attente du réseau',
    /**
     * Said for every photo the outbox gave up on — out of time, past the per-event
     * limit, or refused by the server on its merits. Deliberately one sentence for all
     * three: the guest's next move is identical, and three shades of "it did not go"
     * would only make them read more.
     */
    itemExpiredHint: 'Cette photo n’a pas pu être envoyée. Renvoyez-la si vous l’avez encore.',
    offlineTitle: (count: number) =>
      count === 1 ? '1 photo attend le réseau' : `${count} photos attendent le réseau`,
    offlineHint:
      'Elles sont enregistrées sur votre téléphone et partiront dès que la connexion revient. Vous pouvez fermer cette page.',
    offlineSending: 'Envoi des photos en attente…',
    offlineRetry: 'Envoyer maintenant',

    /* ---- Added by the installable app (roadmap 1.2). ---- */

    installTitle: 'Gardez la galerie à portée de main',
    /**
     * Says what it is for, not what it is. "Installer l'application" invites the
     * question a guest at a wedding will not stop to answer; "retrouvez-la sans le QR
     * code" is the reason they would want it.
     */
    installHint:
      'Ajoutez-la à votre écran d’accueil pour retrouver la galerie plus tard, sans chercher le QR code.',
    /** iOS gives no prompt at all, so the route through the share menu is the feature. */
    /**
     * No location given for the Share button, deliberately: it is at the bottom on an
     * iPhone and at the top on an iPad, and the property this browser was recognised by
     * cannot tell the two apart. Naming the wrong corner is worse than naming none.
     */
    installIosHint: 'Ouvrez le menu Partager, puis choisissez « Sur l’écran d’accueil ».',
    installAction: 'Ajouter à l’écran d’accueil',
    installDismiss: 'Masquer cette proposition',

    /* -------------------------- end guest surface --------------------------- */
  },

  moderation: {
    title: 'Modération',
    intro: 'Rien n’apparaît à l’écran sans votre validation.',
    pending: (count: number) => (count === 1 ? '1 photo en attente' : `${count} photos en attente`),
    empty: 'Rien à valider pour l’instant.',
    emptyHint: 'Les nouvelles photos arrivent ici automatiquement.',
    publish: 'Publier',
    reject: 'Refuser',
    hide: 'Retirer de l’écran',
    undo: 'Annuler',
    undone: 'Décision annulée.',
    selectAll: 'Tout sélectionner',
    clearSelection: 'Tout désélectionner',
    bulkPublish: (count: number) => `Publier (${count})`,
    bulkReject: (count: number) => `Refuser (${count})`,
    bulkSkipped: (count: number) =>
      count === 1
        ? '1 photo ignorée : action impossible.'
        : `${count} photos ignorées : action impossible.`,
    filterAll: 'Toutes',
    filterPending: 'En attente',
    filterPublished: 'À l’écran',
    filterRejected: 'Refusées',
    filterHidden: 'Retirées',
    by: (name: string) => `par ${name}`,
    byAnonymous: 'Invité anonyme',
    shortcuts: 'Raccourcis',
    shortcutsHint: 'J / K pour naviguer, P pour publier, R pour refuser, Z pour annuler.',

    /* ---- Added by features/moderation. Keep additions inside this block. ---- */
    shortcutsMore:
      'H pour retirer de l’écran, Espace pour sélectionner, Échap pour tout désélectionner.',
    queueLabel: 'Photos à modérer',
    filterLabel: 'Filtrer par état',
    emptyFiltered: 'Aucune photo dans cette catégorie.',
    emptyFilteredHint: 'Changez de filtre pour voir les autres photos.',
    loadFailed: 'La file de modération n’a pas pu être chargée.',
    live: 'Mises à jour en direct',
    liveLost: 'Connexion perdue — nouvelle tentative en cours.',
    // The word beside the border colour and the icon, so the status survives stage
    // lighting and a red-green colourblind host.
    statePending: 'En attente',
    statePublished: 'Publiée',
    stateRejected: 'Refusée',
    stateHidden: 'Retirée de l’écran',
    selected: (count: number) =>
      count === 1 ? '1 photo sélectionnée' : `${count} photos sélectionnées`,
    /**
     * Goes inside "la photo de …", where `byAnonymous` would read as "de Invité
     * anonyme". The standalone caption line keeps `byAnonymous`.
     */
    anonymousInName: 'l’invité anonyme',
    selectPhoto: (author: string) => `Sélectionner la photo de ${author}`,
    publishPhoto: (author: string) => `Publier la photo de ${author}`,
    rejectPhoto: (author: string) => `Refuser la photo de ${author}`,
    hidePhoto: (author: string) => `Retirer de l’écran la photo de ${author}`,
    enlargePhoto: (author: string) => `Agrandir la photo de ${author}`,
    photoOf: (author: string) => `Photo de ${author}`,
    photoAlt: (author: string) => `Photo envoyée par ${author}`,
    photoAltWithCaption: (caption: string, author: string) =>
      `${caption} — photo envoyée par ${author}`,
    previousPhoto: 'Photo précédente',
    nextPhoto: 'Photo suivante',
    bulkHide: (count: number) => `Retirer de l’écran (${count})`,
    published: (count: number) => (count === 1 ? '1 photo publiée.' : `${count} photos publiées.`),
    refused: (count: number) => (count === 1 ? '1 photo refusée.' : `${count} photos refusées.`),
    removed: (count: number) =>
      count === 1 ? '1 photo retirée de l’écran.' : `${count} photos retirées de l’écran.`,
    decisionFailed: 'La décision n’a pas pu être enregistrée. Réessayez.',
    undoFailed: 'L’annulation n’a pas pu être enregistrée. Réessayez.',
    dimensions: (width: number, height: number) => `${width} × ${height} pixels`,
    /**
     * Said out loud rather than left blank. A card with no caption line at all is
     * indistinguishable from one whose caption failed to arrive, and the host is about
     * to decide what gets projected with that photo.
     */
    noCaption: 'Sans légende',
  },

  wall: {
    empty: 'Les premières photos vont bientôt arriver',
    emptyHint: 'Scannez le QR code pour envoyer les vôtres.',
    joinPrompt: 'Rejoignez la galerie',
    reactions: 'Réactions',
    offline: 'Connexion perdue — nouvelle tentative en cours',
    paused: 'Diaporama en pause',

    /* ---- Added by features/wall. Keep additions inside this block. ---- */
    codeLabel: 'Code de la soirée',
    // The accessible name of the inline QR. Read by nothing in the room, but the wall
    // is also opened on a laptop while a host sets the projector up.
    qrTitle: 'QR code pour rejoindre la galerie',
    // A photo's alt text. 1.0 used the filename, which reads aloud as IMG_4821.jpg.
    photoBy: (name: string) => `Photo envoyée par ${name}`,
    photoByAnonymous: 'Photo envoyée par un invité',
    errorTitle: 'Les photos n’ont pas pu être chargées',
    errorHint: 'Nouvelle tentative en cours. Vérifiez le réseau du lieu si l’écran reste vide.',
    dismissJoinCard: 'Masquer le rappel du code',
    shortcuts: 'Raccourcis clavier',
    shortcutsHint:
      'Espace met en pause, les flèches changent de photo, F passe en plein écran, L change la disposition.',
  },

  admin: {
    title: 'Administration',
    events: 'Vos évènements',
    newEvent: 'Nouvel évènement',
    eventName: 'Nom de l’évènement',
    eventNameHint: 'Visible par vos invités, par exemple « Camille & Sacha ».',
    slug: 'Adresse',
    joinCode: 'Code d’accès',
    rotateJoinCode: 'Changer le code',
    rotateJoinCodeHint:
      'Les invités déjà connectés le restent. Le nouveau code remplace immédiatement l’ancien.',
    qrCode: 'QR code',
    qrCodeHint: 'À imprimer et poser sur les tables.',
    openWall: 'Ouvrir l’écran',
    openModeration: 'Modérer',
    download: 'Télécharger l’album',
    statusDraft: 'Brouillon',
    statusLive: 'En cours',
    statusClosed: 'Terminé',
    statusArchived: 'Archivé',
    goLive: 'Ouvrir aux invités',
    closeEvent: 'Clore l’évènement',
    reopenEvent: 'Réouvrir',
    archiveEvent: 'Archiver',
    photos: (count: number) => (count === 1 ? '1 photo' : `${count} photos`),
    guests: (count: number) => (count === 1 ? '1 invité' : `${count} invités`),
    storageUsed: (used: string, total: string) => `${used} sur ${total}`,
    settings: 'Réglages',
    moderationMode: 'Modération',
    moderationManual: 'Valider chaque photo',
    moderationAuto: 'Publier automatiquement',
    moderationAutoWarning:
      'Les photos apparaîtront à l’écran sans validation. À réserver aux évènements entre proches.',
    allowCaptions: 'Autoriser les légendes',
    allowReactions: 'Autoriser les réactions',
    allowGuestSelfDelete: 'Autoriser les invités à supprimer leurs photos',
    retention: 'Suppression automatique',
    retentionNever: 'Jamais',
    retentionDays: (days: number) => `${days} jours après la fin`,
    moderators: 'Modérateurs',
    inviteModerator: 'Inviter un modérateur',

    /* ---- Added by features/admin (auth, event management). ---- */
    loading: 'Chargement de vos évènements…',
    loadFailed: 'Chargement impossible',
    eventLoading: 'Chargement de l’évènement…',
    eventsEmpty: 'Aucun évènement pour le moment.',
    eventsEmptyHint:
      'Créez votre premier évènement, puis imprimez son QR code pour le poser sur les tables.',
    create: 'Créer l’évènement',
    slugHint: 'Facultatif. Laissez vide pour la déduire du nom.',
    slugPreviewLabel: 'Adresse de la galerie',
    slugPreviewEmpty: 'Saisissez un nom pour voir l’adresse.',
    eventCreated: (name: string) => `${name} est prêt. Imprimez le QR code quand vous voulez.`,
    joinCodeHint: 'À communiquer aux invités qui ne peuvent pas scanner le QR code.',
    eventControls: 'Pilotage de l’évènement',
    joinLink: 'Lien d’invitation',
    printQr: 'Imprimer le QR code',
    qrScanPrompt: 'Scannez pour envoyer vos photos.',
    qrAlt: (eventName: string) => `QR code d’accès à ${eventName}`,
    storageLabel: 'Espace photos utilisé',
    storage: (used: string) => `${used} utilisés`,
    statusSaved: 'Le nouvel état est enregistré.',
    rotateJoinCodeTitle: 'Changer le code d’accès ?',
    codeRotated: 'Le code d’accès a été changé. L’ancien ne fonctionne plus.',
    settingsSaved: 'Réglages enregistrés.',
    settingsReadOnly: 'Cet évènement est archivé : ses réglages ne peuvent plus être modifiés.',
    retentionHint: 'Les photos sont supprimées ce délai après la clôture de l’évènement.',
    selfDeleteGrace: 'Délai de suppression',
    selfDeleteGraceHint: 'Pendant ce délai, un invité peut retirer lui-même sa photo.',
    graceNone: 'Aucun délai',
    graceSeconds: (seconds: number) => (seconds === 1 ? '1 seconde' : `${seconds} secondes`),
    graceMinutes: (minutes: number) => (minutes === 1 ? '1 minute' : `${minutes} minutes`),
    graceHours: (hours: number) => (hours === 1 ? '1 heure' : `${hours} heures`),
    maxPhotosPerGuest: 'Photos par invité',
    maxPhotosUnlimited: 'Sans limite',
    guestList: 'Invités',
    guestsEmpty: 'Personne n’a encore rejoint la galerie.',
    guestsEmptyHint: 'Les invités apparaissent ici dès qu’ils scannent le QR code.',
    lastSeen: (when: string) => `Dernière activité : ${when}`,
    dateUnknown: 'Date inconnue',
    guestRevokedBadge: 'Accès retiré',
    revokeGuest: 'Retirer l’accès',
    revokeGuestTitle: 'Retirer l’accès de cet invité ?',
    revokeGuestHint:
      'Ses photos déjà publiées restent à l’écran, mais il ne pourra plus en envoyer.',
    guestRevoked: 'L’accès a été retiré.',
    moderatorsEmpty: 'Vous êtes seul à modérer cet évènement.',
    moderatorEmail: 'Adresse e-mail du modérateur',
    moderatorEmailHint: 'Il recevra des droits sur cet évènement uniquement.',
    moderatorPassword: 'Mot de passe temporaire',
    /**
     * Said plainly because the host *is* the delivery mechanism: rien n'est envoyé par
     * e-mail, so a host who types a password and waits for something to happen has
     * already lost the invitee.
     */
    moderatorPasswordHint: (min: number) =>
      `Au moins ${min} caractères. Aucun e-mail n’est envoyé : lisez ce mot de passe au modérateur. Il en choisira un autre à sa première connexion.`,
    inviteSubmit: 'Inviter',
    moderatorInvited: (email: string) =>
      `${email} peut désormais modérer cet évènement. Communiquez-lui le mot de passe temporaire.`,
    /** The address already had an account, so the password just typed was not used. */
    moderatorInvitedExisting: (email: string) =>
      `${email} peut désormais modérer cet évènement. Ce compte existait déjà : il garde son mot de passe habituel.`,
    revokeModerator: 'Retirer',
    revokeModeratorTitle: 'Retirer ce modérateur ?',
    revokeModeratorHint:
      'Il perdra l’accès à cet évènement. Ses décisions passées sont conservées.',
    moderatorRevoked: 'Le modérateur a été retiré.',
    roleOwner: 'Organisateur',
    roleModerator: 'Modérateur',
    lastOwnerHint: 'Le dernier organisateur ne peut pas être retiré.',
    purge: 'Supprimer l’évènement',
    purgeTitle: 'Supprimer définitivement cet évènement ?',
    purgeWarning:
      'Toutes les photos, les invités et l’album seront supprimés. Cette action est définitive.',
    purgeConfirmLabel: 'Adresse de l’évènement',
    purgeConfirmHint: (slug: string) => `Saisissez « ${slug} » pour confirmer la suppression.`,
    purged: (name: string) => `${name} a été supprimé.`,
  },

  auth: {
    title: 'Connexion',
    email: 'Adresse e-mail',
    password: 'Mot de passe',
    submit: 'Se connecter',
    submitting: 'Connexion…',
    logout: 'Se déconnecter',
    changePassword: 'Changer de mot de passe',
    currentPassword: 'Mot de passe actuel',
    newPassword: 'Nouveau mot de passe',
    newPasswordHint: (min: number) =>
      `Au moins ${min} caractères. Une phrase est plus sûre qu’un mot.`,
    confirmPassword: 'Confirmer le nouveau mot de passe',
    mustChangePassword: 'Choisissez un mot de passe avant de continuer.',

    /* ---- Added by features/auth. ---- */
    changePasswordIntro: 'Choisissez un mot de passe que vous n’utilisez pas ailleurs.',
    passwordSaved: 'Mot de passe enregistré.',
  },

  /**
   * Server error codes to French. The key is the `error.code` the API returns.
   *
   * Each message says what the reader can do next. `unknown` is the fallback and is
   * deliberately vague about internals — a stack trace or a SQL fragment never reaches
   * a guest's phone.
   */
  errors: {
    unknown: 'Une erreur est survenue. Réessayez dans un instant.',
    network: 'Connexion interrompue. Vérifiez votre réseau puis réessayez.',
    'request.invalid': 'Les informations envoyées ne sont pas valides.',

    'auth.invalidCredentials': 'Adresse e-mail ou mot de passe incorrect.',
    'auth.required': 'Connectez-vous pour continuer.',
    'auth.forbidden': 'Vous n’avez pas les droits pour cette action.',

    'event.notFound': 'Ce code ne correspond à aucune galerie ouverte.',
    'event.notAcceptingUploads': 'Cette galerie n’accepte plus de photos.',
    'event.quotaExceeded': 'La galerie a atteint sa capacité. Prévenez l’organisateur.',
    'event.slugTaken': 'Cette adresse est déjà utilisée.',
    'event.immutable': 'Cet évènement est archivé et ne peut plus être modifié.',
    'event.illegalTransition': 'Ce changement d’état n’est pas possible.',

    'guest.wrongEvent': 'Votre accès ne correspond pas à cette galerie.',
    'guest.revoked': 'Votre accès a été retiré par l’organisateur.',
    'guestToken.expired': 'Votre accès a expiré. Scannez à nouveau le QR code.',
    'guestToken.malformed': 'Votre accès n’est plus valide. Scannez à nouveau le QR code.',
    'guestToken.badSignature': 'Votre accès n’est plus valide. Scannez à nouveau le QR code.',

    'photo.notFound': 'Cette photo n’existe plus.',
    'photo.illegalTransition': 'Cette action n’est pas possible sur cette photo.',
    'photo.tooManyForGuest': 'Vous avez atteint le nombre de photos autorisé.',

    'image.unsupportedFormat':
      'Ce fichier n’est pas une photo. Formats acceptés : JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'Cette photo semble abîmée. Essayez-en une autre.',
    'image.tooManyPixels': 'Cette photo est trop grande. Réduisez-la puis réessayez.',
    'image.animated': 'Les images animées ne sont pas acceptées.',
    'image.renderFailed': 'Cette photo n’a pas pu être traitée. Essayez-en une autre.',
    'upload.tooLarge': 'Cette photo dépasse la taille maximale.',
    'upload.tooManyFiles': 'Trop de photos en une fois. Envoyez-les en plusieurs lots.',

    'caption.tooLong': 'Légende trop longue.',
    'caption.empty': 'La légende est vide.',

    'password.tooShort': 'Mot de passe trop court.',
    'password.tooLong': 'Mot de passe trop long.',
    'password.tooCommon': 'Ce mot de passe est trop courant.',
    'password.sameAsEmail': 'Le mot de passe ne peut pas être votre adresse e-mail.',
    'password.sameAsName': 'Le mot de passe ne peut pas être votre nom.',
    'password.tooRepetitive': 'Ce mot de passe est trop répétitif.',
    'password.unchanged': 'Choisissez un mot de passe différent de l’actuel.',
    'password.mismatch': 'Les deux mots de passe ne correspondent pas.',

    /* ---- Added by features/admin: codes the host-facing forms can receive. ---- */
    'eventName.empty': 'Donnez un nom à votre évènement.',
    'eventName.tooShort': 'Ce nom est trop court.',
    'eventName.tooLong': 'Ce nom est trop long.',
    'slug.tooShort': 'L’adresse doit comporter au moins deux caractères.',
    'slug.tooLong': 'Cette adresse est trop longue.',
    'slug.malformed':
      'L’adresse n’accepte que des lettres sans accent, des chiffres et des tirets.',
    'slug.reserved': 'Cette adresse est réservée. Choisissez-en une autre.',
    'eventSettings.graceSecondsInvalid': 'Ce délai de suppression n’est pas accepté.',
    'eventSettings.retentionDaysInvalid': 'Ce délai de conservation n’est pas accepté.',
    'eventSettings.maxPhotosPerGuestInvalid': 'Ce nombre de photos par invité n’est pas accepté.',
    'email.malformed': 'Cette adresse e-mail n’est pas valide.',
    'user.notFound': 'Aucun compte ne correspond à cette adresse e-mail.',
    'membership.alreadyExists': 'Cette personne modère déjà cet évènement.',

    'displayName.tooLong': 'Prénom trop long.',
    'joinCode.wrongLength': 'Le code comporte six caractères.',
    'joinCode.malformed': 'Ce code contient un caractère inattendu.',

    'reaction.rateLimited': 'Doucement — attendez un instant avant de réagir à nouveau.',
    'rate.limited': 'Trop de tentatives. Patientez un instant.',

    /* ---- Codes docs/API.md documents that had no copy of their own yet. Each one
            reached a guest as the generic `unknown` sentence, which told them nothing
            about a refusal the host had deliberately configured. ---- */
    'event.captionsNotAllowed': 'Les légendes ne sont pas activées pour cette galerie.',
    'event.reactionsDisabled': 'Les réactions ne sont pas activées pour cette galerie.',
    'event.guestSelfDeleteDisabled':
      'L’organisateur ne permet pas aux invités de supprimer leurs photos.',
    'photo.captionEditForbidden': 'Cette légende ne peut plus être modifiée.',
    'photo.deleteForbidden': 'Vous ne pouvez plus supprimer cette photo vous-même.',
    'reaction.alreadyExists': 'Vous avez déjà réagi ainsi à cette photo.',
    'reaction.notPublished': 'Cette photo n’est pas encore à l’écran.',
    'reaction.notFound': 'Cette réaction n’existe plus.',
    'upload.noFiles': 'Aucune photo n’a été reçue. Sélectionnez-en une puis réessayez.',
    'upload.unexpectedField': 'Cet envoi n’a pas pu être lu. Réessayez.',
    // The page's CSRF cookie is gone or stale — a tab left open all evening, or a
    // reverse proxy that dropped it. Reloading re-issues it, so that is the advice.
    'request.csrfMissing': 'Cette page a expiré. Rechargez-la puis réessayez.',
    'request.csrfMismatch': 'Cette page a expiré. Rechargez-la puis réessayez.',

    /* ---- Codes the use cases actually answer with, which docs/API.md either names
            differently or does not list. `event.photoLimitReached` is the important
            one: the doc calls the per-guest cap `photo.tooManyForGuest`, the server
            sends `event.photoLimitReached`, so the only refusal a host deliberately
            configured reached the guest as the generic sentence. Both spellings are
            kept until the contract picks one. ---- */
    'event.photoLimitReached': 'Vous avez atteint le nombre de photos autorisé.',
    'photo.pixelBudgetExceeded': 'Cette photo est trop grande. Réduisez-la puis réessayez.',
    'upload.rejected': 'Cet envoi n’a pas pu être lu. Réessayez.',
    'event.notModeratable': 'Cet évènement est archivé : les décisions ne s’appliquent plus.',
    'membership.lastOwner': 'Un évènement doit garder au moins un propriétaire.',
    'membership.notFound': 'Cette personne ne modère pas cet évènement.',
    'guest.notFound': 'Cet invité n’apparaît plus dans la liste. Actualisez la page.',
  },

  /**
   * Design-system primitives and the app shell.
   *
   * Separate from the feature sections because a primitive's copy — the label on a
   * dialog's close button, the name of the toast region — would otherwise be reworded
   * once per feature folder that renders it.
   */
  ui: {
    dialogClose: 'Fermer la fenêtre',
    notifications: 'Notifications',
    dismissNotification: 'Masquer cette notification',
    percent: (value: number) => `${value} %`,
    optional: 'Facultatif',
  },

  shell: {
    skipToContent: 'Aller au contenu principal',
    sessionChecking: 'Vérification de votre session…',
    sessionFailed: 'Impossible de vérifier votre session. Vérifiez votre réseau puis réessayez.',
    crashTitle: 'Cet écran s’est arrêté',
    crashHint: 'Rien n’est perdu : vos photos sont sur le serveur. Réessayez pour reprendre.',
    notFoundTitle: 'Page introuvable',
    notFoundHint: 'Cette adresse n’existe pas. Vérifiez le lien ou revenez à l’accueil.',
    notFoundHome: 'Revenir à l’accueil',
    comingSoon: 'Cet écran arrive bientôt.',
  },
} as const

export type Translations = typeof fr

/**
 * French for a server error code, falling back to a generic message.
 *
 * Unknown codes are expected: a newer server may return a code this build has never
 * heard of, and showing a guest a raw `event.somethingNew` would be worse than a
 * generic sentence.
 */
export const messageForCode = (code: string | undefined): string => {
  const table: Record<string, string | undefined> = fr.errors
  /**
   * `Object.hasOwn` rather than a bare lookup. `code` is a string chosen by whatever
   * answered the request — the server, or a proxy in front of it — so a body carrying
   * `{"error":{"code":"constructor"}}` would otherwise resolve to `Object` itself and
   * hand a guest a function where a sentence belongs.
   */
  const message = code !== undefined && Object.hasOwn(fr.errors, code) ? table[code] : undefined
  return message ?? fr.errors.unknown
}
