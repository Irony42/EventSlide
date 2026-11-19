import type { ChannelKind } from '../../domain/channels/channelKind'
import type {
  ChannelCommand,
  ChannelCommandName,
  ChannelMedia,
  ChannelSender,
} from '../../domain/channels/inboundMessage'
import type { Event } from '../../domain/events/event'
import type { EventSettingsPatch } from '../../domain/events/eventSettings'
import { DomainError } from '../../domain/shared/errors'
import { asEventId, asGuestId, asPhotoId, type GuestId } from '../../domain/shared/ids'
import { err, ok } from '../../domain/shared/result'
import { makeBindConversation } from '../usecases/channels/bindConversation'
import { makeChannelReplier } from '../usecases/channels/channelReplier'
import {
  makeDrainChannelMedia,
  type DrainChannelMediaDeps,
} from '../usecases/channels/drainChannelMedia'
import { makeForgetChannelSender } from '../usecases/channels/forgetChannelSender'
import { makeReceiveChannelMessage } from '../usecases/channels/receiveChannelMessage'
import type { UploadClip, UploadClipInput } from '../usecases/clips/uploadClip'
import type { EraseGuestContribution } from '../usecases/guests/eraseGuestContribution'
import type { UploadPhotos, UploadPhotosInput } from '../usecases/photos/uploadPhotos'
import type { MessagingChannel } from '../ports/messagingChannel'
import { AT, aClient, aGuest, anEvent, type EventInput } from './builders'
import { CapturingLogger } from './capturingLogger'
import { FakeChannelBindingRepository } from './fakeChannelBindingRepository'
import { FakeChannelMediaJobRepository } from './fakeChannelMediaJobRepository'
import { FakeChannelSenderKeyer } from './fakeChannelSenderKeyer'
import { FakeClientRepository } from './fakeClientRepository'
import { FakeClock } from './fakeClock'
import { FakeEventRepository } from './fakeEventRepository'
import { FakeGuestRepository } from './fakeGuestRepository'
import { FakeMembershipRepository } from './fakeMembershipRepository'
import { FakeMessagingChannel } from './fakeMessagingChannel'
import { RecordingEventBus } from './recordingEventBus'
import { SequentialIdGenerator } from './sequentialIdGenerator'

/**
 * A world for the messaging channel use cases (spec 27): one event that connects Telegram, a conversation, the
 * fakes, and the real use cases wired as the container wires them. The two upload use cases are **recorded
 * doubles** here (they have their own suites): what a test asserts is what the channel asked of them and how it
 * answered what they said.
 */

export const CONVERSATION = '-1001'
export const OTHER_CONVERSATION = '-1002'
export const NOTICE_URL = 'https://app.example/join/H7K2QM'
export const BYTES = new Uint8Array([1, 2, 3, 4])

export const aSender = (patch: Partial<ChannelSender> = {}): ChannelSender => ({
  ref: '42',
  displayName: 'Léa Martin',
  isBot: false,
  isAnonymous: false,
  ...patch,
})

export const aCommand = (
  command: ChannelCommandName,
  argument = '',
  patch: Partial<ChannelCommand> = {},
): ChannelCommand => ({
  type: 'command',
  channel: 'telegram',
  conversationRef: CONVERSATION,
  conversationTitle: 'Mariage Léa & Tom',
  messageRef: 'm-1',
  sender: aSender(),
  command,
  argument,
  ...patch,
})

export const aMedia = (patch: Partial<ChannelMedia> = {}): ChannelMedia => ({
  type: 'media',
  channel: 'telegram',
  conversationRef: CONVERSATION,
  conversationTitle: 'Mariage Léa & Tom',
  messageRef: 'm-1',
  sender: aSender(),
  kind: 'photo',
  fileRef: 'file-1',
  declaredBytes: 1_000,
  durationMs: null,
  declaredName: 'photo.jpg',
  declaredMimeType: null,
  ...patch,
})

export interface ChannelSceneOptions {
  /** The event: `live`, `H7K2QM`, Telegram switched on and publishing on arrival unless told otherwise. */
  readonly event?: EventInput
  readonly settings?: EventSettingsPatch
  /** A client plan for the event: `true` allows channels, `false` does not, absent means no client. */
  readonly clientAllowsChannels?: boolean
  /** The receiving ceilings: 3 media a minute and 5 queued per event unless told otherwise. */
  readonly limits?: { readonly mediaPerMinute?: number; readonly maxQueuedPerEvent?: number }
}

export type UploadPhotosVerdict = Awaited<ReturnType<UploadPhotos>>
export type UploadClipVerdict = Awaited<ReturnType<UploadClip>>

