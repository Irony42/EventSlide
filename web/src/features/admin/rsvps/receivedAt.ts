/** When a reply was received, as the host reads it: "22 nov., 18:04", in their language and zone. */
export const receivedAt = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
