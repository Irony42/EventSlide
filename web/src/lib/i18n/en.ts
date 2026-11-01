import { formattersFor } from './formatters'
import type { UiText } from './translations'

/**
 * English, for every surface: the guest’s phone, the host’s and the moderators’
 * consoles, and the projected wall.
 *
 * The type on this table is `UiText` — the whole of `fr.ts`, every literal widened to
 * `string` — so a key added to the French table fails the build here until this one
 * carries it. `translations.ts` has the argument, including the guest-only one it
 * reversed.
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
    loadFailed: 'Loading failed',
    retry: 'Try again',
    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    confirm: 'Confirm',
    language: 'Language',
  },

  join: {
    title: 'Join the event',
    codeLabel: 'Event code',
    codeHint: 'Six characters, printed on the card or the QR code.',
    nameLabel: 'Your first name',
    nameHint: 'It will appear under your photos. You can leave it empty.',
    submit: 'Join',
    submitting: 'Connecting…',
    welcome: (eventName: string) => `Welcome to ${eventName}`,
    anonymous: 'Stay anonymous',
    /* Navigation pass, batch A: leaving a wrong event, a code that opens nothing, the way to the organiser area. */
    notYourEvening: 'Not your event?',
    notOpenHint:
      'If you scanned a QR code, the event may not be open yet, or it may be over. Try again in a moment, or ask the organiser.',
    organiserLink: 'Organiser area',
  },

  upload: {
    intro: 'Add your photos. They will appear on the screen once they are approved.',
    addPhotos: 'Add photos',
    takePhoto: 'Take a photo',
    captionLabel: 'Caption',
    captionHint: (max: number) => `${t.number(max)} characters maximum. Optional.`,
    send: 'Send',
    sendCount: (count: number) =>
      t.count(count, { one: 'Send the photo', other: `Send the ${t.number(count)} photos` }),
    queueEmpty: 'No photos selected yet.',
    itemPending: 'Ready',
    itemUploading: 'Sending',
    itemDone: 'Sent',
    itemDuplicate: 'Already sent',
    itemFailed: 'Failed',
    mine: 'Your uploads',
    statusPending: 'Waiting for approval',
    statusPublished: 'On the screen',
    statusRejected: 'Not selected',
    statusHidden: 'Taken off the screen',
    deleteOwn: 'Delete',
    deleteOwnConfirm: 'Delete this photo? This cannot be undone.',
    eraseOpen: 'Delete everything I sent',
    eraseTitle: 'Delete everything?',
    eraseBody:
      'Your photos, videos, captions, reactions and first name will be erased from the event: from the screen, the album and the organiser’s list. This cannot be undone.',
    eraseLimits:
      'A copy the organiser has already saved, or that someone captured with a screenshot, cannot be taken back.',
    eraseConfirm: 'Yes, delete everything',
    eraseCancel: 'No, keep them',
    eraseFailed: 'The deletion did not go through. Try again, or ask the organiser.',
    eraseDoneTitle: 'Done',
    eraseDone:
      'Everything you had sent has been deleted from the event. This phone is no longer linked to it.',
    eraseLostAccess:
      'New phone, or lost access? Ask the organiser to delete your photos: they can do it from their own area.',
    revokedTitle: 'Your access was removed',
    revokedBody:
      'The organiser removed your access, so you can no longer send photos. You can still delete everything you sent.',

    itemPreparing: 'Preparing…',
    queueLabel: 'Photos to send',
    queueSummary: (done: number, total: number) => `${t.number(done)} of ${t.number(total)} sent`,
    queueFailed: (count: number) =>
      t.count(count, {
        one: 'One upload failed.',
        other: `${t.number(count)} uploads failed.`,
      }),
    /**
     * What the pane says once every photo of the batch has arrived, in one line: how many, and
     * how many of them the event already held. The rows behind it keep each photo's own word.
     * Counted by `t.count`, so the agreement is the language's own, zero included.
     */
    queueDone: (arrived: number, already: number) => {
      if (already > 0 && already === arrived) {
        return t.count(arrived, {
          one: 'This photo was already there',
          other: `These ${t.number(arrived)} photos were already there`,
        })
      }
      const sent = t.count(arrived, {
        one: `${t.number(arrived)} photo sent`,
        other: `${t.number(arrived)} photos sent`,
      })
      if (already === 0) return sent
      const there = t.count(already, {
        one: `${t.number(already)} was already there`,
        other: `${t.number(already)} were already there`,
      })
      return `${sent} (${there})`
    },
    queueViewMine: 'See my uploads',
    queueDetails: 'Details',
    queueDismiss: 'Hide the summary',
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
    mineFailed: 'The list of your uploads could not be updated. Try again.',
    mineAlt: 'Your photo',
    /* "Levez les yeux" (UX review 2026-10-30): a photo of the guest's goes from waiting to on the wall. */
    photoDeveloped: 'Approved! It is about to appear on the screen: look up.',
    photoDevelopedAway: 'It has been on the screen.',
    deleteOwnNumbered: (position: number) => `Delete photo ${t.number(position)}`,
    notJoinedTitle: 'Join the event to send your photos',
    notJoinedHint: 'Scan the QR code again, or type the event code.',
    notJoinedAction: 'Enter the code',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    galleryUnavailable: 'This event is no longer available. You can no longer send photos to it.',
    galleryUnavailableAction: 'Enter the code again',

    missionsTitle: 'Missions',
    missionsHint: 'Tap a mission, then send your photo.',
    missionDone: 'Done',
    missionDoneByRoom: 'Already photographed',
    missionFor: (prompt: string) => `These photos will count towards “${prompt}”.`,

    itemQueued: 'Will go as soon as the network is back',
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

    /* Guest traps and end-of-evening pass (revue UX 30/10: INV-1, 4, 7, 8). */
    offlineHintNoSync:
      'They are saved on your phone and will leave as soon as the connection is back. Keep this page open until then.',
    queueReady: (count: number) =>
      t.count(count, {
        one: 'One photo ready: tap Send.',
        other: `${t.number(count)} photos ready: tap Send.`,
      }),
    leaveWaitCount: (done: number, total: number) =>
      `Please wait, sending (${t.number(done)}/${t.number(total)})`,
    leaveWait: 'Please wait, sending…',
    endedTitle: 'That’s it for tonight.',
    endedThanks: (count: number) =>
      t.count(count, {
        one: 'Thank you for your photo!',
        other: `Thank you for your ${t.number(count)} photos!`,
      }),
    endedThanksNone: 'Thank you for being with us!',
    endedAlbum: 'The organisers will share the album.',

    installTitle: 'Keep the event within reach',
    installHint:
      'Add it to your home screen to find the event again later, without looking for the QR code.',
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
    introImmediate: 'Add your photos. They will appear on the screen straight away.',
    noticeLink: 'How your photos are used',
    noticeTitle: 'Before your first photo',
    noticeChangedTitle: 'This information has changed',
    noticeChangedHint: 'The organiser has changed a setting since you last read this.',
    noticeAcknowledge: 'I understand',
    noticeWhatHappens: 'What happens to your photos',
    noticeWhoSees: 'Who sees your photos',
    noticeHowLong: 'How long they are kept',
    noticeRemoval: 'Having one removed',
    noticeMetadataStripped:
      'The location and device details are removed from every photo as it arrives.',
    noticePublication: {
      afterReview: 'The organiser approves each photo before it appears on the screen.',
      immediate:
        'They appear on the screen as soon as they arrive. The organiser can take any of them down at any time.',
    },
    noticeAudiences: {
      wall: 'Anyone looking at the event’s screen, in the room or through its link, once a photo is on it.',
      guestFeed:
        'The other guests at the event, on their own phones, in “Photos from the evening”: they see the photo shown on the screen, with your first name if you gave one, and its caption.',
      organisers:
        'The organiser and their team, who see everything you send and can download the photos shown on the screen.',
      sharedGallery:
        'Anyone the organiser sends a private link to the album, if they make one, and anyone that link is forwarded to: they can view and download the photos shown on the screen in full resolution, until the link expires or is withdrawn.',
    },
    noticeRetentionDays: (days: number) =>
      t.count(days, {
        one: `They are deleted automatically ${t.number(days)} day after the organiser ends the event.`,
        other: `They are deleted automatically ${t.number(days)} days after the organiser ends the event.`,
      }),
    noticeRetentionNone:
      'No automatic deletion is planned: they stay until the organiser deletes them.',
    noticeRemovalSeconds: (seconds: number) =>
      t.count(seconds, {
        one: `You can delete one yourself within ${t.number(seconds)} second of sending it, as long as it has not been approved.`,
        other: `You can delete one yourself within ${t.number(seconds)} seconds of sending it, as long as it has not been approved.`,
      }),
    noticeRemovalMinutes: (minutes: number) =>
      t.count(minutes, {
        one: `You can delete one yourself within ${t.number(minutes)} minute of sending it, as long as it has not been approved.`,
        other: `You can delete one yourself within ${t.number(minutes)} minutes of sending it, as long as it has not been approved.`,
      }),
    noticeRemovalHours: (hours: number) =>
      t.count(hours, {
        one: `You can delete one yourself within ${t.number(hours)} hour of sending it, as long as it has not been approved.`,
        other: `You can delete one yourself within ${t.number(hours)} hours of sending it, as long as it has not been approved.`,
      }),
    noticeRemovalOtherwise: 'Otherwise, ask the organiser: they can delete any photo.',
    noticeRemovalAskHost: 'Ask the organiser: they can delete any photo.',
    noticeErasure: (action: string, section: string) =>
      `You can also delete everything from your phone: “${action}”, under “${section}”.`,
    clipDoneImmediate: 'Video sent. It is going up on the screen.',

    /* ---- Added by guest reactions. ---- */

    reactionKinds: {
      love: 'Love',
      laugh: 'Haha',
      wow: 'Wow',
      cheers: 'Cheers',
      clap: 'Applause',
    },
    reactionsGroup: (position: number) => `React to photo ${t.number(position)}`,
    reactionsFailed: 'The reactions could not be loaded.',
  },

  ui: {
    dialogClose: 'Close the dialog',
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
    /* Navigation pass, batch B: the way home from a 404 or a crash, and the expired-session banner. */
    hostHome: 'Go to your events',
    sessionExpired: 'Your session has expired.',
    sessionExpiredAction: 'Sign in again',
    crashAutoRetry: 'Trying again automatically in a moment…',
  },

  errors: {
    'clientName.empty': 'Give the client a name.',
    'clientName.tooLong': 'This name is too long.',
    'clientName.invalid': 'This name contains a character that is not accepted.',
    'clientCeilings.maxEventsInvalid': 'This number of events is not accepted.',
    'clientCeilings.maxEventsPerPeriodInvalid': 'This number of events per period is not accepted.',
    'clientCeilings.maxTotalBytesInvalid': 'This total storage is not accepted.',
    'clientCeilings.maxEventQuotaBytesInvalid': 'This event quota is not accepted.',
    'clientCeilings.maxRetentionDaysInvalid':
      'This retention is not accepted: from 1 to 3,650 days.',
    'clientCeilings.maxLiveDaysInvalid':
      'This length of an ongoing event is not accepted: from 1 to 365 days.',
    'clientCeilings.periodStartedAtInvalid': 'This start of period is not accepted.',
    'clientCeilings.clipsAllowedInvalid': 'This video setting is not accepted.',
    'clientCeilings.liveAllowedInvalid': 'This opening setting is not accepted.',
    'siteLookup.queryInvalid':
      'Enter an id, a code, an address or an event name (300 characters at most).',
    'audit.reasonInvalid':
      'The reason must fit on one line of 200 characters at most, with no e-mail address.',
    'reset.mailerRequired': 'This instance does not send mail: no reset link can be issued.',
    'reset.mailNotSent': 'The mail server refused the message. No link was issued.',
    'reset.approverUnavailable':
      'This account belongs to no client, or to several: no owner can approve the request.',
    'reset.requestNotFound': 'This request does not exist, or has not been approved yet.',
    'reset.tooManyForAddress':
      'This address has already received several resets. Try again in an hour.',
    'account.disabled': 'This account is switched off.',
    'account.operatorProtected': 'An operator’s account can be neither switched off nor deleted.',
    'account.holdsEvents': 'This account owns an event: hand it over or purge it first.',
    'account.holdsMedia': 'This account uploaded photos or videos, whose files would stay on disk.',
    'account.holdsReviews': 'This account reviewed photos, whose rows carry its name.',
    'account.lastClientOwner':
      'This account is the only owner of a client that still has members or events: add an owner, or end the client’s engagement.',
    'client.graceInvalid': 'This grace period is not accepted. Give a whole number of days.',
    'client.offboarding': 'This client’s engagement is ending: its suspension cannot be lifted.',
    unknown: 'Something went wrong. Try again in a moment.',
    network: 'The connection dropped. Check your network, then try again.',
    'request.invalid': 'The information sent is not valid.',

    'auth.invalidCredentials': 'Wrong email address or password.',
    'auth.required': 'Sign in to continue.',
    'auth.forbidden': 'You do not have the rights for this action.',
    'auth.passwordChangeRequired': 'Choose a new password before you continue.',
    'auth.invalidToken': 'This link is no longer valid. Ask for a new one.',
    'auth.invalidSecondFactor':
      'That code is not valid. Wait for the next one in your app, or use a recovery code.',
    'auth.secondFactorExpired': 'This sign-in has expired. Start again with your password.',
    'auth.tooManySecondFactorAttempts': 'Too many wrong codes. Try again in a quarter of an hour.',
    'auth.secondFactorRequired': 'This account must first pass two-step verification.',
    'auth.stepUpRequired': 'Confirm who you are to continue.',
    'auth.secondFactorAlreadyEnrolled': 'Two-step verification is already on for this account.',
    'auth.noEnrolmentInProgress': 'No set-up is in progress. Start again.',
    'auth.secondFactorUnavailable':
      'This server cannot check the app’s code right now. Use a recovery code.',
    'auth.totpCodeInvalid': 'Enter the six digits the app is showing.',
    'auth.secondFactorNotEnrolled': 'Two-step verification is not on for this account.',
    'feature.unavailable': 'This feature is not available on this server.',

    'event.notFound': 'This code does not match any open event.',
    'event.notAcceptingUploads': 'This event is no longer accepting photos.',
    'event.quotaExceeded': 'The event is full. Let the organiser know.',
    'event.slugUnavailable': 'This address is already in use.',
    'event.customSlugNotAllowed': 'This instance does not allow choosing your own address.',
    'event.creationRateLimited': 'You created too many events recently. Try again later.',
    'event.quotaAboveCeiling': 'This quota exceeds the limit this server allows.',
    'event.creationNotAllowed': 'Your account cannot create events on this server.',
    'client.notFound': 'This client account could not be found.',
    'client.ownerRequired': 'Only an owner of the account can read this.',
    'client.ceilingReached': 'Your account has reached the number of events it is allowed.',
    'client.storageFull': 'The event is full. Let the organiser know.',
    'client.liveNotAllowed': 'Your account cannot open an event right now.',
    'client.liveWindowOver':
      'The opening period of this event is over: it can no longer be reopened.',
    'client.retentionAboveCeiling': 'This retention period is longer than your account allows.',
    'client.clipsNotAllowed': 'Videos are not available for this event.',
    'event.immutable': 'This event is archived and can no longer be changed.',
    'event.illegalTransition': 'This change of state is not possible.',

    'guest.revoked': 'Your access was withdrawn by the organiser.',
    'guestToken.expired': 'Your access has expired. Scan the QR code again.',
    'guestToken.malformed': 'Your access is no longer valid. Scan the QR code again.',
    'guestToken.badSignature': 'Your access is no longer valid. Scan the QR code again.',

    'photo.notFound': 'This photo no longer exists.',
    'photo.illegalTransition': 'This action is not possible on this photo.',

    'image.unsupportedFormat': 'This file is not a photo. Accepted formats: JPEG, PNG, HEIC, WebP.',
    'image.corrupt': 'This photo looks damaged. Try another one.',
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
    'invitation.tooManyForAddress':
      'This address has already received several invitations. Try again in an hour.',
    'invitation.notFound':
      'This invitation is no longer valid. Ask the person who sent it for a new one.',
    'invitation.signInRequired':
      'An account already uses the address this invitation was written to. Sign in with that account: you will come back here to accept.',
    'terms.notAccepted': 'To continue, tick the box that accepts the terms of use.',
    'invitation.wrongAccount':
      'This invitation was written for a different email address than this account’s.',
    'invitation.credentialsRequired':
      'Sign in with the invited account, or choose a name and a password.',
    'accountName.empty': 'Enter your name.',
    'accountName.tooLong': 'That name is too long.',

    'displayName.tooLong': 'First name too long.',
    'joinCode.wrongLength': 'This code has the wrong number of characters.',
    'joinCode.malformed': 'This code contains an unexpected character.',

    'reaction.rateLimited': 'Gently — wait a moment before reacting again.',
    'rate.limited': 'Too many attempts. Wait a moment.',

    'event.captionsNotAllowed': 'Captions are not enabled for this event.',
    'event.reactionsDisabled': 'Reactions are not enabled for this event.',
    'event.guestSelfDeleteDisabled': 'The organiser does not let guests delete their photos.',
    'photo.captionEditForbidden': 'This caption can no longer be changed.',
    'photo.deleteForbidden': 'You can no longer delete this photo yourself.',
    'reaction.alreadyExists': 'You have already reacted this way to this photo.',
    'reaction.notPublished': 'This photo is not on the screen yet.',
    'reaction.notFound': 'This reaction no longer exists.',
    'reaction.ownPhoto': 'You cannot react to your own photo.',
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

    'event.scheduleOutOfOrder': 'The end must come after the opening.',
    'event.scheduleInPast':
      'That time has already passed. Check the date: for the end of the evening, choose the next day.',
    'event.scheduleInvalid': 'These dates cannot be read. Choose them again.',

    'event.clipsNotAllowed': 'Videos are not enabled for this event.',
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
      'That colour is too close to the application’s status colours. Choose another hue.',
    'gallery.notAvailable': 'This link is no longer available.',
    'gallery.passwordRequired': 'This album is protected by a password.',
    'gallery.wrongPassword': 'Incorrect password.',
    'gallery.tooManyAttempts': 'Too many attempts. Try again in a quarter of an hour.',
    'gallery.cursorInvalid': 'The list of photos has changed. Reload the page.',
    'shareLink.lifetimeInvalid': 'Choose a length between 1 and 90 days.',

    'upload.busy': 'A lot of uploads are in progress. Try again in a moment.',
    'storage.boxFull': 'There is no room left to save this file. Let the organiser know.',
    /* ---- The host's venue photograph (ADR 0010, decision 8). ---- */
    'venuePhoto.tooLarge': 'This photo is too heavy, even resized. Try another one.',
    'venuePhoto.notFound': 'This photo no longer exists.',
    'venuePhoto.saveFailed': 'The photo could not be saved. Try again.',
  },

  moderation: {
    title: 'Moderation',
    // Navigation pass, batch C: the way to the other console.
    openMobile: 'Phone version, one photo at a time',
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
    shortcutsHint: 'J / K to move, P to publish, R to reject, Z to undo the last decision.',

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
    statePublished: 'On the screen',
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
        one: `${t.number(count)} photo taken off the screen. It stays in your album.`,
        other: `${t.number(count)} photos taken off the screen. They stay in your album.`,
      }),
    decisionFailed: 'The decision could not be saved. Try again.',
    undoFailed: 'The decision could not be undone. Try again.',
    dimensions: (width: number, height: number) => `${width} × ${height} pixels`,
    noCaption: 'No caption',

    /* ---- Moderation traps pass (MOD-1, MOD-4, MOD-9, MOD-13). Keep additions inside this block. ---- */
    nothingToUndo: 'Nothing to undo.',
    undoPublish: 'Take off',
    seeRejected: 'See Rejected',
    republish: 'Put back on the screen',
    republishPhoto: (author: string) => `Put the photo by ${author} back on the screen`,
    publishAnyway: 'Publish anyway',
    publishAnywayPhoto: (author: string) => `Publish the photo by ${author} anyway`,
    alreadyOnScreen: 'This photo is already on the screen.',
    alreadyRefused: 'This photo is already rejected.',
    notOnScreen: 'This photo is not on the screen.',
    decisionsExplained:
      'Take off the screen: the photo stays in your album. Reject: it leaves the album and its guest sees “Not selected”.',
    filterRejectedHint: 'Out of the album. The guest sees “Not selected”.',
    filterHiddenHint: 'Taken off the screen. They stay in your album.',
    confirmRejectTitle: (count: number) => `Reject ${t.number(count)} photos?`,
    confirmRejectBody:
      'Their guests will see “Not selected” and the photos will leave the album. This cannot be undone.',
    confirmRejectLabel: (count: number) => `Reject ${t.number(count)} photos`,

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

  /* The guest's view of the evening: the published photographs, with the reactions. */
  feed: {
    title: 'Photos from the evening',
    link: 'See the photos from the evening',
    back: 'Send your photos',
    refresh: 'Refresh',
    more: 'Show more photos',
    empty: 'No photo is on the screen yet.',
    emptyHint: 'Photos the organisers approve will appear here.',
    failed: 'The photos could not be loaded. Try again.',
    own: 'Your photo',
    /* Navigation pass, batch A: a gallery the server no longer serves. */
    unavailable: 'This event is no longer on display.',
    unavailableHint:
      'The evening is over, so there are no photos to see here. Ask the organisers for the album link.',
  },

  wall: {
    empty: 'The first photos will arrive soon',
    emptyHint: 'Scan the QR code to send yours.',
    joinPrompt: 'Join the event',
    offline: 'New photos waiting for the network',
    paused: 'Slideshow paused',

    codeLabel: 'Event code',
    // The accessible name of the inline QR. Read by nothing in the room, but the wall
    // is also opened on a laptop while a host sets the projector up.
    qrTitle: 'QR code to join the event',
    // The alt text of a photo. 1.0 used the filename, which reads aloud as IMG_4821.jpg.
    photoBy: (name: string) => `Photo sent by ${name}`,
    photoByAnonymous: 'Photo sent by a guest',
    errorTitle: 'The photos could not be loaded',
    errorHint: 'Trying again. Check the venue network if the screen stays empty.',
    notServedTitle: 'This screen is waiting',
    notServedHint: 'This screen will switch on by itself as soon as the event opens.',
    dismissJoinCard: 'Hide the code reminder',
    shortcuts: 'Keyboard shortcuts',
    shortcutsHint:
      'Space pauses, the arrow keys change photo, F goes full screen, L changes the layout, Q hides or shows the QR code.',
    /* Navigation pass, batch A: how to leave the wall. */
    leaveHint: 'To leave: Esc or F exit full screen, then close the tab.',
    /* "Levez les yeux" (UX review 2026-10-30): the line under a guest's first photo on the wall. */
    firstPhotoOf: (name: string) => `First photo from ${name}`,

    /* ---- Before and after the evening (UX review 30/10, MUR-2 to MUR-9). Keep additions inside this block. ---- */
    // The corner card's title: what to do, in a verb a guest reads from ten metres.
    sendPrompt: 'Send your photos to the screen',
    // Under the code, for the phone that cannot read the QR. Both holes are interpolated as given.
    typeCodeAt: (code: string, host: string) => `or type ${code} at ${host}`,
    // An empty wall of an event the host has closed: nobody can send a photo any more.
    emptyClosed: 'Thank you for coming!',
    // In the shortcuts panel, only when the browser could not keep the screen awake itself.
    keepAwakeHint: 'Turn off sleep mode on this computer.',

    layoutNames: {
      spotlight: 'Full screen',
      mosaic: 'Mosaic',
      polaroid: 'Polaroid',
      filmstrip: 'Filmstrip',
      collage: 'Collage',
      split: 'Side by side',
      clothesline: 'Clothesline',
    },
    layoutOrder: (names: readonly string[]) => `Layouts, in order: ${names.join(', ')}.`,

    videoBy: (name: string) => `Video sent by ${name}`,
    videoByAnonymous: 'Video sent by a guest',

    missionsTitle: 'Missions',
    missionDone: 'Done',
    missionGuests: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} guest`,
        other: `${t.number(count)} guests`,
      }),
  },

  admin: {
    events: 'Your events',
    breadcrumbLabel: 'Breadcrumb',
    newEvent: 'New event',
    eventName: 'Event name',
    eventNameHint: 'Visible to your guests, for example “Camille & Sacha”.',
    slug: 'Address',
    joinCode: 'Event code',
    rotateJoinCode: 'Change the code',
    rotateJoinCodeHint:
      'The QR codes already printed and the link already sent will stop working: you will need to reprint them and send the link again. Guests who have already joined stay joined.',
    qrCode: 'QR code',
    qrCodeHint: 'To print and put on the tables.',
    openWall: 'Open the screen',
    openModeration: 'Moderate',
    download: 'Download the album',
    statusDraft: 'Draft',
    statusLive: 'Live',
    statusClosed: 'Ended',
    statusArchived: 'Archived',
    goLive: 'Open to guests',
    closeEvent: 'End the event',
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
      'Guests can send short videos as well as photos. When the box is unticked, videos are refused: because you unticked it, because the template chosen when the event was created set it that way, or because the event is older than this feature. Tick it to allow them.',
    allowGuestSelfDelete: 'Allow guests to delete their photos',

    wallLanguage: 'Language of the screen in the room',
    wallLanguageHint:
      'The words on the screen in the room: “Join the event”, “Missions”, the waiting messages. What you and your guests write — the event name, the captions, the mission prompts — is shown as it is and is never translated. Your guests choose their own language on their phone; this setting does not apply to them.',

    theme: 'Appearance',
    themeHint:
      'Visible to your guests and on the screen in the room. The colours offered stay readable at ten metres.',
    themeAccent: 'Colour',
    themeAccentNames: {
      violet: 'Ambiance colour (default)',
      rose: 'Pink',
      azure: 'Blue',
      teal: 'Teal',
    },
    themeFonts: 'Typeface',
    /** The honest scope, said once: the phone of a guest downloads nothing for this. */
    themeFontsHint: 'Applied to the screen in the room only.',
    themeFontsNames: {
      sans: 'Editorial',
      serif: 'Classic',
    },
    themeFrame: 'Photo frame',
    themeFrameNames: {
      soft: 'Rounded corners',
      square: 'Square corners',
      round: 'Very rounded corners',
    },
    themeAmbiance: 'Ambiance',
    themeAmbianceHint:
      'The world your guests’ phones, the room’s screen and this event’s pages in your space wear.',
    themeAmbianceNames: {
      eventslide: 'EventSlide',
      guinguette: 'Guinguette',
      riviera: 'Riviera',
      champs: 'Golden fields',
      bivouac: 'Bivouac',
      cabaret: 'Cabaret',
      noces: 'Wedding',
      custom: 'Custom',
    },

    template: 'Type of event',
    templateHint:
      'A starting point, suited to the kind of evening. All these settings can still be changed at any time, before the event and during it.',
    templateNone: 'No template',
    templateNoneSummary:
      'Default settings: every photo approved before it reaches the screen, kept indefinitely.',
    templateChanges: 'This template sets:',
    templatePreviewSample: 'Your event',
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
        one: `${t.number(days)} day after the event ends`,
        other: `${t.number(days)} days after the event ends`,
      }),
    retentionUnlimited: 'Kept indefinitely',
    moderators: 'Moderators',

    loading: 'Loading your events…',
    eventLoading: 'Loading the event…',
    eventsEmpty: 'No events yet.',
    eventsEmptyHint: 'Five steps to be ready on the day.',
    emptyStepCreate: 'Create the event.',
    emptyStepPrint: 'Print the QR code and put it on the tables.',
    emptyStepScreen: 'Plug in the venue’s screen and open it: it waits for the opening.',
    emptyStepOpen: 'Open the event to guests.',
    emptyStepTest: 'Test from a phone that is not yours, on the venue’s network.',
    create: 'Create the event',
    slugHint: 'Optional. Leave it empty to derive it from the name.',
    slugPreviewLabel: 'Address for your guests',
    slugPreviewEmpty: 'Type a name to see the address.',
    eventCreated: (name: string) => `${name} is ready. Print the QR code whenever you like.`,
    joinCodeHint: 'To give to guests who cannot scan the QR code.',
    eventControls: 'Event controls',
    joinLink: 'Link for your guests',
    printQr: 'Print the QR code',
    qrScanPrompt: 'Scan to send your photos.',
    qrAlt: (eventName: string) => `QR code to join ${eventName}`,
    printKitTitle: 'Table cards and poster',
    printKitCrumb: 'Cards and poster',
    printKitIntro:
      'Print something to put on the tables: the QR code, the backup code and three lines of instructions.',
    printKitFormat: 'Format',
    printFormatA4: 'A4 poster (1 per sheet)',
    printFormatA5: 'A5 poster (2 per sheet)',
    printFormatCard: 'A6 table cards (4 per sheet)',
    printKitLanguage: 'Language of the sheet',
    printKitLanguageHint: 'This is the language of the evening, not of your screen.',
    printKitPrint: 'Print',
    printKitPrinting: 'Updating the code…',
    printKitHelp:
      'In the print window, choose A4, scale 100%, no headers or footers. Your browser also offers “Save as PDF” there. Use the Print button: Ctrl+P does not check the code.',
    printKitCodeChanged:
      'The code for the evening has changed: the sheet below is up to date. Throw the old ones away.',
    printKitClosed:
      'This evening is closed: guests who scan can no longer join. If you reopen it, the same code works again.',
    printKitDraft: 'Guests will only be able to join once the evening opens.',
    printKitArchived: 'This event is archived: its QR code no longer leads anywhere.',
    printKitBack: 'Back to the event',
    printKitLongLink: 'The link is long, so the QR code will be small. Prefer the poster.',
    printKitPreview: 'Preview of the sheet',
    storageLabel: 'Photo storage used',
    storage: (used: string) => `${used} used`,
    rotateJoinCodeTitle: 'Change the event code?',
    codeRotated: 'New code active. The old one no longer works.',
    settingsSaved: 'Settings saved.',
    settingsReadOnly: 'This event is archived: its settings can no longer be changed.',
    settingsOwnerOnly: 'Only the event’s owner can change its settings.',
    retentionHint:
      'The photos are deleted this long after the event has ended. Until it ends, nothing is deleted.',
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
    guestsEmpty: 'Nobody has joined the event yet.',
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
    moderatorEmailHint:
      'They will get an invitation, valid for seven days, to moderate this event only.',
    inviteSubmit: 'Invite',
    /** An invitation went out by e-mail: nothing to copy. */
    moderatorInviteSent: (email: string) => `An invitation was sent to ${email}.`,
    /** No mail relay, or it refused: the link is for the host to pass on, once. */
    inviteLinkCreated: (email: string) =>
      `This link was not sent by email. Pass it on to ${email} yourself: it works once and stays valid for seven days.`,
    inviteLinkUrl: 'Link to pass on',
    inviteLinkCopy: 'Copy the link',
    inviteLinkCopied: 'Link copied.',
    /** No clipboard (an address that is not secure) or a refusal: the field is selectable. */
    inviteLinkCopyFailed: 'Copying is not possible here: select the link and copy it yourself.',
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

    schedule: 'Automatic opening and end',
    scheduleHint:
      'Leave this empty to open and end the event yourself. The times are your computer’s, so they are the times where the party is.',
    scheduleOpenAt: 'Open to guests on',
    scheduleCloseAt: 'End the event on',
    scheduleCloseAtHint: 'The photos and the album are kept: ending the event deletes nothing.',
    scheduleSaved: 'The schedule has been saved.',
    scheduleNone: 'No schedule: you open and end the event yourself.',
    scheduleArmed: (opensAt: string, closesAt: string) =>
      `Opens on ${opensAt}, ends on ${closesAt}.`,
    scheduleOpensOnly: (opensAt: string) => `Opens on ${opensAt}. You will end it yourself.`,
    scheduleClosesOnly: (closesAt: string) => `Ends on ${closesAt}. You will open it yourself.`,
    scheduleSave: 'Save the schedule',
    /* ---- Added by the host lifecycle pass (revue UX 30/10). ---- */
    noticeOpened: 'Event opened to guests.',
    noticeClosed: 'Event ended. Guests can no longer send photos.',
    noticeReopened: 'Event reopened: guests can send photos again.',
    noticeArchived: 'Event archived. The album can still be downloaded.',
    noticeArchivedDraft: 'Event archived.',
    archiveTitle: (eventName: string) => `Archive ${eventName}?`,
    archiveHint:
      'The screen stops, the settings freeze, and it cannot be undone. The album can still be downloaded.',
    archiveDraftHint: 'The settings freeze and the event can never be opened: it cannot be undone.',
    openTitle: (eventName: string) => `Open ${eventName} to guests?`,
    openHint:
      'Everyone who has the QR code will be able to send photos. You will not be able to go back to draft.',
    wallDraftHint: 'Will light up by itself as soon as the event opens to guests',
    codeRotatedAction: 'Print the new QR',
    afterTitle: 'After the event',
    afterHint: 'Send the album to your guests, or keep it for yourself.',
    afterShare: 'Share the album',
    autoOpenAt: (time: string) => `Opens automatically at ${time}`,
    autoOpenOn: (dateTime: string) => `Opens automatically on ${dateTime}`,
    autoCloseAt: (time: string) => `Ends automatically at ${time}`,
    autoCloseOn: (dateTime: string) => `Ends automatically on ${dateTime}`,
    autoEdit: 'Edit the schedule',
    scheduleDiscardedAction: 'Set a new schedule',

    scheduleDiscarded: (when: string) =>
      `The automatic schedule could not be applied on ${when}: the event could not change state at that moment. It has been cleared. Save a new one if you still want one.`,

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
    shareLink: 'Shared album',
    shareLinkHint:
      'A link to send after the party: the published photos, to download at full resolution.',
    shareLinkNone: 'No link is active.',
    shareLinkActive: (date: string) => `Open until ${date}`,
    shareLinkUnavailable:
      'This link no longer opens: it has expired, or the person who made it no longer organises the event.',
    shareLinkProtected: 'Protected by a password',
    shareLinkUnprotected: 'No password',
    shareLinkLifetime: 'Open for',
    shareLinkDays: (days: number) =>
      t.count(days, { one: `${t.number(days)} day`, other: `${t.number(days)} days` }),
    shareLinkPassword: 'Password',
    shareLinkPasswordHint: (min: number) =>
      `At least ${t.number(min)} characters. Send it separately from the link.`,
    shareLinkCreate: 'Create the link',
    shareLinkReplace: 'Replace with a new link',
    shareLinkReplaceHint: 'The current link will stop working at once.',
    shareLinkCreated: 'Here is the link. Copy it now: it will not be shown again.',
    shareLinkUrl: 'Link address',
    shareLinkCopy: 'Copy the link',
    shareLinkCopied: 'Link copied.',
    // Navigation pass, batch C: a copy that failed, and the link that is never shown again.
    shareLinkCopyFailed:
      'Copying failed. The address is selected: copy it with Ctrl+C (or by long-pressing on a phone).',
    shareLinkLeaveWarning:
      'This address will never be shown again and you have not copied it. Leave the page anyway?',
    shareLinkRevoke: 'Switch off the link',
    shareLinkRevokeTitle: 'Switch off this link?',
    shareLinkRevokeHint:
      'Nobody will be able to open the album with this link any more, even with the password. You can make a new one.',
    shareLinkRevoked: 'The link has been switched off.',

    /* ---- The host's own photograph of their venue (ADR 0010, decision 8). ---- */
    venuePhoto: 'Photo of your venue',
    venuePhotoHint:
      'Replaces the ambiance’s photo behind your guests’ screen and the room’s. It is resized and stripped of its metadata, GPS position included, then veiled so the text stays readable.',
    venuePhotoPreviewAlt: 'Preview of your venue photo',
    venuePhotoDefault: 'No photo of your venue: the ambiance shows its default photo.',
    venuePhotoChoose: 'Choose a photo',
    venuePhotoReplace: 'Replace the photo',
    venuePhotoRemove: 'Go back to the default photo',
    venuePhotoBusy: 'Uploading the photo…',
    venuePhotoSaved: 'Your venue photo is saved.',
    venuePhotoRemoved: 'The default photo is back.',
    customAmbianceCreate: 'Create my ambiance (Custom)',
    customAmbianceEdit: 'Edit my ambiance',
    customAmbianceEntryHint:
      'Your own ground, light or dark, tinted to your taste: you see it on real screens before saving.',
    customAmbianceTitle: 'Your custom ambiance',
    customAmbianceCrumb: 'Custom',
    customAmbianceIntro:
      'Choose a light or dark ground, its tint, your accent colour and a typeface. The previews show the real screens with your choices, and nothing is saved until you press Save.',
    customGround: 'Ground',
    customGroundNames: { light: 'Light', dark: 'Dark' },
    customGroundHue: 'Ground tint',
    customGroundHueHint:
      'From 0° to 359°: only the tint is yours to choose; the lightness is fixed so everything stays readable.',
    customAccentHue: 'Accent colour',
    customAccentHueHint:
      'Every hue is allowed, including ones close to the application’s green, yellow or red: the label on the button stays readable on each, and an alert always carries an icon and a word.',
    customFaces: 'Typeface',
    customFacesHint:
      'The fonts and button corners of one of the six ambiances, each shown in its own font.',
    customPreview: 'Preview',
    customPreviewHint:
      'An illustration of what your guests and the room will see, with sample photos.',
    customPreviewPhone: 'Your guests’ screen',
    customPreviewWall: 'The room’s screen',
    customPreviewCaption: 'What a lovely evening!',
    customPreviewAuthor: 'Lea',
    customKept: 'Your choice is kept as you left it: change it, then save again.',
    customSaved: 'Your ambiance is saved.',
  },

  auth: {
    title: 'Sign in',
    email: 'Email address',
    password: 'Password',
    submit: 'Sign in',
    logout: 'Sign out',
    changePassword: 'Change your password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    newPasswordHint: (min: number) => `At least ${min} characters. A phrase is safer than a word.`,
    confirmPassword: 'Confirm the new password',

    changePasswordIntro: 'Choose a password you do not use anywhere else.',
    passwordSaved: 'Password saved.',
    passwordIncorrect: 'Wrong password.',
    deleteAccount: 'Delete my account',
    deleteAccountIntro:
      'Deleting your account erases your address, your password and your access. Any events you still own must first be deleted or handed to someone else. For a few days at most, sessions that are already open remain, and the audit log keeps anonymous lines: an identifier that no longer points to anyone, with neither your name nor your address. This cannot be undone.',
    deleteAccountConfirm: 'Enter your password to confirm.',
    deleteAccountSubmit: 'Permanently delete my account',
    deleteAccountDone: 'Your account has been deleted.',
    deleteAccountCode: 'Code from your authenticator app',
    deleteAccountCodeHint: 'Only if you turned on a second factor; otherwise leave it empty.',
    deleteAccountHoldsEvents:
      'You still own at least one event. Delete it or hand it to someone else, then try again. Need help? Contact the site operator.',
    deleteAccountHoldsMedia:
      'You uploaded photos or videos to an event, so your account cannot be deleted on your own. Contact the site operator.',
    deleteAccountHoldsReviews:
      'You moderated photos, so your account cannot be deleted on your own. Contact the site operator.',
    deleteAccountLastOwner:
      'You are the only owner of your space, which still has members or events. Add another owner, or contact the site operator.',

    /* ---- Added by G2-13: the second factor. ---- */
    secondFactorTitle: 'Two-step verification',
    secondFactorIntro: 'Enter the six-digit code your authenticator app is showing.',
    secondFactorCode: 'Six-digit code',
    secondFactorSubmit: 'Verify',
    secondFactorRecoveryToggle: 'Use a recovery code',
    secondFactorAppToggle: 'Use the code from the app',
    secondFactorRecoveryIntro:
      'Enter one of the recovery codes you were given when you switched this on. Each works once.',
    recoveryCode: 'Recovery code',
    secondFactorRestart: 'Start again with your password',
    securityTitle: 'Account security',
    securityUnavailable:
      'This server has no encryption key for two-step verification. Ask its administrator to set one.',
    setupIntro:
      'An authenticator app (Aegis, 1Password, Google Authenticator…) makes a six-digit code that is added to your password.',
    setupStart: 'Switch on verification',
    setupScan: 'Scan this QR code with your app. With no camera, type the key in by hand.',
    setupQrLabel: 'Setup QR code',
    setupKeyLabel: 'Setup key',
    setupConfirm: 'Confirm',
    recoveryCodesTitle: 'Recovery codes',
    recoveryCodesIntro:
      'If you lose your phone, each of these ten codes lets you in once. Write them down now: they will not be shown again.',
    recoveryCodesCopy: 'Copy the codes',
    recoveryCodesCopied: 'Codes copied.',
    recoveryCodesSaved: 'I have written them down',
    securityEnabled: 'Two-step verification is on for this account.',
    securityManageIntro:
      'To renew your recovery codes or switch verification off, confirm who you are first.',
    stepUpSubmit: 'Confirm it is me',
    stepUpDone: 'Identity confirmed for five minutes.',
    recoveryCodesRegenerate: 'Make new recovery codes',
    secondFactorDisable: 'Switch verification off',
    secondFactorDisabled: 'Two-step verification switched off.',

    /* ---- Added by G2-10: the invitation page, the reset by e-mail and the account menu. ---- */
    invitationTitle: 'Invitation',
    invitationToModerate: (name: string) =>
      `You have been invited to moderate the event “${name}”.`,
    invitationToOwn: (name: string) =>
      `You have been invited to create and manage the events of “${name}”.`,
    invitationToJoin: (name: string) => `You have been invited to join the team of “${name}”.`,
    invitationExpires: (when: string) => `Valid until ${when}.`,
    invitationChoose:
      'Choose your name and a password: your account is created when you submit this form.',
    invitationName: 'Your name',
    invitationNameHint: 'It appears in the list of people who have access.',
    invitationConfirmPassword: 'Confirm the password',
    invitationSubmit: 'Create my account and accept',
    invitationAccepted: 'Invitation accepted.',
    invitationHaveAccount: 'Already have an account?',
    invitationSignedInAs: (email: string) => `You are signed in as ${email}.`,
    invitationAcceptAs: 'Accept with this account',
    invitationUseAnother: 'Use another account',
    /* ---- Added by G2-20: the terms of use an invitation's acceptance agrees to. ---- */
    invitationAcceptTerms: (version: string) =>
      `I accept the terms of use (version ${version}), including the data processing clauses.`,
    invitationReadTerms: 'Read the terms of use',
    deadLinkTitle: 'This link is not valid',
    forgotLink: 'Forgot your password?',
    forgotTitle: 'Forgot your password',
    forgotIntro:
      'Enter the e-mail address of your account. If an account uses it, you will receive a link to choose a new password.',
    forgotSubmit: 'Send the link',
    forgotSentTitle: 'Check your inbox',
    forgotSent:
      'If an account uses this address, a message with a link has just been sent. The link is valid for one hour and works once.',
    forgotUnavailable:
      'This server cannot send e-mail, so passwords cannot be reset here this way. Ask whoever runs it.',
    backToLogin: 'Back to sign-in',
    resetTitle: 'New password',
    resetIntro:
      'Choose a password you do not use anywhere else. You will be signed out on all your devices.',
    resetSubmit: 'Change the password',
    resetDoneTitle: 'Password changed',
    resetDone: 'All your sessions were closed. Sign in with your new password.',
    resetAskAgain: 'Ask for a new link',
    accountMenu: 'Account',
    accountSignedInAs: (email: string) => `Signed in as ${email}`,
    logoutEverywhere: 'Sign out everywhere',
    logoutEverywhereTitle: 'Sign out everywhere?',
    logoutEverywhereHint:
      'Your session will be closed on every device, this one included, and you will have to sign in again. Useful if you lost a device or used a shared computer.',

    /* ---- Navigation pass, batch D: accounts and sign-in. ---- */
    alreadySignedIn: 'You are already signed in. Redirecting…',
    forgotNoMail:
      'Forgotten your password? This server sends no e-mail: ask whoever runs it to reset it for you.',
    changePasswordForced:
      'Your password was chosen for you: replace it before going further. You will then return to where you were going.',
    menuMustChange: 'Change your password first: the rest of your space stays closed until then.',
    securityBack: 'Back',
    secondFactorEnabled: 'Two-step verification turned on.',
    recoveryCodesLeaveTitle: 'Leave without writing down your codes?',
    recoveryCodesLeaveHint:
      'These codes are shown only once: if you leave this page you can no longer read them. Getting new ones means confirming your identity again.',
    recoveryCodesLeaveStay: 'Stay and write them down',
    recoveryCodesLeaveGo: 'Leave anyway',
    deadInvitationSignIn: 'If you have already accepted it, your account exists: sign in.',
    deadInvitationSignedIn:
      'You are already signed in: if you accepted it with this account, your events are there.',
  },

  mobileModeration: {
    title: 'Moderation on a phone',
    // Navigation pass, batch C: the way to the other console.
    openConsole: 'Full version, for a computer',
    intro: 'Swipe the photo right to publish, left to reject.',
    releaseToPublish: 'Release to publish',
    releaseToReject: 'Release to reject',
    nowDeciding: (photo: string) => `Photo to moderate. ${photo}`,
    undoLast: 'Undo the last decision',
    undoUnavailable: 'Only publishing can be undone.',

    /* ---- Moderation traps pass (MOD-2). Keep additions inside this block. ---- */
    onScreenTitle: 'Latest photos on the screen',
    onScreenHint: 'Tap a photo to take it off the screen.',
    onScreenEmpty: 'Nothing on the screen right now.',
    openOnScreen: (author: string) => `View the photo by ${author}, on the screen`,
  },
  gallery: {
    title: 'Shared album',
    opening: 'Opening the album…',
    unavailableTitle: 'This link is no longer available',
    unavailableHint:
      'It may have expired or been switched off. Ask the person who sent it to you for a new one.',
    lockedTitle: 'Protected album',
    lockedHint: 'Enter the password you were given with the link.',
    passwordLabel: 'Password',
    unlock: 'Open the album',
    photoCount: (count: number) =>
      t.count(count, { one: `${t.number(count)} photo`, other: `${t.number(count)} photos` }),
    availableUntil: (date: string) => `Available until ${date}`,
    privacyNote: 'Photos download at full resolution, without their location data.',
    downloadAll: 'Download everything (.zip)',
    download: 'Download the original',
    downloadClip: 'Download the video',
    openPhoto: (position: number) => `Enlarge photo ${t.number(position)}`,
    photoAlt: (position: number) => `Photo ${t.number(position)} of the album`,
    clipBadge: 'Video',
    empty: 'No photo has been published in this album yet.',
    loadMore: 'Show more photos',
    viewerTitle: (position: number, total: number) =>
      `Photo ${t.number(position)} of ${t.number(total)}`,
  },
  about: {
    sourceCode: 'Source code (AGPL-3.0)',
    opensInNewTab: 'opens a new tab',
    aboutLink: 'About',
    /* Navigation pass, batch A: a way back from the page. */
    back: 'Back',
    home: 'Home',

    title: 'About EventSlide',
    intro:
      'EventSlide is free software: you can read, modify and redistribute its source code under the terms of its licence.',
    versionLabel: 'Version',
    licenseLabel: 'Licence',
    sourceLabel: 'Source code',
    sourceNote: 'This link leads to the source code of the version shown above.',
    noticesLabel: 'Third-party licences',
    noticesLink: 'Notices of the bundled libraries',
    noticesNote: 'The licence texts of the free libraries this application contains.',

    supportLink: 'Support the project',
    supportTitle: 'The project runs on donations',
    supportIntro: 'EventSlide is free software, at no charge and without ads.',
    supportNoCounterpart: 'A donation unlocks nothing: same service for everyone.',
    budgetLink: 'See the public budget',
    supportDismiss: 'Hide this message',

    termsLink: 'Terms of use',
    privacyLink: 'Privacy policy',
    legalNoticeLink: 'Legal notice',
    helpLink: 'Help',
    reportLink: 'Report content',
    operatorTitle: 'Who runs this instance',
    operatorNameLabel: 'Operator',
    operatorContactLabel: 'Contact',
    operatorHostedBy: 'Hosted by',
  },
  clientSpace: {
    bannerLabel: 'Your account’s limits',
    warningTitle: 'You are close to a limit of your account',
    reachedTitle: 'A limit of your account has been reached',
    eventsMeter: (used: number, max: number) => `Events: ${used} of ${max}`,
    eventsPerPeriodMeter: (used: number, max: number) =>
      `Events created this period: ${used} of ${max}`,
    storageMeter: (used: string, max: string) => `Storage: ${used} of ${max}`,
    liveNotAllowed: 'Opening new events is paused on your account.',
    contactHint: 'To lift a limit, contact your operator.',
    contactAction: 'Contact the operator',
    suspendedTitle: 'Your account is suspended',
    suspendedBody:
      'Your albums can still be viewed and exported. While the suspension lasts, you cannot create, open or edit an event, and the public no longer sees your screens.',
    spaceLink: 'Client space',
    spaceTitle: 'Client space',
    limitsTitle: 'Limits and usage',
    noLimits: 'Your operator has not set any limit on your account.',
    // Navigation pass, batch C: an account that belongs to no client.
    noClient: 'Your account does not belong to any client.',
    noClientHint:
      'So there is no limit or usage to read here. Your events are on the page that lists them.',
    roleOwner: 'Owner',
    roleMember: 'Member',
    pendingTitle: 'Waiting for your approval',
    pendingHint:
      'Your operator has invited these people to your account. They only get in with an owner’s approval.',
    pendingEmpty: 'Nothing is waiting for your approval.',
    pendingValidUntil: (date: string) => `Valid until ${date}`,
    approve: 'Approve',
    approved: 'Invitation approved.',
    auditTitle: 'Activity log',
    auditHint:
      'Everything your operator, the system or your team did on your account, newest first.',
    auditEmpty: 'No action has been recorded yet.',
    auditMore: 'Show older actions',
    actorOperator: 'Operator',
    actorMember: 'Your team',
    actorSystem: 'System',
    actorIntegration: 'Integration',
    actionCeilingsChanged: 'Your limits were changed.',
    actionPeriodReset: 'Your period was renewed.',
    actionInvitationIssued: 'An invitation was issued.',
    actionInvitationIssuedPending: 'An invitation was issued; it is waiting for your approval.',
    actionInvitationApproved: 'An invitation was approved.',
    actionResetRequested: 'A password reset was requested for a member.',
    actionResetApproved: 'A password reset was approved.',
    actionResetMailed: 'A reset link was sent to the member.',
    actionResetShown: 'A reset link was handed to the operator.',
    actionTermsAccepted: 'A person accepted the terms of use by accepting an invitation.',
    actionOther: 'An action was recorded.',
    liveWindowEnd: (date: string) => `The event ends on ${date}.`,
  },

  site: {
    menuLink: 'Operator console',
    consoleTitle: 'Operator console',
    consoleIntro:
      'What you see here is shapes and sizes, never what your clients made: no photograph, no event name.',
    navLabel: 'Console sections',
    navClients: 'Clients',
    navAccounts: 'Accounts',
    navAudit: 'Log',
    factorTitle: 'Two-step verification required',
    factorEnrol:
      'This instance requires it of the operator, and your account has not turned it on yet. Turn it on, then come back here.',
    factorEnrolLink: 'Turn on two-step verification',
    factorSignIn:
      'This sign-in has not passed two-step verification. Sign in again and enter the code from your app.',
    factorSignOut: 'Sign in again',
    stepUpTitle: 'Confirm your identity',
    stepUpIntro:
      'This action changes a shared instance. Enter your password, and the code from your app if you have one: the confirmation lasts five minutes.',
    more: 'Show more',

    clientsTitle: 'Clients',
    clientsHint:
      'A client is an account, its events and its limits. You read its sizes, never its contents.',
    newClient: 'New client',
    clientsEmpty: 'No client yet.',
    clientsEmptyHint:
      'Open a client: its owner receives an invitation and chooses their own password.',
    clientsTableLabel: 'The instance’s clients',
    clientColumn: 'Client',
    statusColumn: 'Status',
    eventsColumn: 'Events',
    membersColumn: 'Members',
    storageColumn: 'Storage',
    createdColumn: 'Opened on',
    statusActive: 'Active',
    statusSuspended: 'Suspended',
    statusOffboarding: 'Winding down',
    eventsCell: (total: number, live: number) => `${t.number(total)} (${t.number(live)} live)`,
    storageOf: (used: string, max: string) => `${used} of ${max}`,
    noCeiling: 'No limit',

    newClientTitle: 'Open a client',
    newClientIntro:
      'The client is opened with no member and no event, and its owner is invited by e-mail, or by a link for you to pass on if the instance cannot send mail. You never choose their password.',
    clientName: 'Client name',
    ownerEmail: 'Owner’s e-mail address',
    inviteLanguage: 'Language of the invitation',
    defaultsHint:
      'The limits are the ones this instance gives a new client by default. Empty a field to set no limit.',
    createClient: 'Open the client',
    clientCreated: 'Client opened.',

    invitationMailed: (email: string) => `An invitation was sent to ${email}.`,
    invitationPending:
      'The invitation is written, but it only opens once an owner of the client agrees.',
    invitationLinkTitle: 'No e-mail went out',
    invitationLinkBody:
      'This instance cannot send mail, or the mail server refused this message. This link is the only copy: pass it on to the recipient, then close this box.',
    invitationLinkLabel: 'Invitation link',
    copyLink: 'Copy the link',
    linkCopied: 'Link copied.',
    invitationValidUntil: (date: string) => `Valid until ${date}.`,

    ceilingsLegend: 'Limits',
    maxEvents: 'Events, at most',
    maxEventsPerPeriod: 'Events created per period, at most',
    maxTotalGigabytes: 'Total storage, in GB',
    maxEventQuotaGigabytes: 'Quota of one event, in GB',
    maxRetentionDays: 'Retention after the event ends, in days, at most',
    maxLiveDays: 'Length of an ongoing event, in days, at most',
    clipsAllowed: 'Videos allowed',
    liveAllowed: 'Opening events allowed',
    renewPeriod: 'Renew the period now',
    renewPeriodHint: 'Resets the counter of events created in the period.',
    emptyMeansNone: 'Empty: no limit.',
    notANumber: 'Enter a positive number.',

    allClients: 'All clients',
    memberCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} member`,
        other: `${t.number(count)} members`,
      }),
    periodEvents: (count: number) => `Created in the period: ${t.number(count)}`,
    suspendedSince: (date: string) => `Suspended since ${date}.`,
    purgeOn: (date: string) => `The albums will be purged on ${date} at the latest.`,
    suspend: 'Suspend',
    suspendTitle: 'Suspend this client?',
    suspendBody:
      'Guests can no longer join its events or send photos, the public no longer sees its screens or its albums, and its members can no longer change anything. Nothing is deleted and no account is switched off.',
    suspended: 'Client suspended.',
    resume: 'Lift the suspension',
    resumeTitle: 'Lift the suspension?',
    resumeBody:
      'The client’s screens and albums become visible again at once, and its guests can join and send photos again.',
    resumed: 'Suspension lifted.',
    rename: 'Rename',
    renameTitle: 'Client name',
    renamed: 'Client renamed.',
    ceilingsTitle: 'Limits',
    ceilingsReason: 'Reason for the change',
    ceilingsReasonHint:
      'One sentence on one line, 200 characters at most, with no e-mail address. It goes in the operator’s log and the client does not read it. Non-financial reasons only: the size of an event, capacity, abuse.',
    ceilingsSave: 'Save the limits',
    ceilingsSaved: 'Limits saved.',
    ceilingsUnchanged: 'No limit has changed.',
    inviteTitle: 'Invite into this client',
    inviteIntro:
      'A person joins the client’s account, never an event. If the client already has events or members, an owner must approve the invitation.',
    inviteEmail: 'E-mail address',
    inviteRole: 'Role',
    inviteSend: 'Invite',
    roleOwner: 'Owner',
    roleMember: 'Member',
    eventsTitle: 'Events',
    eventsHint: 'Shapes and sizes only: no name, no address, no photograph.',
    eventsEmpty: 'This client has no event.',
    eventsTableLabel: 'The client’s events',
    eventColumn: 'Event',
    eventStatusColumn: 'Status',
    photosColumn: 'Photos',
    usedColumn: 'Space used',
    startsColumn: 'Planned start',
    eventLabel: (short: string) => `Event ${short}`,
    eventStatuses: {
      draft: 'Draft',
      live: 'Live',
      closed: 'Ended',
      archived: 'Archived',
    },
    photoCount: (count: number) =>
      t.count(count, {
        one: `${t.number(count)} photo`,
        other: `${t.number(count)} photos`,
      }),
    auditLink: 'See this client’s log',

    accountsTitle: 'Accounts',
    accountsHint:
      'The addresses of the people who have an account on this instance, and nothing else: no display name, no password.',
    accountsEmpty: 'No account yet.',
    accountsTableLabel: 'The instance’s accounts',
    addressColumn: 'Address',
    roleColumn: 'Role on the instance',
    accountStateColumn: 'Status',
    lastLoginColumn: 'Last sign-in',
    termsColumn: 'Terms accepted',
    termsNone: 'None on record',
    termsAccepted: (version: string, at: string) => `Version ${version}, on ${at}`,
    ownedColumn: 'Events owned',
    clientsColumn: 'Clients',
    siteRoleOperator: 'Operator',
    accountActive: 'Active',
    accountDisabled: 'Switched off',
    neverSignedIn: 'Never',
    mustChange: 'Must change their password',
    resetPassword: 'Reset the password',
    resetTitle: 'Reset this password?',
    resetBody:
      'A link valid for one hour goes to the account’s own address and nowhere else: you only see it on an instance that cannot send mail.',
    resetSent: 'The link was sent to the account’s address.',
    resetPending: 'Waiting for an owner',
    resetPendingBody:
      'This instance does not send mail. Another owner of the client must approve the request before the link is handed to you.',
    resetFetch: 'Get the approved link',
    resetLinkTitle: 'Reset link',
    resetLinkBody: 'It works once. Pass it on to the account’s holder, then close this box.',

    auditTitle: 'Log',
    auditHint:
      'Everything that was done on the instance, newest first. The reason for a change of limits is the operator’s own sentence.',
    auditEmpty: 'No action recorded yet.',
    auditMore: 'Show older actions',
    auditShowAll: 'Show the whole log',

    /* ---- Navigation pass, batch D: the console's links and the invitation link. ---- */
    exitsLabel: 'Leave the console',
    accountsLink: 'See all accounts',
    noClient: 'None',
    auditFilteredFor: (name: string) => `Log of the client “${name}”.`,
    auditToClient: 'See this client',
    linkLeaveTitle: 'Leave without copying the link?',
    linkLeaveHint:
      'No e-mail went out: this link is shown only here, once. If you leave this page you can no longer copy it; you will have to issue a new one.',
    linkLeaveStay: 'Stay and copy the link',
    linkLeaveGo: 'Leave anyway',
    auditReason: (reason: string) => `Reason: ${reason}`,
    auditAccount: (short: string) => `account ${short}`,
    actors: {
      operator: 'Operator',
      member: 'Member',
      system: 'System',
      integration: 'Integration',
    },
    actions: {
      'client.created': 'Client opened.',
      'client.renamed': 'Client renamed.',
      'client.ceilingsChanged': 'Limits changed.',
      'client.periodReset': 'Period renewed.',
      'client.suspended': 'Client suspended.',
      'client.resumed': 'Suspension lifted.',
      'invitation.issued': 'Invitation issued.',
      'invitation.approved': 'Invitation approved by an owner.',
      'account.resetRequested': 'Password reset requested.',
      'account.resetApproved': 'Reset approved by an owner.',
      'account.resetIssued': 'Reset issued.',
      'account.disabled': 'Account switched off.',
      'client.offboarded': 'End of engagement started.',
      'client.finalized': 'Client deleted at the end of its engagement.',
      'account.enabled': 'Account switched on.',
      'account.deleted': 'Account deleted.',
      'account.termsAccepted': 'Terms of use accepted.',
      'account.secondFactorEnrolled': 'Two-step verification turned on.',
      'account.secondFactorDisabled': 'Two-step verification turned off.',
      'account.recoveryCodesRegenerated': 'Recovery codes renewed.',
      'account.recoveryCodeUsed': 'A recovery code was used.',
    },
    actionInvitationIssuedPending: 'Invitation issued; it is waiting for an owner’s approval.',
    actionOther: 'An action was recorded.',
    accountActionsColumn: 'Actions on the account',
    disableAccount: 'Switch off',
    enableAccount: 'Switch on',
    deleteAccount: 'Delete',
    disableTitle: (address: string) => `Switch off the account of ${address}?`,
    disableBody:
      'Every session it has ends at once and the person can no longer sign in. Nothing is deleted: switching it back on gives the access back, but they will have to sign in again.',
    accountDisabledDone: 'Account switched off.',
    accountEnabledDone: 'Account switched on.',
    deleteTitle: (address: string) => `Delete the account of ${address}?`,
    deleteBody:
      'This answers an erasure request. The account, its memberships, the invitations addressed to it, its second factor and the share links it created go away. The log lines it wrote stay, without its name, and so do the invitations it issued. Its address stays in its live sessions (seven days at most) and in links already issued until they expire. This cannot be undone.',
    accountDeletedDone: 'Account deleted.',
    offboardTitle: 'End of engagement',
    offboardIntro:
      'Live events are ended, drafts are archived, the client is suspended, and its albums are purged at the latest when the grace period you give runs out: it is the time the client has to export what it wants to keep (an event’s own retention or the client’s limits may purge sooner). Then the accounts that belonged only to it and hold nothing else are deleted, and the client with them.',
    graceDays: 'Grace period before the purge, in days',
    graceDaysHint: 'A whole number of days: the limits are the server’s.',
    offboardAction: 'End the engagement',
    offboardConfirmTitle: 'End this client’s engagement?',
    offboardConfirmBody: (days: number) =>
      t.count(days, {
        one: `In ${t.number(days)} day at the latest, this client’s albums will be purged, then the client will be deleted along with the accounts that belonged only to it and hold nothing else. There is no way back: neither the date nor the suspension can be changed. Until then its live events are ended, its drafts archived and the client suspended.`,
        other: `In ${t.number(days)} days at the latest, this client’s albums will be purged, then the client will be deleted along with the accounts that belonged only to it and hold nothing else. There is no way back: neither the date nor the suspension can be changed. Until then its live events are ended, its drafts archived and the client suspended.`,
      }),
    offboardedDone: 'Engagement ending.',
    offboardingRunning:
      'This engagement is ending: the albums will be purged on the date shown above at the latest.',
    daysNotWhole: 'Give a whole number of days.',
    takedownNav: 'Takedown',
    takedownTitle: 'Remove without looking',
    takedownIntro:
      'Take down a reported photograph or event from its id, without ever opening it: this console shows no thumbnail, no caption, no guest name and no media address. Every act asks for a reason, which is written to the instance log and which the client does not read. Taking down does not stop the purge: to keep the content as evidence, take it down and then hold its purge.',
    takedownEventTitle: 'An event',
    takedownEventIntro:
      'Find the reported event by its address, its event code or its exact name. All you see of it is its id and its state.',
    takedownEventLabel: 'Address, code or exact name',
    takedownEventAction: 'Search for the event',
    takedownEventNone: 'No event matches. The name must be exact: part of a name is not enough.',
    takedownEventHeading: (id: string) => `Event ${id}`,
    takedownClient: 'Open the client',
    takedownNoClient: 'No client',
    takedownStateDown: 'Taken down',
    takedownStateUp: 'Online',
    takedownStateHeld: 'Purge held',
    takedownStateFree: 'Normal purge',
    takedownEventDown: 'Take the event down',
    takedownEventUp: 'Put back online',
    takedownHold: 'Hold the purge',
    takedownRelease: 'Release the purge',
    takedownPhotoTitle: 'A photograph',
    takedownPhotoIntro:
      'Paste the photograph id as the report gives it (the last part of its address before the variant name). All you see is the event it belongs to and its state.',
    takedownPhotoLabel: 'Photograph id',
    takedownPhotoAction: 'Search for the photograph',
    takedownPhotoNone: 'No photograph has this id.',
    takedownPhotoHeading: (id: string) => `Photograph ${id}`,
    takedownPhotoOf: (id: string) => `In event ${id}`,
    takedownPhotoDown: 'Take the photograph down',
    takedownPhotoUp: 'Put the photograph back',
    takedownReason: 'Reason',
    takedownReasonHint:
      'One sentence on a single line, 200 characters at most, with no e-mail address. It is written to the instance log.',
    takedownUnknown:
      'State unknown: the act may or may not have gone through, search again to find out.',
    takedownDone: 'Done.',
    takedownOps: {
      eventDown: {
        title: 'Take this event down?',
        body: 'The wall, the guest feed, the album link and the host’s space answer as if the event did not exist, and open screens close. Nothing is deleted. Retention carries on: to keep the content as evidence, hold its purge as well.',
        confirm: 'Take the event down',
      },
      eventUp: {
        title: 'Put this event back online?',
        body: 'The wall, the guests, the album and the host get it back as it was.',
        confirm: 'Put back online',
      },
      purgeHold: {
        title: 'Hold this event’s purge?',
        body: 'The retention sweep skips it, and neither the host nor a guest can delete the event or a photograph any more. Nothing is hidden: the hold cannot be seen in the room. Backups are not held.',
        confirm: 'Hold the purge',
      },
      purgeRelease: {
        title: 'Release this event’s purge?',
        body: 'The event becomes purgeable again at its own deadline, which may have passed: the next sweep will then purge it.',
        confirm: 'Release the purge',
      },
      photoDown: {
        title: 'Take this photograph down?',
        body: 'It leaves the wall, the guest feed, the album link and the host screens at once, and open screens forget it. The file is kept. The host cannot put it back.',
        confirm: 'Take the photograph down',
      },
      photoUp: {
        title: 'Put this photograph back?',
        body: 'It reappears with the status the host had given it.',
        confirm: 'Put the photograph back',
      },
    },
  },

  /** The text on the printed sheet, in the language of the evening (spec 02). */
  printKit: {
    title: 'Share your photos of the evening',
    step1: 'Scan the QR code with your phone’s camera.',
    step2: 'Send your photos.',
    step3: 'They join the evening’s screen.',
    fallback: (code: string, address: string) => `No QR code? Type the code ${code} at ${address}.`,
  },
  titles: {
    print: 'Table cards and poster',
    join: 'Join the event',
    upload: 'Send photos',
    feed: 'Photos from the evening',
    wall: 'Event screen',
    gallery: 'Shared album',
    about: 'About',
    notFound: 'Page not found',
    login: 'Sign in',
    forgotPassword: 'Forgot your password',
    resetPassword: 'New password',
    invitation: 'Invitation',
    changePassword: 'Change your password',
    security: 'Account security',
    deleteAccount: 'Delete my account',
    dashboard: 'Your events',
    newEvent: 'New event',
    event: 'Event',
    moderation: 'Moderation',
    mobileModeration: 'Moderation on a phone',
    settings: 'Event settings',
    customAmbiance: 'Custom ambiance',
    clientSpace: 'Client space',
    site: 'Operator console',
    siteClient: 'Client',
    siteAccounts: 'Instance accounts',
    siteAudit: 'Instance log',
    siteTakedown: 'Content takedown',
  },
}
