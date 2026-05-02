interface SlideshowCanvasProps {
  imageUrl: string
  onNext: () => void
}

export default function SlideshowCanvas({ imageUrl, onNext }: SlideshowCanvasProps) {
  return (
    <div
      id="slideshow"
      className="slideshow-root"
      style={{ backgroundImage: `url("${imageUrl}")` }}
      onClick={onNext}
    />
  )
}
