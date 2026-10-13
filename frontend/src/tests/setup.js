import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// Filters are remembered in sessionStorage; a test must not inherit the last one's.
afterEach(() => {
  try {
    sessionStorage.clear()
  } catch {
    // a test that made storage throw has already restored it
  }
})
