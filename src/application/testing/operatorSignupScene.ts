import { asAccountTokenId, asClientId, asUserId } from '../../domain/shared/ids'
import { DomainError } from '../../domain/shared/errors'
import { createSignupRequest } from '../../domain/signups/signupRequest'
import { EmailAddress } from '../../domain/users/emailAddress'
import { err, ok } from '../../domain/shared/result'
import { AT, anAccountToken, aUser } from './builders'
import { FakeAccountTokenRepository } from './fakeAccountTokenRepository'
import { FakeAuditLog } from './fakeAuditLog'
import { FakeClock } from './fakeClock'
import { FakeMailer } from './fakeMailer'
import { FakeSignupRepository } from './fakeSignupRepository'
import { FakeUserRepository } from './fakeUserRepository'
import type {
  ProvisionClientOwner,
  ProvisionClientOwnerInput,
} from '../usecases/clients/provisionClientOwner'

/**
 * The scene the three operator-side signup use cases are tested in: the in-memory signup store with its
 * token store, an operator account, a recording audit log and mailer, and a `provisionClientOwner` that
 * records its calls and can be told to fail or throw (the real one has its own tests).
 */

export const OPERATOR = asUserId('user-operator')
export const CLIENT = asClientId('client-new')

export const aSignupScene = () => {
  const clock = new FakeClock(AT)
  const tokens = new FakeAccountTokenRepository().withAccounts(OPERATOR).withClients(CLIENT)
  const signups = new FakeSignupRepository(tokens).withAccounts(OPERATOR).withClients(CLIENT)
  const audit = new FakeAuditLog().withAccounts(OPERATOR)
  const mailer = new FakeMailer()
  const users = new FakeUserRepository()
  const provisioned: ProvisionClientOwnerInput[] = []
  let behaviour: 'ok' | 'fail' | 'throw' = 'ok'

  const provisionClientOwner: ProvisionClientOwner = async (input) => {
    provisioned.push(input)
    if (behaviour === 'throw') throw new Error('storage failed')
    if (behaviour === 'fail') return err(DomainError.conflict('invitation.tooManyForAddress'))
    // The invitation token must exist for the signup's foreign key to hold it.
    await tokens.save(
      anAccountToken({
        id: 'invitation-1',
        purpose: 'invitation',
        email: input.ownerEmail,
        userId: null,
        clientId: CLIENT,
        clientRole: 'owner',
      }),
    )
    return ok({
      clientId: CLIENT,
      invitation: {
        invitationId: asAccountTokenId('invitation-1'),
        expiresAt: new Date(AT.getTime() + 7 * 86_400_000),
        delivery: 'mail',
      },
    })
  }

  /** A request confirmed into the operator's queue (`pending`), or left `unconfirmed`. */
  const seed = async (
    input: {
      id?: string
      email?: string
      locale?: 'fr' | 'en'
      confirmed?: boolean
      at?: Date
    } = {},
  ): Promise<string> => {
    const id = input.id ?? 'signup-1'
    const address = EmailAddress.create(input.email ?? 'camille@example.test')
    if (!address.ok) throw new Error('fixture rejected')
    const sent = input.at ?? AT
    const request = createSignupRequest(
      { id, email: address.value, clientName: 'Mariage de Léa', locale: input.locale ?? 'fr' },
      sent,
    )
    if (!request.ok) throw new Error('fixture rejected')
    const token = anAccountToken({
      id: `confirm-${id}`,
      purpose: 'emailVerification',
      email: address.value.value,
      userId: null,
      createdAt: sent,
    })
    await signups.admit({ request: request.value, token, now: sent, maxPerDay: 100 })
    if (input.confirmed !== false) {
      await signups.confirm({ tokenDigest: token.tokenDigest, now: sent, outcome: 'pending' })
    }
    return id
  }

  return {
    clock,
    signups,
    tokens,
    audit,
    mailer,
    users,
    aUser,
    provisioned,
    provisionClientOwner,
    seed,
    failProvisioning: () => (behaviour = 'fail'),
    provisioningWorksAgain: () => (behaviour = 'ok'),
    throwInProvisioning: () => (behaviour = 'throw'),
  }
}
