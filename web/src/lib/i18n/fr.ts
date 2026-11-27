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
 *    `npm run typecheck` (`translations.ts` explains the derivation). **Every section is
 *    translated** — the guest's, the host's and the room's alike.
 *
 * Tone: sentence case, no exclamation-mark inflation, and an error says what to do
 * next rather than what went wrong internally.
 *
 * **Adding a string.** Put it in the section it belongs to, as here, and the four other
 * tables stop compiling until they carry it too — if you are adding a key you are adding
 * five. The `/* ---- Added by … ---- *\/` banners in this file mark where a feature
 * branch appended, so two branches touching one section merge without meeting; they are
 * this file's convention only, and the four translations carry no copy of them.
 *
 * **What is not in this file, and must never be.** An event's name, a photo's caption, a
 * guest's display name and a mission's prompt are *content* — a person wrote them and no
 * table translates them. `content.test.ts` enforces it.
 */

import { formattersFor } from './formatters'
import type { CuratedAccent } from '../../design-system/eventTheme'
import type { BookLength } from '../bookStyle'
import type { PrintDesign } from '../print/printDesigns'
import type { PrintSwatch } from '../print/printColours'
import type {
  AlbumBookStyle,
  EventStatus,
  EventTemplateKey,
  NoticeAudience,
  NoticePublication,
  ReactionKind,
  SiteAuditEntryDto,
  ThemeFonts,
  ThemeFrame,
  ThemeGround,
  ThemeAmbiance,
  WallLayout,
} from '../api/dto'

/**
 * French counting, from `Intl` rather than from a hand-written ternary.
 *
 * The ternaries this replaces were the English rule: `count === 1 ? singular : plural`
 * puts zero in the plural, and French puts zero in the singular — so every counted
 * phrase in this file read "0 photos" where French wants "0 photo". Each of the five
 * tables holds its own set of formatters and the phrases read identically across them.
 */
const t = formattersFor('fr')

/**
 * "de" or "d’" before a name, for the line under a guest's first photo ("Première photo
 * d’Alice", not "de Alice").
 *
 * The elision is for a vowel, an accented vowel, `y` and an *h* — the mute h of Hugo and
 * Hélène. It is deliberately simple: the few first names that begin with an aspirated h
 * (Hans, Henri in some families) would be elided too, and a table of exceptions would be wrong
 * for somebody else. A name is content, not copy, so a guess that is right for nearly every name
 * beats asking the guest how to say theirs.
 */
export const deBefore = (name: string): string =>
  /^[aeiouyàâäéèêëîïôöùûüh]/i.test(name) ? `d’${name}` : `de ${name}`

