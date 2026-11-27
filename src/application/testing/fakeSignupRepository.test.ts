import { signupRepositoryContract } from './contracts/signupRepositoryContract'
import { asClientId, asUserId } from '../../domain/shared/ids'
import { FakeAccountTokenRepository } from './fakeAccountTokenRepository'
import { FakeSignupRepository } from './fakeSignupRepository'

signupRepositoryContract('fake', async () => {
  const accounts = ['user-1', 'user-2', 'user-approver'].map(asUserId)
  const clients = ['client-1', 'client-2'].map(asClientId)
  const tokens = new FakeAccountTokenRepository().withAccounts(...accounts).withClients(...clients)
  const repo = new FakeSignupRepository(tokens).withAccounts(...accounts).withClients(...clients)
  return { repo, tokens }
})
