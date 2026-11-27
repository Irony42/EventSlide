import { asClientId, asAccountTokenId, type ClientId } from '../../domain/shared/ids'
import { issueAccountToken, type AccountToken } from '../../domain/users/accountToken'
import { ok } from '../../domain/shared/result'
import type { ClientLocale } from '../../domain/clients/clientLocale'
import { EmailAddress } from '../../domain/users/emailAddress'
import { AT } from './builders'
import { CapturingLogger } from './capturingLogger'
import { FakeAccountTokenRepository } from './fakeAccountTokenRepository'
import { FakeAuditLog } from './fakeAuditLog'
import { FakeClientRepository } from './fakeClientRepository'
import { FakeClock } from './fakeClock'
import { FakeDiskSpaceChecker } from './fakeDiskSpaceChecker'
import { FakeMailer } from './fakeMailer'
import { FakeSecretTokens } from './fakeSecretTokens'
import { FakeSignupRepository } from './fakeSignupRepository'
import { SequentialIdGenerator } from './sequentialIdGenerator'
import type { ProvisionClientOwner } from '../usecases/clients/provisionClientOwner'
import { makeConfirmSignup } from '../usecases/signups/confirmSignup'
import { makeNotifySignupOperator } from '../usecases/signups/notifySignupOperator'
import { makePreviewSignupConfirmation } from '../usecases/signups/previewSignupConfirmation'
import { makeRequestSignup, type RequestSignupInput } from '../usecases/signups/requestSignup'
import type { SignupMode } from '../../domain/signups/signupMode'

export const PUBLIC_URL = 'https://photos.example.test'
export const ADDRESS = 'lea@example.test'
export const OPERATOR_ADDRESS = 'pierre@example.test'
export const DISK_PATH = '/data'

/** A form as a person fills it. */
export const aForm = (overrides: Partial<RequestSignupInput> = {}): RequestSignupInput => ({
  email: ADDRESS,
  clientName: 'Mariage de Lea et Hugo',
  locale: 'fr' as ClientLocale,
  website: '',
  ...overrides,
})

/** The whole signup world over the fakes, built once per test. */
export const buildSignupScene = (
  options: { readonly mode?: SignupMode; readonly maxPerDay?: number } = {},
) => {
  const mode = options.mode ?? 'open'
  const clock = new FakeClock(AT)
  const tokens = new FakeAccountTokenRepository()
  const signups = new FakeSignupRepository(tokens)
  const secrets = new FakeSecretTokens()
  const mailer = new FakeMailer()
  const ids = new SequentialIdGenerator()
  const logger = new CapturingLogger()
  const audit = new FakeAuditLog()
  const clients = new FakeClientRepository()
  const disk = new FakeDiskSpaceChecker()
  const operator = EmailAddress.create(OPERATOR_ADDRESS)
  if (!operator.ok) throw new Error('fixture')

  const notify = makeNotifySignupOperator({
    mailer,
    to: operator.value,
    publicUrl: PUBLIC_URL,
    clock,
    logger,
  })

  /** The calls `provisionClientOwner` received, and what it answers next (default: a client). */
  const provisioned: Parameters<ProvisionClientOwner>[0][] = []
  const provisioning: {
    next: Awaited<ReturnType<ProvisionClientOwner>> | 'throw' | 'throw-text' | 'link' | null
  } = {
    next: null,
  }
  let clientCount = 0
  const provisionClientOwner: ProvisionClientOwner = async (input) => {
    provisioned.push(input)
    const planned = provisioning.next
    provisioning.next = null
    if (planned === 'throw') throw new Error('storage failed')
    if (planned === 'throw-text') throw 'plain text'
    if (planned !== null && planned !== 'link') return planned
    clientCount += 1
    const clientId = asClientId(`client-${clientCount}`)
    signups.withClients(clientId)
    tokens.withClients(clientId)
    const invitationId = asAccountTokenId(`invitation-${clientCount}`)
    await tokens.save({
      ...(await invitationRow(ids, secrets, input.ownerEmail, clientId, clock.now())),
      id: invitationId,
    })
    return ok({
      clientId,
      invitation: {
        invitationId,
        expiresAt: new Date(clock.now().getTime() + 7 * 86_400_000),
        ...(planned === 'link'
          ? { delivery: 'link' as const, link: 'https://secret.example.test/invite' }
          : { delivery: 'mail' as const }),
      },
    })
  }

  const requestSignup = makeRequestSignup({
    mode,
    signups,
    secrets,
    mailer,
    ids,
    clock,
    logger,
    audit,
    publicUrl: PUBLIC_URL,
    maxPerDay: options.maxPerDay ?? 50,
  })
  const preview = makePreviewSignupConfirmation({ mode, signups, secrets, clock })
  const confirmNow = makeConfirmSignup({
    mode,
    signups,
    secrets,
    provisionClientOwner,
    clients,
    disk,
    diskPaths: [DISK_PATH],
    minFreeDiskBytes: 1_000_000_000,
    notify,
    clock,
    logger,
  })

  /** Presses the button and waits for the notices behind it, as a test may and the route does not. */
  const confirm: typeof confirmNow = async (input) => {
    const result = await confirmNow(input)
    if (result.ok) await result.value.completion
    return result
  }

  /** Submits the form and waits for its completion, as a test may and the route does not. */
  const submit = async (input: RequestSignupInput = aForm()) => {
    const result = await requestSignup(input)
    if (result.ok) await result.value.completion
    return result
  }

  /** The token in the last confirmation mail's link. */
  const lastToken = (): string => {
    const mail = mailer.sent[mailer.sent.length - 1]
    const match = mail?.text.match(/\/signup\/confirm\/([^?\s]+)/)
    if (match?.[1] === undefined) throw new Error('no confirmation link in the last mail')
    return decodeURIComponent(match[1])
  }

  return {
    clock,
    tokens,
    ids,
    signups,
    secrets,
    mailer,
    logger,
    audit,
    clients,
    disk,
    notify,
    provisioned,
    provisioning,
    provisionClientOwner,
    requestSignup,
    preview,
    confirm,
    confirmNow,
    submit,
    lastToken,
  }
}

/** An invitation row to satisfy `finalize`'s foreign key. */
const invitationRow = async (
  ids: SequentialIdGenerator,
  secrets: FakeSecretTokens,
  email: string,
  clientId: ClientId,
  now: Date,
): Promise<AccountToken> => {
  const address = EmailAddress.create(email)
  if (!address.ok) throw new Error('fixture')
  const issued = issueAccountToken(
    {
      purpose: 'invitation',
      tokenDigest: secrets.mint().digest,
      email: address.value,
      userId: null,
      clientId,
      clientRole: 'owner',
      delivery: 'mail',
      createdBy: null,
    },
    ids.accountTokenId(),
    now,
  )
  if (!issued.ok) throw new Error('fixture')
  return issued.value
}
