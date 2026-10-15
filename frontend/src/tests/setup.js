import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { configure } from '@testing-library/react'

// findBy*/waitFor give up after 1000 ms by default. On the Windows bind-mounted container a run is slow enough
// that an ordinary async render (no ordering bug) occasionally lands at ~1050 ms and fails; waiting longer costs
// nothing when the element is already there. Stays well under vitest's 5000 ms per-test timeout.
configure({ asyncUtilTimeout: 3000 })

// Filters are remembered in sessionStorage; a test must not inherit the last one's.
afterEach(() => {
  try {
    sessionStorage.clear()
  } catch {
    // a test that made storage throw has already restored it
  }
})
