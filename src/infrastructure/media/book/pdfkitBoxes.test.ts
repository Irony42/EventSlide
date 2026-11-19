import PDFDocument from 'pdfkit'
import { describe, expect, it } from 'vitest'
import { setPageBoxes, setPageLayout } from './pdfkitBoxes'

const pdfOf = async (draw: (doc: PDFKit.PDFDocument) => void): Promise<string> => {
  const doc = new PDFDocument({ margin: 0, autoFirstPage: false, compress: false })
  const parts: Buffer[] = []
  doc.on('data', (chunk: Buffer) => parts.push(chunk))
  draw(doc)
  const done = new Promise<void>((resolve) => doc.on('end', resolve))
  doc.end()
  await done
  return Buffer.concat(parts).toString('latin1')
}

describe('pdfkitBoxes', () => {
  it('writes the TrimBox and the BleedBox in the page it was given, and only there', async () => {
    const pdf = await pdfOf((doc) => {
      doc.addPage({ size: [100, 100] })
      setPageBoxes(doc, [5, 5, 95, 95], [0, 0, 100, 100])
      doc.addPage({ size: [100, 100] })
    })

    expect(pdf.match(/\/TrimBox \[5 5 95 95\]/g)).toHaveLength(1)
    expect(pdf.match(/\/BleedBox \[0 0 100 100\]/g)).toHaveLength(1)
  })

  it('writes the page layout in the root of the document as a name', async () => {
    const pdf = await pdfOf((doc) => {
      setPageLayout(doc, 'TwoPageRight')
      doc.addPage({ size: [100, 100] })
    })

    expect(pdf).toContain('/PageLayout /TwoPageRight')
  })
})
