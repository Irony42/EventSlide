import { passwordHasherContract } from '../../application/testing/contracts/passwordHasherContract'
import { createBcryptPasswordHasher } from './bcryptPasswordHasher'

passwordHasherContract('bcrypt', () => createBcryptPasswordHasher({ cost: 10 }))
