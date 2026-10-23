import { describe, expect, it } from 'vitest'
import { filenameFromDisposition } from './api.js'

describe('filenameFromDisposition', () => {
  it('reads a quoted filename', () => {
    expect(filenameFromDisposition('attachment; filename="export-20261023.zip"')).toBe('export-20261023.zip')
  })
  it('reads a bare filename', () => {
    expect(filenameFromDisposition('attachment; filename=export-20261023.zip')).toBe('export-20261023.zip')
  })
  it('is null when the header is missing or has no filename', () => {
    expect(filenameFromDisposition(null)).toBeNull()
    expect(filenameFromDisposition('attachment')).toBeNull()
  })
})
