import { formattersFor } from './formatters'
import type { UiText } from './translations'

/**
 * English, for the guest surface.
 *
 * Only the sections a guest can read: `translations.ts` explains why the admin and
 * moderation consoles stay French, and the type on this table is what enforces it — a
 * host-facing section added here is an excess property and fails the build.
 *
 * Register: "you", polite, sentence case, no exclamation marks. The French table is
 * written in the vouvoiement the app uses everywhere; English has one form, so what
 * carries the same distance is the absence of slang and of contractions in refusals.
 *
 * Typography: the apostrophe is U+2019 (’), never the ASCII one — `orthography.test.ts`
 * refuses the ASCII apostrophe in every language, French included.
 */

const t = formattersFor('en')

export const en: UiText = {
  app: {
    name: 'EventSlide',
    loading: 'Loading…',
    retry: 'Try again',
    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    back: 'Back',
    confirm: 'Confirm',
    language: 'Language',
  },

  join: {
    title: 'Join the gallery',
    codeLabel: 'Event code',
    codeHint: 'Six characters, printed on the card or the QR code.',
    nameLabel: 'Your first name',
    nameHint: 'It will appear under your photos. You can leave it empty.',
    submit: 'Join',
    submitting: 'Connecting…',
    welcome: (eventName: string) => `Welcome to ${eventName}`,
    anonymous: 'Stay anonymous',
  },

  upload: {
    title: 'Your photos',
    intro: 'Add your photos. They will appear on the screen once they are approved.',
    addPhotos: 'Add photos',
    takePhoto: 'Take a photo',
    captionLabel: 'Caption',
    captionHint: (max: number) => `${t.number(max)} characters maximum. Optional.`,
    send: 'Send',
    sending: 'Sending…',
    sendCount: (count: number) =>
      t.count(count, { one: 'Send the photo', other: `Send the ${t.number(count)} photos` }),
    queueEmpty: 'No photos selected yet.',
    itemPending: 'Waiting',
    itemUploading: 'Sending',
    itemDone: 'Sent',
    itemDuplicate: 'Already sent',
    itemFailed: 'Failed',
    remove: 'Remove',
    mine: 'Your uploads',
    statusPending: 'Waiting for approval',
    statusPublished: 'On the screen',
    statusRejected: 'Not selected',
    statusHidden: 'Taken off the screen',
    deleteOwn: 'Delete',
    deleteOwnConfirm: 'Delete this photo? This cannot be undone.',
    graceOver: 'The time to delete this photo yourself has passed.',
    thanks: 'Thank you, your photos have arrived.',
    sendMore: 'Send more photos',

    itemPreparing: 'Preparing…',
    queueLabel: 'Photos to send',
    queueSummary: (done: number, total: number) => `${t.number(done)} of ${t.number(total)} sent`,
    queueFailed: (count: number) =>
      t.count(count, {
        one: 'One upload failed.',
        other: `${t.number(count)} uploads failed.`,
      }),
    itemAlt: (position: number) => `Photo ${t.number(position)} to send`,
    itemProgress: (position: number) => `Sending photo ${t.number(position)}`,
    removeItem: (position: number) => `Remove photo ${t.number(position)}`,
    retryItem: (position: number) => `Send photo ${t.number(position)} again`,
    captionRemaining: (remaining: number) =>
      t.count(remaining, {
        one: `${t.number(remaining)} character left.`,
        other: `${t.number(remaining)} characters left.`,
      }),
    signedAs: (name: string) => `Your photos will appear under the name ${name}.`,
    signedAnonymous: 'Your photos will appear without a name.',
    mineEmpty: 'You have not sent any photos yet.',
    mineFailed: 'Your uploads could not be shown. Try again.',
    mineAlt: 'Your photo',
    deleteOwnNumbered: (position: number) => `Delete photo ${t.number(position)}`,
    notJoinedTitle: 'Join the gallery to send your photos',
    notJoinedHint: 'Scan the QR code again, or type the event code.',
    notJoinedAction: 'Enter the code',

    /* ---- Added by photo missions (ROADMAP 2.1). ---- */

    missionsTitle: 'Missions',
    missionsHint: 'Tap a mission, then send your photo.',
    missionDone: 'Done',
    missionDoneByRoom: 'Already photographed',
    missionFor: (prompt: string) => `These photos will count towards “${prompt}”.`,

    itemQueued: 'Waiting for the network',
    itemExpiredHint: 'This photo could not be sent. Send it again if you still have it.',
    offlineTitle: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo is waiting for the network`,
        other: `${t.number(count)} photos are waiting for the network`,
      }),
    offlineHint:
      'They are saved on your phone and will leave as soon as the connection is back. You can close this page.',
    offlineSending: 'Sending the waiting photos…',
    offlineRetry: 'Send now',

    installTitle: 'Keep the gallery within reach',
    installHint:
      'Add it to your home screen to find the gallery again later, without looking for the QR code.',
    installIosHint: 'Open the Share menu, then choose “Add to Home Screen”.',
    installAction: 'Add to home screen',
    installDismiss: 'Hide this suggestion',

    clipSection: 'Video',
    addClip: 'Add a video',
    recordClip: 'Record a video',
    clipHint: (seconds: number, megabytes: number) =>
      `${t.number(seconds)} seconds and ${t.number(megabytes)} MB maximum. The video is played without sound.`,
    clipSend: 'Send the video',
    clipChange: 'Choose another video',
    clipDiscard: 'Remove this video',
    clipCancel: 'Cancel the upload',
    clipAlreadySent:
      'This video is already on the server. It will be processed, then offered to the organiser.',
    clipChosen: 'Video ready to send',
    clipSize: (megabytes: number) => `${t.number(megabytes)} MB`,
    clipTooLarge: (megabytes: number) =>
      `This video is over ${t.number(megabytes)} MB. Record a shorter sequence.`,
    clipTooLong: (seconds: number) =>
      `This video is over ${t.number(seconds)} seconds. Record a shorter sequence.`,
    clipNotAVideo: 'This file is not a video.',
    clipUploading: 'Sending the video…',
    clipQueued: 'In the queue…',
    clipRunning: 'Processing the video…',
    clipDone: 'Video sent. It will appear on the screen once it is approved.',
    clipProgress: 'Sending the video',
    clipQueueFullRetry: (seconds: number) =>
      seconds <= 1
        ? 'A lot of videos are being processed. Try again in a moment.'
        : `A lot of videos are being processed. Try again in ${t.number(seconds)} seconds.`,
    clipQueueFreed: 'The queue has cleared. You can send the video again.',
    clipStillWorking:
      'This video is taking longer than expected to process. Reload the page in a few minutes to find out whether it worked.',
    clipNotQueued:
      'Videos are not held on your phone: they are too heavy. Try again when the connection is back.',
    mineClipAlt: 'Your video',
    mineClipBadge: 'Video',
    mineClipLength: (seconds: number) => `Video · ${t.number(seconds)} s`,
  },

  ui: {
    dialogClose: 'Close the dialog',
    notifications: 'Notifications',
    dismissNotification: 'Hide this notification',
    percent: (value: number) => t.percent(value),
    optional: 'Optional',
  },

  shell: {
    skipToContent: 'Skip to main content',
    sessionChecking: 'Checking your session…',
    sessionFailed: 'Your session could not be checked. Check your network, then try again.',
    crashTitle: 'This screen stopped',
    crashHint: 'Nothing is lost: your photos are on the server. Try again to carry on.',
    notFoundTitle: 'Page not found',
    notFoundHint: 'This address does not exist. Check the link, or go back to the start.',
    notFoundHome: 'Back to the start',
    comingSoon: 'This screen is coming soon.',
  },

  errors: {
    unknown: 'Something went wrong. Try again in a moment.',
    network: 'The connection dropped. Check your network, then try again.',
    'request.invalid': 'The information sent is not valid.',

    'auth.invalidCredentials': 'Wrong email address or password.',
    'auth.required': 'Sign in to continue.',
    'auth.forbidden': 'You do not have the rights for this action.',

    'event.notFound': 'This code does not match any open gallery.',
    'event.notAcceptingUploads': 'This gallery is no longer accepting photos.',
    'event.quotaExceeded': 'The gallery is full. Let the organiser know.',
    'event.slugTaken': 'This address is already in use.',
    'event.immutable': 'This event is archived and can no longer be changed.',
    'event.illegalTransition': 'This change of state is not possible.',

    'guest.wrongEvent': 'Your access does not match this gallery.',
    'guest.revoked': 'Your access was withdrawn by the organiser.',
    'guestToken.expired': 'Your access has expired. Scan the QR code again.',
    'guestToken.malformed': 'Your access is no longer valid. Scan the QR code again.',
    'guestToken.badSignature': 'Your access is no longer valid. Scan the QR code again.',

    'photo.notFound': 'This photo no longer exists.',
    'photo.illegalTransition': 'This action is not possible on this photo.',
    'photo.tooManyForGuest': 'You have reached the number of photos allowed.',

    'image.unsupportedFormat': 'This file is not a photo. Accepted formats: JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'This photo looks damaged. Try another one.',
    'image.tooManyPixels': 'This photo is too large. Make it smaller, then try again.',
    'image.animated': 'Animated images are not accepted.',
    'image.renderFailed': 'This photo could not be processed. Try another one.',
    'upload.tooLarge': 'This photo is over the maximum size.',
    'upload.tooManyFiles': 'Too many photos at once. Send them in several batches.',

    'caption.tooLong': 'Caption too long.',
    'caption.empty': 'The caption is empty.',

    'password.tooShort': 'Password too short.',
    'password.tooLong': 'Password too long.',
    'password.tooCommon': 'This password is too common.',
    'password.sameAsEmail': 'The password cannot be your email address.',
    'password.sameAsName': 'The password cannot be your name.',
    'password.tooRepetitive': 'This password is too repetitive.',
    'password.unchanged': 'Choose a password different from the current one.',
    'password.mismatch': 'The two passwords do not match.',

    'eventName.empty': 'Give your event a name.',
    'eventName.tooShort': 'This name is too short.',
    'eventName.tooLong': 'This name is too long.',
    'slug.tooShort': 'The address must be at least two characters.',
    'slug.tooLong': 'This address is too long.',
    'slug.malformed': 'The address accepts only unaccented letters, digits and hyphens.',
    'slug.reserved': 'This address is reserved. Choose another one.',
    'eventSettings.graceSecondsInvalid': 'This deletion window is not accepted.',
    'eventSettings.retentionDaysInvalid': 'This retention period is not accepted.',
    'eventSettings.maxPhotosPerGuestInvalid': 'This number of photos per guest is not accepted.',
    'eventSettings.wallLanguageInvalid':
      'This language is not available. Choose one from the list.',
    'email.malformed': 'This email address is not valid.',
    'user.notFound': 'No account matches this email address.',
    'membership.alreadyExists': 'This person already moderates this event.',

    'displayName.tooLong': 'First name too long.',
    'joinCode.wrongLength': 'The code is six characters long.',
    'joinCode.malformed': 'This code contains an unexpected character.',

    'reaction.rateLimited': 'Gently — wait a moment before reacting again.',
    'rate.limited': 'Too many attempts. Wait a moment.',

    'event.captionsNotAllowed': 'Captions are not enabled for this gallery.',
    'event.reactionsDisabled': 'Reactions are not enabled for this gallery.',
    'event.guestSelfDeleteDisabled': 'The organiser does not let guests delete their photos.',
    'photo.captionEditForbidden': 'This caption can no longer be changed.',
    'photo.deleteForbidden': 'You can no longer delete this photo yourself.',
    'reaction.alreadyExists': 'You have already reacted this way to this photo.',
    'reaction.notPublished': 'This photo is not on the screen yet.',
    'reaction.notFound': 'This reaction no longer exists.',
    'upload.noFiles': 'No photo was received. Select one, then try again.',
    'upload.unexpectedField': 'This upload could not be read. Try again.',
    'request.csrfMissing': 'This page has expired. Reload it, then try again.',
    'request.csrfMismatch': 'This page has expired. Reload it, then try again.',

    'event.photoLimitReached': 'You have reached the number of photos allowed.',
    'photo.pixelBudgetExceeded': 'This photo is too large. Make it smaller, then try again.',
    'upload.rejected': 'This upload could not be read. Try again.',
    'event.notModeratable': 'This event is archived: decisions no longer apply.',
    'membership.lastOwner': 'An event must keep at least one owner.',
    'membership.notFound': 'This person does not moderate this event.',
    'guest.notFound': 'This guest is no longer in the list. Refresh the page.',

    'event.scheduleOutOfOrder': 'The closing must come after the opening.',
    'event.scheduleInPast':
      'That time has already passed. Check the date: for the end of the evening, choose the next day.',
    'event.scheduleInvalid': 'These dates cannot be read. Choose them again.',

    'event.clipsNotAllowed': 'Videos are not enabled for this gallery.',
    'clip.queueFull': 'A lot of videos are being processed. Try again in a minute.',
    'clip.transcoderUnavailable': 'This server cannot process videos. Let the organiser know.',
    'clip.unsupportedFormat': 'This file is not a video. Accepted formats: MP4, MOV, WebM.',
    'clip.corrupt': 'This video looks damaged. Try another one.',
    'clip.noVideoStream': 'This file contains no picture. Try another one.',
    'clip.durationUnknown': 'The length of this video cannot be read. Try another one.',
    'clip.tooShort': 'This video is too short.',
    'clip.tooLong': 'This video is too long. Record a shorter sequence.',
    'clip.transcodeFailed': 'This video could not be processed. Try another one.',
    'clip.transcodeTimedOut': 'This video is too heavy to process. Try another one.',
    'clip.storageFailed': 'This video could not be saved. Try again.',
    'clip.sourceMissing': 'This video is no longer available. Send it again.',
    'clip.stageFailed': 'This video could not be received. Try again.',
    'clip.abandoned': 'Processing this video was interrupted. Send it again.',
    'clip.sourceByteSizeInvalid': 'This file is empty. Choose another one.',
    'clip.transcodeCancelled':
      'Processing this video was interrupted. It will be picked up again automatically.',
    'clip.probeUnreadable': 'This video could not be analysed. Try again.',
    'clip.pixelBudgetExceeded': 'This video is too large. Record at a lower resolution.',
    'clipJob.notFound': 'This video no longer exists.',
    'clipJob.illegalTransition': 'This action is not possible on this video.',
    'photo.rangeNotSatisfiable': 'That part of the file does not exist.',

    /* ---- Added by photo missions (ROADMAP 2.1). ---- */
    'mission.notFound': 'That mission no longer exists. Reload the page.',
    'mission.duplicate': 'That mission already exists.',
    'mission.limitReached': 'You have reached the maximum number of missions.',
    'mission.promptEmpty': 'Write what the mission asks for.',
    'mission.promptTooLong': 'That wording is too long for the screen.',
    'mission.promptInvalid': 'That wording is not valid.',

    'eventTheme.accentHueInvalid': 'That colour is not recognised. Choose one from the list.',
    'eventTheme.accentUnreadable':
      'That colour would not be readable on the screen in the room. Choose one from the list.',
    'eventTheme.accentTooCloseToStatus':
      'That colour is too close to the application’s status colours. Choose another one.',
  },

  moderation: {
    title: 'Moderation',
    intro: 'Nothing reaches the screen without your approval.',
    pending: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo waiting`,
        other: `${t.number(count)} photos waiting`,
      }),
    empty: 'Nothing to approve right now.',
    emptyHint: 'New photos arrive here automatically.',
    publish: 'Publish',
    reject: 'Reject',
    hide: 'Take off the screen',
    undo: 'Undo',
    undone: 'Decision undone.',
    selectAll: 'Select all',
    clearSelection: 'Clear the selection',
    bulkPublish: (count: number) => `Publish (${t.number(count)})`,
    bulkReject: (count: number) => `Reject (${t.number(count)})`,
    bulkSkipped: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo skipped: that action was not possible.`,
        other: `${t.number(count)} photos skipped: that action was not possible.`,
      }),
    filterAll: 'All',
    filterPending: 'Waiting',
    filterPublished: 'On the screen',
    filterRejected: 'Rejected',
    filterHidden: 'Off the screen',
    by: (name: string) => `by ${name}`,
    byAnonymous: 'Anonymous guest',
    shortcuts: 'Shortcuts',
    shortcutsHint: 'J / K to move, P to publish, R to reject, Z to undo.',

    /* ---- Added by features/moderation. Keep additions inside this block. ---- */
    shortcutsMore: 'H to take off the screen, Space to select, Esc to clear the selection.',
    queueLabel: 'Photos to moderate',
    filterLabel: 'Filter by state',
    emptyFiltered: 'No photos in this category.',
    emptyFilteredHint: 'Change the filter to see the other photos.',
    loadFailed: 'The moderation queue could not be loaded.',
    live: 'Live updates',
    liveLost: 'Connection lost — reconnecting.',
    // The word beside the border colour and the icon, so the status survives stage
    // lighting and a red-green colourblind host.
    statePending: 'Waiting',
    statePublished: 'Published',
    stateRejected: 'Rejected',
    stateHidden: 'Taken off the screen',
    selected: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo selected`,
        other: `${t.number(count)} photos selected`,
      }),
    anonymousInName: 'the anonymous guest',
    selectPhoto: (author: string) => `Select the photo by ${author}`,
    publishPhoto: (author: string) => `Publish the photo by ${author}`,
    rejectPhoto: (author: string) => `Reject the photo by ${author}`,
    hidePhoto: (author: string) => `Take the photo by ${author} off the screen`,
    enlargePhoto: (author: string) => `Enlarge the photo by ${author}`,
    photoOf: (author: string) => `Photo by ${author}`,
    photoAlt: (author: string) => `Photo sent by ${author}`,
    photoAltWithCaption: (caption: string, author: string) =>
      `${caption} — photo sent by ${author}`,
    previousPhoto: 'Previous photo',
    nextPhoto: 'Next photo',
    bulkHide: (count: number) => `Take off the screen (${t.number(count)})`,
    published: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo published.`,
        other: `${t.number(count)} photos published.`,
      }),
    refused: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo rejected.`,
        other: `${t.number(count)} photos rejected.`,
      }),
    removed: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo taken off the screen.`,
        other: `${t.number(count)} photos taken off the screen.`,
      }),
    decisionFailed: 'The decision could not be saved. Try again.',
    undoFailed: 'The decision could not be undone. Try again.',
    dimensions: (width: number, height: number) => `${width} × ${height} pixels`,
    noCaption: 'No caption',

    /* ---- Added by short video clips (roadmap 1.4). ---- */

    videoBadge: 'Video',
    videoLength: (seconds: number) => `Video · ${seconds} s`,
    watchVideo: (author: string) => `Watch the video by ${author}`,
    playVideo: (author: string) => `Play the video by ${author}`,
    pauseVideo: (author: string) => `Pause the video by ${author}`,
    videoOf: (author: string) => `Video by ${author}`,
    videoAlt: (author: string) => `Video sent by ${author}`,
    videoAltWithCaption: (caption: string, author: string) =>
      `${caption} — video sent by ${author}`,
    videoMuted: 'The sound could not be turned on: this video is playing without sound.',
    videoUnplayable: 'This video cannot be played here. Only the preview frame is shown.',
  },

  wall: {
    empty: 'The first photos will arrive soon',
    emptyHint: 'Scan the QR code to send yours.',
    joinPrompt: 'Join the gallery',
    reactions: 'Reactions',
    offline: 'Connection lost — reconnecting',
    paused: 'Slideshow paused',

    /* ---- Added by features/wall. Keep additions inside this block. ---- */
    codeLabel: 'Event code',
    // The accessible name of the inline QR. Read by nothing in the room, but the wall
    // is also opened on a laptop while a host sets the projector up.
    qrTitle: 'QR code to join the gallery',
    // The alt text of a photo. 1.0 used the filename, which reads aloud as IMG_4821.jpg.
    photoBy: (name: string) => `Photo sent by ${name}`,
    photoByAnonymous: 'Photo sent by a guest',
    errorTitle: 'The photos could not be loaded',
    errorHint: 'Trying again. Check the venue network if the screen stays empty.',
    dismissJoinCard: 'Hide the code reminder',
    shortcuts: 'Keyboard shortcuts',
    shortcutsHint:
      'Space pauses, the arrow keys change photo, F goes full screen, L changes the layout.',

    /* ---- Wall layouts (roadmap 2.3). Keep additions to them inside this block. ---- */
    layoutNames: {
      spotlight: 'Full screen',
      mosaic: 'Mosaic',
      polaroid: 'Polaroid',
      filmstrip: 'Filmstrip',
      collage: 'Collage',
      split: 'Side by side',
    },
    layoutOrder: (names: readonly string[]) => `Layouts, in order: ${names.join(', ')}.`,

    /* ---- Short video clips (roadmap 1.4). Keep additions inside this block. ---- */
    videoBy: (name: string) => `Video sent by ${name}`,
    videoByAnonymous: 'Video sent by a guest',

    /* ---- Added by photo missions (ROADMAP 2.1). Keep additions inside this block. ---- */

    missionsTitle: 'Missions',
    missionDone: 'Done',
    missionGuests: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} guest`,
        other: `${t.number(count)} guests`,
      }),
  },

  admin: {
    title: 'Administration',
    events: 'Your events',
    newEvent: 'New event',
    eventName: 'Event name',
    eventNameHint: 'Visible to your guests, for example “Camille & Sacha”.',
    slug: 'Address',
    joinCode: 'Access code',
    rotateJoinCode: 'Change the code',
    rotateJoinCodeHint:
      'Guests who have already joined stay joined. The new code replaces the old one immediately.',
    qrCode: 'QR code',
    qrCodeHint: 'To print and put on the tables.',
    openWall: 'Open the screen',
    openModeration: 'Moderate',
    download: 'Download the album',
    statusDraft: 'Draft',
    statusLive: 'Live',
    statusClosed: 'Closed',
    statusArchived: 'Archived',
    goLive: 'Open to guests',
    closeEvent: 'Close the event',
    reopenEvent: 'Reopen',
    archiveEvent: 'Archive',
    photos: (count: number) =>
      t.count(count, { one: `${t.number(count)} photo`, other: `${t.number(count)} photos` }),
    guests: (count: number) =>
      t.count(count, { one: `${t.number(count)} guest`, other: `${t.number(count)} guests` }),
    storageUsed: (used: string, total: string) => `${used} of ${total}`,
    settings: 'Settings',
    moderationMode: 'Moderation',
    moderationManual: 'Approve every photo',
    moderationAuto: 'Publish automatically',
    moderationAutoWarning:
      'Photos and videos will appear on the screen with nobody having approved them. Keep this for events among people you know well.',
    allowCaptions: 'Allow captions',
    allowReactions: 'Allow reactions',
    allowClips: 'Allow videos',
    allowClipsHint:
      'Guests can send short videos as well as photos. When the box is unticked, videos are refused: because you unticked it, because the template chosen when the event was created set it that way, or because the gallery is older than this feature. Tick it to allow them.',
    allowGuestSelfDelete: 'Allow guests to delete their photos',

    /* ---- The language the room’s screen speaks (roadmap 1.5). ---- */

    wallLanguage: 'Language of the screen in the room',
    wallLanguageHint:
      'The words on the screen in the room: “Join the gallery”, “Missions”, the waiting messages. What you and your guests write — the event name, the captions, the mission prompts — is shown as it is and is never translated. Your guests choose their own language on their phone; this setting does not apply to them.',

    /* ---- Per-event theming (roadmap 2.2). ---- */
    theme: 'Appearance',
    themeHint:
      'Visible to your guests and on the screen in the room. The colours offered stay readable at ten metres.',
    themeAccent: 'Colour',
    themeAccentNames: {
      violet: 'Purple',
      rose: 'Pink',
      azure: 'Blue',
      teal: 'Teal',
    },
    themeFonts: 'Typeface',
    /** The honest scope, said once: the phone of a guest downloads nothing for this. */
    themeFontsHint: 'Applied to the screen in the room only.',
    themeFontsNames: {
      sans: 'Modern',
      serif: 'Classic',
    },
    themeFrame: 'Photo frame',
    themeFrameNames: {
      soft: 'Rounded corners',
      square: 'Square corners',
      round: 'Very rounded corners',
    },
    themeMaterial: 'Panel material',
    themeMaterialHint:
      'Glass lets you sense what passes underneath; the plain surface is opaque. The difference is subtle, and it only affects the upload screen your guests see: your moderation console and the screen in the room do not change.',
    themeMaterialNames: {
      glass: 'Frosted glass',
      plain: 'Plain surface',
    },

    /* ---- Event templates (roadmap 3.5). ---- */
    template: 'Type of event',
    templateHint:
      'A starting point, suited to the kind of evening. All these settings can still be changed at any time, before the event and during it.',
    templateNone: 'No template',
    templateNoneSummary:
      'Default settings: every photo approved before it reaches the screen, kept indefinitely.',
    templateChanges: 'This template sets:',
    templateClipsOn: 'Videos allowed',
    templateClipsOff: 'Videos turned off',
    templateNames: {
      wedding: 'Wedding',
      birthday: 'Birthday',
      conference: 'Conference',
      party: 'Party',
    },

    retention: 'Automatic deletion',
    retentionNever: 'Never',
    retentionDays: (days: number) =>
      t.count(days, {
        one: `${t.number(days)} day after closing`,
        other: `${t.number(days)} days after closing`,
      }),
    retentionUnlimited: 'Kept indefinitely',
    moderators: 'Moderators',
    inviteModerator: 'Invite a moderator',

    /* ---- Added by features/admin (auth, event management). ---- */
    loading: 'Loading your events…',
    loadFailed: 'Loading failed',
    eventLoading: 'Loading the event…',
    eventsEmpty: 'No events yet.',
    eventsEmptyHint: 'Create your first event, then print its QR code to put on the tables.',
    create: 'Create the event',
    slugHint: 'Optional. Leave it empty to derive it from the name.',
    slugPreviewLabel: 'Gallery address',
    slugPreviewEmpty: 'Type a name to see the address.',
    eventCreated: (name: string) => `${name} is ready. Print the QR code whenever you like.`,
    joinCodeHint: 'To give to guests who cannot scan the QR code.',
    eventControls: 'Event controls',
    joinLink: 'Invitation link',
    printQr: 'Print the QR code',
    qrScanPrompt: 'Scan to send your photos.',
    qrAlt: (eventName: string) => `QR code to join ${eventName}`,
    storageLabel: 'Photo storage used',
    storage: (used: string) => `${used} used`,
    statusSaved: 'The new state is saved.',
    rotateJoinCodeTitle: 'Change the access code?',
    codeRotated: 'The access code has been changed. The old one no longer works.',
    settingsSaved: 'Settings saved.',
    settingsReadOnly: 'This event is archived: its settings can no longer be changed.',
    retentionHint: 'The photos are deleted this long after the event is closed.',
    selfDeleteGrace: 'Deletion window',
    selfDeleteGraceHint: 'During this window, a guest can delete their own photo.',
    graceNone: 'No window',
    graceSeconds: (seconds: number) =>
      t.count(seconds, {
        one: `${t.number(seconds)} second`,
        other: `${t.number(seconds)} seconds`,
      }),
    graceMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `${t.number(minutes)} minute`,
        other: `${t.number(minutes)} minutes`,
      }),
    graceHours: (hours: number) =>
      t.count(hours, { one: `${t.number(hours)} hour`, other: `${t.number(hours)} hours` }),
    maxPhotosPerGuest: 'Photos per guest',
    maxPhotosUnlimited: 'No limit',
    guestList: 'Guests',
    guestsEmpty: 'Nobody has joined the gallery yet.',
    guestsEmptyHint: 'Guests appear here as soon as they scan the QR code.',
    lastSeen: (when: string) => `Last active: ${when}`,
    dateUnknown: 'Date unknown',
    guestRevokedBadge: 'Access withdrawn',
    revokeGuest: 'Withdraw access',
    revokeGuestTitle: 'Withdraw this guest’s access?',
    revokeGuestHint:
      'Their photos already on the screen stay there, but they will not be able to send any more.',
    guestRevoked: 'The access has been withdrawn.',
    moderatorsEmpty: 'You are the only person moderating this event.',
    moderatorEmail: 'Moderator’s email address',
    moderatorEmailHint: 'They will get rights on this event only.',
    moderatorPassword: 'Temporary password',
    moderatorPasswordHint: (min: number) =>
      `At least ${min} characters. No email is sent: read this password out to the moderator. They will choose another one when they first sign in.`,
    inviteSubmit: 'Invite',
    moderatorInvited: (email: string) =>
      `${email} can now moderate this event. Give them the temporary password.`,
    moderatorInvitedExisting: (email: string) =>
      `${email} can now moderate this event. This account already existed: it keeps its usual password.`,
    revokeModerator: 'Remove',
    revokeModeratorTitle: 'Remove this moderator?',
    revokeModeratorHint: 'They will lose access to this event. Their past decisions are kept.',
    moderatorRevoked: 'The moderator has been removed.',
    roleOwner: 'Organiser',
    roleModerator: 'Moderator',
    lastOwnerHint: 'The last organiser cannot be removed.',
    purge: 'Delete the event',
    purgeTitle: 'Permanently delete this event?',
    purgeWarning:
      'All the photos, the guests and the album will be deleted. This cannot be undone.',
    purgeConfirmLabel: 'Event address',
    purgeConfirmHint: (slug: string) => `Type “${slug}” to confirm the deletion.`,
    purged: (name: string) => `${name} has been deleted.`,

    /* ---- Scheduled opening and closing (docs/ROADMAP.md §3.4). ---- */
    schedule: 'Automatic opening and closing',
    scheduleHint:
      'Leave this empty to open and close the event yourself. The times are your computer’s, so they are the times where the party is.',
    scheduleOpenAt: 'Open to guests on',
    scheduleCloseAt: 'Close the event on',
    scheduleCloseAtHint: 'The photos and the album are kept: closing deletes nothing.',
    scheduleSaved: 'The schedule has been saved.',
    scheduleNone: 'No schedule: you open and close the event yourself.',
    scheduleArmed: (opensAt: string, closesAt: string) =>
      `Opens on ${opensAt}, closes on ${closesAt}.`,
    scheduleOpensOnly: (opensAt: string) => `Opens on ${opensAt}. You will close it yourself.`,
    scheduleClosesOnly: (closesAt: string) => `Closes on ${closesAt}. You will open it yourself.`,
    scheduleSave: 'Save the schedule',
    scheduleDiscarded: (when: string) =>
      `The automatic schedule could not be applied on ${when}: the event could not change state at that moment. It has been cleared. Save a new one if you still want one.`,

    /* ---- Added by photo missions (ROADMAP 2.1). Keep additions inside this block. ---- */

    missionsTitle: 'Missions',
    missionsHint:
      'A short list of prompts that your guests see as a checklist, and that the screen shows in a corner.',
    missionsEmpty: 'No missions yet.',
    missionPrompt: 'Prompt',
    missionPromptHint: (max: number) =>
      `${t.number(max)} characters maximum. Written in the language of the event: it is not translated.`,
    missionScope: 'To be answered',
    missionScopeGuest: 'By each guest',
    missionScopeEvent: 'Once for the event',
    missionScopeHint:
      'By each guest: everyone can answer it. Once: the first approved photo ticks it for everybody.',
    missionAdd: 'Add the mission',
    missionSave: 'Save',
    missionCancel: 'Cancel',
    missionEditShort: 'Edit',
    missionDeleteShort: 'Delete',
    missionEdit: (prompt: string) => `Edit “${prompt}”`,
    missionDelete: (prompt: string) => `Delete “${prompt}”`,
    missionDeleteTitle: 'Delete this mission?',
    missionDeleteAction: 'Delete the mission',
    missionDeleteConfirm:
      'The photos already sent stay in the album: they will simply no longer count towards this mission.',
    missionAdded: 'The mission has been added.',
    missionSaved: 'The mission has been saved.',
    missionDeleted: 'The mission has been deleted.',
    missionAnswered: (photos: number, guests: number) =>
      `${t.count(photos, {
        one: `${t.number(photos)} photo`,
        other: `${t.number(photos)} photos`,
      })}, ${t.count(guests, {
        one: `${t.number(guests)} guest`,
        other: `${t.number(guests)} guests`,
      })}`,
    missionUnanswered: 'Not answered yet',
    missionsFull: (max: number) =>
      `${t.number(max)} missions at most: that is what keeps the list readable at ten metres.`,
  },

  auth: {
    title: 'Sign in',
    email: 'Email address',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    logout: 'Sign out',
    changePassword: 'Change your password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    newPasswordHint: (min: number) => `At least ${min} characters. A phrase is safer than a word.`,
    confirmPassword: 'Confirm the new password',
    mustChangePassword: 'Choose a password before you continue.',

    /* ---- Added by features/auth. ---- */
    changePasswordIntro: 'Choose a password you do not use anywhere else.',
    passwordSaved: 'Password saved.',
  },

  mobileModeration: {
    title: 'Moderation on a phone',
    intro: 'Swipe the photo right to publish, left to reject.',
    releaseToPublish: 'Release to publish',
    releaseToReject: 'Release to reject',
    nowDeciding: (photo: string) => `Photo to moderate. ${photo}`,
    undoLast: 'Undo the last decision',
    undoUnavailable: 'Only publishing can be undone.',
  },
}
