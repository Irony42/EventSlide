/**
 * Every user-facing string, in one place, and the source of truth for what a string is.
 *
 * Three rules the rest of the app depends on:
 *
 * 1. **The server never sends French.** It sends a stable machine code
 *    (`photo.notFound`, `event.quotaExceeded`); this file decides the wording. 1.0
 *    hardcoded French inside route handlers, so the wording could not change without
 *    editing the server and could not be translated at all.
 * 2. **Vouvoiement throughout.** A guest is somebody else's guest at somebody else's
 *    wedding — the app is the host's voice, not a friend's. Mixed registers read as
 *    sloppy, so the choice is made once, here.
 * 3. **This file decides which keys exist.** `de.ts`, `en.ts`, `es.ts` and `it.ts` are
 *    typed from `typeof fr`, so a key added here that they do not carry fails
 *    `npm run typecheck` (`translations.ts` explains the derivation). Only the sections
 *    listed in `GUEST_SECTIONS` are translated; the rest are French on every language,
 *    by design and not by omission.
 *
 * Tone: sentence case, no exclamation-mark inflation, and an error says what to do
 * next rather than what went wrong internally.
 *
 * **Adding a string.** Put it in the section it belongs to, as here. If the section is
 * host-facing (`admin`, `moderation`, `mobileModeration`, `auth`, `wall`) there is
 * nothing else to do. If it is guest-facing (`app`, `join`, `upload`, `ui`, `shell`,
 * `errors`) the four other tables stop compiling until they carry it too.
 */

import { formattersFor } from './formatters'
import type { CuratedAccent } from '../../design-system/eventTheme'
import type { ThemeFonts, ThemeFrame, WallLayout } from '../api/dto'

/**
 * French counting, from `Intl` rather than from a hand-written ternary.
 *
 * The ternaries this replaces were the English rule: `count === 1 ? singular : plural`
 * puts zero in the plural, and French puts zero in the singular — so every counted
 * phrase in this file read "0 photos" where French wants "0 photo". Each of the five
 * tables holds its own set of formatters and the phrases read identically across them.
 */
