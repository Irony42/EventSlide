import { pushSubscriptionRepositoryContract } from './contracts/pushSubscriptionRepositoryContract'
import { FakePushSubscriptionRepository } from './fakePushSubscriptionRepository'

pushSubscriptionRepositoryContract('fake', async () => ({
  repo: new FakePushSubscriptionRepository(),
}))
