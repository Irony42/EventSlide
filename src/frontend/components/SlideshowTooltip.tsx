interface SlideshowTooltipProps {
  showHint: boolean
  onEnter: () => void
  onLeave: () => void
}

export default function SlideshowTooltip({ showHint, onEnter, onLeave }: SlideshowTooltipProps) {
  return (
    <>
      <div
        id="slideshowTooltip"
        className="slideshow-tooltip"
        title="Aide"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        i
      </div>
      <p id="slideshowHint" className={`slideshow-hint ${showHint ? 'visible' : ''}`}>
        Clic: image suivante | Entree: changer intervalle | Suppr: reset compteur
      </p>
    </>
  )
}