const t = formattersFor('fr')

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
    /**
     * The accessible name of the language picker (roadmap 1.5).
     *
     * Translated like everything else in this section, even though the control it names
     * shows every language in its own name: a guest using a screen reader hears this
     * label, and hearing it in a language they do not read is the same failure the
     * picker exists to fix.
     */
    language: 'Langue',
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
    captionHint: (max: number) => `${t.number(max)} caractères maximum. Facultatif.`,
    send: 'Envoyer',
    sending: 'Envoi…',
    sendCount: (count: number) =>
      t.count(count, {
        one: 'Envoyer la photo',
        other: `Envoyer les ${t.number(count)} photos`,
      }),
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
      t.count(done, {
        one: `${t.number(done)} envoyée sur ${t.number(total)}`,
        other: `${t.number(done)} envoyées sur ${t.number(total)}`,
      }),
    queueFailed: (count: number) =>
      t.count(count, {
        one: 'Un envoi a échoué.',
        other: `${t.number(count)} envois ont échoué.`,
      }),
    itemAlt: (position: number) => `Photo ${position} à envoyer`,
    itemProgress: (position: number) => `Envoi de la photo ${position}`,
    removeItem: (position: number) => `Retirer la photo ${position}`,
    retryItem: (position: number) => `Réessayer l’envoi de la photo ${position}`,
    captionRemaining: (remaining: number) =>
      t.count(remaining, {
        one: `${t.number(remaining)} caractère restant.`,
        other: `${t.number(remaining)} caractères restants.`,
      }),
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
      t.count(count, {
        one: `${t.number(count)} photo attend le réseau`,
        other: `${t.number(count)} photos attendent le réseau`,
      }),
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

    /* ---- Added by short video clips (roadmap 1.4). ---- */

    /**
     * The picker's two controls, worded as "vidéo" and never as "clip".
     *
     * `clip` is the code's word for the thing; a guest at a wedding films a video. The
     * two labels are separate for the same reason the photo pair is: choosing from the
     * library and filming now are different intentions, and a phone's camera app is a
     * one-way trip out of the page unless `capture` keeps it inside.
     *
     * The section heading is a third, shorter word: it and the picker's own label would
     * otherwise be the same string, and a screen reader would announce the region and
     * the control inside it identically.
     */
    clipSection: 'Vidéo',
    addClip: 'Ajouter une vidéo',
    recordClip: 'Filmer une vidéo',
    /**
     * What the limits are, said **before** the picker opens.
     *
     * The numbers come from the event, not from this bundle: they are the deployment's
     * `MAX_CLIP_SECONDS` and `MAX_CLIP_BYTES`, and a guest who reads them films a
     * shorter sequence instead of losing four minutes of venue Wi-Fi to a refusal.
     *
     * The second sentence is the other thing they cannot guess and would be annoyed to
     * discover: **the wall plays a clip muted.** A room with a DJ in it is not a room
     * that hears a projector, so a guest filming a speech should know before they film
     * it rather than after it is on the screen.
     */
    clipHint: (seconds: number, megabytes: number) =>
      `${t.number(seconds)} secondes et ${t.number(megabytes)} Mo maximum. La vidéo est diffusée sans le son.`,
    clipSend: 'Envoyer la vidéo',
    /** The picker's label once a recording is in hand: pressing it opens the picker. */
    clipChange: 'Choisir une autre vidéo',
    /**
     * The button that empties the composer. Named after what it does, not after what the
     * guest might do next: it and the picker above were both "choisir une autre vidéo",
     * so a screen-reader user activating one of them watched the composer empty and no
     * picker open.
     */
    clipDiscard: 'Retirer cette vidéo',
    clipCancel: 'Annuler l’envoi',
    /**
     * Once the bytes are on the box there is nothing left to cancel, and the screen says
     * so rather than offering a button that lies.
     *
     * A real cancellation is not a missing button, it is a reshaping of the spine: the
     * transcode queue deduplicates **per event**, so two guests who forward the same
     * video from the group chat share one job — cancelling it would delete somebody
     * else's clip. `queued` may also only become `running`, and there is no route for a
     * guest to touch a job at all. So the honest thing is to stop promising it and to
     * name what actually happens next.
     */
    clipAlreadySent:
      'Cette vidéo est déjà sur le serveur. Elle sera traitée, puis proposée à l’organisateur.',
    /** The chosen file, before anything has been sent. */
    clipChosen: 'Vidéo prête à être envoyée',
    clipSize: (megabytes: number) => `${t.number(megabytes)} Mo`,
    /**
     * The refusals this surface makes for itself, before a byte leaves the phone.
     *
     * Both name the limit rather than saying "trop grande": a guest who is told the
     * number can act on it, and the number is the one this deployment actually enforces.
     */
    clipTooLarge: (megabytes: number) =>
      `Cette vidéo dépasse ${t.number(megabytes)} Mo. Filmez une séquence plus courte.`,
    clipTooLong: (seconds: number) =>
      `Cette vidéo dépasse ${t.number(seconds)} secondes. Filmez une séquence plus courte.`,
    clipNotAVideo: 'Ce fichier n’est pas une vidéo.',
    /**
     * The four states the job actually has, in the guest's words.
     *
     * Polled from the server rather than guessed at: a progress bar that reaches 100%
     * and then says nothing for forty seconds is how a guest concludes it failed and
     * sends the same eighty megabytes again.
     */
    clipUploading: 'Envoi de la vidéo…',
    clipQueued: 'En file d’attente…',
    clipRunning: 'Traitement de la vidéo…',
    clipDone: 'Vidéo envoyée. Elle apparaîtra à l’écran après validation.',
    clipProgress: 'Envoi de la vidéo',
    /**
     * `429 clip.queueFull`, which is the box being busy and **not** the guest's fault.
     *
     * Worded as a delay rather than as an error, and it carries the server's own
     * `Retry-After`: the condition clears in about a minute, and a guest told "réessayez
     * dans 30 secondes" waits, where a guest told "erreur" presses the button four more
     * times and makes the queue worse.
     */
    clipQueueFullRetry: (seconds: number) =>
      seconds <= 1
        ? 'Beaucoup de vidéos sont en cours de traitement. Réessayez dans un instant.'
        : `Beaucoup de vidéos sont en cours de traitement. Réessayez dans ${t.number(seconds)} secondes.`,
    /** The wait is over and the button is back. Said, so the change is not silent. */
    clipQueueFreed: 'La file s’est libérée. Vous pouvez renvoyer la vidéo.',
    /**
     * The box is still working on it after several minutes, and the screen has stopped
     * asking.
     *
     * Not "échec": the clip may very well arrive. What has ended is the watching, and the
     * sentence points the guest at the one place it will turn up — which is the whole
     * reason "Vos envois" exists.
     */
    clipStillWorking:
      'Le traitement de cette vidéo prend plus de temps que prévu. Rechargez la page dans quelques minutes pour savoir si elle a abouti.',
    /**
     * Said when the network drops mid-upload, and it is the honest half of a deliberate
     * decision: **a clip is not kept in the offline outbox.**
     *
     * A photo is stored on the device and leaves by itself. Eighty megabytes cannot be —
     * a phone holding a video it can never drain is a phone whose queue never empties,
     * and the photos behind it never leave either. So the video is not promised, and the
     * guest is told why rather than watching a row say "en attente du réseau" all
     * evening for bytes nothing will ever send.
     */
    clipNotQueued:
      'Les vidéos ne sont pas mises en attente sur votre téléphone : elles sont trop lourdes. Réessayez quand la connexion revient.',
    /** In "Vos envois", where a clip's thumbnail is its image d’aperçu. */
    mineClipAlt: 'Votre vidéo',
    mineClipBadge: 'Vidéo',
    /**
     * The same badge once the duration is known.
     *
     * It reads identically to `moderation.videoLength`, which is what "Vos envois" used
     * to render — and that was a scope bug rather than reuse: `moderation` is host copy
     * and stays French in every language, so a guest reading this app in German had one
     * French badge in their own list of uploads. Two identical sentences owned by the
     * two audiences that read them is the cheaper mistake.
     */
    mineClipLength: (seconds: number) => `Vidéo · ${t.number(seconds)} s`,

    /* -------------------------- end guest surface --------------------------- */
  },

  moderation: {
    title: 'Modération',
    intro: 'Rien n’apparaît à l’écran sans votre validation.',
    pending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo en attente`,
        other: `${t.number(count)} photos en attente`,
      }),
    empty: 'Rien à valider pour l’instant.',
    emptyHint: 'Les nouvelles photos arrivent ici automatiquement.',
    publish: 'Publier',
    reject: 'Refuser',
    hide: 'Retirer de l’écran',
    undo: 'Annuler',
    undone: 'Décision annulée.',
    selectAll: 'Tout sélectionner',
    clearSelection: 'Tout désélectionner',
    bulkPublish: (count: number) => `Publier (${t.number(count)})`,
    bulkReject: (count: number) => `Refuser (${t.number(count)})`,
    bulkSkipped: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo ignorée : action impossible.`,
        other: `${t.number(count)} photos ignorées : action impossible.`,
      }),
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
      t.count(count, {
        one: `${t.number(count)} photo sélectionnée`,
        other: `${t.number(count)} photos sélectionnées`,
      }),
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
    bulkHide: (count: number) => `Retirer de l’écran (${t.number(count)})`,
    published: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo publiée.`,
        other: `${t.number(count)} photos publiées.`,
      }),
    refused: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo refusée.`,
        other: `${t.number(count)} photos refusées.`,
      }),
    removed: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo retirée de l’écran.`,
        other: `${t.number(count)} photos retirées de l’écran.`,
      }),
    decisionFailed: 'La décision n’a pas pu être enregistrée. Réessayez.',
    undoFailed: 'L’annulation n’a pas pu être enregistrée. Réessayez.',
    dimensions: (width: number, height: number) => `${width} × ${height} pixels`,
    /**
     * Said out loud rather than left blank. A card with no caption line at all is
     * indistinguishable from one whose caption failed to arrive, and the host is about
     * to decide what gets projected with that photo.
     */
    noCaption: 'Sans légende',

    /* ---- Added by short video clips (roadmap 1.4). ---- */

    /**
     * A clip, on the two surfaces that judge one.
     *
     * The badge is on the card because the decision starts before the host opens
     * anything: "this one is fifteen seconds of video" changes how long they are about
     * to spend, and a poster frame alone does not say it.
     */
    videoBadge: 'Vidéo',
    videoLength: (seconds: number) => `Vidéo · ${seconds} s`,
    /**
     * The whole point of the clip work on this surface. A moderator deciding whether
     * fifteen seconds of video goes on a wall in front of two hundred people cannot do
     * it from a still frame — the thing that gets someone into trouble is rarely in the
     * first frame.
     */
    watchVideo: (author: string) => `Regarder la vidéo de ${author}`,
    playVideo: (author: string) => `Lire la vidéo de ${author}`,
    pauseVideo: (author: string) => `Mettre en pause la vidéo de ${author}`,
    videoOf: (author: string) => `Vidéo de ${author}`,
    videoAlt: (author: string) => `Vidéo envoyée par ${author}`,
    videoAltWithCaption: (caption: string, author: string) =>
      `${caption} — vidéo envoyée par ${author}`,
    /**
     * The host is watching, and hearing nothing.
     *
     * A browser that refuses unmuted playback is met with a muted retry rather than
     * with nothing — a silent clip is a far better decision than a poster frame. But it
     * is said out loud, because a moderator judging fifteen seconds of a speech would
     * otherwise approve it on half the evidence and never know.
     */
    videoMuted: 'Le son n’a pas pu être activé : cette vidéo est lue sans le son.',
    /**
     * The degradation, said rather than left as a button that does nothing.
     *
     * A console that cannot decode a clip still has to let the host decide, and the
     * poster frame plus this sentence is a worse decision than watching it — but it is a
     * decision, and it is an honest one.
     */
    videoUnplayable: 'Cette vidéo ne peut pas être lue ici. Seule l’image d’aperçu s’affiche.',
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

    /* ---- Wall layouts (roadmap 2.3). Keep additions to them inside this block. ---- */
    /**
     * The dispositions, named for the one person who ever reads them: the host standing
     * at the projector with the shortcuts dialog open. Nothing here is projected — the
     * room sees photographs, not the name of the grid they are in — so these are working
     * words a French-speaking host would use, not translations of the code's names.
     *
     * `satisfies Record<WallLayout, string>` is the same guard `useLayoutParam` uses: a
     * layout added to the contract fails to compile here until it is named, and a name
     * that is not a layout is rejected as an excess property.
     */
    layoutNames: {
      spotlight: 'Plein écran',
      mosaic: 'Mosaïque',
      polaroid: 'Polaroïd',
      filmstrip: 'Pellicule',
      collage: 'Collage',
      split: 'Côte à côte',
    } satisfies Record<WallLayout, string>,
    layoutOrder: (names: readonly string[]) => `Dispositions, dans l’ordre : ${names.join(', ')}.`,

    /* ---- Short video clips (roadmap 1.4). Keep additions inside this block. ---- */
    /**
     * A clip's accessible name. Distinct from a photo's, because "photo envoyée par
     * Léa" on an element that moves and has sound is the wrong description of it.
     *
     * Nobody in the room hears this: the wall is projected. It is read on the laptop a
     * host sets the projector up from, which is the one place this screen is ever
     * driven by a keyboard.
     */
    videoBy: (name: string) => `Vidéo envoyée par ${name}`,
    videoByAnonymous: 'Vidéo envoyée par un invité',
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
    photos: (count: number) =>
      t.count(count, { one: `${t.number(count)} photo`, other: `${t.number(count)} photos` }),
    guests: (count: number) =>
      t.count(count, { one: `${t.number(count)} invité`, other: `${t.number(count)} invités` }),
    storageUsed: (used: string, total: string) => `${used} sur ${total}`,
    settings: 'Réglages',
    moderationMode: 'Modération',
    moderationManual: 'Valider chaque photo',
    moderationAuto: 'Publier automatiquement',
    moderationAutoWarning:
      'Les photos apparaîtront à l’écran sans validation. À réserver aux évènements entre proches.',
    allowCaptions: 'Autoriser les légendes',
    allowReactions: 'Autoriser les réactions',
    /**
     * The host's switch over video (roadmap 1.4).
     *
     * The hint says the part a host cannot guess: the setting reads *off* on every
     * gallery that existed before video shipped, because a deploy must not start
     * accepting eighty-megabyte uploads on a wedding that is live at that moment. So
     * for exactly the events this feature was built for, nothing happens until the host
     * comes here and ticks it.
     */
    allowClips: 'Autoriser les vidéos',
    allowClipsHint:
      'Les invités peuvent envoyer de courtes vidéos, en plus des photos. Désactivé sur les galeries créées avant l’arrivée de cette fonctionnalité : cochez la case pour l’activer.',
    allowGuestSelfDelete: 'Autoriser les invités à supprimer leurs photos',

    /* ---- Per-event theming (roadmap 2.2). Kept to seven keys, three of them records,
            because a single choice with four options does not deserve four strings. ---- */
    theme: 'Apparence',
    themeHint:
      'Visible par vos invités et sur l’écran de la salle. Les couleurs proposées restent lisibles à dix mètres.',
    themeAccent: 'Couleur',
    themeAccentNames: {
      violet: 'Violet',
      rose: 'Rose',
      azure: 'Bleu',
      teal: 'Turquoise',
    } satisfies Record<CuratedAccent, string>,
    themeFonts: 'Typographie',
    /** The honest scope, said once: a guest's phone downloads nothing for this. */
    themeFontsHint: 'Appliquée à l’écran de la salle uniquement.',
    themeFontsNames: {
      sans: 'Moderne',
      serif: 'Classique',
    } satisfies Record<ThemeFonts, string>,
    themeFrame: 'Cadre des photos',
    themeFrameNames: {
      soft: 'Coins arrondis',
      square: 'Coins droits',
      round: 'Coins très arrondis',
    } satisfies Record<ThemeFrame, string>,

    retention: 'Suppression automatique',
    retentionNever: 'Jamais',
    retentionDays: (days: number) =>
      t.count(days, {
        one: `${t.number(days)} jour après la fin`,
        other: `${t.number(days)} jours après la fin`,
      }),
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
    graceSeconds: (seconds: number) =>
      t.count(seconds, {
        one: `${t.number(seconds)} seconde`,
        other: `${t.number(seconds)} secondes`,
      }),
    graceMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `${t.number(minutes)} minute`,
        other: `${t.number(minutes)} minutes`,
      }),
    graceHours: (hours: number) =>
      t.count(hours, { one: `${t.number(hours)} heure`, other: `${t.number(hours)} heures` }),
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

    /* ------------------------------------------------------------------------
     * Scheduled opening and closing (docs/ROADMAP.md §3.4).
     *
     * Times are typed and shown in the browser's timezone — the host's own laptop,
     * which is at the venue — so "18:00" means 18:00 where the party is. Only the
     * instant travels to the server. See web/src/features/admin/eventSchedule.ts.
     * ---------------------------------------------------------------------- */
    schedule: 'Ouverture et fermeture automatiques',
    scheduleHint:
      'Laissez vide pour ouvrir et clore vous-même. Les heures sont celles de votre ordinateur, donc celles du lieu de la fête.',
    scheduleOpenAt: 'Ouvrir aux invités le',
    scheduleCloseAt: 'Clore l’évènement le',
    scheduleCloseAtHint: 'Les photos et l’album sont conservés : clore n’efface rien.',
    scheduleSaved: 'L’horaire a été enregistré.',
    scheduleNone: 'Aucun horaire : vous ouvrez et vous clôturez vous-même.',
    /** Rendered as a reminder under the fields once a schedule is armed. */
    scheduleArmed: (opensAt: string, closesAt: string) =>
      `Ouverture le ${opensAt}, fermeture le ${closesAt}.`,
    scheduleOpensOnly: (opensAt: string) => `Ouverture le ${opensAt}. Vous clôturerez vous-même.`,
    scheduleClosesOnly: (closesAt: string) => `Fermeture le ${closesAt}. Vous ouvrirez vous-même.`,
    scheduleSave: 'Enregistrer l’horaire',
    /**
     * The sweep threw a schedule away because the event could not change state then —
     * an archived event, or a closing on an evening that never started. Says what
     * happened, and that the host has to act if they still want it.
     */
    scheduleDiscarded: (when: string) =>
      `L’horaire automatique n’a pas pu s’appliquer le ${when} : l’évènement ne pouvait pas changer d’état à ce moment-là. Il a été effacé. Enregistrez-en un nouveau si vous en voulez un.`,
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

    /* ---- Added by the scheduled open and close (docs/ROADMAP.md §3.4). These live
            here and not in the `admin` block above because `messageForCode` resolves a
            server error code against `fr.errors` and nothing else. ---- */
    'event.scheduleOutOfOrder': 'La fermeture doit venir après l’ouverture.',
    /**
     * The likeliest mistake with this form: it is 21:30, the host picks 02:00 for the
     * closing and leaves the date on today. The sentence names the fix rather than the
     * rule, because the date field is what they have to change.
     */
    'event.scheduleInPast':
      'Cette heure est déjà passée. Vérifiez la date : pour la fin de soirée, choisissez le lendemain.',
    'event.scheduleInvalid': 'Ces dates ne sont pas lisibles. Choisissez-les à nouveau.',

    /* ---- Per-event theming (roadmap 2.2). The picker offers only choices the server
            accepts, so a host meets these through the API or a build one deploy ahead —
            and each still says which way to move rather than only that it refused. ---- */
    'eventTheme.accentHueInvalid':
      'Cette couleur n’est pas reconnue. Choisissez-en une dans la liste.',
    'eventTheme.accentUnreadable':
      'Cette couleur ne serait pas lisible à l’écran de la salle. Choisissez-en une dans la liste.',
    'eventTheme.accentTooCloseToStatus':
      'Cette couleur ressemble trop aux couleurs d’état de l’application. Choisissez-en une autre dans la liste.',

    /* ---- Added by the short video clips (docs/ROADMAP.md 1.4). They live here and not
            in a feature block because `messageForCode` resolves a server error code
            against `fr.errors` and nothing else.

            Two of them carry most of the weight. `clip.queueFull` must not read like
            `event.quotaExceeded` — the gallery is not full, the machine is busy for a
            minute — and `clip.transcoderUnavailable` must not read like
            `clip.unsupportedFormat`: the file is fine, this server cannot process it,
            and a guest told otherwise spends the evening trying other files. ---- */
    'event.clipsNotAllowed': 'Les vidéos ne sont pas activées pour cette galerie.',
    'clip.queueFull': 'Beaucoup de vidéos sont en cours de traitement. Réessayez dans une minute.',
    'clip.transcoderUnavailable':
      'Ce serveur ne peut pas traiter les vidéos. Prévenez l’organisateur.',
    'clip.unsupportedFormat': 'Ce fichier n’est pas une vidéo. Formats acceptés : MP4, MOV, WebM.',
    'clip.corrupt': 'Cette vidéo semble abîmée. Essayez-en une autre.',
    'clip.noVideoStream': 'Ce fichier ne contient pas d’image. Essayez-en un autre.',
    'clip.durationUnknown': 'La durée de cette vidéo est illisible. Essayez-en une autre.',
    'clip.tooShort': 'Cette vidéo est trop courte.',
    'clip.tooLong': 'Cette vidéo est trop longue. Filmez une séquence plus courte.',
    'clip.transcodeFailed': 'Cette vidéo n’a pas pu être traitée. Essayez-en une autre.',
    'clip.transcodeTimedOut': 'Cette vidéo est trop lourde à traiter. Essayez-en une autre.',
    'clip.storageFailed': 'Cette vidéo n’a pas pu être enregistrée. Réessayez.',
    'clip.sourceMissing': 'Cette vidéo n’est plus disponible. Envoyez-la à nouveau.',
    'clip.stageFailed': 'Cette vidéo n’a pas pu être reçue. Réessayez.',
    'clip.abandoned': 'Le traitement de cette vidéo a été interrompu. Envoyez-la à nouveau.',
    'clip.sourceByteSizeInvalid': 'Ce fichier est vide. Choisissez-en un autre.',
    'clip.transcodeCancelled':
      'Le traitement de cette vidéo a été interrompu. Elle sera reprise automatiquement.',
    'clip.probeUnreadable': 'Cette vidéo n’a pas pu être analysée. Réessayez.',
    'clip.pixelBudgetExceeded':
      'Cette vidéo est trop grande. Filmez dans une définition plus basse.',
    'clipJob.notFound': 'Cette vidéo n’existe plus.',
    'clipJob.illegalTransition': 'Cette action n’est pas possible sur cette vidéo.',
    // A player corrects itself from the `Content-Range` on the 416 and never shows this;
    // it is here because every code the API can answer with has a sentence of its own,
    // and a code with no copy renders as the generic one if anything ever does show it.
    'photo.rangeNotSatisfiable': 'Cette partie du fichier n’existe pas.',
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
    /**
     * The narrow space before the sign is French and not universal: English writes
     * "80%". `Intl` owns that difference, so no table has to remember it.
     */
    percent: (value: number) => t.percent(value),
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

  /* ======================================================================== */
  /* ==== Added by features/moderation: the phone console (ROADMAP 3.1). ==== */
  /* ==== Its own block, at the end of the file and after a section no    ==== */
  /* ==== feature adds to, so a branch appending inside `moderation` or   ==== */
  /* ==== `wall` above merges without meeting this one. Everything the    ==== */
  /* ==== phone console can reuse — the verbs, the states, the counts —   ==== */
  /* ==== it takes from `moderation`; only what is new to the gesture is  ==== */
  /* ==== here.                                                          ==== */
  /* ======================================================================== */
  mobileModeration: {
    /**
     * Deliberately not `moderation.title`.
     *
     * The two consoles are two addresses, and a heading that read the same on both
     * would let a mistyped route resolve to the wrong screen unnoticed — which is the
     * exact failure `router.test.tsx` names one case per admin address to catch.
     */
    title: 'Modération sur téléphone',
    intro: 'Glissez la photo vers la droite pour publier, vers la gauche pour refuser.',
    /** The second half of the gesture: the host has gone far enough to decide. */
    releaseToPublish: 'Relâchez pour publier',
    releaseToReject: 'Relâchez pour refuser',
    /**
     * The photo that has just arrived in the host's hand, for the live region.
     *
     * The card is replaced silently when a decision lands, so without this a host using
     * a screen reader is told what they published and nothing about what they are now
     * deciding. Two sentences rather than a colon, because this is read aloud.
     */
    nowDeciding: (photo: string) => `Photo à modérer. ${photo}`,
    /**
     * Named more fully than `moderation.undo`, which is the label on the toast the
     * decision itself raises. Both are on screen at once here, and two buttons reading
     * "Annuler" is two buttons a screen reader cannot tell apart.
     */
    undoLast: 'Annuler la dernière décision',
    /**
     * Why the undo is greyed out, said once rather than per decision.
     *
     * A refusal cannot be taken back: nothing puts a photo back to "en attente", and
     * the only verb that would reverse it is `publish` — which would throw a photo the
     * host has just turned down onto the projector with no approval behind it. So the
     * console says what it can do instead of offering something it cannot.
     */
    undoUnavailable: 'Seule une publication peut être annulée.',
  },
} as const

/**
 * The shape every other table has to have.
 *
 * `messageForCode` used to live here and now lives in `translations.ts`, with the rest
 * of what knows about more than one language: resolving a server error code takes a
 * table, and a table takes a locale.
 */
export type Translations = typeof fr
