import { useEffect, useState } from 'react'

export function useIsMobile(breakpoint = 768) {
  // Initialise from matchMedia synchronously so the first paint matches
  // the value the effect would have set. Using window.innerWidth here
  // disagrees with matchMedia by the scrollbar width on some systems
  // and was causing the dock to flicker desktop→mobile on first render.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined'
      && window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    setIsMobile(mq.matches)
    return () => mq.removeEventListener('change', handler)
  }, [breakpoint])

  return isMobile
}
