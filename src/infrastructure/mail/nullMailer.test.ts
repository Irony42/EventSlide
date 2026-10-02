import { mailerContract } from '../../application/testing/contracts/mailerContract'
import { nullMailer } from './nullMailer'

// The self-hoster default: no SMTP configured, so nothing leaves and the caller shows a
// link to copy. The same suite that holds the fake and the SMTP adapter to account holds
// this one to the other half of it.
mailerContract('null', 'sendsNothing', async () => ({
  mailer: nullMailer,
  delivered: async () => [],
  provoke: async () => {
    throw new Error('a mailer that sends nothing has no relay to provoke')
  },
}))