export const aChannelScene = (options: ChannelSceneOptions = {}) => {
  const clients = new FakeClientRepository()
  const events = new FakeEventRepository({ clients })
  const guests = new FakeGuestRepository()
  const bindings = new FakeChannelBindingRepository()
  const jobs = new FakeChannelMediaJobRepository()
  const memberships = new FakeMembershipRepository()
  const telegram = new FakeMessagingChannel()
  const channels: ReadonlyMap<ChannelKind, MessagingChannel> = new Map([['telegram', telegram]])
  const keyer = new FakeChannelSenderKeyer()
  const bus = new RecordingEventBus()
  const clock = new FakeClock(AT)
  const ids = new SequentialIdGenerator()
  const logger = new CapturingLogger()
  const replier = makeChannelReplier(clock)

  const hasClient = options.clientAllowsChannels !== undefined
  if (hasClient) {
    clients.seed(
      aClient({ id: 'client-1', ceilings: { channelsAllowed: options.clientAllowsChannels } }),
    )
  }
  const event: Event = anEvent({
    id: 'event-1',
    settings: { moderation: 'auto', allowTelegram: true, ...options.settings },
    ...(hasClient ? { clientId: 'client-1' } : {}),
    ...options.event,
  })
  events.seed(event)

  const bindConversation = makeBindConversation({ events, clients, bindings, ids, clock, bus })

  const erased: GuestId[] = []
  let eraseVerdict: Awaited<ReturnType<EraseGuestContribution>> = ok({
    photos: 0,
    clips: 0,
    messages: 0,
  })
  const eraseGuestContribution: EraseGuestContribution = async ({ guestId }) => {
    erased.push(guestId)
    return eraseVerdict
  }
  const forgetChannelSender = makeForgetChannelSender({
    guests,
    jobs,
    keyer,
    eraseGuestContribution,
  })

  const receive = makeReceiveChannelMessage({
    events,
    guests,
    bindings,
    jobs,
    channels,
    keyer,
    bindConversation,
    forgetChannelSender,
    replier,
    ids,
    clock,
    bus,
    logger,
    noticeUrlOf: () => NOTICE_URL,
    limits: {
      mediaPerMinute: options.limits?.mediaPerMinute ?? 3,
      maxQueuedPerEvent: options.limits?.maxQueuedPerEvent ?? 5,
    },
  })

  const photoCalls: UploadPhotosInput[] = []
  const clipCalls: UploadClipInput[] = []
  let photoVerdict: UploadPhotosVerdict = ok({
    outcomes: [
      { index: 0, declaredName: 'photo.jpg', kind: 'stored', photoId: asPhotoId('photo-1') },
    ],
    published: [],
  })
  let clipVerdict: UploadClipVerdict = ok({
    clipJobId: ids.clipJobId(),
    status: 'queued',
    photoId: asPhotoId('photo-2'),
    failureCode: null,
    duplicate: false,
  })

  const drainDeps: DrainChannelMediaDeps = {
    events,
    clients,
    guests,
    bindings,
    jobs,
    channels,
    uploadPhotos: async (input) => {
      photoCalls.push(input)
      return photoVerdict
    },
    uploadClip: async (input) => {
      clipCalls.push(input)
      return clipVerdict
    },
    replier,
    ids,
    clock,
    logger,
    limits: { maxPhotoBytes: 10_000, maxVideoBytes: 20_000, maxClipMs: 15_000 },
  }
  const drain = makeDrainChannelMedia(drainDeps)

  return {
    event,
    clients,
    events,
    guests,
    bindings,
    jobs,
    memberships,
    telegram,
    channels,
    keyer,
    bus,
    clock,
    ids,
    logger,
    replier,
    bindConversation,
    forgetChannelSender,
    receive,
    drain,
    drainDeps,
    erased,
    photoCalls,
    clipCalls,
    answerPhotos: (verdict: UploadPhotosVerdict) => {
      photoVerdict = verdict
    },
    answerClips: (verdict: UploadClipVerdict) => {
      clipVerdict = verdict
    },
    answerErase: (verdict: typeof eraseVerdict) => {
      eraseVerdict = verdict
    },
    /** Connect the conversation to the event, as `/soiree CODE` does. */
    bindNow: async (conversationRef = CONVERSATION) => {
      await receive(aCommand('bind', 'H7K2QM', { conversationRef }))
      telegram.said.length = 0
      bus.clear()
    },
    guestOf: (senderRef = '42') =>
      guests.findByChannelSender(asEventId('event-1'), 'telegram', `key:telegram:${senderRef}`),
    aWebGuest: (id = 'guest-web') => aGuest({ id, eventId: 'event-1' }),
    asGuestId,
    refusedPhoto: (code: string): UploadPhotosVerdict =>
      ok({
        outcomes: [
          {
            index: 0,
            declaredName: 'photo.jpg',
            kind: 'refused',
            error: DomainError.conflict(code),
          },
        ],
        published: [],
      }),
    failedUpload: (code: string) => err(DomainError.conflict(code)),
  }
}

export type ChannelScene = ReturnType<typeof aChannelScene>
