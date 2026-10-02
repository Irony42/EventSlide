import { totpEngineContract } from './contracts/totpEngineContract'
import { FakeTotpEngine } from './fakeTotpEngine'

totpEngineContract('fake', new FakeTotpEngine())
