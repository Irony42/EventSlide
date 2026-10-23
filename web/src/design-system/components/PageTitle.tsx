import { useTranslations } from '../../lib/i18n/useTranslations'

export interface PageTitleProps {
  /** The page's name, from `text.titles`: a short noun, in the language on screen. */
  readonly title: string
}

/**
 * What the browser tab says (WCAG 2.4.2, level A).
 *
 * Renders a `<title>` and nothing else: React 19 hoists it into the document head and
 * puts it ahead of the one `index.html` ships, so the shell's own title is what a tab shows
 * while a lazy chunk arrives and again once the page has left. It is a component rather
 * than an effect for the same reason `GalleryPage`'s `<meta name="robots">` is: the tab
 * then follows the page that is mounted and nothing has to be restored by hand.
 *
 * **Once per page, and static.** Two mounted at once would leave two `<title>` elements in
 * the head and a browser reads only the first. The page's name is therefore a translated
 * phrase and never content: an event's name, a caption, or the token of an invitation or a
 * gallery link is not written here (`AcceptInvitationPage` has the reason for the last).
 */
export function PageTitle({ title }: PageTitleProps) {
  const t = useTranslations()
  // One string. `<title>{title} · {name}</title>` would hand React an array of three
  // children, which it refuses for a title.
  return <title>{`${title} · ${t.app.name}`}</title>
}
