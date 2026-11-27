import { hostAnnouncementRepositoryContract } from './contracts/hostAnnouncementRepositoryContract'
import { FakeHostAnnouncementRepository } from './fakeHostAnnouncementRepository'

hostAnnouncementRepositoryContract('fake', async () => {
  const repo = new FakeHostAnnouncementRepository()
  // The fake is told who owns a client; "owns another client" changes nothing it reads (one account, once).
  return {
    repo,
    addOwner: async (userId, email) => {
      repo.withOwner(userId, email)
    },
    addMember: async () => {},
    addStranger: async () => {},
    switchOff: async (userId) => {
      repo.switchOff(userId)
    },
    ownAnotherClient: async () => {},
  }
})
