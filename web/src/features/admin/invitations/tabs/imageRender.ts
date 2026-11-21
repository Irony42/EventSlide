/**
 * The invitation image, made in the browser (spec 29, ADR 0016): the card as a PNG of the size a
 * phone posts. `html-to-image` draws the DOM into an SVG `foreignObject` and a canvas; it is
 * loaded **on demand**, so neither the main bundle nor the public invitation page carries it.
 *
 * Nothing leaves the device. The fonts and the photograph are the instance's own or `data:`, which
 * the CSP already allows; no CDN is opened.
 */

export interface ShotSize {
  readonly width: number
  readonly height: number
}

/** Makes the PNG of an element. Injectable, so a component test needs no canvas. */
export type RenderPng = (node: HTMLElement, size: ShotSize) => Promise<Blob>

/**
 * Asks the browser for every face the card writes in: the card fonts download only when a card
 * uses them, and a capture taken before they arrive would draw the fallback. Resolves once the
 * browser says its fonts are ready.
 */
export const loadFacesOf = async (root: HTMLElement): Promise<void> => {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  if (fonts === undefined) return
  const wanted = new Set<string>()
  for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (element.textContent?.trim() === '' && element.children.length === 0) continue
    const style = getComputedStyle(element)
    wanted.add(`${style.fontStyle} ${style.fontWeight} 32px ${style.fontFamily}`)
  }
  await Promise.all(
    [...wanted].map((face) => fonts.load(face, root.textContent ?? '').catch(() => [])),
  )
  await fonts.ready
}

/** Safari draws the first capture of a page without its fonts and images: one is made and thrown away. */
const needsWarmUp = (): boolean => {
  const agent = navigator.userAgent
  const webkit = /AppleWebKit/.test(agent) && !/Chrome|Chromium|Edg|Android/.test(agent)
  return webkit || /CriOS|FxiOS|EdgiOS/.test(agent)
}

export const renderCardPng: RenderPng = async (node, size) => {
  await loadFacesOf(node)
  const { toBlob } = await import('html-to-image')
  const options = {
    width: size.width,
    height: size.height,
    canvasWidth: size.width,
    canvasHeight: size.height,
    pixelRatio: 1,
    cacheBust: false,
  }
  if (needsWarmUp()) await toBlob(node, options)
  const blob = await toBlob(node, options)
  if (blob === null) throw new Error('the browser produced no image')
  return blob
}

/**
 * The photograph as a ground: drawn tiny on a canvas, then stretched back by the browser's own
 * smoothing, which blurs it the same way everywhere. A CSS or canvas `blur` filter is left to the
 * browser's mood inside a `foreignObject` (Safari ignores it), and this is not. `null` when the
 * browser cannot draw it: the ground is then the card's colour.
 */
export const blurPhoto = async (photoUrl: string): Promise<string | null> => {
  try {
    const image = new Image()
    image.src = photoUrl
    await image.decode()
    const ratio = image.naturalHeight / image.naturalWidth
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = Math.max(1, Math.round(40 * ratio))
    const context = canvas.getContext('2d')
    if (context === null) return null
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return null
  }
}
