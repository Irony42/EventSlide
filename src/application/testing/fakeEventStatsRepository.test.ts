import { eventStatsRepositoryContract } from './contracts/eventStatsRepositoryContract'
import { FakeEventStatsRepository } from './fakeEventStatsRepository'
import { FakeGuestRepository } from './fakeGuestRepository'
import { FakePhotoRepository } from './fakePhotoRepository'
import { FakeReactionRepository } from './fakeReactionRepository'
import { asEventId, asGuestId, asPhotoId } from '../../domain/shared/ids'

eventStatsRepositoryContract('fake', async () => {
  const photos = new FakePhotoRepository()
  const guests = new FakeGuestRepository(photos)
  const reactions = new FakeReactionRepository()

  return {
    repo: new FakeEventStatsRepository(photos, guests, reactions),
    world: {
      addGuest: async (guest) => void guests.seed(guest),
      addPhoto: async (photo) => void photos.seed(photo),
      addReaction: async (reaction) => void reactions.seed(reaction),
      takeDown: (eventId, photoId) =>
        photos.setTakenDown(eventId, asPhotoId(photoId), new Date('2026-06-21T00:00:00.000Z')),
      deletePhoto: (eventId, photoId) => photos.delete(eventId, asPhotoId(photoId)),
      deleteGuest: async (eventId, guestId) => {
        await reactions.deleteByGuest(asEventId(eventId), asGuestId(guestId))
        await guests.delete(asEventId(eventId), asGuestId(guestId))
      },
    },
  }
})
