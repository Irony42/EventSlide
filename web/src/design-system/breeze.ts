/**
 * The garland's « breeze »: each photo becomes a small pendulum that a moving pointer pushes in
 * the direction of the gesture. Ported from the brand kit's `garland.js`.
 *
 * Returns a function that takes everything back out, for a `useEffect` cleanup. Nothing moves
 * under `prefers-reduced-motion: reduce`, and no style is ever written into the markup: the
 * rotation goes through the CSSOM (`element.style`), which the production CSP
 * (`style-src 'self'`) does not govern.
 *
 * Every photo is an element marked `data-breeze-photo` holding an invisible circle centred on
 * its peg; the circle is what the pointer is measured against.
 */
export function breeze(svg: SVGSVGElement, area: Element | null = svg.parentElement): () => void {
  if (area === null) return () => {}
  // Where there is no matchMedia there is no preference to read: treat it as none given.
  const reduce =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false }

  const photos = Array.from(svg.querySelectorAll<SVGElement>('[data-breeze-photo]'), (el) => ({
    el,
    hit: el.querySelector('circle'),
    angle: 0,
    velocity: 0,
    x: 0,
    y: 0,
    radius: 0,
  }))

  let lastX: number | null = null
  let measured = false
  let running = false
  let then = 0
  let frame = 0

  // The pegs do not move when the photos turn (they are the pivots), so they are measured again
  // only after a scroll, a resize, the pointer coming in, or the end of the fall.
  const measure = () => {
    for (const photo of photos) {
      const box = photo.hit?.getBoundingClientRect()
      if (box === undefined) continue
      photo.x = box.left + box.width / 2
      photo.y = box.top + box.height / 2
      photo.radius = box.height / 2
    }
    measured = true
  }
  const forget = () => {
    measured = false
  }

  const step = (now: number) => {
    // The same motion at 60 and at 120 Hz.
    const factor = then === 0 ? 1 : Math.min(2, (now - then) / 16.7)
    then = now
    let moving = false
    for (const photo of photos) {
      // Spring and friction.
      photo.velocity += (-0.06 * photo.angle - 0.075 * photo.velocity) * factor
      photo.angle = Math.max(-18, Math.min(18, photo.angle + photo.velocity * factor))
      if (Math.abs(photo.angle) > 0.05 || Math.abs(photo.velocity) > 0.05) {
        moving = true
      } else {
        photo.angle = 0
        photo.velocity = 0
      }
      photo.el.style.transform = photo.angle === 0 ? '' : `rotate(${photo.angle.toFixed(2)}deg)`
    }
    running = moving
    if (moving) frame = requestAnimationFrame(step)
    else then = 0
  }

  const onMove = (event: Event) => {
    if (reduce.matches) return
    const { clientX, clientY } = event as PointerEvent
    if (!measured) measure()
    if (lastX !== null) {
      const speed = Math.max(-40, Math.min(40, clientX - lastX))
      for (const photo of photos) {
        if (photo.radius <= 0) continue
        const dx = clientX - photo.x
        const dy = Math.abs(clientY - photo.y)
        const band = dy < photo.radius * 1.2 ? 1 : dy < photo.radius * 3 ? 0.25 : 0
        const near = Math.exp(-(dx * dx) / (2 * (photo.radius * 0.8) ** 2)) * band
        photo.velocity = Math.max(-6, Math.min(6, photo.velocity - speed * near * 0.16))
      }
      if (!running) {
        running = true
        frame = requestAnimationFrame(step)
      }
    }
    lastX = clientX
  }
  const onLeave = () => {
    lastX = null
  }

  window.addEventListener('scroll', forget, { passive: true })
  window.addEventListener('resize', forget)
  area.addEventListener('pointerenter', forget)
  area.addEventListener('pointermove', onMove)
  area.addEventListener('pointerleave', onLeave)
  svg.addEventListener('animationend', forget)

  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('scroll', forget)
    window.removeEventListener('resize', forget)
    area.removeEventListener('pointerenter', forget)
    area.removeEventListener('pointermove', onMove)
    area.removeEventListener('pointerleave', onLeave)
    svg.removeEventListener('animationend', forget)
    for (const photo of photos) photo.el.style.transform = ''
  }
}
