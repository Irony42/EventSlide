/**
 * Put text on the clipboard, and say whether it worked.
 *
 * Never rejects. The host console copies a link or a set of codes in six places and each used
 * to guard the browser in its own way: some forgot the refusal (a permission, a document that is
 * not focused) and left an unhandled rejection, some forgot that `navigator.clipboard` does not
 * exist at all on an address that is not a secure context, which includes the plain-HTTP LAN
 * deployment this product is at home on. Both are the same answer here, `false`, and the caller
 * decides what to say: the text is on screen to be selected either way.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  // An absent clipboard throws on the property read, inside the try: the same answer as a refusal.
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
