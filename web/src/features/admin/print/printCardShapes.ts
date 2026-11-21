/** The torn edges of a till receipt, top and bottom, as one clip path. */
export const ZIGZAG = (() => {
  const teeth = 22
  const points: string[] = []
  for (let i = 0; i <= teeth; i++)
    points.push(`${((i / teeth) * 100).toFixed(2)}% ${i % 2 ? '1.4cqw' : '0px'}`)
  for (let i = teeth; i >= 0; i--) {
    points.push(`${((i / teeth) * 100).toFixed(2)}% calc(100% - ${i % 2 ? '1.4cqw' : '0px'})`)
  }
  return `polygon(${points.join(',')})`
})()
