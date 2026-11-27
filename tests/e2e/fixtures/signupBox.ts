import type { TestInfo } from '@playwright/test'
import {
  parseMessage,
  startSmtpSink,
  type ParsedMessage,
  type SmtpSink,
} from '../../../src/infrastructure/mail/testing/smtpSink'
import { HOSTED } from './operatorFactor'
import { startTestApp, type TestApp } from './startTestApp'

/**
 * A box configured the way the hosted instance is for self-service signup (spec 31), on its own
 * server with a mail relay that is a listener in this process: the shared server has no relay on
 * purpose (a self-hoster with no SMTP sees no signup), so every spec about signup boots one.
 *
 * `operator` adds what the console needs (`SITE_ADMIN`, a second factor) and what the welcome mail
 * names (`OPERATOR_NAME`, its contact address and the guides page). `terms` asks the invitation's
 * acceptance for the terms of use, as the hosted instance does.
 */

export const CONTACT = 'contact@hosted.example.org'
export const GUIDES = '/legal/avant-evenement'
export const TERMS_VERSION = '2026-11'

export interface SignupBox {
  readonly app: TestApp
  readonly sink: SmtpSink
  close(): Promise<void>
}

export interface SignupBoxOptions {
  readonly mode: 'review' | 'open'
  /** Extra settings, merged over the defaults (a ceiling, a disk floor). */
  readonly env?: Readonly<Record<string, string>>
  /** Ask the invitation's acceptance for the terms of use. */
  readonly terms?: boolean
}

export const startSignupBox = async (
  testInfo: TestInfo,
  { mode, env = {}, terms = false }: SignupBoxOptions,
): Promise<SignupBox> => {
  const sink = await startSmtpSink()
  const app = await startTestApp({
    worker: testInfo.workerIndex,
    env: {
      ...HOSTED,
      SMTP_URL: `smtp://127.0.0.1:${sink.port}`,
      MAIL_FROM: 'no-reply@eventslide.test',
      SIGNUP: mode,
      OPERATOR_NAME: 'Association Les Photographes',
      OPERATOR_CONTACT_EMAIL: CONTACT,
      SUPPORT_URL: GUIDES,
      ...(terms
        ? {
            LEGAL_TERMS_URL: 'https://hosted.example.org/legal/cgu',
            LEGAL_TERMS_VERSION: TERMS_VERSION,
          }
        : {}),
      ...env,
    },
  }).catch(async (error: unknown) => {
    await sink.close()
    throw error
  })
  return {
    app,
    sink,
    close: async () => {
      await app.dispose()
      await sink.close()
    },
  }
}

/** The mails the relay accepted for one recipient, oldest first. */
export const mailsTo = (
  sink: SmtpSink,
  address: string,
): readonly (ParsedMessage & { readonly text: string })[] =>
  sink.messages
    .filter((message) => message.envelopeTo.includes(address))
    .map((message) => {
      const parsed = parseMessage(message.raw)
      return { ...parsed, text: parsed.text ?? '' }
    })

/** The one link of the first mail to `address` whose subject holds `subject`, or `null` until it arrives. */
export const linkIn = (
  sink: SmtpSink,
  address: string,
  subject: string,
  path: RegExp,
): string | null => {
  for (const mail of mailsTo(sink, address)) {
    if (!mail.subject.includes(subject)) continue
    const found = path.exec(mail.text)?.[0]
    if (found !== undefined) return found
  }
  return null
}
