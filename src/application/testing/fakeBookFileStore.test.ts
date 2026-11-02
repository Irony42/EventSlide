import { bookFileStoreContract } from './contracts/bookFileStoreContract'
import { FakeBookFileStore } from './fakeBookFileStore'

bookFileStoreContract('fake', async () => ({ store: new FakeBookFileStore() }))
