import { albumBookRepositoryContract } from './contracts/albumBookRepositoryContract'
import { FakeAlbumBookRepository } from './fakeAlbumBookRepository'

albumBookRepositoryContract('fake', async () => ({ repo: new FakeAlbumBookRepository() }))
