/**
 * What a test needs to say which classes an element wears.
 *
 * A CSS Module's classes are hashed, so a test cannot spell them: it reads them off the
 * stylesheet module the component itself imports. That also fails the day a class is renamed
 * in the stylesheet and not in the component, which is a different defect from a missing one.
 */

type Styles = Readonly<Record<string, string | undefined>>

/** A class of a stylesheet, or a failure saying the stylesheet has no such class. */
export const cls = (styles: Styles, name: string): string => {
  const found = styles[name]
  if (found === undefined) throw new Error(`the stylesheet has no .${name}`)
  return found
}

/** The class tokens an element wears, in the order its `class` attribute gives them. */
export const classesOf = (element: Element | null | undefined): readonly string[] =>
  (element?.getAttribute('class') ?? '').split(' ').filter((name) => name !== '')
