import { archiveWriterContract } from '../../application/testing/contracts/archiveWriterContract'
import { archiverWriter } from './archiverWriter'

archiveWriterContract('archiver', () => archiverWriter)
