import { exportFileStoreContract } from './contracts/exportFileStoreContract'
import { FakeExportFileStore } from './fakeExportFileStore'

exportFileStoreContract('fake', async () => ({ store: new FakeExportFileStore() }))
