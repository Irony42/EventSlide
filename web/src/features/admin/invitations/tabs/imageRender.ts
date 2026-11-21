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
export const loadFacesOf = async (root: HTMLElement): Promise<string> => {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  if (fonts === undefined) return ''
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
  return [...wanted].sort().join('|')
}

/** Safari draws the first capture of a page without its fonts and images: one is made and thrown away. */
const needsWarmUp = (): boolean => {
  const agent = navigator.userAgent
  const webkit = /AppleWebKit/.test(agent) && !/Chrome|Chromium|Edg|Android/.test(agent)
  return webkit || /CriOS|FxiOS|EdgiOS/.test(agent)
}

/**
 * The `@font-face` CSS that is embedded in a capture, once per set of faces. `html-to-image` would
 * otherwise read every rule of the page and fetch every font file again at each capture, the
 * warm-up one included; here the faces the card is written in are embedded, as data, from one
 * pass.
 */
const embedded = new Map<string, Promise<string>>()

const fontEmbedCssOf = (node: HTMLElement, faces: string): Promise<string> => {
  let css = embedded.get(faces)
  if (css === undefined) {
    css = import('html-to-image').then(({ getFontEmbedCSS }) => getFontEmbedCSS(node))
    // A failure is not kept: the next capture asks again.
    css.catch(() => embedded.delete(faces))
    embedded.set(faces, css)
  }
  return css
}

/** What an SVG shape is painted with: the properties a style sheet gives it. */
const SVG_PAINT = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-dasharray',
  'opacity',
  'filter',
  'vector-effect',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
] as const

/**
 * Writes the colours and strokes of every SVG shape in the node **onto the shape**, and returns what
 * puts it back. `html-to-image` carries the computed style of the HTML it copies but not of an SVG
 * shape, which keeps only its class: in the picture, which is a document of its own, the class
 * names nothing, and a garland of coloured prints comes out black. The values written are the
 * computed ones, so a colour that is a custom property of the card is already a colour.
 *
 * Through the style object, not the `style` attribute: the page's CSP allows the first and not
 * the second.
 */
export const inlineSvgPaint = (root: HTMLElement): (() => void) => {
  const undo: (() => void)[] = []
  for (const shape of root.querySelectorAll('svg, svg *')) {
    if (!(shape instanceof SVGElement)) continue
    const computed = getComputedStyle(shape)
    const was = new Map<string, string>()
    for (const name of SVG_PAINT) {
      const value = computed.getPropertyValue(name)
      if (value === '') continue
      was.set(name, shape.style.getPropertyValue(name))
      shape.style.setProperty(name, value)
    }
    undo.push(() => {
      for (const [name, before] of was) {
        if (before === '') shape.style.removeProperty(name)
        else shape.style.setProperty(name, before)
      }
      if (shape.style.length === 0) shape.removeAttribute('style')
    })
  }
  return () => undo.forEach((step) => step())
}

export const renderCardPng: RenderPng = async (node, size) => {
  const faces = await loadFacesOf(node)
  const { toBlob } = await import('html-to-image')
  const fontEmbedCSS = await fontEmbedCssOf(node, faces)
  const options = {
    fontEmbedCSS,
    width: size.width,
    height: size.height,
    canvasWidth: size.width,
    canvasHeight: size.height,
    pixelRatio: 1,
    cacheBust: false,
  }
  const restore = inlineSvgPaint(node)
  try {
    if (needsWarmUp()) await toBlob(node, options)
    const blob = await toBlob(node, options)
    if (blob === null) throw new Error('the browser produced no image')
    return blob
  } finally {
    restore()
  }
}

/**
 * The photograph as a ground: drawn tiny on a canvas, then stretched back by the browser's own
 * smoothing, which blurs it the same way everywhere. A CSS or canvas `blur` filter is left to the
 * browser's mood inside a `foreignObject` (Safari ignores it), and this is not. `null` when the
 * browser cannot draw it: the ground is then the card's colour.
 */
export const blurPhoto = (photoUrl: string): Promise<string | null> =>
  // A photograph that never decodes must not hold the image back for ever: the colour is the ground then.
  Promise.race([
    blurred(photoUrl),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), BLUR_TIMEOUT_MS)),
  ])

const BLUR_TIMEOUT_MS = 5_000

const blurred = async (photoUrl: string): Promise<string | null> => {
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