export const fr = {
  app: {
    name: 'EventSlide',
    loading: 'Chargement…',
    loadFailed: 'Chargement impossible',
    retry: 'Réessayer',
    cancel: 'Annuler',
    close: 'Fermer',
    save: 'Enregistrer',
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
    title: 'Rejoindre la soirée',
    codeLabel: 'Code de la soirée',
    codeHint: 'Six caractères, indiqués sur le carton ou le QR code.',
    nameLabel: 'Votre prénom',
    nameHint: 'Il apparaîtra sous vos photos. Vous pouvez le laisser vide.',
    submit: 'Rejoindre',
    submitting: 'Connexion…',
    welcome: (eventName: string) => `Bienvenue à ${eventName}`,
    logoAlt: (eventName: string) => `Logo de ${eventName}`,
    anonymous: 'Rester anonyme',
    /* Navigation pass, batch A: leaving a wrong event, a code that opens nothing, the way to the organiser area. */
    notYourEvening: 'Ce n’est pas votre soirée ?',
    notOpenHint:
      'Si vous avez scanné un QR code, la soirée n’est peut-être pas encore ouverte, ou elle est déjà terminée. Réessayez dans un moment, ou demandez à l’organisateur.',
    organiserLink: 'Espace organisateur',
  },

  upload: {
    intro: 'Ajoutez vos photos, elles apparaîtront sur l’écran après validation.',
    addPhotos: 'Ajouter des photos',
    takePhoto: 'Prendre une photo',
    captionLabel: 'Légende',
    captionHint: (max: number) => `${t.number(max)} caractères maximum. Facultatif.`,
    send: 'Envoyer',
    sendCount: (count: number) =>
      t.count(count, {
        one: 'Envoyer la photo',
        other: `Envoyer les ${t.number(count)} photos`,
      }),
    queueEmpty: 'Aucune photo sélectionnée pour le moment.',
    foldPane: 'Réduire',
    openPane: 'Envoyer une photo',
    openPaneReady: (count: number) =>
      t.count(count, {
        one: 'Rouvrir le volet : 1 photo prête',
        other: `Rouvrir le volet : ${t.number(count)} photos prêtes`,
      }),
    itemPending: 'Prête',
    itemUploading: 'Envoi en cours',
    itemDone: 'Envoyée',
    itemDuplicate: 'Déjà envoyée',
    itemFailed: 'Échec',
    // The guest's own photos, whatever the host decided: being told a photo is waiting
    // beats wondering whether the upload worked.
    mine: 'Vos envois',
    statusPending: 'En attente de validation',
    statusPublished: 'À l’écran',
    statusRejected: 'Non retenue',
    statusHidden: 'Retirée de l’écran',
    deleteOwn: 'Supprimer',
    deleteOwnConfirm: 'Supprimer cette photo ? Cette action est définitive.',
    eraseOpen: 'Supprimer tout ce que j’ai envoyé',
    eraseTitle: 'Tout supprimer ?',
    eraseBody:
      'Vos photos, vos vidéos, vos légendes, vos réactions et votre prénom seront effacés de la soirée : de l’écran, de l’album et de la liste de l’organisateur. C’est définitif.',
    eraseLimits:
      'Une copie déjà enregistrée par l’organisateur, par un autre invité ou par quelqu’un qui a fait une capture, ne peut pas être reprise.',
    eraseConfirm: 'Oui, tout supprimer',
    eraseCancel: 'Non, je garde',
    eraseFailed: 'La suppression n’a pas abouti. Réessayez, ou demandez à l’organisateur.',
    eraseDoneTitle: 'C’est fait',
    eraseDone:
      'Tout ce que vous aviez envoyé a été supprimé de la soirée. Vous n’êtes plus rattaché à cette soirée sur ce téléphone.',
    eraseLostAccess:
      'Vous avez changé de téléphone ou perdu l’accès ? Demandez à l’organisateur de supprimer vos photos : il peut le faire depuis son espace.',
    revokedTitle: 'Votre accès a été retiré',
    revokedBody:
      'L’organisateur a retiré votre accès : vous ne pouvez plus envoyer de photos. Vous pouvez encore effacer tout ce que vous avez envoyé.',

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
    /**
     * What the pane says once every photo of the batch has arrived, in one line: how many, and
     * how many of them the event already held. The rows behind it keep each photo's own word.
     * Counted by `t.count`, so the agreement is the language's own, zero included.
     */
    queueDone: (arrived: number, already: number) => {
      if (already > 0 && already === arrived) {
        return t.count(arrived, {
          one: 'Cette photo était déjà là',
          other: `Ces ${t.number(arrived)} photos étaient déjà là`,
        })
      }
      const sent = t.count(arrived, {
        one: `${t.number(arrived)} photo envoyée`,
        other: `${t.number(arrived)} photos envoyées`,
      })
      if (already === 0) return sent
      const there = t.count(already, {
        one: `${t.number(already)} était déjà là`,
        other: `${t.number(already)} étaient déjà là`,
      })
      return `${sent} (${there})`
    },
    queueViewMine: 'Voir mes envois',
    queueDetails: 'Détails',
    queueDismiss: 'Masquer le récapitulatif',
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
    mineFailed: 'La liste de vos envois n’a pas pu être mise à jour. Réessayez.',
    mineAlt: 'Votre photo',
    /* "Levez les yeux" (UX review 2026-10-30): a photo of the guest's goes from waiting to on the wall. */
    photoDeveloped: 'Validée ! Elle passe à l’écran dans un instant : levez les yeux.',
    photoDevelopedAway: 'Passée à l’écran.',
    deleteOwnNumbered: (position: number) => `Supprimer la photo ${position}`,
    notJoinedTitle: 'Rejoignez la soirée pour envoyer vos photos',
    notJoinedHint: 'Scannez à nouveau le QR code, ou saisissez le code de la soirée.',
    notJoinedAction: 'Saisir le code',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    galleryUnavailable:
      'Cette soirée n’est plus disponible. Vous ne pouvez plus y envoyer de photos.',
    galleryUnavailableAction: 'Saisir à nouveau le code',

    /* ---- Added by photo missions (ROADMAP 2.1). Keep additions inside this block. ---- */

    /**
     * The host's prompts, as a guest reads them.
     *
     * The words *around* the list are translated; the prompts themselves are not, and
     * never will be — a prompt is content the host typed in the language the evening is
     * held in, not interface copy. A German guest at a French wedding reads a French
     * prompt under a German label, which is the right way round: the prompt names
     * something that happened in that room.
     */
    missionsTitle: 'Missions',
    missionsHint: 'Touchez une mission, puis envoyez votre photo.',
    missionDone: 'Fait',
    /** A once-for-the-evening prompt somebody else already answered. */
    missionDoneByRoom: 'Déjà photographiée',
    missionFor: (prompt: string) => `Ces photos compteront pour « ${prompt} ».`,

    /* ---- Added by the offline outbox. Keep additions inside this block. ---- */

    /**
     * The state a saturated venue Wi-Fi produces, said as reassurance rather than as an
     * error. A guest told "Échec" sends the photo again; a guest told it is on its way
     * puts the phone back in their pocket, which is the entire point of the feature.
     */
    itemQueued: 'Partira dès que le réseau revient',
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

    /* ---- Added by the guest traps and end-of-evening pass (revue UX 30/10: INV-1, 4, 7, 8). Keep additions inside this block. ---- */

    /**
     * Where this phone has no Background Sync (every iPhone): the photos leave only while
     * a page of the app is open, so "you can close this page" would be a lie that costs the
     * evening's photos. Said instead of `offlineHint`, which stays for the browsers that can.
     */
    offlineHintNoSync:
      'Elles sont enregistrées sur votre téléphone et partiront dès que la connexion revient. Gardez cette page ouverte jusque-là.',
    /** Before the guest presses « Envoyer »: nothing has left the phone yet, and the line must not read like an upload that stalled. */
    queueReady: (count: number) =>
      t.count(count, {
        one: 'Une photo prête : appuyez sur Envoyer.',
        other: `${t.number(count)} photos prêtes : appuyez sur Envoyer.`,
      }),
    /** Stands where « Voir les photos de la soirée » is while photos are on their way: leaving would cancel them. */
    leaveWaitCount: (done: number, total: number) =>
      `Patientez, envoi en cours (${t.number(done)}/${t.number(total)})`,
    leaveWait: 'Patientez, envoi en cours…',
    /** The evening is closed: a quiet thank-you in place of the warning, counted from the list already on screen. */
    endedTitle: 'C’est fini pour ce soir.',
    endedThanks: (count: number) =>
      t.count(count, {
        one: 'Merci pour votre photo !',
        other: `Merci pour vos ${t.number(count)} photos !`,
      }),
    endedThanksNone: 'Merci d’avoir été des nôtres !',
    endedAlbum: 'Les organisateurs partageront l’album.',

    /* ---- Added by the installable app (roadmap 1.2). ---- */

    installTitle: 'Gardez la soirée à portée de main',
    /**
     * Says what it is for, not what it is. "Installer l'application" invites the
     * question a guest at a wedding will not stop to answer; "retrouvez-la sans le QR
     * code" is the reason they would want it.
     */
    installHint:
      'Ajoutez-la à votre écran d’accueil pour retrouver la soirée plus tard, sans chercher le QR code.',
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
     * The trim screen (spec 16), opened in place of a "too long" refusal. Nothing on it
     * can be wrong: the handles keep the range valid, so there is no error sentence here.
     */
    clipTrimTitle: (seconds: number) => `Choisissez les ${t.number(seconds)} secondes à garder`,
    clipTrimStart: 'Début de l’extrait',
    clipTrimEnd: 'Fin de l’extrait',
    clipTrimValue: (seconds: number) => `${t.number(seconds)} secondes`,
    clipTrimSummary: (seconds: number, maxSeconds: number) =>
      `Extrait : ${t.number(seconds)} s sur ${t.number(maxSeconds)} s au plus`,
    clipTrimPlay: 'Lire l’extrait',
    clipTrimPause: 'Mettre en pause',
    clipTrimNoPreview: 'Aperçu indisponible sur cet appareil. L’extrait sera bien découpé.',
    clipTrimWholeFileSent:
      'Seul l’extrait choisi est conservé. Si ce téléphone ne sait pas le découper, la vidéo entière est envoyée avant d’être coupée.',
    clipSendTrimmed: 'Envoyer cet extrait',
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
     * to render — a scope bug rather than reuse, back when `moderation` was French in
     * every language. Both are translated now, so the bug is gone on its own; the
     * duplication stays because a moderator's badge and a guest's badge are owned by
     * different audiences and free to diverge.
     */
    mineClipLength: (seconds: number) => `Vidéo · ${t.number(seconds)} s`,
    mineMission: (prompt: string) => `Mission : ${prompt}`,
    mineChallenge: 'Défi',

    /* ---- Added by the privacy notice (roadmap 5.1). Keep additions inside this block. ---- */

    /**
     * The header line for an event that publishes on arrival.
     *
     * `intro` above promises a validation, which is false on such an event — and the
     * notice under it now says so in so many words, so the two cannot be allowed to
     * disagree on one screen. Chosen from the notice's `publication`, never guessed.
     */
    introImmediate: 'Ajoutez vos photos, elles apparaîtront tout de suite sur l’écran.',
    /**
     * The way back to the notice once it has been read, and the title of the dialog it
     * opens. Worded as the guest's question rather than as "Confidentialité", which is a
     * legal page's word and not something a wedding guest looks for.
     */
    noticeLink: 'Comment vos photos sont utilisées',
    noticeTitle: 'Avant votre première photo',
    /**
     * The same card shown again, because the host changed a setting the notice states.
     * It says *why* it is back: a notice that reappears unexplained reads as a bug, and a
     * guest who thinks it is one stops reading it.
     */
    noticeChangedTitle: 'Ces informations ont changé',
    noticeChangedHint: 'L’organisateur a modifié un réglage depuis votre dernière lecture.',
    noticeAcknowledge: 'J’ai compris',
    /** The four questions of roadmap 5.1, as the guest would ask them. */
    noticeWhatHappens: 'Ce que deviennent vos photos',
    noticeWhoSees: 'Qui voit vos photos',
    noticeHowLong: 'Combien de temps elles sont gardées',
    noticeRemoval: 'Pour en faire retirer une',
    /** True of every event — the ingest pipeline strips it — so it has no setting. */
    noticeMetadataStripped:
      'La position et les informations sur l’appareil sont retirées de chaque photo à son arrivée.',
    noticePublication: {
      afterReview: 'L’organisateur valide chaque photo avant qu’elle passe à l’écran.',
      immediate:
        'Elles passent à l’écran dès leur arrivée. L’organisateur peut en retirer à tout moment.',
    } satisfies Record<NoticePublication, string>,
    /**
     * One sentence per audience, keyed by the server's list. `sharedGallery` is on every
     * event and says "s’il en crée un" for the reason `privacyNotice.ts` gives: the link
     * usually comes the morning after, when this guest will not be asked again. "Et celles
     * à qui ce lien est transféré", because a link is not a guest list.
     */
    noticeAudiences: {
      wall: 'Toute personne qui regarde l’écran de la soirée, dans la salle ou par son lien, une fois la photo affichée.',
      guestFeed:
        'Les autres invités de la soirée, sur leur téléphone, dans « Les photos de la soirée » : ils voient la photo affichée à l’écran, avec votre prénom si vous en avez donné un, et sa légende.',
      organisers:
        'L’organisateur et son équipe, qui voient tout ce que vous envoyez et peuvent télécharger les photos passées à l’écran.',
      sharedGallery:
        'Les personnes à qui l’organisateur envoie un lien privé vers l’album, s’il en crée un, et celles à qui ce lien est transféré : elles peuvent voir et télécharger en pleine résolution les photos affichées à l’écran, jusqu’à ce que le lien expire ou soit retiré.',
    } satisfies Record<NoticeAudience, string>,
    /** Said after the audiences, only on an evening where saving is on (spec 24). */
    noticeGuestSave:
      'Les autres invités peuvent enregistrer votre photo sur leur téléphone, sans le lieu ni l’appareil de prise de vue. Une copie enregistrée ne peut pas être reprise.',
    /**
     * "après que l’organisateur a terminé la soirée", for the reason `admin.retentionHint`
     * spells out: the clock starts when the host ends the event, and "après la fête" would
     * promise a deletion that an event left open never reaches. The guest reads "soirée"
     * (vocabulary pass: "galerie" is not a word for the event any more) and the host's button
     * says "Terminer".
     */
    noticeRetentionDays: (days: number) =>
      t.count(days, {
        one: `Elles sont effacées automatiquement ${t.number(days)} jour après que l’organisateur a terminé la soirée.`,
        other: `Elles sont effacées automatiquement ${t.number(days)} jours après que l’organisateur a terminé la soirée.`,
      }),
    /** Said as what it is. The product's default keeps the album, and a guest may ask. */
    noticeRetentionNone:
      'Aucune suppression automatique n’est prévue : elles restent jusqu’à ce que l’organisateur les efface.',
    noticeRemovalSeconds: (seconds: number) =>
      t.count(seconds, {
        one: `Vous pouvez en supprimer une vous-même dans la seconde qui suit l’envoi, tant qu’elle n’a pas été validée.`,
        other: `Vous pouvez en supprimer une vous-même dans les ${t.number(seconds)} secondes qui suivent l’envoi, tant qu’elle n’a pas été validée.`,
      }),
    noticeRemovalMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `Vous pouvez en supprimer une vous-même dans la minute qui suit l’envoi, tant qu’elle n’a pas été validée.`,
        other: `Vous pouvez en supprimer une vous-même dans les ${t.number(minutes)} minutes qui suivent l’envoi, tant qu’elle n’a pas été validée.`,
      }),
    noticeRemovalHours: (hours: number) =>
      t.count(hours, {
        one: `Vous pouvez en supprimer une vous-même dans l’heure qui suit l’envoi, tant qu’elle n’a pas été validée.`,
        other: `Vous pouvez en supprimer une vous-même dans les ${t.number(hours)} heures qui suivent l’envoi, tant qu’elle n’a pas été validée.`,
      }),
    /**
     * Always the last line, because it is always true: a moderator can delete any photo
     * of their event. The sentence after it (noticeErasure) names the guest's own "delete everything
     * I sent" button, roadmap 5.2.
     */
    noticeRemovalOtherwise:
      'Sinon, demandez à l’organisateur : il peut supprimer n’importe quelle photo.',
    noticeRemovalAskHost: 'Demandez à l’organisateur : il peut supprimer n’importe quelle photo.',
    noticeErasure: (action: string, section: string) =>
      `Vous pouvez aussi tout supprimer depuis votre téléphone : « ${action} », sous « ${section} ».`,
    /** `clipDone` for an event that publishes on arrival, for `introImmediate`'s reason. */
    clipDoneImmediate: 'Vidéo envoyée. Elle passe à l’écran.',

    /* ---- Added by guest reactions (a guest reacts to a photo of theirs on the wall). ---- */

    /**
     * The five reactions, as the words a screen reader says. The glyph on a button is
     * decoration and colour is never the signal, so this is what tells a guest which
     * button is which.
     *
     * One short word each, in the first person where a feeling is named: it is read
     * between a photo and the next control, and a sentence there is a sentence too many.
     */
    reactionKinds: {
      love: 'J’adore',
      laugh: 'Haha',
      wow: 'Waouh',
      cheers: 'Santé',
      clap: 'Bravo',
    } satisfies Record<ReactionKind, string>,
    /** The row's name. Numbered like `deleteOwnNumbered`, so two rows are never one label. */
    reactionsGroup: (position: number) => `Réagir à la photo ${t.number(position)}`,
    reactionsFailed: 'Les réactions n’ont pas pu être chargées.',

    /* -------------------------- end guest surface --------------------------- */
  },

  /**
   * The guestbook, guest side (spec 01). What guests and hosts write is never translated: these
   * are only the words around it.
   */
  guestbook: {
    title: 'Livre d’or',
    helpManual: 'Un petit mot pour la soirée. L’organisateur le lit avant de l’afficher.',
    helpAuto: 'Votre mot apparaît dans le livre d’or.',
    open: 'Laisser un mot',
    label: 'Votre message',
    placeholder: 'Votre message…',
    counter: (length: number, max: number) => `${t.number(length)} / ${t.number(max)}`,
    counterNear: (left: number) =>
      t.count(left, {
        one: 'Il reste 1 caractère.',
        other: `Il reste ${t.number(left)} caractères.`,
      }),
    counterFull: 'Limite atteinte.',
    send: 'Envoyer mon message',
    cancel: 'Annuler',
    thanksManual: 'Merci ! Votre message s’affichera une fois validé par l’organisateur.',
    thanksAuto: 'Merci ! Votre message est dans le livre d’or.',
    mine: 'Mes messages',
    statusPending: 'En attente de validation',
    statusPublished: 'À l’écran',
    statusPublishedNotOnWall: 'Publié, pas affiché à l’écran',
    statusRejected: 'Non retenu',
    statusHidden: 'Retiré de l’écran',
    remove: 'Retirer ce message',
    removeTitle: 'Retirer ce message pour de bon ?',
    removeConfirm: 'Retirer',
    removeCancel: 'Garder',
    removed: 'Message retiré.',
    tooLong: (max: number) => `Message trop long (${t.number(max)} caractères au plus).`,
    /** By the server's code, for what a message can be refused for. */
    errors: {
      'guestbook.empty': 'Écrivez au moins un mot.',
      'guestbook.invalid': 'Ce message ne peut pas être envoyé tel quel.',
      'guestbook.tooManyLines': 'Message trop haut : gardez-le plus court.',
      'guestbook.limitReached':
        'Vous avez déjà laissé 3 messages, texte ou vocaux. Retirez-en un pour en laisser un autre.',
      'guestbook.voiceDisabled': 'Les messages vocaux sont désactivés pour l’instant.',
      'guestbook.voiceEventFull': 'Le livre d’or est plein.',
      'voice.queueFull': 'Réessayez dans un instant.',
      'voice.unsupportedFormat': 'Ce fichier n’est pas un message vocal lisible.',
      'voice.notAudio': 'Ce fichier n’est pas un message vocal lisible.',
      'voice.corrupt': 'Ce fichier n’est pas un message vocal lisible.',
      'voice.tooLong': 'Ce message vocal est trop long.',
      'voice.tooShort': 'Ce message vocal est trop court.',
      'guestbook.eventFull': 'Le livre d’or est complet.',
      'guestbook.disabled': 'Le livre d’or n’est pas ouvert pour le moment.',
      'event.notAcceptingUploads': 'Le livre d’or n’est pas ouvert pour le moment.',
      'guestbook.deleteForbidden':
        'Ce message ne peut plus être retiré. Demandez à l’organisateur : il peut le supprimer.',
      'event.guestSelfDeleteDisabled':
        'L’organisateur n’a pas activé le retrait. Demandez-lui : il peut supprimer un message.',
      'guestbook.notFound': 'Ce message n’existe plus.',
      'guestbook.deleteFailed':
        'Le retrait n’a pas abouti. Réessayez, ou demandez à l’organisateur.',
      'rate.limited': 'Trop de messages d’un coup, réessayez dans une minute.',
    },
    /** `upload.eraseBody` for an event with a guestbook. */
    eraseBody:
      'Vos photos, vos vidéos, vos légendes, vos messages du livre d’or, y compris vos messages vocaux, vos réactions et votre prénom seront effacés de la soirée : de l’écran, de l’album et de la liste de l’organisateur. C’est définitif.',
    /** The notice's four titles, and one added sentence each, for an event with a guestbook. */
    noticeWhatHappens: 'Ce que deviennent vos photos et vos messages',
    noticeWhoSees: 'Qui voit vos photos et vos messages',
    noticeHowLong: 'Combien de temps ils sont gardés',
    noticeRemoval: 'Pour en faire retirer un',
    noticeMessagePublication: {
      afterReview:
        'Un message du livre d’or est lu par l’organisateur avant de pouvoir passer à l’écran.',
      immediate:
        'Un message du livre d’or peut passer à l’écran dès son envoi. L’organisateur peut le retirer à tout moment.',
    } satisfies Record<NoticePublication, string>,
    noticeMessageAudience:
      'Vos messages sont lus par l’organisateur et son équipe, et peuvent s’afficher sur l’écran de la soirée. Ils ne figurent pas dans « Les photos de la soirée ».',
    /** Spec 26: the photo book may carry a guest's words, with their first name, and be printed. */
    noticeMessageBook:
      'L’organisateur peut mettre vos mots, avec votre prénom, dans le livre photo de la soirée, qu’il peut faire imprimer.',
    noticeMessageRetention:
      'Vos messages sont gardés aussi longtemps que les photos, et effacés avec elles.',
    noticeMessageRemoval:
      'Un message se retire comme une photo, depuis « Mes messages » et dans les mêmes conditions.',
  },

  /**
   * The voice message of the guestbook, guest side (spec 25): recording it, listening before sending,
   * where it stands afterwards and what the privacy notice says about it. What a guest says is never
   * translated and never appears here, only the words around it. Never "IA", "intelligent" or
   * "transcription" in a sentence of this table: nothing listens to a voice but the organiser.
   */
  guestbookVoice: {
    open: 'Laisser un message vocal',
    record: 'Enregistrer',
    stop: 'Arrêter',
    clock: (elapsed: string, max: string) => `${elapsed} / ${max}`,
    recordingAnnounce: 'Enregistrement en cours',
    nearEnd: 'Il reste 10 secondes',
    recordedAnnounce: (duration: string) => `Enregistrement terminé, ${duration}`,
    closeToTheMicrophone: 'Parlez de près : les personnes autour de vous peuvent s’entendre',
    listen: 'Écouter',
    listenPause: 'Mettre en pause',
    restart: 'Recommencer',
    send: 'Envoyer mon message vocal',
    cancel: 'Annuler',
    captionLabel: 'Un mot pour l’accompagner',
    micBlocked:
      'Le micro est bloqué. Autorisez-le dans les réglages du navigateur, puis revenez ici.',
    micUnavailableHere:
      'Le micro n’est pas disponible sur cette page. Rouvrez le lien de l’évènement.',
    micMissing:
      'Aucun micro n’a pu être utilisé sur cet appareil. Vous pouvez écrire un mot à la place.',
    tooShort: 'Message trop court : parlez au moins une seconde.',
    writeInstead: 'Écrire un mot à la place',
    openInBrowser: 'Pour laisser un message vocal, ouvrez cette page dans Safari ou Chrome.',
    previewFailed: 'L’aperçu ne se lit pas ici, vous pouvez quand même envoyer',
    interrupted: (duration: string) =>
      `L’enregistrement s’est arrêté parce que la page a été quittée. Il dure ${duration}.`,
    notKept: 'L’enregistrement n’a pas pu être gardé sur votre téléphone. Recommencez.',
    helpManual: 'L’organisateur décide de garder votre message.',
    helpAuto:
      'Votre message est gardé dans le livre d’or. Seuls l’organisateur et son équipe peuvent l’écouter.',
    thanksManual: 'Merci ! L’organisateur décidera de garder votre message.',
    thanksAuto: 'Merci ! Votre message vocal est bien reçu.',
    waitingNetwork: 'Votre message vocal attend un réseau.',
    offlineHintKeepOpen:
      'Gardez cette page ouverte : vos photos et votre message vocal partiront dès que le réseau revient.',
    keptOnPhone: 'Votre enregistrement reste sur votre téléphone.',
    messageLabel: (duration: string | null) =>
      duration === null ? 'Message vocal' : `Message vocal, ${duration}`,
    statusProcessing: 'En traitement',
    statusPublished: 'Dans le livre d’or',
    failed: 'Votre message vocal n’a pas pu être enregistré. Réenregistrez-le.',
    retry: 'Réessayer',
    localWaiting: 'En attente d’un réseau',
    localBlocked: 'Gardé sur votre téléphone',
    saveToPhone: 'Enregistrer sur mon téléphone',
    deleteLocal: 'Supprimer',
    noticeVoiceAudience:
      'Votre message vocal est visible de l’organisateur et de son équipe seulement.',
    noticeVoiceNeverRoom:
      'Il n’est jamais diffusé sur l’écran de la salle ni entendu par les autres invités.',
    noticeVoicePublication: {
      afterReview: 'L’organisateur décide de garder votre message.',
      immediate: 'Votre message est gardé tout de suite dans l’album, sans écoute préalable.',
    } satisfies Record<NoticePublication, string>,
    noticeVoiceRetention:
      'Il est gardé comme vos photos et il part dans l’album que l’organisateur télécharge.',
    noticeVoiceRetentionDays: (count: number) =>
      t.count(count, {
        one: 'Il est gardé comme vos photos (1 jour après que l’organisateur a terminé la soirée) et il part dans l’album que l’organisateur télécharge.',
        other: `Il est gardé comme vos photos (${t.number(count)} jours après que l’organisateur a terminé la soirée) et il part dans l’album que l’organisateur télécharge.`,
      }),
    noticeVoiceMicrophone:
      'Le micro ne sert que pendant l’enregistrement. L’enregistrement reste sur votre téléphone tant que vous n’avez pas envoyé.',
    noticeVoiceSealed:
      'Les messages vocaux restent secrets jusqu’à la fin de la soirée, sauf décision de l’organisateur.',
    noticeVoiceRemovalSeconds: (count: number) =>
      t.count(count, {
        one: 'Vous pouvez retirer votre message vocal pendant 1 seconde après l’envoi.',
        other: `Vous pouvez retirer votre message vocal pendant ${t.number(count)} secondes après l’envoi.`,
      }),
    noticeVoiceRemovalMinutes: (count: number) =>
      t.count(count, {
        one: 'Vous pouvez retirer votre message vocal pendant 1 minute après l’envoi.',
        other: `Vous pouvez retirer votre message vocal pendant ${t.number(count)} minutes après l’envoi.`,
      }),
    noticeVoiceRemovalHours: (count: number) =>
      t.count(count, {
        one: 'Vous pouvez retirer votre message vocal pendant 1 heure après l’envoi.',
        other: `Vous pouvez retirer votre message vocal pendant ${t.number(count)} heures après l’envoi.`,
      }),
    noticeVoiceRemovalAskHost: 'Pour retirer un message vocal, demandez à l’organisateur.',
  },

  moderation: {
    title: 'Modération',
    // Navigation pass, batch C: the way to the other console.
    openMobile: 'Version téléphone, photo par photo',
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
    shortcutsHint:
      'J / K pour naviguer, P pour publier, R pour refuser, Z pour annuler la dernière décision.',

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
    statePublished: 'À l’écran',
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
        one: `${t.number(count)} photo retirée de l’écran. Elle reste dans votre album.`,
        other: `${t.number(count)} photos retirées de l’écran. Elles restent dans votre album.`,
      }),
    // Spec 08: the host's favourites, starred in the moderation console.
    highlight: 'Favori',
    highlightAddHint: 'Mettre en favori',
    highlightRemoveHint: 'Retirer des favoris',
    shortcutsFavourite: 'F pour mettre en favori.',
    decisionFailed: 'La décision n’a pas pu être enregistrée. Réessayez.',
    undoFailed: 'L’annulation n’a pas pu être enregistrée. Réessayez.',
    dimensions: (width: number, height: number) => `${width} × ${height} pixels`,
    /**
     * Said out loud rather than left blank. A card with no caption line at all is
     * indistinguishable from one whose caption failed to arrive, and the host is about
     * to decide what gets projected with that photo.
     */
    noCaption: 'Sans légende',

    /* ---- Moderation traps pass (MOD-1, MOD-4, MOD-9, MOD-13). Keep additions inside this block. ---- */
    /** Z with nothing on offer: said, never ignored. */
    nothingToUndo: 'Rien à annuler.',
    /** The action on "photo publiée": what it does is take the photo back off the screen. */
    undoPublish: 'Retirer',
    /** After a refusal from "En attente", which nothing takes back. */
    seeRejected: 'Voir dans Refusées',
    /** The same decision as `publish`, worded for where the photo comes from. */
    republish: 'Remettre à l’écran',
    republishPhoto: (author: string) => `Remettre à l’écran la photo de ${author}`,
    publishAnyway: 'Publier quand même',
    publishAnywayPhoto: (author: string) => `Publier quand même la photo de ${author}`,
    /** A key that has nothing to do on this photo, and says why. */
    alreadyOnScreen: 'Cette photo est déjà à l’écran.',
    alreadyRefused: 'Cette photo est déjà refusée.',
    notOnScreen: 'Cette photo n’est pas à l’écran.',
    /** Under the viewer's buttons: what the two verbs cost a guest. */
    decisionsExplained:
      'Retirer de l’écran : la photo reste dans votre album. Refuser : elle sort de l’album et son auteur la voit « Non retenue ».',
    /** Tooltips on the two filters. */
    filterRejectedHint: 'Sorties de l’album. L’invité les voit « Non retenues ».',
    filterHiddenHint: 'Retirées de l’écran. Elles restent dans votre album.',
    /** Before a bulk refusal that nothing takes back. */
    confirmRejectTitle: (count: number) => `Refuser ${t.number(count)} photos ?`,
    confirmRejectBody:
      'Leurs auteurs les verront « Non retenues » et elles sortiront de l’album. Cette décision ne s’annule pas.',
    confirmRejectLabel: (count: number) => `Refuser ${t.number(count)} photos`,

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
    /* Spec 15: the guestbook's tab in the console. Its own block, at the end. */
    tabPhotos: 'Photos',
    tabMessages: 'Messages',
    tabsLabel: 'Ce que vous modérez',
    tabCounted: (label: string, count: number) => `${label}, ${t.number(count)} à valider`,
    tabFresh: (label: string, count: number) =>
      t.count(count, {
        one: `${label}, ${t.number(count)} nouveau à relire`,
        other: `${label}, ${t.number(count)} nouveaux à relire`,
      }),
    messagesPendingAnnounce: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} message en attente`,
        other: `${t.number(count)} messages en attente`,
      }),
    messagesEmpty: 'Aucun message à valider pour l’instant.',
    messagesEmptyHint: 'Les mots laissés par vos invités arrivent ici automatiquement.',
    messagePublished: (author: string) => `Message de ${author} publié.`,
    messageRejected: (author: string) => `Message de ${author} refusé.`,
    messageHidden: (author: string) => `Message de ${author} retiré de l’écran.`,
    messagesListLabel: 'Messages du livre d’or',
    messagesLoadFailed: 'Les messages n’ont pas pu être chargés.',
    /* Spec 15, phone console: messages. */
    messageOf: (author: string) => `Message de ${author}`,
    onScreenMessagesTitle: 'Derniers messages à l’écran',
    onScreenMessagesEmpty: 'Aucun message à l’écran pour l’instant.',
    publishMessageOf: (author: string) => `Publier le message de ${author}`,
    rejectMessageOf: (author: string) => `Refuser le message de ${author}`,
    readMessage: 'Lire',
    readMessageOf: (author: string) => `Lire le message de ${author}`,
  },

  /* The guest's view of the evening: the published photographs, with the reactions. */
  feed: {
    title: 'Les photos de la soirée',
    link: 'Voir les photos de la soirée',
    back: 'Envoyer vos photos',
    refresh: 'Actualiser',
    more: 'Voir plus de photos',
    empty: 'Aucune photo n’est encore à l’écran.',
    emptyHint: 'Les photos validées par les organisateurs apparaîtront ici.',
    failed: 'Les photos n’ont pas pu être chargées. Réessayez.',
    own: 'Votre photo',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    unavailable: 'Cette soirée n’est plus affichée.',
    unavailableHint:
      'Elle est terminée, et il n’y a plus de photos à voir ici. Demandez le lien de l’album aux organisateurs.',
    /* Spec 24: saving a photograph from the feed. */
    saving: 'Enregistrement…',
    saveReady: 'Appuyez pour l’enregistrer',
    /** The accessible name of a save button: its word, then the photograph it is under. */
    saveNamed: (action: string, description: string) => `${action} : ${description}`,
    saveDownloaded: 'Photo téléchargée.',
    saveNetworkFailed: 'La photo n’a pas pu être récupérée. Réessayez quand le réseau revient.',
    saveBusy: 'Beaucoup d’invités enregistrent en même temps. Réessayez dans un instant.',
    saveGone: 'Cette photo n’est plus disponible.',
    saveMediaMissing: 'La photo n’a pas pu être récupérée.',
    saveDisabled: 'L’organisateur a désactivé l’enregistrement.',
    saveRevoked: 'L’organisateur a retiré votre accès.',
    /** A lapsed access reads by the state of the evening: open, the code reopens it; over, only the album's link is left. */
    saveExpiredOpen:
      'Votre accès à la soirée a expiré. Rouvrez la soirée depuis le code ou le lien reçu.',
    saveExpiredClosed:
      'Votre accès à la soirée a expiré. Demandez le lien de l’album aux organisateurs.',
    saveHelpSheet:
      'Dans la feuille qui s’ouvre, choisissez « Enregistrer l’image » pour la mettre dans Photos.',
    saveHelpFiles:
      'La photo est dans l’app Fichiers, dossier Téléchargements. Pour qu’elle aille dans Photos, ouvrez la soirée dans Safari : dans la messagerie, touchez Partager, puis « Ouvrir dans Safari ».',
  },

  wall: {
    empty: 'Les premières photos vont bientôt arriver',
    emptyHint: 'Scannez le QR code pour envoyer les vôtres.',
    joinPrompt: 'Rejoignez la soirée',
    offline: 'Nouvelles photos en attente du réseau',
    paused: 'Diaporama en pause',

    /* ---- Spec 11: the souvenir counter and the new-photo signal. Keep additions inside this block. ---- */
    souvenirCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} souvenir partagé`,
        other: `${t.number(count)} souvenirs partagés`,
      }),
    arrivalPhoto: 'Nouvelle photo ajoutée',
    arrivalClip: 'Nouvelle vidéo ajoutée',
    arrivalPhotos: (count: number) => `${t.number(count)} nouvelles photos`,
    arrivalClips: (count: number) => `${t.number(count)} nouvelles vidéos`,
    arrivalMixed: (count: number) => `${t.number(count)} nouveaux souvenirs`,

    /* ---- Spec 21: scheduled announcements on the wall. The text inside is the host's, never translated. ---- */
    announcementSay: (text: string) => `Annonce : ${text}.`,
    announcementIn: (time: string) => `dans ${time}`,
    announcementImminent: (time: string) => `dans un instant · ${time}`,
    /* A discreet announcement's pill (spec 21): rounded up to the minute, two minutes and over; the last minute has its own words. */
    announcementMinutesLeft: (minutes: number) => `encore ${minutes} min`,
    announcementLastMinute: 'moins d’1 min',

    /* ---- Added by features/wall. Keep additions inside this block. ---- */
    codeLabel: 'Code de la soirée',
    // The accessible name of the inline QR. Read by nothing in the room, but the wall
    // is also opened on a laptop while a host sets the projector up.
    qrTitle: 'QR code pour rejoindre la soirée',
    // A photo's alt text. 1.0 used the filename, which reads aloud as IMG_4821.jpg.
    photoBy: (name: string) => `Photo envoyée par ${name}`,
    photoByAnonymous: 'Photo envoyée par un invité',
    errorTitle: 'Les photos n’ont pas pu être chargées',
    errorHint: 'Nouvelle tentative en cours. Vérifiez le réseau du lieu si l’écran reste vide.',
    // The event is not served to the room: not open yet, archived, or its client suspended. The
    // server answered, so the venue's network is fine and neither line sends a host to look at it.
    notServedTitle: 'Cet écran est en attente',
    notServedHint: 'Cet écran s’allumera tout seul dès l’ouverture de la soirée.',
    dismissJoinCard: 'Masquer le rappel du code',
    shortcuts: 'Raccourcis clavier',
    shortcutsHint:
      'Espace met en pause, les flèches changent de photo, F passe en plein écran, L change la disposition, Q masque ou affiche le QR code.',
    /* Navigation pass, batch A: how to leave the wall. */
    leaveHint: 'Pour quitter : Échap ou F sortent du plein écran, puis fermez l’onglet.',
    mixedHint:
      'Le mur alterne vue d’ensemble et photo en grand : L (ou ?layout=) fixe une mise en page sur cet écran et arrête l’alternance jusqu’au rechargement de la page.',
    /* Spec 12: the muted-speaker icon, and the S key in the shortcuts. */
    soundActivate: 'Activer le son sur cet écran',
    soundShortcutHint: 'S active le son sur cet écran, s’il est activé dans les réglages.',
    /* "Levez les yeux" (UX review 2026-10-30): the line under a guest's first photo on the wall. */
    firstPhotoOf: (name: string) => `Première photo ${deBefore(name)}`,

    /* ---- Before and after the evening (UX review 30/10, MUR-2 to MUR-9). Keep additions inside this block. ---- */
    // The corner card's title: what to do, in a verb a guest reads from ten metres.
    sendPrompt: 'Envoyez vos photos sur l’écran',
    // Under the code, for the phone that cannot read the QR. Both holes are interpolated as given.
    typeCodeAt: (code: string, host: string) => `ou tapez ${code} sur ${host}`,
    // The invitation's title where a layout gives it a place of its own (joinSlot.ts). The
    // spotlight's cartel and the filmstrip's ticket keep `sendPrompt`, which says the whole verb.
    invitePrompt: {
      tile: 'Votre photo ici',
      cell: 'La prochaine est la vôtre',
      print: 'Votre photo ici',
      tag: 'Accrochez la vôtre',
      seam: 'Envoyez les vôtres',
    },
    // An empty wall of an event the host has closed: nobody can send a photo any more.
    emptyClosed: 'Merci d’être venus !',
    // In the shortcuts panel, only when the browser could not keep the screen awake itself.
    keepAwakeHint: 'Désactivez la mise en veille de cet ordinateur.',

    /* ---- The settings panel on the wall (spec 13). Keep additions to it inside this block. ---- */
    panel: {
      open: 'Réglages',
      pause: 'Pause',
      resume: 'Reprendre',
      fullscreen: 'Plein écran',
      /* Spec 17: what the owner bar's icons say on hover and on focus, with their key. */
      openTip: 'Réglages (R)',
      pauseTip: 'Pause (Espace)',
      resumeTip: 'Reprendre (Espace)',
      fullscreenTip: 'Plein écran (F)',
      /* Spec 17: the drawer's section row and the current value under each section's title. */
      sectionJump: 'Aller à la section',
      summaryNone: 'Aucun',
      summaryHidden: 'Masqué',
      summaryOff: 'Désactivé',
      rhythmAuto: 'Auto',
      summaryRhythm: (n: number) => `${n} s`,
      barLabel: 'Commandes du mur',
      panelLabel: 'Réglages du mur',
      title: 'Réglages',
      close: 'Fermer les réglages',
      sectionDisplay: 'Affichage',
      sectionAmbiance: 'Ambiance',
      sectionQr: 'QR code',
      forAll: 'Pour tous les écrans',
      thisScreen: 'Cet écran seulement',
      thisScreenHint:
        'Ces commandes ne changent que cet écran et sont perdues au rechargement de la page.',
      screenLayout: (name: string) => `Mise en page de cet écran : ${name} (touche L)`,
      screenShows: (name: string) => `Cet écran affiche ${name} (touche L)`,
      backToEvent: 'Revenir au réglage de l’évènement',
      hideQr: 'Masquer la carte QR',
      showQr: 'Montrer la carte QR',
      saving: 'Enregistrement…',
      saved: 'Enregistré',
      saveFailed: 'Impossible d’enregistrer, réessayez',
      sessionExpired: 'Votre session a expiré. Reconnectez-vous pour régler le mur.',
      signIn: 'Se connecter',
      signInToSet: 'Se connecter pour régler ce mur',
      openHint: 'R ouvre les réglages du mur.',
      /* Spec 12: the state of this screen's speakers, in the "Son" section. */
      soundScreenOn: 'Cet écran : son activé.',
      soundScreenOff: 'Cet écran : son désactivé.',
    },

    /* ---- Wall layouts (roadmap 2.3). Keep additions to them inside this block. ---- */
    /**
     * The dispositions, named for the one person who ever reads them: the host standing
     * at the projector with the shortcuts dialog open. Nothing here is projected — the
     * room sees photographs, not the name of the grid they are in — so these are working
     * words a host would use, not translations of the code's names. The same holds in the
     * other four tables: translate what a host at a projector would call the grid, not
     * `spotlight`.
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
      clothesline: 'Corde à linge',
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

    /** The signature under a guestbook card (spec 01) when the guest gave no name. */
    guestbookAnonymous: 'Un invité',

    /* ---- Added by photo missions (ROADMAP 2.1). Keep additions inside this block. ---- */

    /**
     * The corner panel's own words, in the language the host set on the event — a guest's
     * phone cannot answer "what language is this room", and the host can.
     *
     * The prompts themselves are not here at all. They are content the host typed, and
     * they arrive on the wall response. So this panel routinely renders a translated
     * heading over untranslated prompts, which is not a defect: the heading is the
     * product speaking and the prompt is the host speaking, and they are allowed to be in
     * different languages because they are different voices.
     */
    missionsTitle: 'Missions',
    missionDone: 'Fait',
    /**
     * What the wall prints beside a per-guest prompt, in place of a tick.
     *
     * A tick would be wrong for something two hundred people can each answer, and it is
     * the only place `scope` changes a pixel.
     */
    missionGuests: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} invité`,
        other: `${t.number(count)} invités`,
      }),
  },

  admin: {
    events: 'Vos évènements',
    breadcrumbLabel: 'Fil d’Ariane',
    newEvent: 'Nouvel évènement',
    eventName: 'Nom de l’évènement',
    eventNameHint: 'Visible par vos invités, par exemple « Camille & Sacha ».',
    slug: 'Adresse',
    joinCode: 'Code de la soirée',
    rotateJoinCode: 'Changer le code',
    rotateJoinCodeHint:
      'Les QR codes déjà imprimés et le lien déjà envoyé ne fonctionneront plus : il faudra les réimprimer et le renvoyer. Les invités déjà connectés le restent.',
    openWall: 'Ouvrir l’écran',
    openModeration: 'Modérer',
    download: 'Télécharger l’album',
    statusDraft: 'Brouillon',
    statusLive: 'En cours',
    statusClosed: 'Terminée',
    statusArchived: 'Archivée',
    goLive: 'Ouvrir aux invités',
    closeEvent: 'Terminer la soirée',
    reopenEvent: 'Rouvrir',
    archiveEvent: 'Archiver',
    photos: (count: number) =>
      t.count(count, { one: `${t.number(count)} photo`, other: `${t.number(count)} photos` }),
    guests: (count: number) =>
      t.count(count, { one: `${t.number(count)} invité`, other: `${t.number(count)} invités` }),
    stats: {
      title: 'Statistiques de la soirée',
      tile: 'Statistiques',
      loading: 'Chargement des statistiques…',
      empty:
        'Rien à compter pour l’instant. Les chiffres apparaissent dès que des invités rejoignent l’évènement.',
      emptyAction: 'Voir le QR code',
      figureUploads: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} envoi reçu`,
          other: `${t.number(count)} envois reçus`,
        }),
      figureGuests: (count: number) =>
        t.count(count, { one: `${t.number(count)} invité`, other: `${t.number(count)} invités` }),
      figureHere: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} ici maintenant`,
          other: `${t.number(count)} ici maintenant`,
        }),
      figurePending: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} en attente`,
          other: `${t.number(count)} en attente`,
        }),
      timelineTitle: 'Envois dans le temps',
      timelineCaption: 'Envois par heure',
      hourColumn: 'Heure',
      uploadsColumn: 'Envois',
      timelineEmpty: 'Aucun envoi pour l’instant.',
      peak: (hour: string, count: number) =>
        `Pic : ${hour}, ${t.count(count, { one: `${t.number(count)} envoi`, other: `${t.number(count)} envois` })}`,
      statusTitle: 'Envois par statut',
      statusPublished: 'Publiés',
      statusPending: 'En attente',
      statusRejected: 'Refusés',
      statusHidden: 'Masqués',
      publishedShare: 'Part des envois publiés',
      guestsTitle: 'Invités',
      guestsJoined: 'Arrivés',
      guestsContributors: 'Ayant envoyé au moins un fichier',
      guestsRevoked: 'Retirés par vous',
      reactionsTitle: 'Réactions',
      reactionsTotal: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} réaction`,
          other: `${t.number(count)} réactions`,
        }),
      topTitle: 'Ceux qui ont le plus partagé',
      topEmpty: 'Personne n’a encore publié d’envoi.',
      topLine: (photos: number, reactions: number) =>
        `${t.count(photos, { one: `${t.number(photos)} envoi publié`, other: `${t.number(photos)} envois publiés` })} · ${t.count(reactions, { one: `${t.number(reactions)} réaction reçue`, other: `${t.number(reactions)} réactions reçues` })}`,
      anonymous: (guests: number, photos: number) =>
        `Les invités sans prénom sont regroupés : ${t.count(guests, { one: `${t.number(guests)} invité`, other: `${t.number(guests)} invités` })}, ${t.count(photos, { one: `${t.number(photos)} envoi`, other: `${t.number(photos)} envois` })}.`,
      engagementTitle: 'Après la soirée',
      engagementNone:
        'Pas encore mesuré : aucune ouverture du lien d’album, aucun ZIP lancé ni aucune photo enregistrée.',
      albumOpens: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} ouverture du lien d’album`,
          other: `${t.number(count)} ouvertures du lien d’album`,
        }),
      zipLaunches: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} ZIP lancé`,
          other: `${t.number(count)} ZIP lancés`,
        }),
      guestSaves: (count: number) =>
        t.count(count, {
          one: `${t.number(count)} photo enregistrée par les invités`,
          other: `${t.number(count)} photos enregistrées par les invités`,
        }),
      measuredSince: (date: string) => `Mesuré depuis le ${date}. Avant, rien n’était compté.`,
      engagementNote:
        'Une ouverture est un chargement de la page d’album, pas une personne. Un ZIP lancé n’est pas forcément terminé. Un enregistrement est une demande acceptée, pas une photo forcément arrivée sur le téléphone. Ces chiffres sont indicatifs.',
      retention:
        'Ces chiffres disparaissent avec l’évènement, à sa suppression ou à l’échéance de conservation.',
    },
    storageUsed: (used: string, total: string) => `${used} sur ${total}`,
    settings: 'Réglages',
    moderationMode: 'Modération',
    moderationManual: 'Valider chaque photo',
    moderationAuto: 'Publier automatiquement',
    moderationManualEffect:
      'Chaque envoi (photo, vidéo, message) attend votre accord avant d’arriver à l’écran.',
    moderationAutoEffect: 'Les envois arrivent à l’écran sans validation.',
    /**
     * "Les photos et les vidéos", because both are true.
     *
     * `transcodeNextClip` publishes a finished clip with an `automatic` reviewer under
     * `auto` exactly as photo ingest does, so a guest's video reaches the projector with
     * nobody having watched it. The sentence said "les photos" and a host reading it had
     * no reason to think a clip was covered — and a clip is the one that runs for six
     * seconds with sound in front of the room.
     *
     * Shown on the settings page the moment `auto` is selected, and on the two template
     * cards that set it. One string for one choice: a second wording for the create form
     * would be the same disclosure said two ways, and the weaker one would win by
     * arriving first.
     */
    moderationAutoWarning:
      'Les photos, les vidéos et les messages du livre d’or apparaîtront à l’écran sans validation. À réserver aux évènements entre proches.',
    allowCaptions: 'Autoriser les légendes',
    allowReactions: 'Autoriser les réactions',
    /**
     * The host's switch over video (roadmap 1.4).
     *
     * The hint used to name **one** cause for the box being unticked — "créées avant
     * l’arrivée de cette fonctionnalité" — which was the only cause there was until
     * roadmap 3.5 shipped a Conférence template that unticks it deliberately. A host who
     * created that event this morning was then told its gallery predated a release from
     * last year, which is simply false and is the kind of sentence that makes a host stop
     * believing the rest of the page.
     *
     * So it now explains the *state* and lists the causes rather than asserting one. It
     * is written for any deliberately-off event, not only for the template's.
     */
    allowClips: 'Autoriser les vidéos',
    allowClipsHint:
      'Les invités peuvent envoyer de courtes vidéos, en plus des photos. Quand la case est décochée, les vidéos sont refusées : parce que vous l’avez décochée, parce que le modèle choisi à la création l’a réglé ainsi, ou parce que l’évènement est antérieur à cette fonctionnalité. Cochez-la pour les autoriser.',
    /** The host's switch over saving from the feed (spec 24). */
    allowGuestSave: 'Les invités peuvent enregistrer les photos de la soirée',
    allowGuestSaveHint:
      'Chaque invité peut garder sur son téléphone une photo affichée à l’écran, en haute qualité, sans le lieu ni l’appareil de prise de vue. Vous gardez la main sur l’album : une photo que vous retirez ne peut plus être enregistrée, mais une photo déjà enregistrée reste sur le téléphone de la personne, et vous ne pouvez pas empêcher la copie d’une seule photo sans la retirer. Changer ce réglage pendant la soirée fait relire la notice aux invités avant leur prochaine photo. Une fois la soirée terminée, un invité dont l’accès a expiré ne peut plus enregistrer : envoyez-lui le lien de l’album, qui donne aussi la pleine résolution.',
    allowGuestbook: 'Ouvrir le livre d’or',
    allowGuestbookHint:
      'Les invités laissent un court message. Décoché : le livre d’or est fermé, les messages déjà écrits sont conservés.',
    guestbookOnWall: 'Afficher les messages sur l’écran de la salle',
    guestbookOnWallHint:
      'Décoché : les messages publiés restent dans le livre d’or mais n’apparaissent pas à l’écran.',
    allowGuestSelfDelete: 'Autoriser les invités à supprimer leurs photos',

    /* ---- The language the room's screen speaks (roadmap 1.5). ---- */

    /**
     * Named for the screen it changes and for nothing else.
     *
     * It is **not** "la langue de la soirée", and the hint says so at length — a host who
     * read that wording would reasonably expect their consignes to be translated, and they
     * never will be. No single field could describe the content's language anyway: a
     * caption is written by whichever guest wrote it.
     */
    wallLanguage: 'Langue de l’écran de la salle',
    wallLanguageHint:
      'Les mots de l’écran de la salle : « Rejoignez la soirée », « Missions », les messages d’attente. Ce que vous et vos invités écrivez — le nom de l’évènement, les légendes, les consignes — s’affiche tel quel et n’est jamais traduit. Vos invités choisissent leur propre langue sur leur téléphone ; ce réglage ne les concerne pas.',

    /* ---- Wall display block of the settings page (spec 13). Keep additions to it inside this block. ---- */
    wallDisplay: {
      title: 'Affichage du mur',
      forAll: 'Pour tous les écrans',
      hint: 'Ces choix sont enregistrés pour l’évènement : tous les écrans de la salle les suivent.',
      layout: 'Mise en page',
      layoutHint:
        'Une touche L, ou une adresse avec ?layout=, garde la priorité sur l’écran concerné.',
      layoutUnset: 'Au choix de chaque écran',
      interval: 'Rythme',
      intervalHint: 'Le temps pendant lequel chaque photo reste à l’écran.',
      intervalDefault: 'Par défaut (une photo toutes les 8 s)',
      intervalSeconds: (n: number) => `Une photo toutes les ${n} s`,
      mixed: 'Alterner mur et diaporama',
      mixedHint: 'Le mur affiche une vue d’ensemble, puis une photo en grand, tour à tour.',
      mixedWall: 'Temps sur le mur',
      mixedSlideshow: 'Temps sur le diaporama',
      freshLane: 'Nouvelles photos en priorité',
      freshLaneHint: 'Une photo publiée prend la diapositive suivante, trois de suite au plus.',
      tilt: 'Photos légèrement inclinées',
      tiltHint: 'Polaroïds et corde à linge : un angle fixe de quelques degrés.',
      showTime: 'Heure d’envoi sous la photo',
      showTimeHint:
        'L’heure à laquelle la photo a été envoyée, selon l’horloge de l’écran de la salle.',
      // Spec 11.
      onScreen: 'À l’écran',
      souvenirCounter: 'Afficher le compteur de souvenirs',
      souvenirCounterHint:
        'Un compteur discret, en haut au centre : « 17 souvenirs partagés ». Il compte les photos et les vidéos visibles au mur.',
      newPhotoSignal: 'Signaler les nouvelles photos',
      newPhotoSignalHint:
        'Un message bref, en haut au centre, quand une photo ou une vidéo vient d’apparaître au mur. Jamais le nom de l’invité.',
      // Spec 14: the invitation card.
      qrTitle: 'QR code',
      qrVisible: 'Afficher le QR sur le mur',
      qrVisibleHint:
        'Les invités qui arrivent tard n’auront plus le QR. Le mur vide garde son invitation.',
      qrSize: 'Taille du QR',
      qrSizeValue: (n: number) => `× ${String(Math.round(n * 100) / 100).replace('.', ',')}`,
      qrSizeSmall: 'Petit',
      qrSizeMedium: 'Moyen',
      qrSizeLarge: 'Grand',
      qrSizeHint:
        'Le QR ne descend jamais sous un seuil lisible : un lien long le garde plus grand.',
      qrPlacement: 'Position',
      qrCorners: {
        'top-start': 'En haut à gauche',
        'top-end': 'En haut à droite',
        'bottom-start': 'En bas à gauche',
        'bottom-end': 'En bas à droite',
      },
      qrPlacementHint:
        'Le coin vaut pour la mise en page Plein écran. Les autres placent le QR dans leur propre composition : une case de la mosaïque, un tirage, une étiquette sur la corde…',
    },
    wallSound: {
      title: 'Son',
      hint: 'Un court son quand une photo ou un clip est publié sur le mur. Éteint par défaut.',
      enable: 'Un son à chaque nouvelle photo',
      enableHint:
        'Chaque écran doit aussi être activé sur place : un clic sur le mur (ou la touche S) suffit.',
      tone: 'Son',
      toneNames: { chime: 'Carillon', bell: 'Cloche', drop: 'Goutte', pop: 'Pop' },
      tonePlay: (name: string) => `Écouter : ${name}`,
      volume: 'Volume',
      volumeValue: (n: number) => `Volume ${n} %`,
      test: 'Tester',
      testHint: 'Joue le son choisi sur cet ordinateur, à ce volume.',
    },

    /* ---- Per-event theming (roadmap 2.2). Kept to seven keys, three of them records,
            because a single choice with four options does not deserve four strings. ---- */
    theme: 'Apparence',
    themeAccentNames: {
      violet: 'Couleur de l’ambiance (par défaut)',
      rose: 'Rose',
      azure: 'Bleu',
      teal: 'Turquoise',
    } satisfies Record<CuratedAccent, string>,
    themeFontsNames: {
      sans: 'Éditoriale',
      serif: 'Classique',
    } satisfies Record<ThemeFonts, string>,
    themeFrame: 'Cadre des photos',
    themeFrameNames: {
      soft: 'Coins arrondis',
      square: 'Coins droits',
      round: 'Coins très arrondis',
    } satisfies Record<ThemeFrame, string>,
    themeAmbiance: 'Ambiance',
    themeAmbianceNames: {
      eventslide: 'EventSlide',
      guinguette: 'Guinguette',
      riviera: 'Riviera',
      champs: 'Champs d’or',
      bivouac: 'Bivouac',
      cabaret: 'Cabaret',
      noces: 'Noces',
      custom: 'Sur mesure',
    } satisfies Record<ThemeAmbiance, string>,

    /* ---- The screen that follows the creation of an event: the logo is asked for early. ---- */
    welcome: {
      title: (name: string) => `«\u00a0${name}\u00a0» est créé`,
      lead: 'Une dernière chose, si vous l’avez sous la main\u00a0: votre logo. Il apparaîtra sur la page de vos invités, l’écran de la salle, l’invitation et le QR imprimé.',
      later: 'Plus tard',
      continue: 'Continuer',
      findLater: 'Vous le retrouverez dans Apparence.',
    },
    /* ---- The Apparence page (/appearance): what guests and the room see, with a preview. ---- */
    appearance: {
      title: 'Apparence',
      lead: 'Ce que voient vos invités sur leur téléphone et sur l’écran de la salle.',
      imagesTitle: 'Vos images',
      imagesHelp:
        'Elles habillent tout ce que voient vos invités. L’aperçu les montre dans l’ambiance choisie.',
      ambianceTitle: 'Ambiance',
      ambianceHelp:
        'Le décor de la soirée : photo de fond, police du nom, couleurs. Cliquez : l’aperçu change tout de suite.',
      /** One sentence per ambiance, under its picture: what it looks like. */
      sentences: {
        eventslide: 'Violet profond et lumière douce, la tenue de la maison.',
        guinguette: 'Bois, crème et guirlandes d’ampoules : une fête au jardin.',
        riviera: 'Bleu marine et voile blanche, un soir de bord de mer.',
        champs: 'Herbes hautes et miel dans la lumière dorée.',
        bivouac: 'Nuit bleue et braises, un feu de camp sous les étoiles.',
        cabaret: 'Ébène et or champagne, un rideau de velours.',
        noces: 'Blanc et ivoire, roses rouges : la seule ambiance claire.',
        custom: 'Votre fond, clair ou foncé, teinté à votre goût.',
      } satisfies Record<ThemeAmbiance, string>,
      /** Who it is for, after the label: `Pour : …`. « Sur mesure » has none. */
      audiences: {
        eventslide: 'Va avec tout',
        guinguette: 'Anniversaire, fête de village',
        riviera: 'Fête d’été, terrasse',
        champs: 'Mariage champêtre',
        bivouac: 'Soirée entre amis',
        cabaret: 'Gala, soirée habillée',
        noces: 'Mariage',
      } satisfies Record<Exclude<ThemeAmbiance, 'custom'>, string>,
      audience: (audience: string) => `Pour\u00a0: ${audience}`,
      customCardAction: 'Ouvrir l’éditeur',
      currentAmbiance: '(ambiance actuelle)',
      colourTitle: 'Couleur',
      colourHelp: 'Celle des boutons et de la carte QR. Les quatre restent lisibles à dix mètres.',
      /** The first swatch: no hue of the host's, the ambiance's own accent. */
      colourFromAmbiance: 'De l’ambiance',
      messageTitle: 'Message d’accueil',
      detailsTitle: 'Détails de l’écran de la salle',
      fontsLegend: 'Police du nom sur l’écran',
      fontsAmbiance: 'Celle de l’ambiance',
      fontsClassic: 'Classique',
      fontsAmbianceSummary: 'police de l’ambiance',
      fontsClassicSummary: 'police classique',
      previewTitle: 'Aperçu',
      previewWallPhotos: 'Avec des photos',
      previewWallWaiting: 'Avant les premières photos',
      previewNote:
        'Photos d’exemple. Ce que vous changez ici est enregistré et visible tout de suite par vos invités.',
      previewBig: 'Voir en grand',
      previewClose: 'Fermer',
      /** The summary row the settings page keeps in place of the controls. */
      rowEdit: 'Modifier',
      rowEditLabel: 'Modifier l’apparence',
      rowWithLogo: 'avec logo',
      rowWithoutLogo: 'sans logo',
    },

    /* ---- Event templates (roadmap 3.5). The names of the four evenings, plus the two
            sentences that carry the whole feature: a template is a starting point, and
            nothing here is final. The per-setting wording is reused from the settings
            form below, so the create card and the settings page cannot describe the same
            value differently. ---- */
    template: 'Type d’évènement',
    templateHint:
      'Un point de départ, adapté au genre de soirée. Tous ces réglages restent modifiables à tout moment, avant comme pendant l’évènement.',
    templateNone: 'Sans modèle',
    /**
     * The pre-selected option, which was the only one that said nothing about itself.
     *
     * "Réglages par défaut" describes where the values come from and not what they are,
     * and the value it was quietest about is the one ROADMAP section 7 names as a
     * decision rather than a default: `retentionDays: null` keeps photographs of other
     * people's families indefinitely. The other four cards list their consequences
     * precisely so a preset is not a box whose effects are discovered later; the option a
     * host lands on owes them the same.
     *
     * Both halves are pinned against the domain's own defaults by
     * `eventTemplateContract.test.ts`, so a changed default cannot leave this sentence
     * quietly false.
     */
    templateNoneSummary:
      'Réglages par défaut : chaque photo validée avant l’écran, conservation illimitée.',
    templateChanges: 'Ce modèle règle :',
    /* The heading of the miniature beside each card. A sample rather than the event's name:
       nothing has been typed yet when a host chooses, and the real name is content, which no
       table translates. It is set in the template's own face, so the face is what shows. */
    templatePreviewSample: 'Votre évènement',
    templateClipsOn: 'Vidéos autorisées',
    templateClipsOff: 'Vidéos désactivées',
    templateSelfDeleteOn: 'Effacement photo par photo autorisé',
    templateSelfDeleteOff: 'Effacement photo par photo désactivé',
    templateGuestSaveOn: 'Les invités peuvent enregistrer les photos',
    templateGuestSaveOff: 'Enregistrement des photos par les invités désactivé',
    templateVoiceOn: 'Messages vocaux dans le livre d’or activés',
    templateVoiceOff: 'Messages vocaux désactivés',
    templateVoiceSealed: 'Messages vocaux gardés secrets jusqu’à la révélation',
    templateNames: {
      wedding: 'Mariage',
      birthday: 'Anniversaire',
      conference: 'Conférence',
      party: 'Soirée',
      disposable: 'Appareil jetable',
    } satisfies Record<EventTemplateKey, string>,

    retention: 'Suppression automatique',
    retentionNever: 'Jamais',
    /**
     * "après la fin de la soirée", counted by `Intl` rather than by hand.
     *
     * The retention clock starts at `closedAt` and `Event.expiresAt` answers `null` until
     * the host ends the evening, so a bare "après la fin" named something the server does not
     * measure: the same words meant "never" to a host who leaves the wall open and a real
     * countdown to one who ends it that night. It says "la fin de la soirée" because that is
     * what the button ("Terminer la soirée") and the badge ("Terminée") call the act that
     * starts the clock; it used to say "la clôture", a word the host never read on a button.
     *
     * The plural goes through `t.count` because French agrees zero and one with the
     * singular: a hand-written `${days} jours` reads "1 jours" on the one-day option.
     */
    retentionDays: (days: number) =>
      t.count(days, {
        one: `${t.number(days)} jour après la fin de la soirée`,
        other: `${t.number(days)} jours après la fin de la soirée`,
      }),
    /**
     * What `retentionDays: null` actually is, said as a consequence rather than as
     * "Jamais".
     *
     * `retentionNever` is the right word for an *option* in a list headed "Suppression
     * automatique" — the question there is when it happens and the answer is never. On a
     * card with no such heading it is a bare word that could mean anything, and what it
     * means is that photographs of other people's families are kept indefinitely, which
     * ROADMAP section 7 calls out as a decision rather than a neutral default.
     */
    retentionUnlimited: 'Conservation illimitée',
    moderators: 'Modérateurs',

    /* ---- Added by features/admin (auth, event management). ---- */
    loading: 'Chargement de vos évènements…',
    eventLoading: 'Chargement de l’évènement…',
    eventsEmpty: 'Aucun évènement pour le moment.',
    eventsEmptyHint: 'Cinq étapes pour être prêt le jour J.',
    emptyStepCreate: 'Créez l’évènement.',
    emptyStepPrint: 'Imprimez le QR code et posez-le sur les tables.',
    emptyStepScreen: 'Branchez l’écran du lieu et ouvrez-le : il attendra l’ouverture.',
    emptyStepOpen: 'Ouvrez la soirée aux invités.',
    emptyStepTest: 'Testez depuis un téléphone qui n’est pas le vôtre, sur le réseau du lieu.',
    create: 'Créer l’évènement',
    slugHint: 'Facultatif. Laissez vide pour la déduire du nom.',
    slugPreviewLabel: 'Adresse pour vos invités',
    slugPreviewEmpty: 'Saisissez un nom pour voir l’adresse.',
    joinLink: 'Lien pour vos invités',
    printQr: 'Imprimer le QR code',
    qrScanPrompt: 'Scannez pour envoyer vos photos.',
    qrAlt: (eventName: string) => `QR code pour rejoindre ${eventName}`,
    printKitTitle: 'Cartes de table et affiche',
    printKitCrumb: 'Cartes et affiche',
    printKitIntro:
      'Imprimez de quoi poser sur les tables : le QR code, le code de secours et trois lignes d’explication.',
    printKitFormat: 'Format',
    printKitInk: 'Couleur du QR',
    printInkBlack: 'Noir (le plus sûr)',
    printInkEvent: 'Couleur de l’évènement',
    printKitLogo: 'Logo de l’évènement au centre du QR',
    printKitLogoHint:
      'Le QR code passe en correction d’erreurs maximale : il reste lisible, mais il est un peu plus dense.',
    printFormatA4: 'Affiche A4 (1 par feuille)',
    printFormatA5: 'Affiche A5 (2 par feuille)',
    printFormatCard: 'Cartes de table A6 (4 par feuille)',
    printKitLanguage: 'Langue du support',
    printKitLanguageHint: 'C’est la langue de la soirée, pas celle de votre écran.',
    printKitPrint: 'Imprimer',
    printKitPrinting: 'Mise à jour du code…',
    printKitHelp:
      'Dans la fenêtre d’impression, choisissez A4, échelle 100 %, sans en-têtes ni pieds de page. Votre navigateur y propose aussi « Enregistrer au format PDF ». Utilisez le bouton Imprimer : Ctrl+P ne vérifie pas le code.',
    printKitCodeChanged:
      'Le code de la soirée a changé : le support ci-dessous est à jour. Jetez les anciens.',
    printKitClosed:
      'Cette soirée est fermée : les invités qui scannent ne peuvent plus rejoindre. Si vous la rouvrez, le même code redevient valable.',
    printKitDraft: 'Les invités ne pourront rejoindre qu’à l’ouverture de la soirée.',
    printKitArchived: 'Cet évènement est archivé : son QR code ne mène plus nulle part.',
    printKitBack: 'Retour à l’évènement',
    printKitLongLink: 'Le lien est long, le QR code sera petit. Préférez l’affiche.',
    printKitPreview: 'Aperçu de la feuille',
    /* Spec 28: the designs of the printed card and what the host writes on it. */
    printDesignNames: {
      essentiel: 'Essentiel',
      classique: 'Classique',
      ticket: 'Ticket de caisse',
      bd: 'Bande dessinée',
      magazine: 'Magazine',
      souvenir: 'Souvenir',
      postale: 'Carte postale',
      billet: 'Billet',
      embarquement: 'Carte d’embarquement',
      jetable: 'Appareil jetable',
      affiche: 'Affiche',
      confettis: 'Confettis',
      seventies: 'Années 70',
      nuit: 'Nuit',
      guirlande: 'Guirlande',
    } satisfies Record<PrintDesign, string>,
    printSwatchNames: {
      coral: 'Corail',
      raspberry: 'Framboise',
      plum: 'Prune',
      lavender: 'Lavande',
      navy: 'Bleu nuit',
      ocean: 'Océan',
      fir: 'Sapin',
      olive: 'Olive',
      mustard: 'Moutarde',
      terracotta: 'Terre cuite',
      charcoal: 'Anthracite',
    } satisfies Record<PrintSwatch, string>,
    printKitDesign: 'Modèle',
    printKitTexts: 'Textes de la carte',
    printKitTitleField: 'Titre',
    printKitTitleHint: 'Laissé vide, c’est le nom de la soirée.',
    printKitTagline: 'Accroche',
    printKitNote: 'Petit mot',
    printKitDate: 'Date et lieu',
    printKitTable: 'Table',
    printKitDateExample: '14 juin 2026 · Domaine des Tilleuls',
    printKitTableHint: 'Numéro ou nom, facultatif.',
    printKitOptional: 'Facultatif.',
    printKitSteps: 'Les trois étapes, sur les modèles qui ont la place',
    printKitPhoto: 'Photo',
    printKitPhotoChoose: 'Choisir une photo',
    printKitPhotoRemove: 'Retirer la photo',
    printKitPhotoHint:
      'La photo reste dans ce navigateur : elle n’est pas envoyée, et un autre appareil ne la verra pas.',
    printKitPhotoFailed: 'Cette image ne peut pas être lue. Essayez une photo JPEG ou PNG.',
    printKitFocusX: 'Cadrage horizontal',
    printKitFocusY: 'Cadrage vertical',
    printKitColour: 'Couleur de la carte',
    printKitColourEvent: 'Couleur de la soirée',
    printKitColourCustom: 'Autre couleur',
    printKitInkHeavy: 'Fond plein : ce modèle utilise beaucoup d’encre.',
    printWorkshopLabel: 'Réglages de la carte',
    printPanelTexts: 'Textes',
    printPanelColours: 'Couleurs',
    printPanelPrint: 'Impression',
    printKitColoursHint:
      'Carte et QR code ensemble\u00a0: vous jugez le contraste d’un coup d’œil.',
    printFormatShortCard: 'Cartes A6 ×4',
    printFormatShortA5: 'A5 ×2',
    printFormatShortA4: 'Affiche A4',
    printToolbarLabel: 'Format et impression',
    printViewLabel: 'Aperçu',
    printViewCard: 'Une carte',
    printViewSheet: 'La feuille',
    printSeeBig: 'Voir en grand',
    printCloseBig: 'Fermer l’aperçu',
    printPhotoDragHint: 'Glissez la photo sur la carte pour la cadrer, ou utilisez les curseurs.',
    printPanelPrintLead:
      'Vérifiez la feuille, puis lancez l’impression depuis la barre au-dessus de l’aperçu.',
    storageLabel: 'Espace photos utilisé',
    storage: (used: string) => `${used} utilisés`,
    rotateJoinCodeTitle: 'Changer le code de la soirée ?',
    codeRotated: 'Nouveau code actif. L’ancien ne fonctionne plus.',
    settingsReadOnly: 'Cet évènement est archivé : ses réglages ne peuvent plus être modifiés.',
    // What a moderator is shown in place of a form every save of which the server would refuse.
    settingsOwnerOnly: 'Seul l’organisateur de l’évènement peut modifier ses réglages.',
    /* The settings page in sections, saved as the host changes it. */
    settingsPage: {
      guests: 'Invités',
      guestbook: 'Livre d’or',
      wall: 'Écran de la salle',
      schedule: 'Horaires et conservation',
      autosave: 'Chaque changement est enregistré tout de suite.',
      saving: 'Enregistrement…',
      saved: 'Modifications enregistrées',
      saveFailed: 'La dernière modification n’a pas été enregistrée.',
      manual: 'Chaque photo validée',
      auto: 'Publication automatique',
      clipsOn: 'vidéos autorisées',
      clipsOff: 'pas de vidéos',
      guestSaveOn: 'photos enregistrables',
      guestSaveOff: 'photos non enregistrables',
      open: 'Ouvert',
      closed: 'Fermé',
      onWall: 'messages à l’écran',
      voice: 'messages vocaux',
      on: 'Activé',
      off: 'Désactivé',
      timed: 'révélation à heure fixe',
      byHand: 'révélation à la main',
      qrOn: 'QR affiché',
      qrOff: 'sans QR',
      sound: 'son à chaque photo',
      opensAt: 'Ouverture programmée',
      opensByHand: 'Ouverture à la main',
      closesAt: 'fin programmée',
      closesByHand: 'fin à la main',
      keptForever: 'photos gardées sans limite',
      deletedAfter: (days: number) =>
        t.count(days, {
          one: `photos supprimées ${t.number(days)} jour après la fin`,
          other: `photos supprimées ${t.number(days)} jours après la fin`,
        }),
      confirmAutoTitle: 'Publier automatiquement ?',
      confirmRevealTitle: 'Activer l’appareil jetable maintenant ?',
    },
    retentionHint:
      'Le délai court une fois la soirée terminée. Tant qu’elle n’est pas terminée, rien n’est supprimé.',
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
    guestsEmpty: 'Personne n’a encore rejoint la soirée.',
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
    moderatorEmailHint:
      'Il recevra une invitation, valable sept jours, pour modérer cet évènement uniquement.',
    inviteSubmit: 'Inviter',
    /** An invitation went out by e-mail: nothing to copy. */
    moderatorInviteSent: (email: string) => `Une invitation a été envoyée à ${email}.`,
    /** No mail relay, or it refused: the link is for the host to pass on, once. */
    inviteLinkCreated: (email: string) =>
      `Ce lien n’a pas été envoyé par e-mail. Transmettez-le vous-même à ${email} : il ne sert qu’une fois et reste valable sept jours.`,
    inviteLinkUrl: 'Lien à transmettre',
    inviteLinkCopy: 'Copier le lien',
    inviteLinkCopied: 'Lien copié.',
    /** No clipboard (an address that is not secure) or a refusal: the field is selectable. */
    inviteLinkCopyFailed: 'Copie impossible ici : sélectionnez le lien et copiez-le vous-même.',
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
     * Scheduled opening and end (docs/ROADMAP.md §3.4).
     *
     * Times are typed and shown in the browser's timezone — the host's own laptop,
     * which is at the venue — so "18:00" means 18:00 where the party is. Only the
     * instant travels to the server. See web/src/features/admin/eventSchedule.ts.
     * ---------------------------------------------------------------------- */
    scheduleHint:
      'Laissez vide pour ouvrir et terminer la soirée vous-même. Les heures sont celles de votre ordinateur, donc celles du lieu de la fête.',
    scheduleOpenAt: 'Ouvrir aux invités le',
    scheduleCloseAt: 'Terminer la soirée le',
    scheduleCloseAtHint: 'Les photos et l’album sont conservés : terminer la soirée n’efface rien.',
    scheduleSaved: 'L’horaire a été enregistré.',
    scheduleNone: 'Aucun horaire : vous ouvrez et vous terminez la soirée vous-même.',
    /** Rendered as a reminder under the fields once a schedule is armed. */
    scheduleArmed: (opensAt: string, closesAt: string) =>
      `Ouverture le ${opensAt}, fin le ${closesAt}.`,
    scheduleOpensOnly: (opensAt: string) =>
      `Ouverture le ${opensAt}. Vous terminerez la soirée vous-même.`,
    scheduleClosesOnly: (closesAt: string) => `Fin le ${closesAt}. Vous ouvrirez vous-même.`,
    /**
     * The sweep threw a schedule away because the event could not change state then —
     * an archived event, or a closing on an evening that never started. Says what
     * happened, and that the host has to act if they still want it.
     */
    scheduleDiscarded: (when: string) =>
      `L’horaire automatique n’a pas pu s’appliquer le ${when} : l’évènement ne pouvait pas changer d’état à ce moment-là. Il a été effacé. Enregistrez-en un nouveau si vous en voulez un.`,

    /* ---- Added by the host lifecycle pass (revue UX 30/10: HOT-1, 2, 4, 5, 10, 13). ---- */

    /** One toast per move, in what changed for the room (HOT-13). */
    noticeOpened: 'Soirée ouverte aux invités.',
    noticeClosed: 'Soirée terminée. Les invités ne peuvent plus envoyer.',
    noticeReopened: 'Soirée rouverte : les invités peuvent de nouveau envoyer.',
    noticeArchived: 'Soirée archivée. L’album reste téléchargeable.',
    /** From a draft nothing ever ran, so there is no album to keep: only what stops is said. */
    noticeArchivedDraft: 'Soirée archivée.',
    /** Archiving is terminal: the dialog says what stops and what stays (HOT-4, NAV-1). */
    archiveTitle: (eventName: string) => `Archiver ${eventName} ?`,
    archiveHint:
      'L’écran s’arrête, les réglages se figent, c’est définitif. L’album reste téléchargeable.',
    /** Archiving a draft: no screen was running and no album exists, so only the freeze is said. */
    archiveDraftHint:
      'Les réglages se figent et la soirée ne pourra plus être ouverte : c’est définitif.',
    openTitle: (eventName: string) => `Ouvrir ${eventName} aux invités ?`,
    openHint:
      'Tous ceux qui ont le QR code pourront envoyer des photos. Il ne sera plus possible de revenir au brouillon.',
    /** The wall tile in a draft: the screen can be plugged in early (HOT-1). */
    wallDraftHint: 'S’allumera tout seul dès l’ouverture aux invités',
    /** After the toast of a new code: the printed QR is now out of date (HOT-2). */
    codeRotatedAction: 'Imprimer le nouveau QR',
    /** The album's tile in the "Maintenant" card once the evening is over (HOT-5, APR-6). */
    afterShare: 'Partager l’album',
    /* The event page's "Maintenant" card, one heading per status (the page D layout). */
    nowDraftEyebrow: 'Avant la soirée',
    nowDraftTitle: 'Tout est prêt ?',
    nowDraftSettings: 'Choisir l’ambiance et les horaires',
    nowDraftPrint: 'Imprimer les cartes de table',
    nowDraftWall: 'Tester l’écran sur le vidéoprojecteur',
    nowDraftModerators: 'Inviter quelqu’un à modérer avec vous',
    nowDraftLogo: 'Ajouter votre logo',
    nowLiveEyebrow: 'En direct',
    nowLiveTitle: 'La soirée est en cours',
    nowClosedEyebrow: 'Soirée terminée',
    nowClosedTitle: 'Place aux souvenirs',
    nowArchivedEyebrow: 'Évènement archivé',
    nowArchivedTitle: 'L’album reste à vous',
    moderationWaiting: (count: number) =>
      count === 1 ? '1 photo attend votre accord' : `${count} photos attendent votre accord`,
    moderationNothingWaiting: 'Rien n’attend votre accord',
    wallTileHint: 'Dans un nouvel onglet, pour le vidéoprojecteur',
    downloadHint: 'L’album complet, en un fichier ZIP',
    shareHint: 'Un lien pour ceux qui n’étaient pas là',
    accessTitle: 'Pour rejoindre la soirée',
    copyJoinLink: 'Copier le lien',
    joinLinkCopied: 'Lien copié.',
    joinLinkCopyFailed: 'Le lien n’a pas pu être copié : sélectionnez-le à la main.',
    qrEnlarge: 'Afficher le QR code en grand',
    qrEnlargedHint: 'Vos invités scannent cet écran, ou tapent le code.',
    /* The first visit's guided tour of this page (features/admin/eventTour.ts). */
    tourButton: 'Visite guidée',
    tourWelcomeTitle: 'Bienvenue dans votre soirée',
    tourWelcomeBody: (name: string) =>
      `C’est ici que vous préparez « ${name} », que vous la pilotez le jour J et que vous récupérez l’album ensuite. On fait le tour de l’écran ?`,
    tourWelcomeModeratorTitle: 'Bienvenue dans l’équipe',
    tourWelcomeModeratorBody: (name: string) =>
      `Vous modérez « ${name} ». On fait le tour de ce que vous trouverez ici ?`,
    tourNowTitle: 'Ce qui compte maintenant',
    tourNowBody:
      'Cette carte suit la soirée : avant, ce qu’il reste à préparer ; pendant, la modération et l’écran ; après, l’album. Commencez toujours par elle.',
    tourAccessTitle: 'Faire entrer vos invités',
    tourAccessBody:
      'Ils scannent ce QR code ou tapent le code : ni appli, ni compte. Imprimez les cartes de table, ou affichez le QR en grand le jour J.',
    tourOpenTitle: 'Rien ne part avant l’ouverture',
    tourOpenBody:
      'Tant que la soirée est en brouillon, personne ne peut envoyer de photo. Ouvrez-la ici le moment venu, ou programmez l’ouverture dans les réglages.',
    tourCloseTitle: 'Terminer la soirée au bon moment',
    tourCloseBody:
      'Les invités envoient leurs photos jusqu’à ce que vous terminiez la soirée ici, ou à l’heure prévue dans les réglages.',
    tourAfterTitle: 'Rouvrir ou archiver',
    tourAfterBody:
      'La soirée est terminée : plus aucun envoi. Rouvrez-la si besoin, ou archivez-la une fois l’album récupéré.',
    tourEveningTitle: 'Les deux gestes du jour J',
    tourEveningBodyManual:
      'Modérer : chaque photo attend votre accord avant d’apparaître, depuis l’ordinateur ou le téléphone. Ouvrir l’écran : la page à mettre en plein écran sur le vidéoprojecteur.',
    tourEveningBodyAuto:
      'Modérer : les photos s’affichent dès leur arrivée, et vous retirez d’un geste celles qui n’ont rien à faire à l’écran. Ouvrir l’écran : la page à mettre en plein écran sur le vidéoprojecteur.',
    tourOverviewTitle: 'Tout le reste est ici',
    tourOverviewBody:
      'Livre d’or, défi photo, invités, album… Le menu range tout l’évènement en trois moments : préparer, la soirée, après. Chaque sujet a sa page.',
    tourEndTitle: 'À vous de jouer',
    tourEndBody: 'Ce bouton relance la visite quand vous voulez. Bonne soirée !',
    overviewHints: {
      guestbook: 'Les mots laissés par vos invités',
      challenge: 'Un défi photo chronométré',
      missions: 'Des idées de photos à relever',
      moderators: 'Modérer à plusieurs',
      bestOf: 'Vos photos favorites',
      book: 'Un livre photo à imprimer',
      stats: 'Qui a posté quoi, et quand',
      settings: 'Ambiance, horaires, écran',
    },
    /** What is armed, beside the badge (HOT-10). */
    autoOpenAt: (time: string) => `Ouverture automatique à ${time}`,
    autoOpenOn: (dateTime: string) => `Ouverture automatique le ${dateTime}`,
    autoCloseAt: (time: string) => `Fin automatique à ${time}`,
    autoCloseOn: (dateTime: string) => `Fin automatique le ${dateTime}`,
    autoEdit: 'Modifier l’horaire',
    /** The link in the warning that the schedule was thrown away: there is none left to edit. */
    scheduleDiscardedAction: 'Définir un nouvel horaire',

    /* ---- Added by photo missions (ROADMAP 2.1). Keep additions inside this block. ---- */

    missionsTitle: 'Missions',
    missionsHint:
      'Une courte liste de consignes que vos invités voient comme une check-list, et que l’écran affiche dans un coin.',
    missionsEmpty: 'Aucune mission pour le moment.',
    missionPrompt: 'Consigne',
    missionPromptHint: (max: number) =>
      `${t.number(max)} caractères maximum. Écrite dans la langue de la soirée : elle n’est pas traduite.`,
    missionScope: 'À relever',
    missionScopeGuest: 'Par invité',
    missionScopeEvent: 'Une fois pour la soirée',
    missionScopeHint:
      'Par invité : chacun peut la relever. Une fois : la première photo validée la coche pour tout le monde.',
    missionAdd: 'Ajouter la mission',
    missionSave: 'Enregistrer',
    missionCancel: 'Annuler',
    /**
     * The word on the button, and the sentence a screen reader hears.
     *
     * Twelve rows of "Modifier" are twelve identical accessible names, which is exactly
     * the list a screen-reader user cannot navigate. The visible label stays one word
     * because the row already says which prompt it is about.
     */
    missionEditShort: 'Modifier',
    missionDeleteShort: 'Supprimer',
    missionEdit: (prompt: string) => `Modifier « ${prompt} »`,
    missionDelete: (prompt: string) => `Supprimer « ${prompt} »`,
    /**
     * Said plainly, because the host is about to be told that deleting is safe. It is:
     * the schema unfiles the photographs and removes none of them.
     */
    missionDeleteTitle: 'Supprimer cette mission ?',
    missionDeleteAction: 'Supprimer la mission',
    missionDeleteConfirm:
      'Les photos déjà envoyées restent dans l’album : elles ne compteront simplement plus pour cette mission.',
    missionAdded: 'La mission a été ajoutée.',
    missionSaved: 'La mission a été enregistrée.',
    missionDeleted: 'La mission a été supprimée.',
    /** What the room has done with it. Counted on every read, never stored. */
    missionAnswered: (photos: number, guests: number) =>
      `${t.count(photos, {
        one: `${t.number(photos)} photo`,
        other: `${t.number(photos)} photos`,
      })}, ${t.count(guests, {
        one: `${t.number(guests)} invité`,
        other: `${t.number(guests)} invités`,
      })}`,
    missionUnanswered: 'Pas encore relevée',
    missionsFull: (max: number) =>
      `${t.number(max)} missions au maximum : c’est ce qui garde la liste lisible à dix mètres.`,
    /* ---- Added by the shared gallery (ROADMAP 4.1). ---- */
    shareLink: 'Album partagé',
    shareLinkHint:
      'Un lien à envoyer après la soirée : les photos publiées, à télécharger en pleine résolution.',
    shareLinkNone: 'Aucun lien n’est actif.',
    shareLinkActive: (date: string) => `Ouvert jusqu’au ${date}`,
    /**
     * The one reason a host cannot read off the dates: a co-owner made the link and has
     * since been switched off, or is no longer an owner. Said plainly, with the way out.
     */
    shareLinkUnavailable:
      'Ce lien ne s’ouvre plus : il a expiré, ou la personne qui l’a créé n’organise plus l’évènement.',
    shareLinkProtected: 'Protégé par un mot de passe',
    shareLinkUnprotected: 'Sans mot de passe',
    shareLinkLifetime: 'Durée d’ouverture',
    shareLinkDays: (days: number) =>
      t.count(days, { one: `${t.number(days)} jour`, other: `${t.number(days)} jours` }),
    shareLinkPassword: 'Mot de passe',
    shareLinkPasswordHint: (min: number) =>
      `Au moins ${t.number(min)} caractères. Communiquez-le à part du lien.`,
    shareLinkCreate: 'Créer le lien',
    shareLinkReplace: 'Remplacer par un nouveau lien',
    shareLinkReplaceHint: 'Le lien actuel cessera immédiatement de fonctionner.',
    /** Only its digest is stored, so this is the one moment the address exists. */
    shareLinkCreated: 'Voici le lien. Copiez-le maintenant : il ne sera plus affiché.',
    // Spec 08: the best-of panel on the event page.
    bestOf: 'Best-of',
    bestOfHint: 'Vos photos favorites, à emporter après la soirée.',
    bestOfCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} favori`,
        other: `${t.number(count)} favoris`,
      }),
    bestOfNone: 'Aucun favori pour l’instant. Étoilez vos photos préférées dans la modération.',
    bestOfPreselect: 'Pré-sélectionner les plus aimées',
    bestOfPreselected: (limit: number) =>
      `Les ${t.number(limit)} photos les plus aimées sont maintenant en favori. Vous pouvez en retirer ou en ajouter.`,
    bestOfPreselectNothing:
      'Aucune photo à ajouter : les plus aimées sont déjà en favori, ou personne n’a encore réagi.',
    bestOfDownload: 'Télécharger les favoris (ZIP)',
    exportBusy: (seconds: number | null) =>
      seconds === null
        ? 'Un export est déjà en cours pour votre compte.'
        : `Un export est déjà en cours pour votre compte. ${t.count(seconds, {
            one: `Réessayez dans ${t.number(seconds)} seconde.`,
            other: `Réessayez dans ${t.number(seconds)} secondes.`,
          })}`,
    exportNotReady: (seconds: number | null) =>
      seconds === null
        ? 'Le serveur prépare déjà d’autres exports.'
        : `Le serveur prépare déjà d’autres exports. ${t.count(seconds, {
            one: `Réessayez dans ${t.number(seconds)} seconde.`,
            other: `Réessayez dans ${t.number(seconds)} secondes.`,
          })}`,
    exportFailed: 'Le téléchargement n’a pas pu démarrer. Réessayez dans un instant.',
    // Spec 04: the photo book (a PDF of the published album) on the event page.
    book: 'Livre photo',
    bookHint: 'Un livre PDF de l’album, prêt à envoyer ou à faire imprimer.',
    bookStyleLegend: 'Style',
    bookStyleNames: {
      classique: 'Classique',
      magazine: 'Magazine',
      souvenir: 'Souvenir',
    } satisfies Record<AlbumBookStyle, string>,
    bookStyleHints: {
      classique: 'Sobre, papier ivoire',
      magazine: 'Grandes photos, grands titres',
      souvenir: 'Polaroïds et mots manuscrits',
    } satisfies Record<AlbumBookStyle, string>,
    bookStyleFromWall: 'Choisi d’après l’ambiance de votre mur.',
    bookTitle: 'Titre',
    bookSubtitle: 'Sous-titre',
    bookSubtitleHint: 'Vide : la date de la soirée.',
    bookPhotosLegend: 'Photos',
    bookSelectionAll: (count: number) => `Toutes les photos (${t.number(count)})`,
    bookSelectionAllTooMany: (max: number) =>
      `Plus de ${t.number(max)} photos : choisissez une sélection.`,
    bookSelectionBest: 'Une sélection',
    bookSelectionBestHint:
      'Les photos étoilées, au moins une par photographe, puis les plus aimées, réparties sur toute la soirée.',
    bookLengthLegend: 'Longueur de la sélection',
    bookLengthNames: {
      short: 'Courte',
      medium: 'Moyenne',
      long: 'Longue',
    } satisfies Record<BookLength, string>,
    bookLengthChip: (name: string, photos: number) => `${name} · ${t.number(photos)} photos`,
    bookOptionsLegend: 'Contenu',
    bookShowAuthors: 'Prénoms',
    bookShowAuthorsHint:
      'Sous les photos, sous les mots du livre d’or et sur la page de remerciements.',
    bookShowCaptions: 'Légendes',
    bookGuestbook: 'Mots du livre d’or',
    bookGuestbookHint: (count: number, max: number) =>
      `${t.count(count, { one: '1 message écrit', other: `${t.number(count)} messages écrits` })}.${count > max ? ` Les ${t.number(max)} premiers iront dans le livre.` : ''} Les messages vocaux ne vont pas dans le livre.`,
    bookPrintVersion: 'Version pour l’imprimeur',
    bookPrintVersionHint:
      'Deux fichiers en plus, avec fonds perdus, à envoyer à un imprimeur en ligne.',
    bookFormNote:
      'Seules les photos publiées sont incluses. Le nombre de pages est donné quand le livre est prêt.',
    bookCreate: 'Créer le livre',
    bookRebuild: 'Refaire le livre',
    bookRecreate: 'Recréer le livre',
    bookWorking: 'Livre en préparation…',
    bookWorkingDetail: (style: string, target: number | null) =>
      `Style ${style}, ${target === null ? 'toutes les photos' : `environ ${t.number(target)} photos`}. Vous pouvez quitter la page.`,
    bookDone: (photos: number, ofAlbum: number | null, pages: number, until: string | null) =>
      `Livre prêt : ${t.count(pages, { one: `${t.number(pages)} page`, other: `${t.number(pages)} pages` })}, ${t.count(photos, { one: `${t.number(photos)} photo`, other: `${t.number(photos)} photos` })}${ofAlbum === null ? '' : ` (l’album en compte maintenant ${t.number(ofAlbum)})`}.${until === null ? '' : ` Disponible jusqu’au ${until}.`}`,
    bookDownload: 'Télécharger le livre',
    bookDownloadMeta: (size: string) => `PDF · ${size}`,
    bookDownloadPrintInterior: 'Version imprimeur : intérieur',
    bookDownloadPrintCover: 'Version imprimeur : couverture',
    bookPrintSkippedTooManyPages: (pages: number, max: number) =>
      `Version imprimeur non produite : le livre fait ${t.number(pages)} pages, les imprimeurs en acceptent ${t.number(max)} au plus. Choisissez une sélection plus courte et refaites le livre.`,
    bookPrintSkippedTooLarge:
      'Version imprimeur non produite : ses fichiers sont trop lourds. Choisissez une sélection plus courte et refaites le livre.',
    bookHelpLink: 'Comment le faire imprimer ?',
    bookHelpIntro: 'La version imprimeur, ce sont deux fichiers faits du même livre.',
    bookHelpStep1:
      'Choisissez un imprimeur en ligne qui accepte un PDF pour un livre carré de 21 × 21 cm, à couverture rigide.',
    bookHelpStep2:
      'Envoyez l’intérieur et la couverture. Le fichier de couverture contient deux pages : la quatrième, puis la première.',
    bookHelpStep3:
      'Composez le dos avec l’outil de l’imprimeur, et commandez d’abord un exemplaire d’essai.',
    bookDelete: 'Supprimer le livre',
    bookDeleteTitle: 'Supprimer le livre ?',
    bookDeleteHint:
      'Le fichier est effacé du serveur. Vous pourrez en refaire un, dans la limite de trois par jour.',
    bookStale:
      'Le livre a été retiré parce qu’un contenu a été supprimé ou qu’une légende a changé. Recréez-le : vos choix sont gardés.',
    bookFailed: 'Le livre n’a pas pu être fait. Réessayez dans un moment.',
    bookFailedTooLarge: 'L’album est trop volumineux pour un seul livre.',
    // Spec 08, step 2: the highlight video.
    reelTitle: 'Montage vidéo',
    reelHint: 'Un diaporama vidéo de vos favoris, du plus ancien au plus récent.',
    reelCreate: 'Créer le montage vidéo',
    reelRedo: 'Recréer le montage',
    reelQueued: 'Montage en attente de son tour…',
    reelRunning: 'Montage en cours, cela peut prendre quelques minutes…',
    reelFailed: 'Le montage a échoué.',
    reelStale: 'Vos favoris ont changé : ce montage n’est plus à jour. Recréez-le.',
    reelDownload: 'Télécharger le montage (MP4)',
    reelPlayer: 'Aperçu du montage vidéo',
    reelAsked: 'Le montage est lancé.',
    reelReady: (count: number) => `Montage prêt, ${t.number(count)} photos.`,
    shareLinkUrl: 'Adresse du lien',
    shareLinkCopy: 'Copier le lien',
    shareLinkCopied: 'Lien copié.',
    // Navigation pass, batch C: a copy that failed, and the link that is never shown again.
    shareLinkCopyFailed:
      'La copie a échoué. L’adresse est sélectionnée : copiez-la avec Ctrl+C (ou en appuyant longuement sur un téléphone).',
    shareLinkLeaveWarning:
      'Cette adresse ne sera plus jamais affichée et vous ne l’avez pas copiée. Quitter la page quand même ?',
    shareLinkRevoke: 'Désactiver le lien',
    shareLinkRevokeTitle: 'Désactiver ce lien ?',
    shareLinkRevokeHint:
      'Personne ne pourra plus ouvrir l’album avec ce lien, même avec le mot de passe. Vous pourrez en créer un nouveau.',
    shareLinkRevoked: 'Le lien a été désactivé.',

    /* ---- The host's own photograph of their venue (ADR 0010, decision 8). ---- */
    venuePhoto: 'Photo de votre lieu',
    venuePhotoHint:
      'Remplace la photo de l’ambiance derrière l’écran de vos invités et celui de la salle. Elle est réduite et débarrassée de ses métadonnées, position GPS comprise, puis voilée pour que le texte reste lisible.',
    venuePhotoPreviewAlt: 'Aperçu de la photo de votre lieu',
    venuePhotoDefault: 'Aucune photo de votre lieu : l’ambiance montre sa photo par défaut.',
    venuePhotoChoose: 'Choisir une photo',
    venuePhotoReplace: 'Remplacer la photo',
    venuePhotoRemove: 'Revenir à la photo par défaut',
    venuePhotoBusy: 'Envoi de la photo…',
    venuePhotoSaved: 'La photo de votre lieu est enregistrée.',
    venuePhotoRemoved: 'La photo par défaut est rétablie.',
    welcomeMessage: 'Message d’accueil',
    welcomeMessageHint:
      'Quelques mots affichés à vos invités quand ils rejoignent la soirée. Écrivez dans la langue de vos invités : ce texte n’est pas traduit. Il est visible par toute personne qui a le QR code : n’y mettez rien de privé.',
    welcomeMessagePlaceholder:
      'Bienvenue ! Prenez des photos, on les verra sur l’écran dans la salle.',
    welcomeMessageClear: 'Effacer le message',
    welcomeMessageCount: (count: number, max: number): string => `${count} / ${max}`,
    logo: 'Logo de l’évènement',
    logoHint:
      'PNG sur fond transparent de préférence (PNG, JPEG ou WebP). Il apparaît sur la page de vos invités, sur l’écran de la salle, sur l’invitation et au centre du QR code imprimé, jamais sur les photos.',
    logoPreviewAlt: 'Aperçu du logo de l’évènement',
    logoNone: 'Aucun logo pour le moment.',
    logoChoose: 'Choisir un logo',
    logoReplace: 'Remplacer le logo',
    logoRemove: 'Retirer le logo',
    logoBusy: 'Envoi du logo…',
    logoSaved: 'Le logo est enregistré.',
    logoRemoved: 'Le logo est retiré.',
    customAmbianceCreate: 'Créer mon ambiance (Sur mesure)',
    customAmbianceEdit: 'Modifier mon ambiance',
    customAmbianceTitle: 'Votre ambiance Sur mesure',
    customAmbianceCrumb: 'Sur mesure',
    customAmbianceIntro:
      'Choisissez un fond clair ou foncé, sa teinte, votre couleur d’accent et une typographie. Les aperçus montrent les vrais écrans avec vos choix, et rien n’est enregistré avant « Enregistrer ».',
    customGround: 'Fond',
    customGroundNames: { light: 'Clair', dark: 'Foncé' } satisfies Record<ThemeGround, string>,
    customGroundHue: 'Teinte du fond',
    customGroundHueHint:
      'De 0° à 359° : seule la teinte se choisit, la clarté est fixée pour que tout reste lisible.',
    customAccentHue: 'Couleur d’accent',
    customAccentHueHint:
      'Toutes les teintes sont permises, y compris celles qui rappellent le vert, le jaune ou le rouge de l’application : le texte du bouton reste lisible sur chacune, et une alerte garde toujours une icône et un mot.',
    customFaces: 'Typographie',
    customFacesHint:
      'Les polices et les angles des boutons de l’une des six ambiances, chacune montrée dans sa propre police.',
    customPreview: 'Aperçu',
    customPreviewHint:
      'Illustration de ce que verront vos invités et la salle, avec des photos d’exemple.',
    customPreviewPhone: 'Écran de vos invités',
    customPreviewWall: 'Écran de la salle',
    customPreviewCaption: 'Quelle belle soirée !',
    customPreviewAuthor: 'Léa',
    customKept:
      'Votre choix est conservé tel que vous l’avez laissé : modifiez-le, puis enregistrez à nouveau.',
    customSaved: 'Votre ambiance est enregistrée.',
  },

  /** The guestbook, host side (spec 01). What guests write is never translated. */
  guestbookHost: {
    title: 'Livre d’or',
    hint: 'Les mots laissés par vos invités. Ils s’affichent à l’écran selon vos réglages.',
    empty: 'Aucun message pour l’instant.',
    anonymous: 'Invité sans nom',
    pending: (count: number) =>
      t.count(count, {
        one: '1 en attente',
        other: `${t.number(count)} en attente`,
      }),
    statusPending: 'En attente',
    statusPublished: 'À l’écran',
    statusRejected: 'Non retenu',
    statusHidden: 'Retiré de l’écran',
    copyId: 'Copier l’identifiant',
    idCopied: 'Identifiant copié.',
    copyFailed: 'Copie impossible : sélectionnez l’identifiant à la main.',
    openMessages: 'Modérer les messages',
    onWall: (count: number) => `${t.number(count)} à l’écran`,
  },

  /**
   * The voice messages in the host's console and settings (spec 25): the card, the secret, the
   * action that keeps what waits, and the settings section. What a guest says is never here.
   * The interface says "gardé secret" / "kept secret", never the code's word for it. Never "IA",
   * "intelligent" or "transcription" in a sentence of this table.
   */
  guestbookVoiceHost: {
    cardLabel: (author: string, duration: string) => `Message vocal de ${author}, ${duration}`,
    duration: (duration: string) => `Durée : ${duration}`,
    voiceBadge: 'Message vocal',
    processing: 'En traitement',
    processingCount: (count: number) =>
      t.count(count, {
        one: '1 message vocal en traitement',
        other: `${t.number(count)} messages vocaux en traitement`,
      }),
    sealedCard: 'Gardé secret jusqu’à la fin de la soirée',
    sealedCardReveal: 'Gardé secret jusqu’à la révélation de la soirée',
    sealedUntil: (time: string) => `Gardé secret jusqu’à ${time}`,
    sealedUntilOrReveal: (time: string) =>
      `Gardé secret jusqu’à ${time}, ou jusqu’à la révélation de la soirée si elle vient avant`,
    notListened: 'Vous n’avez pas écouté ce message',
    cannotHide: 'Un message vocal ne se masque pas : il n’est jamais à l’écran.',
    keepPending: (count: number) =>
      t.count(count, {
        one: 'Garder le message en attente',
        other: `Garder les ${t.number(count)} messages en attente`,
      }),
    keepConfirm: 'Vous n’avez pas écouté tous ces messages. Les garder dans l’album ?',
    keepConfirmLabel: 'Les garder',
    kept: (count: number) =>
      t.count(count, {
        one: '1 message vocal gardé.',
        other: `${t.number(count)} messages vocaux gardés.`,
      }),
    settingsEnabled: 'Messages vocaux',
    settingsEnabledHint:
      'Allumer les messages vocaux en cours de soirée fait relire la notice à chaque invité avant son prochain envoi : mieux vaut les allumer avant.',
    settingsSealed: 'Garder les messages vocaux secrets jusqu’à la fin de la soirée',
    settingsSealedReveal: 'Garder les messages vocaux secrets jusqu’à la révélation',
    settingsSealedHint:
      'Vous ne pourrez pas les écouter avant. Vous pouvez quand même décider de les garder ou de les refuser.',
    settingsSealedRevealHint:
      'Comme la révélation est activée, ils s’ouvrent quand vous révélez la soirée, ou à sa fin. Vous ne pourrez pas les écouter avant. Vous pouvez quand même décider de les garder ou de les refuser.',
    openNow: 'Ouvrir maintenant',
    openConfirmTitle: 'Ouvrir les messages vocaux ?',
    openConfirmBody: 'Vous pourrez les écouter dès maintenant. Cette action est définitive.',
    opened: 'Les messages vocaux sont ouverts.',
    insecure: 'Cette adresse n’est pas sécurisée : vos invités ne pourront pas enregistrer',
  },

  /* ---- Added by spec 31: signing up for an account by oneself. ---- */
  signup: {
    title: 'Créer un compte',
    intro:
      'Une adresse, le nom de votre espace, et un lien de confirmation vous attend dans votre boîte.',
    clientName: 'Nom de votre espace',
    clientNameHint:
      'Par exemple «\u00a0Mariage de Léa et Hugo\u00a0» ou «\u00a0Association Les Pieds Agiles\u00a0». 80 caractères au plus.',
    clientNameMissing: 'Donnez un nom à votre espace.',
    note: 'Pour quelle occasion\u00a0?',
    noteHint:
      'Quelques mots sur votre évènement. 300 caractères au plus. N’indiquez rien de sensible (santé, religion…)\u00a0: ce texte sert seulement à ouvrir votre compte.',
    eventDate: 'Date de l’évènement',
    eventDateOutOfRange: 'Indiquez une date comprise entre hier et dans deux ans.',
    submit: 'Créer mon compte',
    notice:
      'Votre adresse sert seulement à vous écrire pour ce compte. La demande est effacée dès qu’elle aboutit, et au plus tard 60\u00a0jours après l’envoi.',
    unavailable: 'L’inscription n’est pas ouverte sur ce serveur.',
    haveAccount: 'Vous avez déjà un compte\u00a0?',
    loginPrompt: 'Pas encore de compte\u00a0?',
    loginLink: 'Créer un compte',
    sentTitle: 'Regardez votre boîte',
    sent: 'Un lien pour confirmer votre adresse vous attend (valable 24\u00a0h). Rien reçu\u00a0? Vérifiez les indésirables.',
    busyTitle: 'Beaucoup de demandes aujourd’hui',
    busy: 'Beaucoup de demandes aujourd’hui, revenez demain.',
    confirmTitle: 'Confirmer votre adresse',
    confirmIntro: (email: string) =>
      `Vous vous inscrivez avec ${email}. Appuyez sur le bouton pour confirmer cette adresse.`,
    confirmSubmit: 'Confirmer mon adresse',
    reviewTitle: 'Adresse confirmée',
    reviewDone:
      'Merci, votre adresse est confirmée. Je valide chaque compte à la main, en général dans la journée. Vous recevrez un mail avec le lien pour choisir votre mot de passe.',
    mailTitle: 'Votre compte est ouvert',
    mailDone:
      'Votre compte est ouvert\u00a0: le lien pour choisir votre mot de passe arrive dans votre boîte.',
    pendingTitle: 'Adresse confirmée',
    pendingDone:
      'Votre adresse est confirmée. J’ouvre votre compte dès que possible, vous recevrez un mail.',
    spentTitle: 'Ce lien a déjà servi',
    spent:
      'Votre adresse est donc déjà confirmée\u00a0: vous recevrez un mail dès que votre compte est prêt.',
    expiredTitle: 'Ce lien a expiré',
    expired:
      'Un lien de confirmation vaut 24 h. Recommencez l’inscription pour en recevoir un nouveau.',
    restart: 'Recommencer l’inscription',
  },
  auth: {
    title: 'Connexion',
    email: 'Adresse e-mail',
    password: 'Mot de passe',
    submit: 'Se connecter',
    logout: 'Se déconnecter',
    changePassword: 'Changer de mot de passe',
    currentPassword: 'Mot de passe actuel',
    newPassword: 'Nouveau mot de passe',
    newPasswordHint: (min: number) =>
      `Au moins ${min} caractères. Une phrase est plus sûre qu’un mot.`,
    confirmPassword: 'Confirmer le nouveau mot de passe',

    /* ---- Added by features/auth. ---- */
    changePasswordIntro: 'Choisissez un mot de passe que vous n’utilisez pas ailleurs.',
    passwordSaved: 'Mot de passe enregistré.',
    // The refusal of a prompt that asks for the password and nothing else (change it, confirm
    // oneself, set up the second factor): the address is already known there, so naming it
    // would make a wrong password read as a wrong account.
    passwordIncorrect: 'Mot de passe incorrect.',
    deleteAccount: 'Supprimer mon compte',
    deleteAccountIntro:
      'Votre adresse, votre mot de passe et vos accès sont effacés. Vos évènements, s’il vous en reste, doivent d’abord être supprimés ou confiés à quelqu’un d’autre. Il restera, au plus quelques jours, les sessions déjà ouvertes, et dans le journal d’audit des lignes anonymes : un identifiant qui ne renvoie plus à personne, sans votre nom ni votre adresse. Cette action est définitive.',
    deleteAccountConfirm: 'Entrez votre mot de passe pour confirmer.',
    deleteAccountSubmit: 'Supprimer définitivement mon compte',
    deleteAccountDone: 'Votre compte est supprimé.',
    deleteAccountCode: 'Code de votre application d’authentification',
    deleteAccountCodeHint:
      'À remplir seulement si vous avez activé un second facteur ; sinon, laissez vide.',
    deleteAccountHoldsEvents:
      'Vous possédez encore au moins un évènement. Supprimez-le ou confiez-le à quelqu’un d’autre, puis réessayez. Besoin d’aide ? Contactez l’opérateur du site.',
    deleteAccountHoldsMedia:
      'Vous avez déposé des photos ou des vidéos dans un évènement : votre compte ne peut pas être supprimé en libre-service. Contactez l’opérateur du site.',
    deleteAccountHoldsReviews:
      'Vous avez modéré des photos : votre compte ne peut pas être supprimé en libre-service. Contactez l’opérateur du site.',
    deleteAccountLastOwner:
      'Vous êtes le seul propriétaire de votre espace, qui compte encore des membres ou des évènements. Ajoutez un autre propriétaire, ou contactez l’opérateur du site.',

    /* ---- Added by G2-13: the second factor. ---- */
    secondFactorTitle: 'Vérification en deux étapes',
    secondFactorIntro:
      'Saisissez le code à six chiffres affiché par votre application d’authentification.',
    secondFactorCode: 'Code à six chiffres',
    secondFactorSubmit: 'Vérifier',
    secondFactorRecoveryToggle: 'Utiliser un code de secours',
    secondFactorAppToggle: 'Utiliser le code de l’application',
    secondFactorRecoveryIntro:
      'Saisissez l’un des codes de secours remis lors de l’activation. Chacun ne sert qu’une fois.',
    recoveryCode: 'Code de secours',
    secondFactorRestart: 'Recommencer avec le mot de passe',
    securityTitle: 'Sécurité du compte',
    /** The account menu's entry and the page's title: the page also holds the e-mail switches (spec 32). */
    securityMenu: 'Sécurité et e-mails',
    mailPreferences: {
      title: 'E-mails',
      intro:
        'Les e-mails que ce serveur vous écrit au sujet de vos évènements. Ils ne portent que des chiffres et vos propres mots, jamais le nom, le régime ou le mot d’un invité.',
      rsvpLabel: 'Les réponses des invités',
      rsvpHint:
        'Le rappel avant la date limite, le récapitulatif après la date limite et « tout est complet ». Le résumé quotidien se coche évènement par évènement, sur la page des réponses.',
      eventLabel: 'La vie de vos évènements',
      eventHint:
        'Une archive, un livre photo ou un film prêt, la fin d’un évènement avec ses chiffres, le mur qui va se fermer dans la journée, une invitation acceptée.',
      always:
        'Quoi que vous cochiez ici, vous recevez toujours les e-mails de sécurité de votre compte (mot de passe, vérification en deux étapes, compte désactivé ou supprimé) et l’avertissement avant l’effacement des réponses.',
      failed: 'Le choix n’a pas pu être enregistré. Réessayez dans un instant.',
    },
    securityUnavailable:
      'Ce serveur n’a pas de clé de chiffrement pour la vérification en deux étapes. Demandez à son administrateur de la configurer.',
    setupIntro:
      'Une application d’authentification (Aegis, 1Password, Google Authenticator…) génère un code à six chiffres qui s’ajoute à votre mot de passe.',
    setupStart: 'Activer la vérification',
    setupScan:
      'Scannez ce QR code avec votre application. Sans caméra, saisissez la clé à la main.',
    setupQrLabel: 'QR code de configuration',
    setupKeyLabel: 'Clé de configuration',
    setupConfirm: 'Confirmer',
    recoveryCodesTitle: 'Codes de secours',
    recoveryCodesIntro:
      'Si vous perdez votre téléphone, chacun de ces dix codes vous ouvre la porte une fois. Notez-les maintenant : ils ne seront plus affichés.',
    recoveryCodesCopy: 'Copier les codes',
    recoveryCodesCopied: 'Codes copiés.',
    recoveryCodesCopyFailed:
      'Copie impossible ici : sélectionnez les codes et copiez-les vous-même.',
    recoveryCodesSaved: 'J’ai noté mes codes',
    securityEnabled: 'La vérification en deux étapes est active sur ce compte.',
    securityManageIntro:
      'Pour renouveler vos codes de secours ou désactiver la vérification, confirmez d’abord votre identité.',
    stepUpSubmit: 'Confirmer mon identité',
    stepUpDone: 'Identité confirmée pour cinq minutes.',
    recoveryCodesRegenerate: 'Générer de nouveaux codes de secours',
    secondFactorDisable: 'Désactiver la vérification',
    secondFactorDisabled: 'Vérification en deux étapes désactivée.',

    /* ---- Added by G2-10: the invitation page, the reset by e-mail and the account menu. ---- */
    invitationTitle: 'Invitation',
    invitationToModerate: (name: string) =>
      `Vous avez reçu une invitation à modérer l’évènement « ${name} ».`,
    invitationToOwn: (name: string) =>
      `Vous avez reçu une invitation à créer et gérer les évènements de « ${name} ».`,
    invitationToJoin: (name: string) =>
      `Vous avez reçu une invitation à rejoindre l’équipe de « ${name} ».`,
    invitationExpires: (when: string) => `Valable jusqu’au ${when}.`,
    invitationChoose:
      'Choisissez votre nom et un mot de passe : votre compte est créé en validant ce formulaire.',
    invitationName: 'Votre nom',
    invitationNameHint: 'Il s’affiche dans la liste des personnes qui ont accès.',
    invitationConfirmPassword: 'Confirmer le mot de passe',
    invitationSubmit: 'Créer mon compte et accepter',
    invitationAccepted: 'Invitation acceptée.',
    invitationHaveAccount: 'Vous avez déjà un compte ?',
    invitationSignedInAs: (email: string) => `Vous êtes connecté avec ${email}.`,
    invitationAcceptAs: 'Accepter avec ce compte',
    invitationUseAnother: 'Utiliser un autre compte',
    /* ---- Added by G2-20: the terms of use an invitation's acceptance agrees to. ---- */
    invitationAcceptTerms: (version: string) =>
      `J’accepte les conditions d’utilisation (version ${version}), dont les clauses de sous-traitance.`,
    invitationReadTerms: 'Lire les conditions d’utilisation',
    /** The title of every dead link, invitation or reset: one sentence, whatever killed it. */
    deadLinkTitle: 'Ce lien n’est pas valable',
    forgotLink: 'Mot de passe oublié ?',
    forgotTitle: 'Mot de passe oublié',
    forgotIntro:
      'Saisissez l’adresse e-mail de votre compte. Si un compte l’utilise, vous recevrez un lien pour choisir un nouveau mot de passe.',
    forgotSubmit: 'Envoyer le lien',
    forgotSentTitle: 'Consultez votre messagerie',
    forgotSent:
      'Si un compte utilise cette adresse, un message avec un lien vient d’être envoyé. Le lien est valable une heure et ne sert qu’une fois.',
    forgotUnavailable:
      'Ce serveur ne peut pas envoyer d’e-mail : le mot de passe ne peut pas y être réinitialisé de cette façon. Demandez à la personne qui l’administre.',
    backToLogin: 'Retour à la connexion',
    resetTitle: 'Nouveau mot de passe',
    resetIntro:
      'Choisissez un mot de passe que vous n’utilisez pas ailleurs. Vous serez déconnecté de tous vos appareils.',
    resetSubmit: 'Changer le mot de passe',
    resetDoneTitle: 'Mot de passe changé',
    resetDone:
      'Toutes vos sessions ont été fermées. Connectez-vous avec votre nouveau mot de passe.',
    resetAskAgain: 'Demander un nouveau lien',
    accountMenu: 'Compte',
    accountSignedInAs: (email: string) => `Connecté en tant que ${email}`,
    logoutEverywhere: 'Se déconnecter partout',
    logoutEverywhereTitle: 'Se déconnecter partout ?',
    logoutEverywhereHint:
      'Votre session sera fermée sur tous vos appareils, celui-ci compris, et il faudra vous reconnecter. Utile si vous avez perdu un appareil ou utilisé un ordinateur partagé.',

    /* ---- Navigation pass, batch D: accounts and sign-in. ---- */
    alreadySignedIn: 'Vous êtes déjà connecté. Redirection…',
    forgotNoMail:
      'Mot de passe oublié ? Ce serveur n’envoie pas d’e-mail : demandez à la personne qui l’administre de le réinitialiser.',
    changePasswordForced:
      'Votre mot de passe a été choisi pour vous : remplacez-le avant d’aller plus loin. Vous reviendrez ensuite là où vous alliez.',
    menuMustChange:
      'Changez d’abord votre mot de passe : le reste de votre espace est fermé jusque-là.',
    securityBack: 'Retour',
    secondFactorEnabled: 'Vérification en deux étapes activée.',
    recoveryCodesLeaveTitle: 'Quitter sans avoir noté vos codes ?',
    recoveryCodesLeaveHint:
      'Ces codes ne s’affichent qu’une fois : en quittant cette page, vous ne pourrez plus les relire. Pour en obtenir de nouveaux, il faudra confirmer de nouveau votre identité.',
    recoveryCodesLeaveStay: 'Rester et noter mes codes',
    recoveryCodesLeaveGo: 'Quitter quand même',
    deadInvitationSignIn: 'Si vous l’avez déjà acceptée, votre compte existe : connectez-vous.',
    deadInvitationSignedIn:
      'Vous êtes déjà connecté : si vous l’aviez acceptée avec ce compte, vos évènements s’y trouvent.',
  },

  /**
   * Server error codes to French. The key is the `error.code` the API returns.
   *
   * Each message says what the reader can do next. `unknown` is the fallback and is
   * deliberately vague about internals — a stack trace or a SQL fragment never reaches
   * a guest's phone.
   */
  errors: {
    /* ---- Added by features/site: codes the operator’s console can receive. ---- */
    'clientName.empty': 'Donnez un nom au client.',
    'clientName.tooLong': 'Ce nom est trop long.',
    'clientName.invalid': 'Ce nom contient un caractère qui n’est pas accepté.',
    'clientCeilings.maxEventsInvalid': 'Ce nombre d’évènements n’est pas accepté.',
    'clientCeilings.maxEventsPerPeriodInvalid':
      'Ce nombre d’évènements par période n’est pas accepté.',
    'clientCeilings.maxTotalBytesInvalid': 'Ce stockage total n’est pas accepté.',
    'clientCeilings.maxEventQuotaBytesInvalid': 'Ce quota d’évènement n’est pas accepté.',
    'clientCeilings.maxRetentionDaysInvalid':
      'Cette durée de conservation n’est pas acceptée : de 1 à 3 650 jours.',
    'clientCeilings.maxLiveDaysInvalid':
      'Cette durée d’évènement en cours n’est pas acceptée : de 1 à 365 jours.',
    'clientCeilings.periodStartedAtInvalid': 'Ce début de période n’est pas accepté.',
    'clientCeilings.clipsAllowedInvalid': 'Ce réglage des vidéos n’est pas accepté.',
    'clientCeilings.channelsAllowedInvalid': 'Ce réglage des messageries n’est pas accepté.',
    'clientCeilings.booksAllowedInvalid': 'Ce réglage des livres photo n’est pas accepté.',
    'clientCeilings.liveAllowedInvalid': 'Ce réglage d’ouverture n’est pas accepté.',
    'siteLookup.queryInvalid':
      'Saisissez un identifiant, un code, une adresse ou un nom d’évènement (300 caractères au plus).',
    'audit.reasonInvalid':
      'Le motif doit tenir sur une ligne de 200 caractères au plus, sans adresse e-mail.',
    'reset.mailerRequired':
      'Cette instance n’envoie pas de courrier : aucun lien de réinitialisation ne peut être émis.',
    'reset.mailNotSent': 'Le serveur de messagerie a refusé le message. Aucun lien n’a été émis.',
    'reset.approverUnavailable':
      'Ce compte n’appartient à aucun client, ou à plusieurs : aucun propriétaire ne peut approuver la demande.',
    'reset.requestNotFound': 'Cette demande n’existe pas, ou n’a pas encore été approuvée.',
    'reset.tooManyForAddress':
      'Cette adresse a déjà reçu plusieurs réinitialisations. Réessayez dans une heure.',
    'account.disabled': 'Ce compte est désactivé.',
    'account.operatorProtected': 'Le compte d’un opérateur ne peut être ni désactivé ni supprimé.',
    'account.holdsEvents': 'Ce compte possède un évènement : transférez-le ou purgez-le d’abord.',
    'account.holdsMedia':
      'Ce compte a déposé des photos ou des vidéos, dont les fichiers resteraient sur le disque.',
    'account.holdsReviews': 'Ce compte a modéré des photos, dont les lignes portent son nom.',
    'account.lastClientOwner':
      'Ce compte est le seul propriétaire d’un client qui a encore des membres ou des évènements : ajoutez un propriétaire, ou mettez fin à l’engagement du client.',
    'client.graceInvalid': 'Ce délai n’est pas accepté. Indiquez un nombre entier de jours.',
    'client.offboarding':
      'La fin d’engagement de ce client est en cours : sa suspension ne se lève pas.',
    unknown: 'Une erreur est survenue. Réessayez dans un instant.',
    network: 'Connexion interrompue. Vérifiez votre réseau puis réessayez.',
    'request.invalid': 'Les informations envoyées ne sont pas valides.',

    'auth.invalidCredentials': 'Adresse e-mail ou mot de passe incorrect.',
    'auth.required': 'Connectez-vous pour continuer.',
    'auth.forbidden': 'Vous n’avez pas les droits pour cette action.',
    'auth.passwordChangeRequired': 'Choisissez un nouveau mot de passe avant de continuer.',
    'auth.invalidToken': 'Ce lien n’est plus valable. Demandez-en un nouveau.',
    'auth.invalidSecondFactor':
      'Ce code n’est pas valable. Attendez le suivant dans votre application, ou utilisez un code de secours.',
    'auth.secondFactorExpired': 'Cette connexion a expiré. Recommencez avec votre mot de passe.',
    'auth.tooManySecondFactorAttempts': 'Trop de codes erronés. Réessayez dans un quart d’heure.',
    'auth.secondFactorRequired': 'Ce compte doit d’abord passer la vérification en deux étapes.',
    'auth.stepUpRequired': 'Confirmez votre identité pour continuer.',
    'signup.notPending': 'Cette demande a déjà été traitée.',
    'signup.notFound': 'Cette demande n’existe plus.',
    'auth.secondFactorAlreadyEnrolled':
      'La vérification en deux étapes est déjà active sur ce compte.',
    'auth.noEnrolmentInProgress': 'Aucune activation n’est en cours. Recommencez.',
    'auth.secondFactorUnavailable':
      'Ce serveur ne peut pas vérifier le code de l’application pour le moment. Utilisez un code de secours.',
    'auth.totpCodeInvalid': 'Saisissez les six chiffres affichés par l’application.',
    'auth.secondFactorNotEnrolled':
      'La vérification en deux étapes n’est pas active sur ce compte.',
    'feature.unavailable': 'Cette fonction n’est pas disponible sur ce serveur.',

    'event.notFound': 'Ce code ne correspond à aucune soirée ouverte.',
    'event.notAcceptingUploads': 'Cette soirée n’accepte plus de photos.',
    'event.quotaExceeded': 'La soirée a atteint sa capacité. Prévenez l’organisateur.',
    'event.slugUnavailable': 'Cette adresse est déjà utilisée.',
    'event.customSlugNotAllowed': 'Cette instance ne permet pas de choisir sa propre adresse.',
    'event.creationRateLimited': 'Vous avez créé trop d’évènements récemment. Réessayez plus tard.',
    'event.quotaAboveCeiling': 'Ce quota dépasse la limite que ce serveur autorise.',
    'event.creationNotAllowed': 'Votre compte ne peut pas créer d’évènement sur ce serveur.',
    'client.notFound': 'Ce compte client est introuvable.',
    'client.ownerRequired': 'Seul un propriétaire du compte peut consulter cette page.',
    'client.ceilingReached': 'Votre compte a atteint le nombre d’évènements autorisé.',
    'client.storageFull': 'La soirée a atteint sa capacité. Prévenez l’organisateur.',
    'client.liveNotAllowed': 'Votre compte ne peut pas ouvrir d’évènement pour le moment.',
    'client.liveWindowOver':
      'La durée d’ouverture de cet évènement est écoulée : il ne peut plus être rouvert.',
    'client.retentionAboveCeiling':
      'Cette durée de conservation dépasse celle que votre compte autorise.',
    'client.clipsNotAllowed': 'Les vidéos ne sont pas disponibles pour cette soirée.',
    'event.immutable': 'Cet évènement est archivé et ne peut plus être modifié.',
    'event.illegalTransition': 'Ce changement d’état n’est pas possible.',

    'guest.revoked': 'Votre accès a été retiré par l’organisateur.',
    'guestToken.expired': 'Votre accès a expiré. Scannez à nouveau le QR code.',
    'guestToken.malformed': 'Votre accès n’est plus valide. Scannez à nouveau le QR code.',
    'guestToken.badSignature': 'Votre accès n’est plus valide. Scannez à nouveau le QR code.',

    'photo.notFound': 'Cette photo n’existe plus.',
    'photo.illegalTransition': 'Cette action n’est pas possible sur cette photo.',
    'highlight.notPublished': 'Seule une photo publiée peut être mise en favori.',
    'highlight.empty': 'Aucun favori pour l’instant.',
    'book.alreadyRunning': 'Un livre est déjà en préparation.',
    'book.empty': 'Aucune photo publiée pour l’instant : il n’y a pas de livre à faire.',
    'book.dailyLimitReached':
      'Vous avez atteint la limite de livres pour aujourd’hui. Réessayez demain.',
    'book.unavailable': 'Les livres photo sont indisponibles pour le moment.',
    'book.notAllowed': 'Votre espace n’inclut pas les livres photo.',
    'book.notFound': 'Ce livre n’est plus disponible. Refaites-le.',
    'book.titleEmpty': 'Donnez un titre au livre.',
    'book.titleTooLong': 'Ce titre est trop long.',
    'book.subtitleTooLong': 'Ce sous-titre est trop long.',
    'export.alreadyRunning': 'Une archive est déjà en préparation.',
    'export.notClosed': 'L’archive se prépare une fois l’évènement terminé.',
    'export.noRoom':
      'Le serveur n’a pas assez de place pour préparer l’archive. Téléchargez l’album directement, ou prévenez l’exploitant.',
    'export.tooLarge':
      'L’archive dépasserait la taille que le serveur accepte de préparer. Téléchargez l’album directement.',
    'export.dailyLimitReached':
      'La limite d’archives préparées par jour est atteinte pour cet évènement. Réessayez demain, ou téléchargez l’album directement.',
    'export.unavailable':
      'La préparation d’archives est désactivée sur ce serveur. Téléchargez l’album directement.',
    'export.notFound': 'Cette archive n’est plus disponible. Préparez-la de nouveau.',
    'reel.notEnoughPhotos': 'Il faut au moins trois favoris publiés pour faire un montage.',
    'reel.tooManyPhotos': 'Trop de favoris pour un montage : retirez-en quelques-uns.',
    'reel.alreadyRunning': 'Un montage est déjà en cours.',
    'reel.queueFull': 'Beaucoup de montages sont en attente. Réessayez dans quelques minutes.',
    'reel.notAllowed': 'Le montage vidéo n’est pas inclus dans votre offre.',
    'reel.transcoderUnavailable': 'Le montage vidéo n’est pas disponible sur ce serveur.',
    'reel.notReady': 'Le montage n’est pas prêt.',
    'reel.eventUnavailable': 'Cet évènement n’est plus disponible.',
    'reel.renderFailed': 'Le montage n’a pas pu être fait. Réessayez.',
    'reel.storageFailed': 'Le montage n’a pas pu être enregistré. Réessayez.',
    'reel.timedOut': 'Le montage a pris trop de temps. Réessayez.',
    'reel.cancelled': 'Le montage a été interrompu. Réessayez.',

    'image.unsupportedFormat':
      'Ce fichier n’est pas une photo. Formats acceptés : JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'Cette photo semble abîmée. Essayez-en une autre.',
    'image.animated': 'Les images animées ne sont pas acceptées.',
    'image.renderFailed': 'Cette photo n’a pas pu être traitée. Essayez-en une autre.',
    'image.renderUnavailable':
      'Cette photo n’a pas pu être traitée pour l’instant : le serveur est momentanément indisponible. Réessayez dans un instant.',
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
    'logo.tooLarge': 'Ce logo est trop lourd, même réduit. Essayez-en un autre.',
    'logo.notFound': 'Ce logo n’existe plus.',
    'logo.saveFailed': 'Le logo n’a pas pu être enregistré. Réessayez.',
    'eventSettings.welcomeInvalid': 'Ce message n’est pas valide.',
    'eventSettings.welcomeTooLong': 'Ce message est trop long.',
    'eventSettings.welcomeTooManyLines': 'Ce message compte trop de lignes.',
    'eventSettings.saveFailed': 'Les réglages n’ont pas pu être enregistrés. Réessayez.',
    'eventSettings.revealInPast': 'L’heure de la révélation doit être dans le futur.',
    'eventSettings.revealDone':
      'La soirée est déjà révélée : l’heure ne peut plus être déplacée ni effacée.',
    'eventSettings.revealInstantInvalid': 'Cette heure de révélation n’est pas valide.',
    'eventSettings.graceSecondsInvalid': 'Ce délai de suppression n’est pas accepté.',
    'eventSettings.retentionDaysInvalid': 'Ce délai de conservation n’est pas accepté.',
    'eventSettings.maxPhotosPerGuestInvalid': 'Ce nombre de photos par invité n’est pas accepté.',
    // The picker offers only the five the build carries, so a host meets this through the
    // API or a tab left open across a deploy that removed one.
    'wallMixed.wallTooShort':
      'La durée sur le mur doit être comprise entre 30 secondes et 60 minutes.',
    'wallMixed.wallTooLong':
      'La durée sur le mur doit être comprise entre 30 secondes et 60 minutes.',
    'wallMixed.slideshowTooShort':
      'La durée du diaporama doit être comprise entre 15 secondes et 30 minutes.',
    'wallMixed.slideshowTooLong':
      'La durée du diaporama doit être comprise entre 15 secondes et 30 minutes.',
    'eventSettings.wallLanguageInvalid':
      'Cette langue n’est pas disponible. Choisissez-en une dans la liste.',
    'email.malformed': 'Cette adresse e-mail n’est pas valide.',
    'user.notFound': 'Aucun compte ne correspond à cette adresse e-mail.',
    'membership.alreadyExists': 'Cette personne modère déjà cet évènement.',
    'invitation.tooManyForAddress':
      'Cette adresse a déjà reçu plusieurs invitations. Réessayez dans une heure.',
    'invitation.notFound':
      'Cette invitation n’est plus valable. Demandez-en une nouvelle à la personne qui vous l’a envoyée.',
    'invitation.signInRequired':
      'Un compte utilise déjà l’adresse de cette invitation. Connectez-vous avec ce compte : vous reviendrez ici pour accepter.',
    'terms.notAccepted': 'Pour continuer, cochez la case qui accepte les conditions d’utilisation.',
    'invitation.wrongAccount':
      'Cette invitation est destinée à une autre adresse e-mail que celle de ce compte.',
    'invitation.credentialsRequired':
      'Connectez-vous avec le compte invité, ou choisissez un nom et un mot de passe.',
    'accountName.empty': 'Indiquez votre nom.',
    'accountName.tooLong': 'Ce nom est trop long.',

    'displayName.tooLong': 'Prénom trop long.',
    // Not "six caractères": JOIN_CODE_LENGTH is configurable (6 à 10), so the one thing
    // true on every deployment is that this code does not have the right length.
    'joinCode.wrongLength': 'Ce code n’a pas le bon nombre de caractères.',
    'joinCode.malformed': 'Ce code contient un caractère inattendu.',

    'reaction.rateLimited': 'Doucement — attendez un instant avant de réagir à nouveau.',
    'rate.limited': 'Trop de tentatives. Patientez un instant.',

    /* ---- Codes docs/API.md documents that had no copy of their own yet. Each one
            reached a guest as the generic `unknown` sentence, which told them nothing
            about a refusal the host had deliberately configured. ---- */
    'event.captionsNotAllowed': 'Les légendes ne sont pas activées pour cette soirée.',
    'event.reactionsDisabled': 'Les réactions ne sont pas activées pour cette soirée.',
    'event.guestSelfDeleteDisabled':
      'L’organisateur ne permet pas aux invités de supprimer leurs photos.',
    'photo.captionEditForbidden': 'Cette légende ne peut plus être modifiée.',
    'photo.deleteForbidden': 'Vous ne pouvez plus supprimer cette photo vous-même.',
    'reaction.alreadyExists': 'Vous avez déjà réagi ainsi à cette photo.',
    'reaction.notPublished': 'Cette photo n’est pas encore à l’écran.',
    'reaction.notFound': 'Cette réaction n’existe plus.',
    'reaction.ownPhoto': 'Vous ne pouvez pas réagir à votre propre photo.',
    'upload.noFiles': 'Aucune photo n’a été reçue. Sélectionnez-en une puis réessayez.',
    'upload.unexpectedField': 'Cet envoi n’a pas pu être lu. Réessayez.',
    // The page's CSRF cookie is gone or stale — a tab left open all evening, or a
    // reverse proxy that dropped it. Reloading re-issues it, so that is the advice.
    'request.csrfMissing': 'Cette page a expiré. Rechargez-la puis réessayez.',
    'request.csrfMismatch': 'Cette page a expiré. Rechargez-la puis réessayez.',

    /* ---- Codes the use cases answer with that docs/API.md names only in passing or
            does not list. `event.photoLimitReached` is the important one: it is the
            per-guest cap, the only refusal a host deliberately configures, and without
            its own sentence it reaches the guest as the generic one. ---- */
    'event.photoLimitReached': 'Vous avez atteint le nombre de photos autorisé.',
    'photo.pixelBudgetExceeded': 'Cette photo est trop grande. Réduisez-la puis réessayez.',
    'upload.rejected': 'Cet envoi n’a pas pu être lu. Réessayez.',
    'event.notModeratable': 'Cet évènement est archivé : les décisions ne s’appliquent plus.',
    'membership.lastOwner': 'Un évènement doit garder au moins un organisateur.',
    'membership.notFound': 'Cette personne ne modère pas cet évènement.',
    'guest.notFound': 'Cet invité n’apparaît plus dans la liste. Actualisez la page.',

    /* ---- Added by the scheduled open and close (docs/ROADMAP.md §3.4). These live
            here and not in the `admin` block above because `messageForCode` resolves a
            server error code against `fr.errors` and nothing else. ---- */
    'event.scheduleOutOfOrder': 'La fin doit venir après l’ouverture.',
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
      'Cette couleur ressemble trop aux couleurs d’état de l’application. Choisissez une autre teinte.',

    /* ---- Added by the short video clips (docs/ROADMAP.md 1.4). They live here and not
            in a feature block because `messageForCode` resolves a server error code
            against `fr.errors` and nothing else.

            Two of them carry most of the weight. `clip.queueFull` must not read like
            `event.quotaExceeded` — the gallery is not full, the machine is busy for a
            minute — and `clip.transcoderUnavailable` must not read like
            `clip.unsupportedFormat`: the file is fine, this server cannot process it,
            and a guest told otherwise spends the evening trying other files. ---- */
    'event.clipsNotAllowed': 'Les vidéos ne sont pas activées pour cette soirée.',
    'clip.queueFull': 'Beaucoup de vidéos sont en cours de traitement. Réessayez dans une minute.',
    'clip.transcoderUnavailable':
      'Ce serveur ne peut pas traiter les vidéos. Prévenez l’organisateur.',
    'clip.unsupportedFormat': 'Ce fichier n’est pas une vidéo. Formats acceptés : MP4, MOV, WebM.',
    'clip.corrupt': 'Cette vidéo semble abîmée. Essayez-en une autre.',
    'clip.noVideoStream': 'Ce fichier ne contient pas d’image. Essayez-en un autre.',
    'clip.durationUnknown': 'La durée de cette vidéo est illisible. Essayez-en une autre.',
    'clip.tooShort': 'Cette vidéo est trop courte.',
    'clip.tooLong': 'Cette vidéo est trop longue. Filmez une séquence plus courte.',
    'clip.trimInvalid': 'Cet extrait n’est pas valable. Choisissez-en un autre.',
    'clip.trimOutOfRange': 'L’extrait choisi dépasse la fin de la vidéo. Choisissez-en un autre.',
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

    /* ---- Added by photo missions (ROADMAP 2.1). ---- */
    'mission.notFound': 'Cette mission n’existe plus. Rechargez la page.',
    'mission.duplicate': 'Cette mission existe déjà.',
    'mission.limitReached': 'Vous avez atteint le nombre de missions autorisé.',
    'mission.promptEmpty': 'Écrivez la consigne de la mission.',
    'mission.promptTooLong': 'Cette consigne est trop longue pour l’écran.',
    'mission.promptInvalid': 'Cette consigne n’est pas valide.',
    'challenge.alreadyRunning': 'Un défi est déjà en cours. Arrêtez-le avant d’en lancer un autre.',
    'challenge.limit': 'Cet évènement a atteint le nombre de défis autorisé.',
    'challenge.eventNotOpen': 'Un défi ne peut se lancer que pendant que l’évènement est ouvert.',
    'challenge.durationInvalid': 'Cette durée n’est pas valide.',
    'announcement.textInvalid': 'Écrivez le texte de l’annonce (80 caractères au plus).',
    'announcement.atInvalid': 'Cette heure est déjà passée. Utilisez « Lancer maintenant ».',
    'announcement.kindInvalid': 'Ce type d’annonce n’est pas valide.',
    'announcement.durationInvalid': 'Cette durée n’est pas valide pour ce type d’annonce.',
    'announcement.countdownInvalid': 'Ce compte à rebours n’est pas valide pour ce type d’annonce.',
    'announcement.notFound': 'Cette annonce n’existe plus. Rechargez la page.',
    'announcement.overlap': 'Une autre annonce est prévue à ce moment-là.',
    'announcement.showing': 'Une annonce est déjà à l’écran.',
    'announcement.locked': 'Cette annonce est à l’écran : retirez-la pour la corriger.',
    'announcement.limit': 'Vous avez atteint 50 annonces. Supprimez-en.',
    'announcement.eventNotOpen': 'L’évènement n’est pas ouvert : l’annonce ne sera pas montrée.',
    /* ---- Added by the shared gallery (ROADMAP 4.1). ---- */
    'gallery.notAvailable': 'Ce lien n’est plus disponible.',
    'gallery.passwordRequired': 'Cet album est protégé par un mot de passe.',
    'gallery.wrongPassword': 'Mot de passe incorrect.',
    'gallery.tooManyAttempts': 'Trop de tentatives. Réessayez dans un quart d’heure.',
    'gallery.cursorInvalid': 'La liste des photos a changé. Rechargez la page.',
    'shareLink.lifetimeInvalid': 'Choisissez une durée entre 1 et 90 jours.',

    /* ---- Added by the upload concurrency cap and the free-disk-space guard
            (G3-06 / P4-10). `upload.busy` clears in seconds — the client may retry at
            once — and must not read like `event.quotaExceeded`: the gallery is not
            full, the box is briefly busy. `storage.boxFull` is not the guest's fault
            and names no fix a guest could apply, unlike every other upload refusal
            above. ---- */
    'upload.busy': 'Beaucoup d’envois sont en cours. Réessayez dans un instant.',
    'storage.boxFull':
      'Il n’y a plus assez de place pour enregistrer ce fichier. Prévenez l’organisateur.',
    /* ---- The host's venue photograph (ADR 0010, decision 8). ---- */
    'venuePhoto.tooLarge': 'Cette photo est trop lourde, même réduite. Essayez-en une autre.',
    'venuePhoto.notFound': 'Cette photo n’existe plus.',
    'venuePhoto.saveFailed': 'La photo n’a pas pu être enregistrée. Réessayez.',
    /* ---- Added by spec 29: the host's invitation form. ---- */
    'guestInvite.titleTooLong': 'Ce titre est trop long\u00a0: 80 caractères au plus.',
    'guestInvite.titleInvalid': 'Ce titre n’est pas valide.',
    'guestInvite.venueTooLong': 'Ce nom de lieu est trop long\u00a0: 80 caractères au plus.',
    'guestInvite.venueInvalid': 'Ce nom de lieu n’est pas valide.',
    'guestInvite.addressTooLong': 'Cette adresse est trop longue\u00a0: 160 caractères au plus.',
    'guestInvite.addressTooManyLines': 'L’adresse tient sur deux lignes au plus.',
    'guestInvite.addressInvalid': 'Cette adresse n’est pas valide.',
    'guestInvite.messageTooLong': 'Votre mot est trop long\u00a0: 500 caractères au plus.',
    'guestInvite.messageTooManyLines': 'Votre mot tient sur huit lignes au plus.',
    'guestInvite.messageInvalid': 'Ce mot n’est pas valide.',
    'guestInvite.startsAtInvalid': 'Cette date de début n’est pas valide.',
    'guestInvite.endsAtInvalid': 'Cette date de fin n’est pas valide.',
    'guestInvite.endBeforeStart': 'La fin doit être après le début.',
    'guestInvite.tooLong': 'La fin doit tomber dans les 7 jours qui suivent le début.',
    'guestInvite.endNeedsStart': 'Ajoutez un début avant la fin.',
    'guestInvite.badTimeZone': 'Ce fuseau horaire n’est pas reconnu.',
    'guestInvite.timeZoneRequired': 'Choisissez le fuseau horaire de la fête.',
    'guestInvite.languageInvalid': 'Cette langue n’est pas proposée.',
    'guestInvite.needsDate': 'Ajoutez la date de début avant d’activer l’invitation.',
    'guestInvite.eventArchived':
      'L’évènement est archivé\u00a0: l’invitation ne peut plus changer.',
    'rsvp.notFound': 'Cette réponse n’existe plus.',
    'rsvp.closed': 'Les réponses sont closes.',
    'rsvp.off': 'L’organisateur ne demande pas de réponse pour l’instant.',
    'rsvp.tooMany': 'Cette invitation a atteint son nombre maximal de réponses.',
    'rsvp.inviteRequired': 'Enregistrez d’abord l’invitation.',
    'rsvp.nameEmpty': 'Indiquez votre prénom et nom.',
    'rsvp.nameInvalid': 'Ce nom n’est pas valide.',
    'rsvp.nameTooLong': 'Ce nom est trop long\u00a0: 60 caractères au plus.',
    'rsvp.answerInvalid': 'Choisissez une réponse.',
    'rsvp.maybeNotOffered': '«\u00a0Peut-être\u00a0» n’est pas proposé pour cette fête.',
    'rsvp.adultsRequired': 'Il faut au moins un adulte.',
    'rsvp.partyTooBig': 'Vous êtes trop nombreux pour ce formulaire.',
    'rsvp.countInvalid': 'Ce nombre de personnes n’est pas valide.',
    'rsvp.dietInvalid': 'Ce texte n’est pas valide.',
    'rsvp.dietTooLong': 'Ce texte est trop long\u00a0: 120 caractères au plus.',
    'rsvp.messageInvalid': 'Ce mot n’est pas valide.',
    'rsvp.messageTooLong': 'Ce mot est trop long\u00a0: 280 caractères au plus.',
    'rsvp.messageTooManyLines': 'Ce mot tient sur quatre lignes au plus.',
    'rsvp.enabledInvalid': 'Ce réglage n’est pas valide.',
    'rsvp.deadlineInvalid': 'Cette date limite n’est pas valide.',
    'rsvp.deadlineNeedsDate': 'Ajoutez d’abord la date de début de l’invitation.',
    'rsvp.deadlineAfterStart': 'La date limite ne peut pas dépasser le jour de la fête.',
    'rsvp.formInvalid': 'Ce réglage du formulaire n’est pas valide.',
    'rsvp.partyMaxInvalid': 'Le nombre de personnes va de 1 à 10.',
    'rsvp.companionsInvalid': 'Ces prénoms ne sont pas valides.',
    'rsvp.companionTooLong': 'Un prénom est trop long\u00a0: 40 caractères au plus.',
    'rsvp.companionsTooMany': 'Il y a trop de prénoms pour le nombre de personnes.',
    'rsvp.mealsInvalid': 'Ces menus ne sont pas valides\u00a0: de 2 à 6 menus, tous différents.',
    'rsvp.mealsTooMany': 'Il y a plus de menus que de personnes.',
    'rsvp.mealNotOffered':
      'Les menus ont changé\u00a0: la page vient d’être mise à jour. Choisissez à nouveau.',
    'rsvp.answersInvalid': 'Ces réponses ne sont pas valides.',
    'rsvp.answerTooLong': 'Une réponse est trop longue\u00a0: 120 caractères au plus.',
    'rsvp.answerNotAnOption':
      'Les choix ont changé\u00a0: la page vient d’être mise à jour. Choisissez à nouveau.',
    'rsvp.questionsInvalid':
      'Ces questions ne sont pas valides\u00a0: trois au plus, et de 2 à 6 choix pour une question à choix.',
    'rsvp.momentsInvalid':
      'Ces moments ne sont pas valides\u00a0: quatre au plus, tous différents.',
    'rsvp.momentsRequired': 'Choisissez au moins un moment.',
    'household.momentsInvalid': 'Ces moments ne sont pas valides pour ce foyer.',
    'rsvp.capacityInvalid': 'Le nombre de places va de 1 à 2000.',
    'rsvp.full':
      'Il ne reste pas assez de places pour ce nombre\u00a0: réduisez-le ou prévenez l’organisateur.',
    'household.nameEmpty': 'Indiquez un nom de foyer.',
    'household.nameInvalid': 'Ce nom de foyer n’est pas valide.',
    'household.nameTooLong': 'Ce nom est trop long\u00a0: 80 caractères au plus.',
    'household.placesInvalid': 'Le nombre de places va de 1 à 10.',
    'household.placesExceeded':
      'Cette réponse compte plus de personnes que le foyer n’a de places.',
    'household.tooMany': 'La liste est pleine\u00a0: 500 foyers au plus.',
    'household.notFound': 'Ce foyer n’existe plus.',
    'household.alreadyAnswered': 'Une autre réponse est déjà associée à ce foyer.',
    'household.importTooLong': 'La liste est trop longue\u00a0: 300 lignes au plus.',
    'household.importInvalid': 'Cette liste n’est pas valide.',
    'household.tokenInvalid': 'Ce lien de foyer n’est pas valide.',
    'guestInvite.notFound': 'Cette invitation n’existe pas encore. Enregistrez-la d’abord.',
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
    tourStep: (step: number, total: number) => `Étape ${step} sur ${total}`,
    tourNext: 'Suivant',
    tourPrevious: 'Précédent',
    tourSkip: 'Passer',
    tourFinish: 'Terminer',
    tourLater: 'Plus tard',
    tourStart: 'Faire le tour',
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
    /* Navigation pass, batch B: the way home from a 404 or a crash, and the expired-session banner. */
    hostHome: 'Aller à vos évènements',
    sessionExpired: 'Votre session a expiré.',
    sessionExpiredAction: 'Reconnectez-vous',
    crashAutoRetry: 'Nouvelle tentative automatique dans un instant…',
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
    // Navigation pass, batch C: the way to the other console.
    openConsole: 'Version complète, pour ordinateur',
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

    /* ---- Moderation traps pass (MOD-2). Keep additions inside this block. ---- */
    onScreenTitle: 'Dernières photos à l’écran',
    onScreenHint: 'Touchez une photo pour la retirer de l’écran.',
    onScreenEmpty: 'Rien à l’écran pour l’instant.',
    openOnScreen: (author: string) => `Voir la photo de ${author}, à l’écran`,
  },
  /* ======================================================================== */
  /* ==== Added by the shared gallery (ROADMAP 4.1): the guest who opens  ==== */
  /* ==== the link the host sent. A guest surface, in the reader's own    ==== */
  /* ==== language; the event's name and every caption are content.      ==== */
  /* ======================================================================== */
  gallery: {
    title: 'Album partagé',
    opening: 'Ouverture de l’album…',
    /**
     * One sentence for every way a link can stop working, and deliberately no more: the
     * server answers an expired, a revoked and a mistyped link identically, so the screen
     * cannot tell them apart either — and should not, since the reader may be somebody the
     * link was forwarded to. The host's console is where the reason is shown.
     */
    unavailableTitle: 'Ce lien n’est plus disponible',
    unavailableHint:
      'Il a peut-être expiré ou été désactivé. Demandez un nouveau lien à la personne qui vous l’a envoyé.',
    lockedTitle: 'Album protégé',
    lockedHint: 'Saisissez le mot de passe qui vous a été communiqué avec le lien.',
    passwordLabel: 'Mot de passe',
    unlock: 'Ouvrir l’album',
    photoCount: (count: number) =>
      t.count(count, { one: `${t.number(count)} photo`, other: `${t.number(count)} photos` }),
    availableUntil: (date: string) => `Disponible jusqu’au ${date}`,
    /** Said because it is true and because it is the first thing a careful guest wonders. */
    privacyNote:
      'Les photos se téléchargent en pleine résolution, sans leurs données de localisation.',
    downloadAll: 'Tout télécharger (.zip)',
    download: 'Télécharger l’original',
    downloadClip: 'Télécharger la vidéo',
    /** The accessible name of a tile: sixty tiles must not share one. */
    openPhoto: (position: number) => `Agrandir la photo ${t.number(position)}`,
    /** The fallback `alt` of a photograph with no caption. */
    photoAlt: (position: number) => `Photo ${t.number(position)} de l’album`,
    clipBadge: 'Vidéo',
    empty: 'Aucune photo n’a encore été publiée dans cet album.',
    loadMore: 'Afficher plus de photos',
    viewerTitle: (position: number, total: number) =>
      `Photo ${t.number(position)} sur ${t.number(total)}`,
  },
  /* ======================================================================== */
  /* ==== Added by the AGPL source offer (G1-04 / P1-05): the footer on   ==== */
  /* ==== the guest and host screens, and the /about page. Its own block, ==== */
  /* ==== at the end of the file, so a branch appending to a section      ==== */
  /* ==== above merges without meeting it. A reader's own language on     ==== */
  /* ==== both: the wall carries no footer, so none of this is projected. ==== */
  /* ======================================================================== */
  about: {
    /**
     * The link every guest and host screen carries, and **the licence obligation** — AGPL
     * section 13 entitles a user of a network service to the source of what they are using.
     * It names the licence beside the words "code source" so a reader who knows what that
     * means recognises it at a glance. There is no setting that hides it.
     */
    sourceCode: 'Code source (AGPL-3.0)',
    /** Said to a screen reader, once, because the link opens a new tab and so loses the page. */
    opensInNewTab: 'ouvre un nouvel onglet',
    /** The footer's other link: the page below. */
    aboutLink: 'À propos',
    /* Navigation pass, batch A: a way back from the page. */
    back: 'Retour',
    home: 'Accueil',

    title: 'À propos d’EventSlide',
    intro:
      'EventSlide est un logiciel libre : vous pouvez en lire, en modifier et en redistribuer le code source selon les termes de sa licence.',
    versionLabel: 'Version',
    licenseLabel: 'Licence',
    sourceLabel: 'Code source',
    /** Under the link, because the version above it is the version the link points at. */
    sourceNote: 'Ce lien mène au code source de la version indiquée ci-dessus.',
    /**
     * The licence notices of the libraries the application is built from (roadmap G1-07):
     * the licences of React and the others ask that their text travel with the code, and
     * this is the page that carries it. The link opens a plain-text file the build writes.
     */
    noticesLabel: 'Licences tierces',
    noticesLink: 'Notices des bibliothèques incluses',
    noticesNote: 'Le texte des licences des bibliothèques libres que l’application contient.',

    /**
     * The support link (roadmap G4-02), shown only where the operator set `DONATION_URL`: in
     * the host footer, on `/about`, and in the card a host meets once their event is closed.
     * Never on the wall and never on a guest screen. The verb is "soutenir", not "payer" or
     * "acheter": a donation is not a price, and nothing below says otherwise.
     */
    supportLink: 'Soutenir le projet',
    /** The card's and the /about section's heading. */
    supportTitle: 'Le projet vit de dons',
    supportIntro: 'EventSlide est un logiciel libre, gratuit et sans publicité.',
    /**
     * **The promise, in the product.** A donation changes nothing for the donor: no tier, no
     * badge, no priority, no longer retention. Said wherever the link is offered, so nobody
     * gives expecting a favour and nobody withholds expecting to be penalised.
     */
    supportNoCounterpart: 'Un don ne débloque rien : le service est le même pour tout le monde.',
    /** `BUDGET_URL`: the public ledger the donations are accounted in. */
    budgetLink: 'Voir le budget public',
    /** The close control on the card; the choice is remembered for that event on this device. */
    supportDismiss: 'Masquer ce message',

    /**
     * The operator's own pages and the way to report a piece of content (roadmap G2-17 /
     * P3-18), each shown only where the operator configured an address — a self-hosted box
     * shows none of them. The footer carries the legal three on every screen, the help link on
     * the host's screens and the report link on the guests', and `/about` lists them all but
     * the report link, which the footer already has.
     */
    termsLink: 'Conditions d’utilisation',
    privacyLink: 'Politique de confidentialité',
    legalNoticeLink: 'Mentions légales',
    /** `SUPPORT_URL`: help for the host, not the donation link above. */
    helpLink: 'Aide',
    /** `REPORT_URL`: where anyone can report a content they think is illegal (DSA art. 16). */
    reportLink: 'Signaler un contenu',
    /** The /about section naming whoever runs this instance, drawn only once it has a name. */
    operatorTitle: 'Qui exploite cette instance',
    operatorNameLabel: 'Opérateur',
    operatorContactLabel: 'Contact',
    /**
     * The line of the guest's privacy notice that names the operator. Its answer is the
     * operator's own name, which is content and is never translated.
     */
    operatorHostedBy: 'Hébergé par',
  },
  /**
   * The client's own space (roadmap §10.9; G2-16 / P3-17): the banner over a ceiling, the screen
   * of a suspended account, and the page where an owner reads their limits, what waits for
   * their approval and what the operator did on their account. Only on a box with `SITE_ADMIN=on`.
   *
   * **No name of a person or of a client is interpolated into a phrase here**: the client's name
   * is content and is printed beside the sentence, never inside it.
   */
  clientSpace: {
    bannerLabel: 'Limites de votre compte',
    warningTitle: 'Vous approchez d’une limite de votre compte',
    reachedTitle: 'Une limite de votre compte est atteinte',
    eventsMeter: (used: number, max: number) => `Évènements : ${used} sur ${max}`,
    eventsPerPeriodMeter: (used: number, max: number) =>
      `Évènements créés sur la période : ${used} sur ${max}`,
    storageMeter: (used: string, max: string) => `Stockage : ${used} sur ${max}`,
    liveNotAllowed: 'L’ouverture de nouveaux évènements est suspendue sur votre compte.',
    contactHint: 'Pour lever une limite, contactez votre opérateur.',
    contactAction: 'Contacter l’opérateur',
    suspendedTitle: 'Votre compte est suspendu',
    suspendedBody:
      'Vos albums restent consultables et exportables. Tant que la suspension dure, vous ne pouvez ni créer, ni ouvrir, ni modifier un évènement, et le public ne voit plus vos murs.',
    spaceLink: 'Espace client',
    spaceTitle: 'Espace client',
    limitsTitle: 'Limites et usage',
    noLimits: 'Votre opérateur n’a fixé aucune limite à votre compte.',
    // Navigation pass, batch C: an account that belongs to no client.
    noClient: 'Votre compte n’est rattaché à aucun client.',
    noClientHint:
      'Il n’y a donc ni limite ni usage à consulter ici. Vos évènements, eux, sont sur la page « Vos évènements ».',
    roleOwner: 'Propriétaire',
    roleMember: 'Membre',
    pendingTitle: 'En attente de votre accord',
    pendingHint:
      'Votre opérateur a invité ces personnes dans votre compte. Elles n’y entrent qu’avec l’accord d’un propriétaire.',
    pendingEmpty: 'Rien n’attend votre accord.',
    pendingValidUntil: (date: string) => `Valable jusqu’au ${date}`,
    approve: 'Approuver',
    approved: 'Invitation approuvée.',
    auditTitle: 'Journal des actions',
    auditHint:
      'Tout ce que votre opérateur, le système ou votre équipe a fait sur votre compte, du plus récent au plus ancien.',
    auditEmpty: 'Aucune action enregistrée pour le moment.',
    auditMore: 'Voir les actions plus anciennes',
    actorOperator: 'Opérateur',
    actorMember: 'Votre équipe',
    actorSystem: 'Système',
    actorIntegration: 'Intégration',
    actionCeilingsChanged: 'Vos limites ont été modifiées.',
    actionPeriodReset: 'Votre période a été renouvelée.',
    actionInvitationIssued: 'Une invitation a été émise.',
    actionInvitationIssuedPending: 'Une invitation a été émise ; elle attend votre accord.',
    actionInvitationApproved: 'Une invitation a été approuvée.',
    actionResetRequested: 'Une réinitialisation de mot de passe a été demandée pour un membre.',
    actionResetApproved: 'Une réinitialisation de mot de passe a été approuvée.',
    actionResetMailed: 'Un lien de réinitialisation a été envoyé au membre.',
    actionResetShown: 'Un lien de réinitialisation a été remis à l’opérateur.',
    actionTermsAccepted:
      'Une personne a accepté les conditions d’utilisation en acceptant une invitation.',
    actionOther: 'Une action a été enregistrée.',
    liveWindowEnd: (date: string) => `L’évènement se termine le ${date}.`,
  },

  /* ---- Spec 31: the operator’s page of signup requests (`/admin/site/signups`). ---- */
  siteSignups: {
    nav: 'Inscriptions',
    navPending: (count: number) => `Inscriptions (${count})`,
    title: 'Inscriptions',
    hintOpen:
      'Les comptes s’ouvrent d’eux-mêmes dès que la personne a confirmé son adresse. Voici ceux des 30 derniers jours.',
    hintReview:
      'Chaque personne a confirmé son adresse. Rien ne s’ouvre avant votre validation, et une demande sans réponse disparaît au bout de 30 jours.',
    tabsLabel: 'Demandes d’inscription',
    tabOpened: 'Comptes ouverts',
    tabPending: 'À valider',
    tabProcessed: 'Traitées',
    openedHeading: 'Comptes ouverts ces 30 derniers jours',
    heldHeading: 'Demandes retenues',
    heldHint:
      'La place disque ne permettait pas d’ouvrir ces comptes tout seuls\u00a0: à vous de valider ou de refuser.',
    processedHint: 'Les demandes refusées, gardées 30 jours.',
    emptyOpened: 'Aucun compte ouvert ces 30 derniers jours.',
    emptyPending: 'Aucune demande à valider.',
    emptyProcessed: 'Aucune demande refusée.',
    tableLabel: 'Demandes d’inscription',
    emailColumn: 'Adresse',
    spaceColumn: 'Espace',
    occasionColumn: 'Occasion',
    eventDateColumn: 'Date de l’évènement',
    languageColumn: 'Langue',
    confirmedColumn: 'Confirmée le',
    openedColumn: 'Ouvert le',
    decidedColumn: 'Refusée le',
    actionsColumn: 'Actions',
    none: '—',
    existingAccount: 'Compte existant',
    clientLink: 'Fiche du client',
    approve: 'Valider',
    refuse: 'Refuser',
    approveTitle: (name: string) => `Valider l’inscription de «\u00a0${name}\u00a0»`,
    approveIntro:
      'Le client s’ouvre avec les plafonds ci-dessous, préremplis avec ceux de l’instance, et l’invitation part à l’adresse de la personne.',
    existingAccountNotice: 'Compte existant\u00a0: la personne devra se connecter pour accepter',
    approveConfirm: 'Valider et envoyer l’invitation',
    approvedDone: (name: string) => `Compte «\u00a0${name}\u00a0» ouvert, invitation envoyée.`,
    refuseTitle: (name: string) => `Refuser l’inscription de «\u00a0${name}\u00a0»`,
    refuseBody: 'La demande est refusée. Aucun motif n’est conservé.',
    notify: 'Prévenir la personne',
    notifyHint: 'Un mail neutre, sans motif.',
    refuseConfirm: 'Refuser la demande',
    refusedDone: 'Demande refusée.',
    actions: {
      'signup.approved': 'Inscription validée, compte ouvert.',
      'signup.refused': 'Inscription refusée.',
      'signup.expired': 'Demande d’inscription expirée sans décision.',
      'signup.dailyCeilingReached': 'Plafond d’inscriptions du jour atteint.',
    },
  },

  /* ---- Added by features/site: the operator’s console (G2-15 / P3-16). ---- */
  site: {
    menuLink: 'Console de l’opérateur',
    consoleTitle: 'Console de l’opérateur',
    consoleIntro:
      'Vous voyez ici des formes et des tailles, jamais ce que vos clients ont fabriqué : aucune photo, aucun nom d’évènement.',
    navLabel: 'Sections de la console',
    navClients: 'Clients',
    navAccounts: 'Comptes',
    navAudit: 'Journal',
    factorTitle: 'Vérification en deux étapes requise',
    factorEnrol:
      'Cette instance l’exige de l’opérateur et votre compte ne l’a pas encore activée. Activez-la, puis revenez ici.',
    factorEnrolLink: 'Activer la vérification en deux étapes',
    factorSignIn:
      'Cette connexion n’a pas passé la vérification en deux étapes. Reconnectez-vous et saisissez le code de votre application.',
    factorSignOut: 'Se reconnecter',
    stepUpTitle: 'Confirmez votre identité',
    stepUpIntro:
      'Cette action change une instance partagée. Saisissez votre mot de passe, et le code de votre application si vous en avez une : la confirmation vaut cinq minutes.',
    more: 'Voir la suite',

    clientsTitle: 'Clients',
    clientsHint:
      'Un client, c’est un compte, ses évènements et ses limites. Vous lisez ses tailles, jamais ses contenus.',
    newClient: 'Nouveau client',
    clientsEmpty: 'Aucun client pour le moment.',
    clientsEmptyHint:
      'Ouvrez un client : son propriétaire reçoit une invitation et choisit lui-même son mot de passe.',
    clientsTableLabel: 'Les clients de l’instance',
    clientColumn: 'Client',
    statusColumn: 'État',
    eventsColumn: 'Évènements',
    membersColumn: 'Membres',
    storageColumn: 'Stockage',
    createdColumn: 'Ouvert le',
    statusActive: 'Actif',
    statusSuspended: 'Suspendu',
    statusOffboarding: 'Fin d’engagement',
    eventsCell: (total: number, live: number) => `${t.number(total)} (${t.number(live)} en cours)`,
    storageOf: (used: string, max: string) => `${used} sur ${max}`,
    noCeiling: 'Sans limite',

    newClientTitle: 'Ouvrir un client',
    newClientIntro:
      'Le client est ouvert sans membre ni évènement, et son propriétaire est invité par e-mail, ou par un lien à lui transmettre si l’instance n’envoie pas de courrier. Vous ne choisissez jamais son mot de passe.',
    clientName: 'Nom du client',
    ownerEmail: 'Adresse e-mail du propriétaire',
    inviteLanguage: 'Langue de l’invitation',
    defaultsHint:
      'Les limites sont celles que cette instance donne par défaut à un nouveau client. Videz un champ pour ne fixer aucune limite.',
    createClient: 'Ouvrir le client',
    clientCreated: 'Client ouvert.',

    invitationMailed: (email: string) => `Une invitation a été envoyée à ${email}.`,
    invitationPending:
      'L’invitation est écrite, mais elle ne s’ouvre qu’avec l’accord d’un propriétaire du client.',
    invitationLinkTitle: 'Aucun e-mail n’est parti',
    invitationLinkBody:
      'Cette instance ne peut pas envoyer de courrier, ou le serveur de messagerie a refusé celui-ci. Ce lien est la seule copie : transmettez-le à son destinataire, puis fermez cet encadré.',
    invitationLinkLabel: 'Lien d’invitation',
    copyLink: 'Copier le lien',
    linkCopied: 'Lien copié.',
    linkCopyFailed: 'Copie impossible ici : sélectionnez le lien et copiez-le vous-même.',
    invitationValidUntil: (date: string) => `Valable jusqu’au ${date}.`,

    ceilingsLegend: 'Limites',
    maxEvents: 'Évènements, au plus',
    maxEventsPerPeriod: 'Évènements créés par période, au plus',
    maxTotalGigabytes: 'Stockage total, en Go',
    maxEventQuotaGigabytes: 'Quota d’un évènement, en Go',
    maxRetentionDays: 'Conservation après la fin de l’évènement, en jours, au plus',
    maxLiveDays: 'Durée d’un évènement en cours, en jours, au plus',
    clipsAllowed: 'Vidéos autorisées',
    booksAllowed: 'Livres photo (PDF) autorisés',
    channelsAllowed: 'Groupes de messagerie (Telegram) autorisés',
    liveAllowed: 'Ouverture d’évènements autorisée',
    renewPeriod: 'Renouveler la période maintenant',
    renewPeriodHint: 'Remet à zéro le compteur d’évènements créés sur la période.',
    emptyMeansNone: 'Vide : aucune limite.',
    notANumber: 'Saisissez un nombre positif.',

    allClients: 'Tous les clients',
    memberCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} membre`,
        other: `${t.number(count)} membres`,
      }),
    periodEvents: (count: number) => `Créés sur la période : ${t.number(count)}`,
    suspendedSince: (date: string) => `Suspendu depuis le ${date}.`,
    purgeOn: (date: string) => `Les albums seront purgés au plus tard le ${date}.`,
    suspend: 'Suspendre',
    suspendTitle: 'Suspendre ce client ?',
    suspendBody:
      'Les invités ne peuvent plus rejoindre ses évènements ni y envoyer de photos, le public ne voit plus ses écrans ni ses albums, et ses membres ne peuvent plus rien modifier. Rien n’est supprimé et aucun compte n’est désactivé.',
    suspended: 'Client suspendu.',
    resume: 'Lever la suspension',
    resumeTitle: 'Lever la suspension ?',
    resumeBody:
      'Les écrans et les albums du client redeviennent visibles aussitôt, et ses invités peuvent de nouveau rejoindre et envoyer des photos.',
    resumed: 'Suspension levée.',
    rename: 'Renommer',
    renameTitle: 'Nom du client',
    renamed: 'Client renommé.',
    ceilingsTitle: 'Limites',
    ceilingsReason: 'Motif du changement',
    ceilingsReasonHint:
      'Une phrase sur une ligne, 200 caractères au plus, sans adresse e-mail. Elle est inscrite au journal de l’opérateur et le client ne la lit pas. Motifs non financiers seulement : taille d’un évènement, capacité, abus.',
    ceilingsSave: 'Enregistrer les limites',
    ceilingsSaved: 'Limites enregistrées.',
    ceilingsUnchanged: 'Aucune limite n’a changé.',
    inviteTitle: 'Inviter dans ce client',
    inviteIntro:
      'Une personne entre dans le compte du client, jamais dans un évènement. Si le client a déjà des évènements ou des membres, un propriétaire doit approuver l’invitation.',
    inviteEmail: 'Adresse e-mail',
    inviteRole: 'Rôle',
    inviteSend: 'Inviter',
    roleOwner: 'Propriétaire',
    roleMember: 'Membre',
    eventsTitle: 'Évènements',
    eventsHint: 'Des formes et des tailles seulement : ni nom, ni adresse, ni photo.',
    eventsEmpty: 'Ce client n’a aucun évènement.',
    eventsTableLabel: 'Les évènements du client',
    eventColumn: 'Évènement',
    eventStatusColumn: 'État',
    photosColumn: 'Photos',
    usedColumn: 'Espace utilisé',
    startsColumn: 'Début prévu',
    eventLabel: (short: string) => `Évènement ${short}`,
    eventStatuses: {
      draft: 'Brouillon',
      live: 'En cours',
      closed: 'Terminée',
      archived: 'Archivée',
    } satisfies Record<EventStatus, string>,
    photoCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo`,
        other: `${t.number(count)} photos`,
      }),
    auditLink: 'Voir le journal de ce client',

    accountsTitle: 'Comptes',
    accountsHint:
      'Les adresses des personnes qui ont un compte sur cette instance, et rien d’autre : ni nom affiché, ni mot de passe.',
    accountsEmpty: 'Aucun compte pour le moment.',
    accountsTableLabel: 'Les comptes de l’instance',
    addressColumn: 'Adresse',
    roleColumn: 'Rôle sur l’instance',
    accountStateColumn: 'État',
    lastLoginColumn: 'Dernière connexion',
    termsColumn: 'Conditions acceptées',
    termsNone: 'Aucune trace',
    termsAccepted: (version: string, at: string) => `Version ${version}, le ${at}`,
    ownedColumn: 'Évènements possédés',
    clientsColumn: 'Clients',
    siteRoleOperator: 'Opérateur',
    accountActive: 'Actif',
    accountDisabled: 'Désactivé',
    neverSignedIn: 'Jamais',
    mustChange: 'Doit changer son mot de passe',
    resetPassword: 'Réinitialiser le mot de passe',
    resetTitle: 'Réinitialiser ce mot de passe ?',
    resetBody:
      'Un lien valable une heure part vers l’adresse du compte, et nulle part ailleurs : vous ne le voyez que sur une instance qui n’envoie pas de courrier.',
    resetSent: 'Le lien a été envoyé à l’adresse du compte.',
    resetPending: 'En attente d’un propriétaire',
    resetPendingBody:
      'Cette instance n’envoie pas de courrier. Un autre propriétaire du client doit approuver la demande avant que le lien vous soit remis.',
    resetFetch: 'Récupérer le lien approuvé',
    resetLinkTitle: 'Lien de réinitialisation',
    resetLinkBody:
      'Il ne sert qu’une fois. Transmettez-le au titulaire du compte, puis fermez cet encadré.',

    auditTitle: 'Journal',
    auditHint:
      'Tout ce qui s’est fait sur l’instance, du plus récent au plus ancien. Le motif d’un changement de limites est la phrase de l’opérateur.',
    auditEmpty: 'Aucune action enregistrée pour le moment.',
    auditMore: 'Voir les actions plus anciennes',
    auditShowAll: 'Voir tout le journal',

    /* ---- Navigation pass, batch D: the console's links and the invitation link. ---- */
    exitsLabel: 'Quitter la console',
    accountsLink: 'Voir tous les comptes',
    noClient: 'Aucun',
    auditFilteredFor: (name: string) => `Journal du client « ${name} ».`,
    auditToClient: 'Voir ce client',
    linkLeaveTitle: 'Quitter sans avoir copié le lien ?',
    linkLeaveHint:
      'Aucun e-mail n’est parti : ce lien n’est affiché qu’ici, une seule fois. En quittant cette page, vous ne pourrez plus le copier ; il faudra en émettre un nouveau.',
    linkLeaveStay: 'Rester et copier le lien',
    linkLeaveGo: 'Quitter quand même',
    auditReason: (reason: string) => `Motif : ${reason}`,
    auditAccount: (short: string) => `compte ${short}`,
    actors: {
      operator: 'Opérateur',
      member: 'Membre',
      system: 'Système',
      integration: 'Intégration',
    } satisfies Record<SiteAuditEntryDto['actor']['kind'], string>,
    actions: {
      'client.created': 'Client ouvert.',
      'client.renamed': 'Client renommé.',
      'client.ceilingsChanged': 'Limites modifiées.',
      'client.periodReset': 'Période renouvelée.',
      'client.suspended': 'Client suspendu.',
      'client.resumed': 'Suspension levée.',
      'invitation.issued': 'Invitation émise.',
      'invitation.approved': 'Invitation approuvée par un propriétaire.',
      'account.resetRequested': 'Réinitialisation de mot de passe demandée.',
      'account.resetApproved': 'Réinitialisation approuvée par un propriétaire.',
      'account.resetIssued': 'Réinitialisation émise.',
      'account.disabled': 'Compte désactivé.',
      'client.offboarded': 'Fin d’engagement lancée.',
      'client.finalized': 'Client supprimé à l’issue de la fin d’engagement.',
      'account.enabled': 'Compte réactivé.',
      'account.deleted': 'Compte supprimé.',
      'account.termsAccepted': 'Conditions d’utilisation acceptées.',
      'account.secondFactorEnrolled': 'Vérification en deux étapes activée.',
      'account.secondFactorDisabled': 'Vérification en deux étapes désactivée.',
      'account.recoveryCodesRegenerated': 'Codes de secours renouvelés.',
      'account.recoveryCodeUsed': 'Un code de secours a servi.',
      'account.mailPreferencesChanged': 'Choix d’e-mails modifié.',
    },
    actionInvitationIssuedPending: 'Invitation émise ; elle attend l’accord d’un propriétaire.',
    actionOther: 'Une action a été enregistrée.',
    accountActionsColumn: 'Actions sur le compte',
    disableAccount: 'Désactiver',
    enableAccount: 'Réactiver',
    deleteAccount: 'Supprimer',
    disableTitle: (address: string) => `Désactiver le compte de ${address} ?`,
    disableBody:
      'Toutes ses sessions prennent fin à l’instant et la personne ne peut plus se connecter. Rien n’est supprimé : le réactiver lui rend l’accès, mais elle devra se reconnecter.',
    accountDisabledDone: 'Compte désactivé.',
    accountEnabledDone: 'Compte réactivé.',
    deleteTitle: (address: string) => `Supprimer le compte de ${address} ?`,
    deleteBody:
      'C’est la réponse à une demande d’effacement. Le compte, ses appartenances, les invitations qui lui étaient adressées, son second facteur et les liens de partage qu’il a créés disparaissent. Les lignes du journal qu’il a écrites restent, sans son nom, et les invitations qu’il a émises aussi. Son adresse reste dans ses sessions en cours (sept jours au plus) et dans les liens déjà émis jusqu’à leur expiration. Cette action est définitive.',
    accountDeletedDone: 'Compte supprimé.',
    offboardTitle: 'Fin d’engagement',
    offboardIntro:
      'Les évènements en cours sont terminés, les brouillons archivés, le client est suspendu, et ses albums sont purgés au plus tard à l’issue du délai que vous donnez : c’est le temps dont il dispose pour exporter ce qu’il veut garder (la rétention propre à un évènement ou les limites du client peuvent purger plus tôt). Puis les comptes qui n’appartenaient qu’à lui et ne tiennent rien d’autre sont supprimés, et le client avec eux.',
    graceDays: 'Délai avant la purge, en jours',
    graceDaysHint: 'Un nombre entier de jours : les limites sont celles du serveur.',
    offboardAction: 'Mettre fin à l’engagement',
    offboardConfirmTitle: 'Mettre fin à l’engagement de ce client ?',
    offboardConfirmBody: (days: number) =>
      t.count(days, {
        one: `Dans ${t.number(days)} jour au plus tard, les albums de ce client seront purgés, puis le client sera supprimé avec les comptes qui ne lui appartenaient qu’à lui et ne tiennent rien d’autre. Sans possibilité de retour : ni la date ni la suspension ne pourront être changées. D’ici là, ses évènements en cours sont terminés, ses brouillons archivés et le client suspendu.`,
        other: `Dans ${t.number(days)} jours au plus tard, les albums de ce client seront purgés, puis le client sera supprimé avec les comptes qui ne lui appartenaient qu’à lui et ne tiennent rien d’autre. Sans possibilité de retour : ni la date ni la suspension ne pourront être changées. D’ici là, ses évènements en cours sont terminés, ses brouillons archivés et le client suspendu.`,
      }),
    offboardedDone: 'Fin d’engagement lancée.',
    offboardingRunning:
      'Cet engagement prend fin : les albums seront purgés au plus tard à la date indiquée plus haut.',
    daysNotWhole: 'Indiquez un nombre entier de jours.',
    takedownNav: 'Retrait',
    takedownTitle: 'Retirer sans regarder',
    takedownIntro:
      'Retirez une photo ou un évènement signalé à partir de son identifiant, sans jamais l’ouvrir : cette console ne montre ni vignette, ni légende, ni nom d’invité, ni adresse de média. Chaque acte demande un motif, qui est écrit au journal de l’instance et que le client ne lit pas. Retirer n’arrête pas la purge : pour conserver le contenu comme preuve, retirez-le puis gelez sa purge.',
    takedownEventTitle: 'Un évènement',
    takedownEventIntro:
      'Cherchez l’évènement signalé par son adresse, son code de la soirée ou son nom exact. Vous ne voyez de lui que son identifiant et son état.',
    takedownEventLabel: 'Adresse, code ou nom exact',
    takedownEventAction: 'Chercher l’évènement',
    takedownEventNone:
      'Aucun évènement ne correspond. Le nom doit être exact : une partie de nom ne suffit pas.',
    takedownEventHeading: (id: string) => `Évènement ${id}`,
    takedownClient: 'Ouvrir le client',
    takedownNoClient: 'Sans client',
    takedownStateDown: 'Retiré',
    takedownStateUp: 'En ligne',
    takedownStateHeld: 'Purge gelée',
    takedownStateFree: 'Purge normale',
    takedownEventDown: 'Retirer l’évènement',
    takedownEventUp: 'Remettre en ligne',
    takedownHold: 'Geler la purge',
    takedownRelease: 'Reprendre la purge',
    takedownPhotoTitle: 'Une photo',
    takedownPhotoIntro:
      'Collez l’identifiant de la photo tel que le signalement le donne (le dernier élément de son adresse, avant le nom de la variante). Vous ne voyez que l’évènement auquel elle appartient et son état.',
    takedownPhotoLabel: 'Identifiant de la photo',
    takedownPhotoAction: 'Chercher la photo',
    takedownPhotoNone: 'Aucune photo ne porte cet identifiant.',
    takedownPhotoHeading: (id: string) => `Photo ${id}`,
    takedownPhotoOf: (id: string) => `Dans l’évènement ${id}`,
    takedownPhotoDown: 'Retirer la photo',
    takedownPhotoUp: 'Remettre la photo',
    takedownGuestbookTitle: 'Un message du livre d’or',
    takedownGuestbookIntro:
      'Collez l’identifiant du message tel que le signalement le donne. Vous ne voyez que l’évènement auquel il appartient et son état, jamais son texte.',
    takedownGuestbookLabel: 'Identifiant du message',
    takedownGuestbookAction: 'Chercher le message',
    takedownGuestbookNone: 'Aucun message ne porte cet identifiant.',
    takedownGuestbookHeading: (id: string) => `Message ${id}`,
    takedownGuestbookOf: (id: string) => `Dans l’évènement ${id}`,
    takedownGuestbookDown: 'Retirer le message',
    takedownGuestbookUp: 'Remettre le message',
    takedownReason: 'Motif',
    takedownReasonHint:
      'Une phrase sur une seule ligne, de 200 caractères au plus, sans adresse e-mail. Elle est écrite au journal de l’instance.',
    takedownUnknown:
      'État inconnu : l’acte est passé ou non, relancez la recherche pour le savoir.',
    takedownDone: 'C’est fait.',
    takedownOps: {
      eventDown: {
        title: 'Retirer cet évènement ?',
        body: 'Le mur, le flux des invités, le lien de l’album et l’espace de l’hôte répondent comme si l’évènement n’existait pas, et les écrans ouverts se ferment. Rien n’est supprimé. La conservation continue : pour garder le contenu comme preuve, gelez aussi sa purge.',
        confirm: 'Retirer l’évènement',
      },
      eventUp: {
        title: 'Remettre cet évènement en ligne ?',
        body: 'Le mur, les invités, l’album et l’hôte le retrouvent tel qu’il était.',
        confirm: 'Remettre en ligne',
      },
      purgeHold: {
        title: 'Geler la purge de cet évènement ?',
        body: 'Le balayage de rétention l’ignore, et ni l’hôte ni un invité ne peuvent plus supprimer l’évènement ou une photo. Rien n’est caché : le gel ne se voit pas dans la salle. Les sauvegardes ne sont pas gelées.',
        confirm: 'Geler la purge',
      },
      purgeRelease: {
        title: 'Reprendre la purge de cet évènement ?',
        body: 'L’évènement redevient purgeable à son échéance, qui peut être passée : le prochain balayage le purgera alors.',
        confirm: 'Reprendre la purge',
      },
      photoDown: {
        title: 'Retirer cette photo ?',
        body: 'Elle disparaît à l’instant du mur, du flux des invités, du lien de l’album et des écrans de l’hôte, et les écrans ouverts l’oublient. Le fichier est conservé. L’hôte ne peut pas la remettre.',
        confirm: 'Retirer la photo',
      },
      photoUp: {
        title: 'Remettre cette photo ?',
        body: 'Elle reparaît avec l’état que l’hôte lui avait donné.',
        confirm: 'Remettre la photo',
      },
      guestbookDown: {
        title: 'Retirer ce message ?',
        body: 'Il disparaît à l’instant du mur, de la file de l’hôte et de la liste de son auteur, et les écrans ouverts l’oublient. Le texte est conservé. L’hôte ne peut pas le remettre, et son auteur ne retrouve pas la place qu’il occupait.',
        confirm: 'Retirer le message',
      },
      guestbookUp: {
        title: 'Remettre ce message ?',
        body: 'Il reparaît avec l’état que l’hôte lui avait donné.',
        confirm: 'Remettre le message',
      },
    },
  },

  /**
   * The name of each page in the browser tab (`PageTitle`, WCAG 2.4.2).
   *
   * One entry per address the router serves, and `pageTitles.test.tsx` mounts them all, so
   * a page that ships without one fails there instead of in a tab strip. Short nouns
   * rather than sentences — the tab truncates from the right and `PageTitle` appends the
   * product name — and **never content**: an event's name, a caption or an invitation's
   * token does not come through here, so a title can neither leak nor be translated wrongly.
   */
  /** The text on the printed sheet, in the language of the evening (spec 02). */
  printKit: {
    title: 'Partagez vos photos de la soirée',
    step1: 'Scannez le QR code avec l’appareil photo de votre téléphone.',
    step2: 'Envoyez vos photos.',
    step3: 'Elles rejoignent l’écran de la soirée.',
    fallback: (code: string, address: string) =>
      `Pas de QR code ? Tapez le code ${code} sur ${address}.`,
    /* Spec 28: the words the designs print around the host's own. */
    table: (name: string) => `Table ${name}`,
    ourEvening: 'notre soirée',
    scanMe: 'Scannez-moi !',
    greetings: 'Bons baisers de',
    seeYou: 'À tout de suite sur l’écran !',
    toScreen: 'À : l’écran de la salle',
    ticketGuest: 'Billet invité',
    freeEntry: 'Entrée libre',
    dateLabel: 'Date',
    tableLabel: 'Table',
    seatLabel: 'Place',
    everywhere: 'Partout',
    freeSeat: 'Libre',
    tonight: 'Ce soir',
    scan: 'Scannez',
    stubLine: 'Vos photos passent sur l’écran de la soirée.',
    boarding: 'Carte d’embarquement',
    partyClass: 'Classe fête',
    fromCode: 'TEL',
    toCode: 'ECR',
    fromName: 'Votre téléphone',
    toName: 'L’écran de la salle',
    flight: 'Vol spécial',
    gate: 'Porte',
    allGates: 'Toutes',
    boardingTime: 'Embarquement',
    now: 'Maintenant',
    shortSteps: '1. Scannez · 2. Envoyez · 3. Regardez l’écran',
    shots: 'Pellicule sans fin',
    partyIso: 'ISO fête',
    issue: 'Numéro spécial',
    headline: 'À la une',
    freeIssue: 'Gratuit',
    forAll: 'pour tous',
    coverCta: 'Scannez, publiez : vous faites la une',
    receipt1: 'Photos de la soirée',
    receipt2: 'Fous rires',
    receipt3: 'Selfies ratés',
    receipt4: 'Pas de danse',
    price: '0,00',
    total: 'Total',
    unlimited: 'Illimité',
    receiptFoot: 'Ticket n° 000142 · Merci !',
    boom: 'Scannez !',
    meanwhileTable: (table: string) => `Pendant ce temps, à la table ${table}…`,
    meanwhile: 'Pendant ce temps, sur l’écran…',
  },
  /** The timed photo challenge (spec 10): the console's panel. The prompt inside it is content, never translated. */
  challenge: {
    title: 'Défi photo',
    hint: 'Tapez ce que vous demandez à la salle. Le texte n’apparaît qu’au lancement.',
    prompt: 'Texte du défi',
    /** The text box's counter: how much of the sixty characters is used. */
    promptCount: (used: number, max: number) => `${t.number(used)} / ${t.number(max)}`,
    recent: 'Derniers défis',
    ideasTitle: 'Idées',
    /** Ready-made challenges the host may take as they are or correct; each is at most 60 characters. */
    ideas: [
      'Un selfie avec votre voisin de table',
      'Toute la table dans la photo',
      'Le plus beau sourire de la soirée',
      'Une photo de vos pieds sur la piste',
      'Un toast à l’objectif',
      'Une grimace, tous ensemble',
    ],
    fromMission: 'Une de mes missions',
    duration: 'Durée',
    minutes: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} minute`,
        other: `${t.number(count)} minutes`,
      }),
    launch: 'Lancer en défi',
    stop: 'Arrêter',
    remaining: (time: string) => `Défi en cours · ${time}`,
    notOpen: 'Un défi se lance quand l’évènement est ouvert.',
    ended: 'Défi terminé',
    answers: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo`,
        other: `${t.number(count)} photos`,
      }),
    /** Said once to a screen reader when a challenge begins; the prompt in it is content. */
    announceStart: (prompt: string) => `Début du défi photo : ${prompt}`,
    /** The box above "Envoyer" while a challenge runs (spec 18): checked, the photo answers it. */
    participate: 'Je participe au défi',
    announceEnd: 'Fin du défi photo',
  },
  /** The disposable camera (spec 23): the host's section, band and confirmation. The guest's and the wall's sentences come with their own surfaces. */
  reveal: {
    title: 'Appareil jetable',
    hint: 'Les photos restent cachées pour les invités et la salle jusqu’à la révélation. Vous les voyez dès leur arrivée.',
    enabled: 'Activer l’appareil jetable',
    timed: 'Révéler à une heure précise',
    timedHint:
      'Sans heure, c’est vous qui révélez, avec le bouton « Révéler maintenant » de la page de l’évènement.',
    at: 'Heure de la révélation',
    atLocked: 'La soirée est déjà révélée : l’heure ne peut plus être déplacée.',
    shots: 'Poses par invité',
    shotsHint:
      'Une pose, c’est une photo envoyée. Sans limite, chaque invité envoie autant de photos qu’il le souhaite. Cette limite vaut aussi sans révélation.',
    film: 'Rendu pellicule',
    filmHint:
      'Sur les écrans, les photos prennent l’aspect d’une pellicule. Vos originaux et les téléchargements restent intacts.',
    liveWarning:
      'Des photos sont déjà arrivées : celles qui sont à l’écran disparaîtront jusqu’à la révélation.',
    countdown: (hours: number, minutes: number) =>
      hours > 0
        ? `Révélation dans ${t.number(hours)} h ${String(minutes).padStart(2, '0')}`
        : `Révélation dans ${t.number(minutes)} min`,
    soon: 'Révélation dans moins d’une minute',
    manual: 'Les photos restent cachées jusqu’à ce que vous les révéliez.',
    scheduledFor: (when: string) => `Révélation prévue le ${when}`,
    waiting: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo publiée attend la révélation`,
        other: `${t.number(count)} photos publiées attendent la révélation`,
      }),
    revealNow: 'Révéler maintenant',
    editTime: 'Modifier l’heure',
    revealedAt: (time: string) => `Révélé à ${time}`,
    revealedOn: (when: string) => `Révélé le ${when}`,
    confirmTitle: 'Révéler maintenant ?',
    confirmPublished: (count: number) =>
      count === 0
        ? 'Aucune photo n’est encore publiée.'
        : t.count(count, {
            one: 'La photo publiée apparaîtra sur le mur et dans les téléphones.',
            other: `Les ${t.number(count)} photos publiées apparaîtront sur le mur et dans les téléphones.`,
          }),
    confirmPending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo attend encore une décision : elle restera cachée.`,
        other: `${t.number(count)} photos attendent encore une décision : elles resteront cachées.`,
      }),
    definitive: 'Cette action est définitive.',
    closeTitle: (name: string) => `Terminer « ${name} » ?`,
    closeHeld:
      'Les photos n’ont pas encore été révélées. Une fois la soirée terminée, elles restent cachées tant que vous ne les révélez pas, et la conservation des photos court à partir de la fin de la soirée.',
    closedNotRevealed:
      'Les photos n’ont pas été révélées. La soirée est terminée : elles restent cachées tant que vous ne les révélez pas.',
    closesBefore:
      'La fin programmée de la soirée arrive avant la révélation. Sans révélation, les photos resteront cachées.',
    templateOn: 'Photos cachées jusqu’à la révélation',
    templateOff: 'Sans révélation différée',
    templateFilmOn: 'Rendu pellicule à l’écran',
    templateFilmOff: 'Sans rendu pellicule',
    /* The projected wall before the reveal (spec 23): the hour, then what waits for it. */
    wallAt: (time: string) => `Révélation à ${time}`,
    wallOn: (when: string) => `Révélation le ${when}`,
    wallSoon: 'Révélation bientôt',
    developing: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo en cours de développement`,
        other: `${t.number(count)} photos en cours de développement`,
      }),
    /* The guest's phone (spec 23): the roll, the veiled photographs, the hour and the moment of the reveal. */
    poses: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} pose restante`,
        other: `${t.number(count)} poses restantes`,
      }),
    freshRoll: (count: number) =>
      t.count(count, {
        one: `Pellicule neuve : ${t.number(count)} pose`,
        other: `Pellicule neuve : ${t.number(count)} poses`,
      }),
    rollEmpty: 'Pellicule terminée : votre appareil est vide',
    rollKept: (kept: number) =>
      t.count(kept, {
        one: 'Vous aviez 1 pose, la première est gardée.',
        other: `Vous aviez ${t.number(kept)} poses, les ${t.number(kept)} premières sont gardées.`,
      }),
    undeveloped: 'Sera développée à la révélation',
    guestAt: (time: string) => `Révélation à ${time}`,
    guestOn: (when: string) => `Révélation le ${when}`,
    guestLeft: (hours: number, minutes: number) =>
      hours > 0
        ? `dans ${t.number(hours)} h ${String(minutes).padStart(2, '0')}`
        : `dans ${t.number(minutes)} min`,
    guestSoon: 'dans moins d’une minute',
    guestManual: 'Les organisateurs révéleront les photos pendant la soirée.',
    /* Retouches 17/11: the console banner, the guest's line under the title, the notice's clauses, the waiting wall. */
    bannerManual: 'Révélation au bouton',
    bannerWaiting: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo attend`,
        other: `${t.number(count)} photos attendent`,
      }),
    guestIntro: 'Prenez vos photos : elles seront développées à la révélation.',
    guestIntroAt: (time: string) =>
      `Prenez vos photos : elles seront développées à la révélation, à ${time}.`,
    guestIntroOn: (when: string) =>
      `Prenez vos photos : elles seront développées à la révélation, le ${when}.`,
    noticeHeld: {
      afterReview:
        'L’organisateur valide chaque photo, et les photos validées ne passent à l’écran qu’à la révélation. Lui et ses modérateurs les voient dès leur envoi.',
      immediate:
        'Elles passent à l’écran à la révélation, pas avant. L’organisateur et ses modérateurs les voient dès leur envoi et peuvent en retirer à tout moment.',
    } satisfies Record<NoticePublication, string>,
    noticeShots: (count: number) =>
      t.count(count, {
        one: `Vous avez ${t.number(count)} pose : une pose, c’est une photo envoyée.`,
        other: `Vous avez ${t.number(count)} poses : une pose, c’est une photo envoyée.`,
      }),
    noticeFilm:
      'Le rendu pellicule n’existe qu’à l’écran : votre photo d’origine est conservée telle quelle.',
    wallDeveloping: 'Les photos se développeront à la révélation',
    developedNow: (count: number) =>
      t.count(count, {
        one: 'Votre photo vient d’être développée.',
        other: `Vos ${t.number(count)} photos viennent d’être développées.`,
      }),
    feedAt: (time: string) => `Les photos seront révélées à ${time}`,
    feedOn: (when: string) => `Les photos seront révélées le ${when}`,
    feedSoon: 'Les photos seront bientôt révélées',
    feedHint:
      'Elles apparaîtront ici à la révélation. Vos propres photos restent dans votre liste.',
    /* The shared gallery (spec 23): a link that opens before the reveal, and what a download is. */
    galleryHeld: (when: string) => `Les photos seront révélées le ${when}.`,
    galleryHeldSoon: 'Les photos seront bientôt révélées.',
    galleryOriginal: 'Le téléchargement donne l’original, sans effet pellicule.',
  },
  /** Messaging channels (spec 27): the settings switch, the "Groupe Telegram" panel and the badge of the moderation console. The group's title is content, never translated. */
  channels: {
    settingsSection: 'Messageries',
    allowTelegram: 'Recevoir les photos d’un groupe Telegram',
    allowTelegramHint:
      'Les photos et vidéos envoyées dans le groupe passent par Telegram avant d’arriver ici ; seuls le prénom et une empreinte du compte Telegram sont gardés. Elles suivent le même mode de validation que celles des invités.',
    on: 'Activé',
    off: 'Désactivé',
    notAllowed: 'Non inclus dans votre offre',
    noBot: 'Cette installation n’a pas de bot Telegram : l’opérateur doit en configurer un.',
    notLive: 'Un groupe ne peut être associé que pendant que la soirée est ouverte.',
    title: 'Groupe Telegram',
    hint: 'Les photos postées dans un groupe Telegram arrivent ici, comme celles des invités.',
    step1: (bot: string) => `Ajoutez @${bot} à votre groupe Telegram.`,
    step2: 'Dans le groupe, envoyez :',
    /** The word that connects a group, as the bot's profile lists it in this language (the bot accepts them all). */
    bindCommand: 'soiree',
    copyCommand: 'Copier la commande',
    copied: 'Commande copiée',
    copyFailed: 'La commande n’a pas pu être copiée : sélectionnez-la et copiez-la à la main.',
    visibility:
      'Le bot doit voir les photos : nommez-le administrateur du groupe, ou utilisez un bot dont le mode confidentialité est désactivé (ce réglage ne vaut que pour les groupes que le bot rejoint ensuite : retirez-le puis ajoutez-le de nouveau).',
    listTitle: 'Groupes associés',
    none: 'Aucun groupe n’est associé pour l’instant.',
    boundOn: (date: string) => `associé le ${date}`,
    photos: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo reçue`,
        other: `${t.number(count)} photos reçues`,
      }),
    unlink: 'Dissocier',
    ownerOnlyUnlink: 'Seul le propriétaire de la soirée peut dissocier un groupe.',
    unlinkConfirmTitle: 'Dissocier ce groupe ?',
    unlinkConfirmBody: (title: string) =>
      `Le bot cessera de prendre les photos de « ${title} ». Il le dira dans le groupe et y restera : vous pouvez l’en retirer vous-même.`,
    unlinked: 'Groupe dissocié',
    viaTelegram: 'via Telegram',
  },
  /** Scheduled announcements (spec 21): the host's panel and the wall drawer's section. The text inside is content, never translated. */
  announcement: {
    title: 'Annonces',
    hint: 'Une phrase pour toute la salle, à l’heure choisie. Elle n’apparaît qu’au moment voulu.',
    text: 'Texte de l’annonce',
    /** The text box's counter: how much of the eighty characters is used. */
    textCount: (used: number, max: number) => `${t.number(used)} / ${t.number(max)}`,
    ideasTitle: 'Idées',
    /** Ready-made texts for a full-screen card; each is at most 80 characters. */
    ideas: ['Gâteau', 'Discours', 'Première danse', 'Ouverture du buffet', 'Dernière chanson'],
    /** The same for a discreet one, which says something that stays true for a while; each at most 80 characters. */
    ideasDiscreet: ['Le buffet est ouvert', 'Le photobooth vous attend', 'Dernier service au bar'],
    time: 'Heure',
    timeHint: 'Laissez vide pour utiliser « Lancer maintenant ».',
    /** The line that says which moment the typed time is: the day, the time, and how far away it is. */
    resolvedToday: (time: string, lead: string) => `Aujourd’hui ${time}, dans ${lead}`,
    resolvedTomorrow: (time: string, lead: string) => `Demain ${time}, dans ${lead}`,
    resolvedOn: (date: string, time: string, lead: string) => `${date} ${time}, dans ${lead}`,
    /** How far away, from whole minutes: "1 h 12", "45 min". */
    lead: (minutes: number) => {
      if (minutes <= 0) return 'un instant'
      if (minutes < 60) return `${minutes} min`
      const rest = minutes % 60
      const hours = Math.floor(minutes / 60)
      return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`
    },
    far: 'Plus de 12 heures d’ici : vérifiez l’heure et le jour.',
    kind: 'Type d’annonce',
    kindFullscreen: 'Plein écran',
    kindFullscreenHelp: 'Une carte au milieu de l’écran, quelques secondes.',
    kindDiscreet: 'Discrète',
    kindDiscreetHelp: 'Un texte discret sur les photos, de 5 à 30 minutes.',
    countdown: 'Compte à rebours',
    countdownNone: 'Aucun',
    duration: 'Durée à l’écran',
    /** A span of seconds as the chips say it: under a minute in seconds, from a minute in minutes. */
    span: (seconds: number) => (seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`),
    schedule: 'Programmer',
    launchNow: 'Lancer maintenant',
    save: 'Enregistrer',
    cancel: 'Annuler',
    edit: 'Modifier',
    relaunch: 'Relancer',
    remove: 'Supprimer',
    withdraw: 'Retirer de l’écran',
    editing: 'Modification d’une annonce',
    textOnly: 'Cette annonce est à l’écran : seul son texte peut changer.',
    listLabel: 'Annonces de la soirée',
    empty: 'Aucune annonce pour le moment.',
    loadFailed: 'Les annonces n’ont pas pu être chargées.',
    notLive:
      'L’évènement n’est pas encore ouvert : l’annonce ne sera montrée qu’une fois l’écran ouvert.',
    /** The state the row is in, in words: never by colour alone. */
    states: {
      upcoming: 'À venir',
      counting: 'Compte à rebours',
      showing: 'À l’écran',
      over: 'Passée',
    },
  },
  /** The deletion of the album and its verified archive, on the host's event page (spec 22). The date is the server's, never the machine's; no sentence here says why a date has passed. */
  exportPurge: {
    title: 'Suppression de l’album',
    deletesOn: (date: string, days: number) =>
      `Cet album sera supprimé le ${date} (${t.count(days, { one: 'dans 1 jour', other: `dans ${t.number(days)} jours` })}).`,
    deletesToday: (date: string) => `Cet album sera supprimé aujourd’hui, le ${date}.`,
    passed: 'La date de suppression prévue est passée.',
    downloadFirst: 'Téléchargez-le avant : après cette date il n’existera plus nulle part.',
    downloadAlbum: 'Télécharger l’album',
    directNote:
      'Le serveur ne peut pas vérifier ce téléchargement direct : le fichier MANIFEST.sha256 qu’il contient vous permet de le vérifier chez vous.',
    prepare: 'Préparer une archive vérifiée',
    downloadArchive: 'Télécharger l’archive',
    rebuild: 'Refaire l’archive',
    working:
      'Archive en préparation. Vous pouvez quitter cette page : elle se met à jour toute seule.',
    digest: 'Empreinte SHA-256',
    ready: (entries: number, size: string, sealedOn: string, until: string | null) =>
      `Archive prête : ${t.count(entries, { one: `${t.number(entries)} fichier`, other: `${t.number(entries)} fichiers` })}, ${size}, vérifiée le ${sealedOn}.${until === null ? '' : ` Disponible jusqu’au ${until}.`}`,
    sent: (date: string) =>
      `Archive envoyée en entier le ${date}. Vérifiez votre fichier avant de supprimer quoi que ce soit.`,
    incomplete: (missing: number) =>
      `Archive prête, mais ${t.count(missing, { one: `${t.number(missing)} fichier manquait`, other: `${t.number(missing)} fichiers manquaient` })} sur le disque du serveur : ${t.count(missing, { one: 'il n’y est pas.', other: 'ils n’y sont pas.' })}`,
    voiceSecret: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} message vocal est encore gardé secret : il partirait sans avoir été écouté.`,
        other: `${t.number(count)} messages vocaux sont encore gardés secrets : ils partiraient sans avoir été écoutés.`,
      }),
    voicePending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} message vocal attend votre décision : il ne sera pas dans l’album.`,
        other: `${t.number(count)} messages vocaux attendent votre décision : ils ne seront pas dans l’album.`,
      }),
    retired: 'L’archive a été retirée parce qu’une photo a été effacée. Préparez-la de nouveau.',
    changed:
      'L’album a changé depuis la préparation de l’archive, elle n’est donc plus proposée. Préparez-la de nouveau.',
    noRoom:
      'Le serveur n’a pas assez de place pour préparer l’archive. Téléchargez l’album directement, ou prévenez l’exploitant.',
    tooLarge:
      'L’archive dépasserait la taille que le serveur accepte de préparer. Téléchargez l’album directement.',
    failed:
      'L’archive n’a pas pu être préparée. Réessayez ; si cela se répète, contactez l’exploitant.',
    deleteNow: 'Supprimer maintenant',
    deleteWithout: 'Supprimer sans archive…',
    needsArchive:
      'Pour supprimer l’album maintenant, préparez d’abord l’archive vérifiée et téléchargez-la en entier.',
    needsDownload: 'Pour supprimer l’album maintenant, téléchargez d’abord l’archive en entier.',
    needsComplete:
      'L’archive est incomplète : des fichiers manquaient sur le disque du serveur. Vous pouvez tout de même supprimer l’album, après confirmation.',
    wordPrompt: (word: string) =>
      `Cet album n’a pas été archivé complètement. Pour le supprimer quand même, tapez ${word}.`,
    confirmWord: 'SUPPRIMER',
    wordLabel: 'Mot de confirmation',
  },
  /* Added by spec 29 (guest invitations): the page a guest opens from an invitation. */
  guestInvite: {
    page: {
      eyebrow: 'Invitation',
      when: 'Quand',
      where: 'Où',
      itinerary: 'Itinéraire',
      agenda: 'Ajouter à mon agenda',
      join: 'Rejoindre le mur photo',
      live: 'La soirée a commencé',
      tonight:
        'Le soir même, revenez sur cette page pour partager vos photos sur le mur de la soirée.',
      notOpen: 'Le mur photo n’est pas encore ouvert.',
      over: 'Cette soirée est terminée. Merci d’être venu·e.',
      gone: 'Cette invitation n’est plus disponible',
      goneSub: 'Le lien a peut-être été changé par l’organisateur. Demandez-lui le nouveau.',
      report: 'Signaler cette invitation',
      madeWith: 'Invitation créée avec EventSlide',
      otherTz: (when: string, place: string) => `Soit ${when} à ${place}`,
      loading: 'Chargement de l’invitation',
      failed: 'L’invitation n’a pas pu être chargée. Vérifiez votre connexion.',
      busy: 'Beaucoup de monde ouvre cette invitation en ce moment. Réessayez dans un instant.',
      retry: 'Réessayer',
      logoAlt: (title: string) => `Logo de ${title}`,
    },
    host: {
      crumb: 'Invitations',
      title: 'Invitations',
      formTitle: 'Le texte',
      titleLabel: 'Titre',
      titleHint: (name: string) => `défaut\u00a0: ${name}`,
      startLabel: 'Début',
      endLabel: 'Fin',
      zoneLine: (zone: string) => `Fuseau\u00a0: ${zone}`,
      zoneChange: 'changer de fuseau',
      zoneLabel: 'Fuseau horaire',
      zoneHint:
        'Celui du lieu de la fête\u00a0: l’heure de l’invitation est lue dans ce fuseau, où que l’invité se trouve. Changer de fuseau garde les heures saisies telles quelles.',
      venueLabel: 'Lieu',
      addressLabel: 'Adresse',
      addressHint: '2 lignes',
      addressWarning:
        'Toute personne qui a le lien de l’invitation voit cette adresse jusqu’à la fin de la soirée.',
      messageLabel: 'Votre mot',
      messageCount: (count: number, max: number) => `${count} / ${max}`,
      lineCount: (count: number, max: number) => `${count} / ${max} lignes`,
      languageLabel: 'Langue de l’invitation',
      languageHint: 'libellés fixes seulement',
      linkIntro: 'Une fois activée, l’invitation a un lien et un QR code.',
      activate: 'Activer l’invitation',
      activateNeedsDate: 'Ajoutez la date de début pour pouvoir activer l’invitation.',
      linkLabel: 'Adresse du lien',
      copy: 'Copier',
      copied: 'Lien copié.',
      copyFailed: 'Le navigateur a refusé la copie. Sélectionnez le lien et copiez-le à la main.',
      rotate: 'Changer le lien',
      rotateTitle: 'Changer le lien de l’invitation\u00a0?',
      rotateBody:
        'L’ancien lien et les QR codes déjà imprimés cesseront de marcher. Pensez à réimprimer et à renvoyer le nouveau lien. Le code de la soirée ne change pas.',
      rotateConfirm: 'Changer le lien',
      rotated: 'Nouveau lien. L’ancien ne marche plus.',
      disable: 'Désactiver',
      disabled:
        'Invitation désactivée. La page répond «\u00a0introuvable\u00a0»\u00a0; la réactiver redonne le même lien.',
      enabled: 'Invitation activée. Le lien et le QR code existent.',
      openNote:
        'Dès que vous ouvrez la soirée, même pour un essai, la page de l’invitation affiche le bouton pour rejoindre le mur.',
      formatsLabel: 'Formats de l’invitation',
      tabPrint: 'Carte imprimée',
      tabImage: 'Image à partager',
      tabEmail: 'E-mail',
      locked: 'Ajoutez la date et activez l’invitation pour la partager.',
      nonexistentHour:
        'Cette heure n’existe pas ce jour-là dans ce fuseau (passage à l’heure d’été). Choisissez-en une autre.',
      loadFailed: 'Les invitations n’ont pas pu être chargées.',
      ownerOnly: 'Seul le propriétaire de l’évènement écrit l’invitation.',
      printFormatLegend: 'Format',
      printFormatCard: 'Carte A6 · 4 par A4',
      printFormatA5: 'A5 · 2 par A4',
      shortLabel: 'Mot sur la carte',
      shortCount: (count: number, max: number) => `${count} / ${max}`,
      shortAuto: 'auto',
      shortHint: 'Le mot complet est sur la page de l’invitation.',
      shortReset: 'Revenir au mot automatique',
      printA5Help:
        'Pour l’A5, imprimez depuis Chrome, Edge ou Firefox\u00a0: Safari ne sait pas tourner la feuille.',
      photoHint:
        'La photo reste dans ce navigateur\u00a0: EventSlide ne l’envoie nulle part, et un autre appareil ne la verra pas.',
      photoNotKept:
        'La photo n’a pas pu être gardée sur cet appareil\u00a0: elle disparaîtra quand vous quitterez la page.',
      printButton: 'Imprimer',
      previewLabel: 'Aperçu de la carte',
      printPerHouseholdLegend: 'Cartes pour les foyers',
      printPerHouseholdFailed: 'La liste des foyers n’a pas pu être lue.',
      printPerHouseholdStale:
        'La liste des foyers n’a pas pu être relue\u00a0: rien n’est imprimé. Vérifiez votre connexion puis réessayez.',
      printHouseholdQrAlt: (name: string) => `Code QR du lien personnel de ${name}`,
      printPerHousehold: 'Une carte par foyer',
      printPerHouseholdHint: (households: number, sheets: number) =>
        `${households} ${households === 1 ? 'carte' : 'cartes'} à imprimer, sur ${sheets} ${sheets === 1 ? 'feuille' : 'feuilles'}. Le nom du foyer est sur la carte.`,
      printPerHouseholdPrivacy:
        'Le QR de chaque carte ouvre le lien personnel de son foyer\u00a0: remettez la carte à ce foyer seulement. Le lien secret n’est écrit nulle part en clair.',
      printPerHouseholdPreview:
        'L’aperçu montre la première feuille\u00a0; l’impression les contient toutes.',
      printHelp:
        'Dans la fenêtre d’impression, choisissez une échelle de 100\u00a0% et aucune marge. L’adresse est imprimée sur la carte\u00a0: ne la donnez qu’aux invités que vous avez choisis.',
      lookTitle: 'L’apparence',
      moreTitle: 'Adresse, mot et langue',
      moreAddress: 'adresse',
      moreMessage: 'mot',
      photoNone: 'aucune',
      photoChosen: 'photo choisie',
      colourMore: 'Plus de couleurs',
      colourAll: 'Toutes les couleurs',
      sharePanelTitle: 'Partager et imprimer',
      entryShareSummary: 'Carte, image, e-mail, page de l’invité',
      shareLocked: 'Ajoutez la date et activez l’invitation pour pouvoir partager et imprimer.',
      repliesSummary: (until: string | null, options: number) =>
        `${until === null ? 'Demandées' : `Demandées jusqu’au ${until}`}\u00a0·\u00a0${options} ${options === 1 ? 'option' : 'options'}`,
      fieldProblem: (field: string, message: string) => `${field}\u00a0: ${message}`,
      repliesUnavailable: 'Réglages non chargés',
      statusOn: 'Invitation active',
      statusOff: 'Invitation désactivée',
      statusBarLabel: 'Lien de l’invitation',
      saving: 'Enregistrement…',
      savedAuto: 'Enregistré',
      saveFailed: 'La dernière modification n’a pas été enregistrée.',
      saveRetry: 'Réessayer',
      leaveWarning:
        'Des modifications de l’invitation ne sont pas encore enregistrées. Quitter la page\u00a0?',
      lockedTitle: 'Votre invitation n’est pas encore prête',
      lockedStepDate: 'Ajouter la date de début',
      lockedStepActivate: 'Activer l’invitation',
      lockedDateFocus: 'Saisir la date',
      lockedDateSave: 'Enregistrer cette date',
      tabGuest: 'Page de l’invité',
      guestStateLegend: 'Moment',
      guestStateUpcoming: 'Avant la soirée',
      guestStateJoinable: 'Pendant',
      guestStateOver: 'Après',
      guestHelp:
        'Ce que voit un invité qui scanne le QR code ou ouvre le lien. Le soir même, la page mène au mur photo.',
      guestOpen: 'Ouvrir la page',
      guestCopy: 'Copier le lien',
      guestPreviewLabel: 'Aperçu de la page de l’invité',
      previewEnlarge: 'Voir l’aperçu en grand',
      previewClose: 'Fermer l’aperçu',
      lookLocked:
        'Le modèle, la couleur et la photo se règlent ici dès que l’invitation est prête.',
    },
    image: {
      sameLook:
        'Le modèle, la couleur et la photo se règlent sur l’écran de la carte, dans «\u00a0L’apparence\u00a0».',
      formatLegend: 'Format',
      formatSquare: 'Carré',
      formatStory: 'Story',
      addressLegend: 'Adresse sur l’image',
      addressLabel: 'Montrer l’adresse',
      addressHint:
        'Une story est vue par tous vos abonnés\u00a0: sans adresse, seuls ceux qui ont le lien la verront.',
      textLabel: 'Texte qui accompagne l’image',
      textNote: 'cette fois seulement',
      share: 'Partager',
      download: 'Télécharger l’image',
      copy: 'Copier le texte',
      rendering: 'Préparation de l’image…',
      copied: 'Texte copié.',
      copiedBeforeShare:
        'Texte copié\u00a0: collez-le sous l’image si l’application ne l’a pas repris.',
      copyFailed: 'Le texte n’a pas pu être copié\u00a0: sélectionnez-le dans le champ.',
      renderFailed: 'L’image n’a pas pu être produite sur cet appareil.',
      retry: 'Réessayer',
      revertText: 'Revenir au texte automatique',
      downloaded: 'Image téléchargée.',
      shareFailed:
        'Le partage n’a pas abouti\u00a0: téléchargez l’image et envoyez-la depuis votre téléphone.',
      previewLabel: 'Aperçu de l’image',
      help: 'Sur téléphone, «\u00a0Partager\u00a0» ouvre WhatsApp, Instagram, Messages… avec l’image et le texte. Le texte est aussi copié, au cas où l’application l’oublierait.',
      fileName: 'invitation',
    },
    email: {
      subjectLabel: 'Objet',
      bodyLabel: 'Message',
      bodyNote: 'cette fois seulement',
      counter: (length: number, max: number) =>
        `Lien mailto\u00a0: ${length} / ${max} caractères encodés`,
      counterCut: 'mot coupé, la fin renvoie à la page',
      open: 'Ouvrir dans ma messagerie',
      copy: 'Copier le texte',
      copied: 'Texte copié.',
      copyFailed: 'Le texte n’a pas pu être copié\u00a0: sélectionnez-le dans le champ.',
      download: 'Télécharger l’image',
      rendering: 'Préparation de l’image…',
      renderFailed: 'L’image n’a pas pu être produite sur cet appareil.',
      retry: 'Réessayer',
      revertText: 'Revenir au texte automatique',
      size: (kilobytes: number) => `${kilobytes} Ko`,
      bccAdvice:
        'Mettez vos invités en copie cachée (Cci) pour ne pas partager leurs adresses entre eux. EventSlide n’envoie rien et ne garde aucune adresse.',
      previewLabel: 'Aperçu du message',
      previewHeader: 'Nouveau message',
      previewTo: 'À',
      previewToValue: 'vous-même',
      previewBcc: 'Cci',
      previewBccValue: 'vos invités',
      attachmentNote: '(si vous la joignez)',
      fileName: 'invitation',
    },
    card: {
      eyebrow: 'Invitation',
      more: 'Tous les détails sur la page de l’invitation.',
      link: (link: string) => `Infos et mur photo\u00a0: ${link}`,
      entry: 'Entrée\u00a0: vous',
      hourLabel: 'Heure',
      placeLabel: 'Lieu',
      stubLine: 'Tous les détails, et le soir même le mur photo.',
      startLabel: 'Début',
      endLabel: 'Fin',
      storyTop: 'Vous êtes invité·e',
      infos: 'Infos et mur photo',
      shareIntro: (title: string) => `${title}\u00a0: vous êtes invité·e.`,
      mailHello: 'Bonjour,',
      mailIntro: (title: string) => `${title}, et vous êtes invité·e.`,
      whenLabel: 'Quand',
      whereLabel: 'Où',
      mailDetails: 'Tous les détails, et le soir même le mur photo de la fête\u00a0:',
      mailSubject: (title: string, day: string) => `Invitation\u00a0: ${title}, ${day}`,
      mailMore: '(suite sur la page de l’invitation)',
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
      title: 'Serez-vous là\u00a0?',
      deadline: (day: string) => `Merci de répondre avant le ${day}.`,
      yes: 'Je viens',
      maybe: 'Peut-être',
      no: 'Je ne peux pas',
      nameLabel: 'Votre prénom et nom',
      namePlaceholder: 'Pour que l’organisateur vous reconnaisse',
      howManyLabel: 'Combien serez-vous\u00a0?',
      howManyHint: (max: number) => `vous compris, ${max} au plus`,
      adults: 'Adultes',
      people: 'Personnes',
      kids: 'Enfants',
      kidsHint: 'moins de 12 ans',
      less: 'Moins',
      more: 'Plus',
      dietLabel: 'Allergies ou régime',
      dietHint: 'facultatif, vu seulement par l’organisateur',
      dietPlaceholder: 'Ex. sans gluten',
      messageLabel: 'Un mot pour l’organisateur',
      optional: 'facultatif',
      send: 'Envoyer ma réponse',
      save: 'Enregistrer mes changements',
      cancel: 'Annuler',
      notice:
        'Votre réponse n’est vue que par l’organisateur. Elle est effacée au plus tard deux mois après la fête. Vous pouvez la modifier ou la supprimer avec votre lien.',
      showNameLabel: 'Montrer mon prénom aux autres invités',
      noticeNames:
        'Votre réponse est vue par l’organisateur. Seul votre prénom peut être montré à toute personne qui a le lien de l’invitation, si vous cochez la case. Elle est effacée au plus tard deux mois après la fête. Vous pouvez la modifier ou la supprimer avec votre lien.',
      noticeCount:
        'Votre réponse est vue par l’organisateur. Le nombre de personnes qui viennent est montré à toute personne qui a le lien de l’invitation. Elle est effacée au plus tard deux mois après la fête. Vous pouvez la modifier ou la supprimer avec votre lien.',
      showNameShown: (first: string) =>
        `Sera montré\u00a0: «\u00a0${first}\u00a0» (le premier mot de votre nom)`,
      recapShowName: 'Votre prénom est montré aux autres invités',
      doneYes: (first: string) => `C’est noté, ${first}`,
      doneMaybe: 'Noté\u00a0: peut-être',
      doneNo: (first: string) => `Dommage, ${first}`,
      maybeSub: 'L’organisateur compte sur une réponse ferme avant la fête.',
      noSub:
        'L’organisateur a bien reçu votre réponse. Vous pouvez changer d’avis tant que les réponses sont ouvertes.',
      recapYes: 'Vous venez',
      recapMaybe: 'Peut-être',
      person: { one: 'personne', other: 'personnes' },
      child: { one: 'enfant', other: 'enfants' },
      recapKids: (count: number, label: string) => `dont ${count} ${label}`,
      proofCountOne: '1 personne a dit oui',
      proofCount: (count: number) => `${count} personnes ont dit oui`,
      proofNameOne: (name: string) => `${name} vient`,
      proofNames: (names: string) => `${names} viennent`,
      proofNamesAndOne: (names: string) => `${names} et 1 autre viennent`,
      proofNamesAndMany: (names: string, others: number) => `${names} et ${others} autres viennent`,
      recapNo: 'Vous ne venez pas',
      recapDiet: (diet: string) => `Régime\u00a0: ${diet}`,
      recapMessage: (message: string) => `Votre mot\u00a0: ${message}`,
      edit: 'Modifier ma réponse',
      delete: 'Supprimer ma réponse',
      deleteAsk: 'Supprimer ma réponse\u00a0?',
      deleteSub:
        'L’organisateur ne la verra plus. Vous pourrez répondre à nouveau tant que les réponses sont ouvertes.',
      deleteYes: 'Oui, supprimer',
      deleted: 'Votre réponse est supprimée.',
      linkTitle: 'Votre lien pour modifier depuis un autre appareil',
      linkHint:
        'Gardez-le pour modifier depuis un autre appareil. Celui-ci s’en souvient tout seul.',
      copy: 'Copier',
      copied: 'Lien copié',
      closedTitle: 'Les réponses sont closes',
      closedSub: 'Un changement\u00a0? Prévenez l’organisateur directement.',
      earlier: (summary: string) => `Vous aviez répondu\u00a0: ${summary}`,
      failed: 'La réponse n’a pas pu être envoyée. Vérifiez votre connexion et réessayez.',
      busy: 'Beaucoup de monde répond en ce moment. Réessayez dans un instant.',
      householdGreeting: (name: string) => `Bonjour ${name}`,
      householdPlaces: (n: number) =>
        n === 1 ? 'Une place prévue pour vous' : `${n} places prévues pour vous`,
      householdFailed:
        'Le lien de votre foyer n’a pas pu être lu. Vérifiez votre connexion puis réessayez.',
      householdRetry: 'Réessayer',
      householdIncomplete:
        'Ce lien de foyer est incomplet\u00a0: il a sans doute été coupé en route. Copiez-le en entier, ou demandez-le à l’organisateur.',
      householdNotYours: 'Ce n’est pas votre foyer\u00a0?',
      replyNotYours: 'Ce n’est pas votre réponse\u00a0?',
      olderReply: (name: string) =>
        `Cet appareil garde aussi une réponse enregistrée sous le nom «\u00a0${name}\u00a0».`,
      olderReplyDelete: 'Supprimer cette réponse',
      householdGone:
        'Ce lien de foyer ne fonctionne plus. Demandez-en un nouveau à l’organisateur, ou répondez ci-dessous.',
      forgotten:
        'Cet appareil ne retrouve plus votre réponse\u00a0: elle a été supprimée ou le lien a changé.',
      companionsLabel: 'Prénoms de ceux qui viennent avec vous',
      companionLabel: (n: number) => `Accompagnant ${n}`,
      companionPlaceholder: 'Prénom',
      mealsLabel: 'Menus',
      mealFor: (who: string) => `Menu de ${who}`,
      personFallback: (n: number) => `Personne ${n}`,
      answerPick: 'Choisir',
      recapCompanions: (names: string) => `Avec vous\u00a0: ${names}`,
      recapMeals: (meals: string) => `Menus\u00a0: ${meals}`,
      recapAnswer: (label: string, value: string) => `${label}\u00a0: ${value}`,
      recapAsked: (question: string, value: string) => `${question} ${value}`,
      momentsLabel: 'À quels moments serez-vous là\u00a0?',
      momentsHint: 'au moins un',
      recapMoments: (moments: string) => `Moments\u00a0: ${moments}`,
      momentsGone: 'Le moment que vous aviez choisi n’existe plus\u00a0: choisissez-en un.',
      fullTitle: 'C’est complet',
      fullSub:
        'Il n’y a plus de place. Vous pouvez vous inscrire sur la liste d’attente\u00a0: l’organisateur vous prévient si une place se libère.',
      waitlistJoin: 'M’inscrire sur la liste d’attente',
      doneWaitlist: 'Vous êtes sur la liste d’attente',
      waitlistSub:
        'L’organisateur vous prévient si une place se libère. Vous pouvez changer d’avis tant que les réponses sont ouvertes.',
      recapWaitlist: 'Sur la liste d’attente',
      limitedPlaces: 'Places limitées.',
      stayWaitlist:
        'Vous restez sur la liste d’attente tant que l’organisateur ne vous a pas fait passer.',
      stayWaitlistChoice: 'Rester sur la liste d’attente',
      trap: 'Ne pas remplir ce champ',
      tooLarge: 'Votre réponse est trop longue pour être envoyée. Raccourcissez vos textes.',
    },
    host: {
      absentNote: 'Laisser les absents écrire un mot au livre d’or',
      absentNoteHint:
        'Un invité qui répond non peut laisser un mot, qui passe par la modération du livre d’or. Le livre d’or doit être ouvert.',
      title: 'Réponses des invités',
      stateOff: 'Non demandées',
      stateOpen: 'Demandées',
      stateClosed: 'Fermées',
      needsInvite:
        'Enregistrez d’abord l’invitation (titre et date)\u00a0: les réponses se demandent sur sa page.',
      askLabel: 'Demander une réponse',
      askHint: 'Le bloc «\u00a0Serez-vous là\u00a0?\u00a0» apparaît sur la page de l’invitation.',
      deadlineLabel: 'Date limite',
      deadlineHint:
        'Affichée aux invités. Les réponses restent ouvertes jusqu’à la fin de ce jour, puis se ferment\u00a0: changez la date pour les rouvrir.',
      deadlineClear: 'Retirer la date limite',
      closeAction: 'Fermer les réponses',
      reopenAction: 'Rouvrir les réponses',
      closedNote:
        'Fermées\u00a0: la page de l’invitation dit «\u00a0Les réponses sont closes\u00a0».',
      closesOn: (date: string) =>
        `Sans date limite, les réponses se ferment au début de la fête, le ${date}.`,
      erasedOn: (date: string) => `Les réponses seront effacées le ${date}.`,
      offNote: 'Les invités voient la carte sans formulaire de réponse.',
      presetPartyNote: 'peut-être, nombre de personnes',
      presetWeddingNote: 'menus, prénoms',
      presetCustomNote: 'vos choix',
      essentialsTitle: 'L’essentiel',
      moreOptionsTitle: 'Plus d’options',
      groupMeals: 'Repas et accompagnants',
      groupPlaces: 'Places et visibilité',
      groupAbsent: 'Mot des absents',
      groupData: 'Vos données et celles des invités',
      summaryCompanions: 'prénoms',
      summaryMeals: (count: number) => `${count} menus`,
      summaryNone: 'non',
      summaryOneMoment: 'un seul',
      summaryNoLimit: 'sans limite',
      summaryPlaces: (count: number) => `${count} ${count === 1 ? 'place' : 'places'}`,
      summaryNothingShown: 'rien de visible',
      summaryCountShown: 'nombre visible',
      summaryNamesShown: 'prénoms visibles',
      summaryYes: 'oui',
      summaryNo: 'non',
      summaryMore: 'en savoir plus',
      presetLabel: 'Type de fête',
      presetParty: 'Fête',
      presetWedding: 'Mariage',
      presetCustom: 'Sur mesure',
      presetHint:
        'Un mariage ne propose pas «\u00a0Peut-être\u00a0», accepte 6 personnes par réponse et demande le prénom des accompagnants\u00a0; une fête, l’inverse.',
      maybeLabel: 'Proposer «\u00a0Peut-être\u00a0»',
      maybeHint: 'Pratique pour un anniversaire, souvent retiré pour un mariage.',
      sizeLabel: 'Nombre de personnes',
      sizeHint: 'L’invité dit combien il vient, lui compris.',
      sizeMax: 'Au plus',
      sizeUnit: 'par réponse',
      sizeRange: (min: number, max: number) => `Entre ${min} et ${max}`,
      kidsLabel: 'Compter les enfants à part',
      kidsHint: 'Utile pour le traiteur et les menus enfants.',
      dietLabel: 'Allergies et régimes',
      dietHint:
        'Texte libre facultatif. Donnée de santé\u00a0: vue par vous seul, effacée avec les réponses.',
      saving: 'Enregistrement…',
      saved: 'Enregistré',
      retry: 'Réessayer',
      loadFailed: 'Les réglages des réponses n’ont pas pu être chargés.',
      fewTitle: 'Pourquoi si peu d’obligatoire',
      few: 'Le prénom et la réponse suffisent. Chaque champ en plus fait perdre des réponses\u00a0: les questions viennent après le «\u00a0oui\u00a0», sur le même écran.',
      noContactTitle: 'Aucune adresse, aucun numéro',
      noContact:
        'EventSlide n’envoie ni e-mail ni SMS. L’invité garde son lien privé\u00a0; vous relancez depuis vos propres applications.',
      erasedTitle: 'Effacées après la fête',
      erased:
        'Les réponses disparaissent 30 jours après que la soirée est fermée, ou 60 jours après son début. Exportez-les avant.',
      previewName: 'Camille',
      archived: 'L’évènement est archivé\u00a0: les réglages ne peuvent plus changer.',
      openUntil: (day: string) => `Réponses ouvertes jusqu’au ${day} inclus.`,
      closedByDate: 'Fermées par la date limite\u00a0: changez-la pour rouvrir les réponses.',
      reopenNeedsDate: 'La date limite est passée\u00a0: changez-la pour pouvoir rouvrir.',
      stateFull: 'Complet',
      companionsLabel: 'Prénoms des accompagnants',
      companionsHint: 'L’invité note le prénom de chaque personne qui vient avec lui.',
      companionsNeedSize:
        'Les prénoms se demandent pour chaque personne en plus de l’invité\u00a0: activez aussi le nombre de personnes.',
      visibilityLabel: 'Qui vient',
      visibilityHint:
        'Ce que la page de l’invitation dit des réponses, à toute personne qui a le lien. Jamais les «\u00a0non\u00a0», les «\u00a0peut-être\u00a0», les mots ni les régimes. Sur une petite fête, le nombre peut révéler la réponse d’une seule personne. Quitter «\u00a0prénoms\u00a0» retire les cases cochées\u00a0: les invités devront cocher à nouveau.',
      visibilityOff: 'Rien',
      visibilityCount: 'Le nombre de personnes qui viennent',
      visibilityNames: 'Le nombre, et les prénoms de ceux qui acceptent',
      mealsLabel: 'Menus au choix',
      mealsHint: 'Un menu par personne, demandé seulement à ceux qui viennent.',
      mealsOptionsLabel: 'Les menus',
      mealsOptionsHint: 'Un par ligne, de 2 à 6.',
      questionsTitle: 'Vos questions',
      questionsHint:
        'Trois au plus, posées à ceux qui répondent «\u00a0oui\u00a0» ou «\u00a0peut-être\u00a0». Retirer une question n’efface pas les réponses déjà données.',
      questionAdd: 'Ajouter une question',
      questionLabelLabel: 'La question',
      questionKindLabel: 'Type de réponse',
      questionKindText: 'Texte libre',
      questionKindChoice: 'Choix',
      questionOptionsLabel: 'Les choix',
      questionOptionsHint: 'Un par ligne, de 2 à 6.',
      questionRemove: (label: string) => `Retirer la question «\u00a0${label}\u00a0»`,
      questionConfirm: 'Ajouter la question',
      questionsFull: 'Trois questions au plus.',
      momentsTitle: 'Plusieurs moments',
      momentsHint:
        'Par exemple un brunch et une soirée. Quatre au plus. Chaque invité coche les moments où il sera\u00a0; un foyer peut n’être invité qu’à certains. Retirer un moment retire les choix des invités pour celui-ci.',
      momentAdd: 'Ajouter un moment',
      momentLabelLabel: (n: number) => `Moment ${n}`,
      momentPlaceholder: 'Ex. Brunch du dimanche',
      momentRemove: (label: string) => `Retirer le moment «\u00a0${label}\u00a0»`,
      momentsFull: 'Quatre moments au plus.',
      momentRemoveTitle: (label: string) => `Retirer le moment «\u00a0${label}\u00a0»\u00a0?`,
      momentRemoveBody: (count: number) =>
        count === 0
          ? 'Aucune réponse n’a choisi ce moment. Pour corriger un nom, renommez le moment plutôt que de le retirer.'
          : `${count} ${count === 1 ? 'réponse a' : 'réponses ont'} choisi ce moment et perdront ce choix. Pour corriger un nom, renommez le moment plutôt que de le retirer.`,
      momentRemoveUnknown:
        'Les réponses déjà données pour ce moment perdront ce choix. Pour corriger un nom, renommez le moment plutôt que de le retirer.',
      momentRemoveYes: 'Retirer le moment',
      capacityLabel: 'Places limitées',
      capacityHint:
        'Au-delà du nombre de personnes fixé, un «\u00a0oui\u00a0» va sur la liste d’attente et vous la promouvez à la main. Vos propres ajouts ne sont pas limités.',
      capacityField: 'Personnes au plus',
      capacityFieldHint: 'de 1 à 2000, enfants compris',
      presetConfirmTitle: 'Remplacer vos réglages\u00a0?',
      presetConfirm: (kind: string) =>
        `Vos choix de «\u00a0Peut-être\u00a0», de nombre de personnes, d’enfants et de prénoms des accompagnants seront remplacés par ceux d’${kind}.`,
      presetConfirmYes: 'Remplacer',
      presetKindParty: 'une fête',
      presetKindWedding: 'un mariage',
    },
    /** The host's replies page (spec 30, lot 1). */
    absent: {
      offer: 'Laisser un mot au livre d’or',
      title: 'Un mot au livre d’or',
      hint: 'Votre mot est signé de votre prénom et passe par la modération de l’évènement avant d’être lu.',
      label: 'Votre mot',
      signatureLabel: 'Signé',
      signatureHint:
        'Votre prénom, que vous pouvez changer. Videz le champ pour signer «\u00a0Un invité absent\u00a0».',
      anonymous: 'Un invité absent',
      send: 'Envoyer mon mot',
      sent: 'Merci, votre mot est envoyé.',
      sentSub: 'Il sera lu par l’organisateur.',
      unavailable: 'Le livre d’or n’accepte plus de mot pour le moment.',
      already: 'Vous avez déjà laissé un mot.',
    },
    digest: {
      label: 'Recevoir un résumé par e-mail (au plus un par jour)',
      hint: 'Les chiffres seulement, jamais le nom d’un invité.',
      offByAccount: 'Vous avez coupé les e-mails des réponses dans Sécurité et e-mails.',
      failed: 'Le choix n’a pas pu être enregistré. Réessayez dans un instant.',
    },
    push: {
      // What the service worker shows (it has no locale table of its own: `lib/push/pushNotice.ts` holds the
      // same words, and a test holds the two together).
      noticeOne: 'Une nouvelle réponse',
      noticeMany: (count: number) => `${count}\u00a0nouvelles réponses`,
      noticeSome: 'De nouvelles réponses',
      label: 'Notification du navigateur',
      hint: 'Ce navigateur vous prévient quand des réponses arrivent, sans dire qui a répondu ni quoi.',
      unsupported: 'Ce navigateur ne sait pas afficher de notifications.',
      addToHomeScreen:
        'Sur iPhone, ajoutez d’abord EventSlide à l’écran d’accueil, puis ouvrez-le depuis son icône : les notifications n’existent que dans l’application installée.',
      denied:
        'Les notifications sont bloquées pour ce site : autorisez-les dans les réglages du navigateur, puis revenez ici.',
      failed: 'La notification n’a pas pu être activée. Réessayez dans un instant.',
      offFailed: 'La notification n’a pas pu être désactivée. Réessayez dans un instant.',
    },
    list: {
      crumb: 'Réponses',
      title: 'Réponses',
      loadFailed: 'Les réponses n’ont pas pu être chargées.',
      retry: 'Réessayer',
      settings: 'Réglages',
      reply: { one: 'réponse', other: 'réponses' },
      person: { one: 'personne', other: 'personnes' },
      adult: { one: 'adulte', other: 'adultes' },
      child: { one: 'enfant', other: 'enfants' },
      expected: { one: 'personne attendue', other: 'personnes attendues' },
      line: { one: 'ligne', other: 'lignes' },
      menuNew: { one: 'nouvelle réponse', other: 'nouvelles réponses' },
      deadlineSub: (d: string) => `date limite le ${d}`,
      closedSub: 'réponses fermées',
      tilesLabel: 'Les chiffres',
      tileYes: 'Viennent',
      tileMaybe: 'Peut-être',
      tileNo: 'Ne viennent pas',
      tileMaybeDetail: (replies: string, people: string) => `${replies} · ${people}`,
      adultsKids: (a: string, k: string) => `${a}, ${k}`,
      barSummary: (parts: string) => `Répartition des réponses\u00a0: ${parts}`,
      legendItem: (label: string, count: number, unit: string) =>
        `${label}\u00a0: ${count} ${unit}`,
      barUpTo: (n: number) => `, jusqu’à ${n} avec les «\u00a0peut-être\u00a0»`,
      tabsLabel: 'Filtrer les réponses',
      tabAll: 'Toutes',
      tabYes: 'Viennent',
      tabMaybe: 'Peut-être',
      tabNo: 'Ne viennent pas',
      searchLabel: 'Chercher un nom',
      add: 'Ajouter une réponse',
      export: 'Exporter (tableur)',
      colName: 'Nom',
      colAnswer: 'Réponse',
      colPeople: 'Pers.',
      colDiet: 'Régime',
      colCompanions: 'Avec',
      colMeals: 'Menus',
      colMessage: 'Mot',
      colReceived: 'Reçue',
      answerYes: 'Vient',
      answerMaybe: 'Peut-être',
      answerNo: 'Ne vient pas',
      answerWaitlist: 'Liste d’attente',
      none: '—',
      peopleKids: (a: number, k: number) => `${a} + ${k} enf.`,
      mealCount: (meal: string, count: number) => `${meal}\u00a0×\u00a0${count}`,
      showMore: (n: number) => `Afficher les ${n} autres`,
      rowsOf: (s: number, t: number) => `${s} sur ${t}.`,
      rowsAll: (n: number, w: string) =>
        `${n} ${w}. Une réponse reçue de vive voix\u00a0? «\u00a0Ajouter une réponse\u00a0» en haut du tableau.`,
      noneHere: 'Aucune réponse ici.',
      emptyTitle: 'Aucune réponse pour le moment',
      emptyBody:
        'Les réponses apparaissent ici dès que vos invités répondent, sans recharger la page.',
      emptyOff:
        'Vous ne demandez pas encore de réponse. Activez-les dans les réglages de l’invitation.',
      detailPeople: 'Personnes',
      detailDiet: 'Régime',
      detailCompanions: 'Accompagnants',
      detailMeals: 'Menus',
      detailShowName: 'Prénom montré aux invités',
      detailYes: 'Oui',
      detailMessage: 'Mot',
      detailReceived: 'Reçue',
      sourceOpen: 'lien commun',
      sourceHost: 'saisie par vous',
      sourceHousehold: 'lien du foyer',
      receivedVia: (d: string, s: string) => `${d} · ${s}`,
      edit: 'Modifier',
      remove: 'Supprimer',
      deleteNote:
        'Supprimer sert aux doublons et aux réponses fantaisistes\u00a0: le lien commun n’identifie personne. Le lien privé de l’invité cesse alors de marcher.',
      closeDetail: 'Fermer',
      formAddTitle: 'Ajouter une réponse',
      formEditTitle: 'Modifier la réponse',
      formHint:
        'Le même formulaire que l’invité, rempli par vous\u00a0: pour une réponse reçue au téléphone ou de vive voix. Les limites de places ne vous retiennent pas.',
      formName: 'Nom',
      formAnswer: 'Réponse',
      formAdults: 'Adultes',
      formKids: 'Enfants',
      formDiet: 'Régime ou allergie',
      formCompanion: (n: number) => `Accompagnant ${n}`,
      formMeal: (who: string) => `Menu de ${who}`,
      formQuestionNone: '—',
      formMessage: 'Mot',
      formSave: 'Enregistrer',
      formSaving: 'Enregistrement…',
      deleteTitle: (n: string) => `Supprimer la réponse de ${n}\u00a0?`,
      deleteBody: 'Elle disparaît de la liste et des chiffres. Cette action est définitive.',
      deleteYes: 'Supprimer',
      latestTitle: 'Dernières réponses',
      latestYes: (n: string) => `${n} vient`,
      latestYesMany: (n: string, p: number) => `${n} vient à ${p}`,
      latestMaybe: (n: string) => `${n} viendra peut-être`,
      latestNo: (n: string) => `${n} ne vient pas`,
      notifyTitle: 'Être prévenu',
      notifyApp: 'Pastille dans l’appli',
      notifyAppHint:
        'Le nombre de nouvelles réponses, sur l’entrée «\u00a0Réponses\u00a0» du menu de l’évènement.',
      notifyLive: 'Tableau en direct',
      notifyLiveHint: 'Ouvert, il se met à jour seul à chaque réponse.',
      notifyNoEmail: 'L’instance n’envoie aucun e-mail aux invités.',
      catererTitle: 'Traiteur',
      catererHint:
        'Ce qu’il faut lui dire\u00a0: ceux qui viennent, sans les «\u00a0peut-être\u00a0».',
      catererAdults: 'Adultes',
      catererKids: 'Enfants',
      catererMaybe: 'Peut-être (pas comptés)',
      catererMeals: 'Menus',
      catererNoMeals: 'Aucun menu choisi pour le moment.',
      catererDiets: 'Régimes et allergies',
      catererPrivate: 'Données de santé\u00a0: vues par vous seul, jamais sur la page des invités.',
      catererExport: 'Exporter pour le traiteur (CSV)',
      catererPrint: 'Imprimer la liste',
      printTitle: (event: string) => `Invités qui viennent · ${event}`,
      printConfidential: 'Document confidentiel\u00a0: il contient des régimes.',
      printTotals: (adults: number, kids: number) =>
        `Adultes\u00a0: ${adults} · Enfants\u00a0: ${kids}`,
      printPeople: (n: number) => `Personnes\u00a0: ${n}`,
      colMoments: 'Moments',
      detailMoments: 'Moments',
      formMoments: 'Moments',
      momentsTitle: 'Par moment',
      momentLine: (label: string, yes: string, maybe: string | null) =>
        `${label}\u00a0: ${yes}${maybe === null ? '' : ` (+ ${maybe} avec les «\u00a0peut-être\u00a0»)`}`,
      catererMoments: 'Par moment',
      printMoments: 'Moments',
      momentNoneLine: (people: string) => `Sans moment\u00a0: ${people}`,
      formMomentsHint: 'au moins un, pour ceux qui viennent',
      tabWaitlist: 'Liste d’attente',
      tileWaitlist: 'Liste d’attente',
      promote: 'Promouvoir',
      detailWaitlistHint:
        'Sur la liste d’attente\u00a0: cette réponse ne compte pas dans les places.',
      promoteOver: (capacity: number) => `Cette promotion dépasse la capacité de ${capacity}.`,
      promoteAnyway: 'Promouvoir quand même',
      overCapacity: (capacity: number) => `au-delà de la capacité de ${capacity}`,
      waitlistOrderHint: 'Du plus ancien au plus récent\u00a0: promouvez dans cet ordre.',
      tileNoReply: 'Sans réponse',
      tileNoReplyDetail: (households: string, places: number) => `${households} · ${places} places`,
      household: { one: 'foyer', other: 'foyers' },
      guests: 'Liste d’invités',
      detailHousehold: 'Foyer',
      detailHouseholdNone: 'Aucun foyer',
      detailHouseholdHint: 'Classez cette réponse sous un foyer de votre liste.',
      detailHouseholdFile: 'Associer',
      detailHouseholdUnfile: 'Détacher',
    },
    households: {
      title: 'Liste d’invités',
      backToReplies: 'Réponses',
      intro:
        'Facultatif. Saisissez vos foyers (un nom et un nombre de places, jamais d’adresse e-mail ni de numéro). Chaque foyer reçoit son lien personnel. EventSlide n’envoie rien\u00a0: vous relancez depuis vos propres applications.',
      loadFailed: 'La liste n’a pas pu être chargée.',
      retry: 'Réessayer',
      summary: (households: number, places: number) =>
        `${households} ${households === 1 ? 'foyer' : 'foyers'} · ${places} ${places === 1 ? 'place' : 'places'}`,
      filtersLabel: 'Filtrer la liste',
      filterAll: 'Tous',
      filterPending: 'Sans réponse',
      filterAnswered: 'Ont répondu',
      searchLabel: 'Chercher un foyer',
      add: 'Ajouter un foyer',
      importList: 'Coller une liste',
      remindAll: (n: number) => `Relancer les ${n} sans réponse`,
      colMoments: 'Moments',
      momentsAll: 'Tous',
      formMoments: 'Moments invités',
      formMomentsHint: 'Par défaut, un foyer est invité à tous les moments.',
      colHousehold: 'Foyer',
      colPlaces: 'Places',
      colStatus: 'Réponse',
      colLink: 'Lien personnel',
      statusPending: 'Sans réponse',
      statusReminded: (date: string) => `Relancé le ${date}`,
      statusYes: (people: number) => `Vient · ${people}`,
      statusMaybe: (people: number) => `Peut-être · ${people}`,
      statusNo: 'Ne vient pas',
      statusWaitlist: 'Liste d’attente',
      copyLink: 'Copier le lien',
      linkCopied: 'Lien copié.',
      copyFailed: (link: string) =>
        `La copie n’a pas marché. Copiez le lien à la main\u00a0: ${link}`,
      edit: 'Modifier',
      remove: 'Supprimer',
      rotate: 'Changer le lien',
      viewReply: 'Voir la réponse',
      noneHere: 'Aucun foyer ici.',
      emptyTitle: 'Aucun foyer pour le moment',
      emptyBody:
        'Ajoutez un foyer, ou collez votre liste d’un coup\u00a0: une ligne par foyer, «\u00a0Famille Martin ; 4\u00a0».',
      noInvite: 'Enregistrez d’abord l’invitation\u00a0: le lien de chaque foyer en dépend.',
      noInviteLink: 'Ouvrir l’invitation',
      formAddTitle: 'Ajouter un foyer',
      formEditTitle: 'Modifier le foyer',
      formHint: 'Un nom et le nombre de places que vous gardez pour lui. Rien d’autre.',
      formName: 'Nom du foyer',
      formNamePlaceholder: 'Ex. Famille Martin',
      formPlaces: 'Places',
      formPlacesHint: 'de 1 à 10',
      formSave: 'Enregistrer',
      formSaving: 'Enregistrement…',
      importTitle: 'Coller une liste',
      importHint:
        'Une ligne par foyer\u00a0: «\u00a0Famille Martin ; 4\u00a0». Une liste copiée depuis un tableur convient aussi (le nom, une tabulation, les places). Sans nombre, un foyer a une place. 300 lignes au plus.',
      importLabel: 'Votre liste',
      importPlaceholder: 'Famille Martin ; 4\nLéa Durand ; 2',
      importSubmit: 'Ajouter ces foyers',
      importSending: 'Ajout…',
      importDone: (n: number) => (n === 1 ? '1 foyer ajouté.' : `${n} foyers ajoutés.`),
      importNothing: 'Aucun foyer à ajouter.',
      importSkippedTitle: 'Lignes laissées de côté',
      importSkippedLine: (line: number, reason: string) => `Ligne ${line}\u00a0: ${reason}`,
      importReasons: {
        name: 'nom vide ou de plus de 80 caractères',
        places: 'nombre de places à écrire de 1 à 10',
        duplicate: 'nom déjà dans la liste',
      },
      importClose: 'Fermer',
      deleteTitle: (name: string) => `Supprimer «\u00a0${name}\u00a0»\u00a0?`,
      deleteBody:
        'Le foyer sort de la liste et son lien cesse de marcher. Sa réponse, s’il en a donné une, reste dans les réponses.',
      deleteYes: 'Supprimer le foyer',
      rotateTitle: (name: string) => `Changer le lien de «\u00a0${name}\u00a0»\u00a0?`,
      rotateBody:
        'L’ancien lien, et une carte imprimée avec lui, cesse de marcher tout de suite. La réponse du foyer reste.',
      rotateYes: 'Changer le lien',
      reminderTitle: 'Relance guidée',
      reminderProgress: (i: number, n: number) => `${i} sur ${n} sans réponse`,
      reminderMessageLabel: 'Message',
      reminderEditable: 'modifiable',
      reminderWhatsapp: 'WhatsApp',
      reminderSms: 'SMS',
      reminderEmail: 'E-mail',
      reminderCopy: 'Copier',
      reminderCopied: 'Message copié.',
      reminderPrevious: 'Précédent',
      reminderNext: 'Suivant',
      reminderNote:
        'WhatsApp, SMS et e-mail s’ouvrent avec le message prêt\u00a0: vous choisissez le contact dans votre appli. EventSlide ne connaît ni numéro ni adresse.',
      reminderArchived: 'L’évènement est archivé\u00a0: plus aucune relance n’est possible.',
      reminderLoading: 'Chargement de l’invitation…',
      reminderInviteFailed: 'L’invitation n’a pas pu être lue.',
      reminderNoteMarked:
        'Le marquage «\u00a0relancé\u00a0» est noté dès que vous cliquez sur un canal.',
      reminderAllDone: 'Tout le monde a répondu.',
      reminderNoLink: 'Enregistrez d’abord l’invitation\u00a0: sans lien, il n’y a rien à envoyer.',
      reminderNoteFailed: 'Le marquage «\u00a0relancé\u00a0» n’a pas pu être enregistré.',
      reminderSubject: (title: string) => `Petit rappel\u00a0: ${title}`,
      reminderMessage: (
        name: string,
        title: string,
        deadline: string | null,
        link: string | null,
      ) =>
        `Bonjour ${name}, petit rappel\u00a0: ${title}. Pouvez-vous nous dire si vous venez${deadline === null ? '' : ` avant le ${deadline}`}\u00a0? Deux clics suffisent\u00a0:${link === null ? '' : `\n${link}`}`,
    },
  },

  eventMenu: {
    label: 'Menu de la soirée',
    tabBar: 'Navigation de la soirée',
    home: 'Accueil',
    /** Beside the moment the event is in. */
    current: 'maintenant',
    moments: {
      before: 'Préparer',
      during: 'Pendant la soirée',
      after: 'Après la soirée',
    },
    /** The phone's tab bar, where four words share one line. */
    momentsShort: {
      before: 'Préparer',
      during: 'Soirée',
      after: 'Après',
    },
    momentIntros: {
      before: 'Ce qui se prépare avant l’arrivée des invités.',
      during: 'Ce qui se passe pendant la soirée.',
      after: 'Ce que vous gardez de la soirée.',
    },
    sections: {
      appearance: 'Apparence',
      access: 'QR code et lien',
      print: 'Cartes et affiche',
      invitations: 'Invitations',
      rsvps: 'Réponses',
      missions: 'Missions',
      moderators: 'Modérateurs',
      moderation: 'Modération',
      wall: 'Écran de la salle',
      announcements: 'Annonces',
      challenge: 'Défi photo',
      guestbook: 'Livre d’or',
      reveal: 'Révélation',
      telegram: 'Telegram',
      guests: 'Invités',
      album: 'Album',
      bestOf: 'Best-of',
      book: 'Livre photo',
      share: 'Album partagé',
      stats: 'Statistiques',
      settings: 'Réglages',
    },
    /** One line under each entry, on the lists of the moments' pages. */
    hints: {
      appearance: 'L’ambiance, la couleur, le logo',
      access: 'Le code, le lien et le QR code pour entrer',
      print: 'Le QR code à poser sur les tables',
      invitations: 'Le faire-part et son lien',
      rsvps: 'Qui vient, et combien',
      missions: 'Des idées de photos à relever',
      moderators: 'Modérer à plusieurs',
      moderation: 'Ce qui passe à l’écran',
      wall: 'À ouvrir sur le vidéoprojecteur',
      announcements: 'Un message pour toute la salle',
      challenge: 'Un défi photo chronométré',
      guestbook: 'Les mots laissés par vos invités',
      reveal: 'Quand les photos apparaissent',
      telegram: 'Le groupe relié à la soirée',
      guests: 'Qui a rejoint la soirée',
      album: 'Toutes les photos, en un fichier',
      bestOf: 'Vos photos favorites',
      book: 'Un livre photo à imprimer',
      share: 'Un lien pour ceux qui n’étaient pas là',
      stats: 'Qui a posté quoi, et quand',
      settings: 'Ambiance, horaires, écran',
    },
    newTab: 'ouvre un nouvel onglet',
    notHere: 'Cette page n’existe pas pour cette soirée.',
    backHome: 'Retour à l’accueil de la soirée',
    albumTitle: 'L’album',
    albumIntro: 'Toutes les photos et vidéos publiées, en un fichier ZIP.',
    dangerTitle: 'Supprimer la soirée',
  },
  /* The photo book's own page (spec 26): the live preview beside the settings. */
  bookPage: {
    back: 'Retour à l’évènement',
    coverLegend: 'Couverture',
    previewLabel: 'Aperçu du livre',
    previewNote: 'Aperçu\u00a0: la mise en page finale est faite à la création.',
    summary: (pages: number, photos: number, style: string) =>
      `${t.number(pages)} pages · ${t.number(photos)} photos · style ${style}`,
    refreshing: 'Mise à jour de l’aperçu…',
    failed: 'L’aperçu n’a pas pu être chargé.',
    retry: 'Réessayer',
    empty:
      'Aucune photo n’est publiée pour le moment. Le livre se fera avec les photos publiées : publiez-en depuis la modération.',
    unsupported: 'Le livre photo n’est pas disponible sur ce serveur.',
    prev: 'Pages précédentes',
    next: 'Pages suivantes',
    cover: 'Couverture',
    inside: 'Intérieur de la couverture',
    backCover: 'Quatrième de couverture',
    pageNumber: (n: number) => `Page ${n}`,
    pageNumbers: (a: number, b: number) => `Pages ${a} et ${b}`,
    spreadPosition: (k: number, n: number) => `Double page ${k} sur ${n}`,
    stripLabel: 'Doubles pages',
    stripItem: (label: string) => `Aller à\u00a0: ${label}`,
    big: 'Voir en grand',
    queued: 'En attente de son tour…',
    running: 'Mise en page en cours sur le serveur…',
    workingNote:
      'Le serveur ne donne pas d’avancement. Vous pouvez quitter la page : le livre sera prêt ici.',
  },

  titles: {
    welcome: 'Évènement créé',
    appearance: 'Apparence de l’évènement',
    print: 'Cartes de table et affiche',
    eventBook: 'Livre photo',
    join: 'Rejoindre la soirée',
    upload: 'Envoi de photos',
    feed: 'Les photos de la soirée',
    wall: 'Écran de la soirée',
    gallery: 'Album partagé',
    guestInvite: 'Invitation',
    guestInviteHost: 'Invitations',
    rsvps: 'Réponses',
    rsvpGuests: 'Liste d’invités',
    about: 'À propos',
    notFound: 'Page introuvable',
    login: 'Connexion',
    forgotPassword: 'Mot de passe oublié',
    resetPassword: 'Nouveau mot de passe',
    signup: 'Créer un compte',
    signupSent: 'Inscription envoyée',
    signupConfirm: 'Confirmer votre adresse',
    invitation: 'Invitation',
    changePassword: 'Changer de mot de passe',
    security: 'Sécurité et e-mails',
    deleteAccount: 'Supprimer mon compte',
    dashboard: 'Vos évènements',
    newEvent: 'Nouvel évènement',
    event: 'Évènement',
    eventAccess: 'QR code et lien',
    eventMissions: 'Missions',
    eventModerators: 'Modérateurs',
    eventAnnouncements: 'Annonces',
    eventChallenge: 'Défi photo',
    eventGuestbook: 'Livre d’or',
    eventReveal: 'Révélation',
    eventTelegram: 'Telegram',
    eventGuests: 'Invités',
    eventAlbum: 'Album',
    eventBestOf: 'Best-of',
    eventShare: 'Album partagé',
    eventBefore: 'Préparer la soirée',
    eventDuring: 'Pendant la soirée',
    eventAfter: 'Après la soirée',
    moderation: 'Modération',
    stats: 'Statistiques de la soirée',
    settings: 'Réglages de l’évènement',
    customAmbiance: 'Ambiance Sur mesure',
    clientSpace: 'Espace client',
    site: 'Console de l’opérateur',
    siteClient: 'Client',
    siteAccounts: 'Comptes de l’instance',
    siteAudit: 'Journal de l’instance',
    siteTakedown: 'Retrait de contenu',
    siteSignups: 'Inscriptions',
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
