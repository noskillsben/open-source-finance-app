import { useEffect, useState } from 'react'

/** Whether a CSS media query matches now, and re-renders when that changes. Where `matchMedia`
 * does not exist (a test DOM) the answer is `fallback`. */
export default function useMediaQuery(query, fallback = false) {
  const read = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : fallback)
  const [matches, setMatches] = useState(read)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** 768 px and wider: the width at which a list is a table (DESIGN.md § Lists on a phone). */
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)', true)
