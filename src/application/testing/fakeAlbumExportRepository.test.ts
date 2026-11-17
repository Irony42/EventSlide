import { albumExportRepositoryContract } from './contracts/albumExportRepositoryContract'
import { FakeAlbumExportRepository } from './fakeAlbumExportRepository'

albumExportRepositoryContract('fake', async () => ({ repo: new FakeAlbumExportRepository() }))
