import { FakeClientRepository } from './fakeClientRepository'
import { FakePhotoRepository } from './fakePhotoRepository'
import { FakeReelRepository } from './fakeReelRepository'
import { reelRepositoryContract } from './contracts/reelRepositoryContract'

reelRepositoryContract('fake', async () => {
  const clients = new FakeClientRepository()
  const photos = new FakePhotoRepository().chargeClientBytesFrom(clients)

  return {
    repo: new FakeReelRepository(photos),
    photos,
    placeEventsInClient: async (clientId, eventIds): Promise<void> => {
      for (const eventId of eventIds) clients.linkEvent(eventId, clientId)
    },
  }
})
