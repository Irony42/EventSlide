import { formattersFor } from './formatters'
import type { GuestTranslations } from './translations'

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

export const en: GuestTranslations = {
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
    missionSelect: (prompt: string) => `Choose the mission “${prompt}”`,
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
}
