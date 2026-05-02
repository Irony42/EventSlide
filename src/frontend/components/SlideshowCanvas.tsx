import { useEffect, useState } from 'react'

interface SlideshowCanvasProps {
  imageUrl: string
  onNext: () => void
}

export default function SlideshowCanvas({ imageUrl, onNext }: SlideshowCanvasProps) {
  // Use two layers for crossfading
  const [bg1, setBg1] = useState(imageUrl)
  const [bg2, setBg2] = useState('')
  const [activeLayer, setActiveLayer] = useState<1 | 2>(1)

  useEffect(() => {
    if (!imageUrl) return
    if (activeLayer === 1 && imageUrl !== bg1) {
      setBg2(imageUrl)
      setActiveLayer(2)
    } else if (activeLayer === 2 && imageUrl !== bg2) {
      setBg1(imageUrl)
      setActiveLayer(1)
    }
  }, [imageUrl, bg1, bg2, activeLayer])

  return (
    <>
      <div
        className={`slideshow-root ${activeLayer === 1 ? 'active' : ''}`}
        style={{ backgroundImage: `url("${bg1}")`, zIndex: activeLayer === 1 ? 1 : 0 }}
        onClick={onNext}
      />
      <div
        className={`slideshow-root ${activeLayer === 2 ? 'active' : ''}`}
        style={{ backgroundImage: `url("${bg2}")`, zIndex: activeLayer === 2 ? 1 : 0 }}
        onClick={onNext}
      />
    </>
  )
}
