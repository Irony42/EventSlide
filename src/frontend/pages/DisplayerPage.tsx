import { useEffect, useState } from 'react'
import IntervalInputOverlay from '../components/IntervalInputOverlay'
import SlideshowCanvas from '../components/SlideshowCanvas'
import SlideshowTooltip from '../components/SlideshowTooltip'
import { useSlideshowController } from '../features/useSlideshowController'
import { useAcceptedPicturesPolling } from '../hooks/useAcceptedPicturesPolling'

export default function DisplayerPage() {
  const { pictures, error } = useAcceptedPicturesPolling(15000)
  const { currentImageUrl, nextImage, setIntervalMs, resetIndex } = useSlideshowController(pictures)
  const [showHint, setShowHint] = useState(false)
  const [showIntervalInput, setShowIntervalInput] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') setShowIntervalInput(true)
      if (event.key === 'Delete') {
        const confirmed = window.confirm("Réinitialiser l'index du diaporama ?")
        if (confirmed) resetIndex()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [resetIndex])

  return (
    <>
      <SlideshowCanvas imageUrl={currentImageUrl} onNext={nextImage} />
      {error ? (
        <p className="status-message error position-fixed top-0 start-50 translate-middle-x mt-3 px-3 py-2">
          {error}
        </p>
      ) : null}
      <SlideshowTooltip
        showHint={showHint}
        onEnter={() => setShowHint(true)}
        onLeave={() => setShowHint(false)}
      />
      {showIntervalInput ? (
        <IntervalInputOverlay
          onSubmit={(value) => {
            setIntervalMs(value)
            setShowIntervalInput(false)
          }}
        />
      ) : null}
    </>
  )
}
