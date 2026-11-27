import { EmailAddress } from '../domain/users/emailAddress'

/**
 * What the welcome mail (spec 31) names, from the operator's configuration: the contact address
 * (`OPERATOR_CONTACT_EMAIL`) and the guides page (`SUPPORT_URL`, which is an https URL or a path
 * on this site, made absolute here). `null` when either is missing or unusable: a welcome that
 * names a contact or a page that does not exist is worse than none, so the mail is not sent.
 */
export const welcomeLinks = (config: {
  readonly publicUrl: string
  readonly operator: { readonly contactEmail: string | null; readonly supportUrl: string | null }
}): { readonly contact: EmailAddress; readonly guidesLink: string } | null => {
  const { contactEmail, supportUrl } = config.operator
  if (contactEmail === null || supportUrl === null) return null
  const contact = EmailAddress.create(contactEmail)
  if (!contact.ok) return null
  const guidesLink = supportUrl.startsWith('/')
    ? `${config.publicUrl.replace(/\/+$/, '')}${supportUrl}`
    : supportUrl
  return { contact: contact.value, guidesLink }
}

/**
 * The variables a box with `SIGNUP` on is missing for the welcome mail, to name at boot. Empty when
 * the mail will be sent. `OPERATOR_CONTACT_EMAIL` is only accepted beside `OPERATOR_NAME`.
 */
export const welcomeMissing = (config: {
  readonly operator: { readonly contactEmail: string | null; readonly supportUrl: string | null }
}): readonly string[] => [
  ...(config.operator.contactEmail === null
    ? ['OPERATOR_CONTACT_EMAIL (needs OPERATOR_NAME)']
    : []),
  ...(config.operator.supportUrl === null ? ['SUPPORT_URL'] : []),
]
