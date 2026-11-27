import { asEventId, asUserId } from '../../domain/shared/ids'
import {
  MAIL_PREFERENCE_CONTRACT_FIXTURES,
  mailPreferenceRepositoryContract,
} from './contracts/mailPreferenceRepositoryContract'
import { FakeMailPreferenceRepository } from './fakeMailPreferenceRepository'

mailPreferenceRepositoryContract('fake', async () => {
  const { eventId, otherEventId, userIds } = MAIL_PREFERENCE_CONTRACT_FIXTURES
  const users = userIds.map(asUserId)
  return {
    repo: new FakeMailPreferenceRepository()
      .withUsers(...users)
      .withMembers(
        ...users.map((userId) => ({ eventId: asEventId(eventId), userId })),
        ...users.map((userId) => ({ eventId: asEventId(otherEventId), userId })),
      ),
  }
})
