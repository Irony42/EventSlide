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
  },

  wall: {
    empty: 'Les premières photos vont bientôt arriver',
    emptyHint: 'Scannez le QR code pour envoyer les vôtres.',
    joinPrompt: 'Rejoignez la galerie',
    reactions: 'Réactions',
    offline: 'Connexion perdue — nouvelle tentative en cours',
    paused: 'Diaporama en pause',
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

    'displayName.tooLong': 'Prénom trop long.',
    'joinCode.wrongLength': 'Le code comporte six caractères.',
    'joinCode.malformed': 'Ce code contient un caractère inattendu.',

    'reaction.rateLimited': 'Doucement — attendez un instant avant de réagir à nouveau.',
    'rate.limited': 'Trop de tentatives. Patientez un instant.',
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
  if (code === undefined) return fr.errors.unknown
  const table: Record<string, string> = fr.errors
  return table[code] ?? fr.errors.unknown
}
