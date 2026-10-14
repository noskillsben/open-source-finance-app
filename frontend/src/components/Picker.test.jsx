import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Picker from './Picker.jsx'

const items = [{ id: 1, name: 'Groceries' }, { id: 2, name: 'Rent' }]

function setup() {
  const onPick = vi.fn()
  render(
    <div>
      <Picker text="" onText={() => {}} ariaLabel="Category" items={items} onPick={onPick} />
      <button>elsewhere</button>
    </div>,
  )
  const box = screen.getByLabelText('Category')
  fireEvent.focus(box)
  return { box, onPick }
}

describe('Picker tapping', () => {
  it('picks exactly once on mousedown+click and closes', () => {
    const { onPick } = setup()
    const row = screen.getByText('Rent')
    // mousedown is default-prevented so the input keeps focus and the list stays until the click
    expect(fireEvent.mouseDown(row)).toBe(false)
    expect(screen.getByText('Rent')).toBeTruthy()
    fireEvent.click(row)
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(items[1])
    expect(screen.queryByText('Rent')).toBeNull()
  })

  it('does not pick on mousedown alone', () => {
    const { onPick } = setup()
    fireEvent.mouseDown(screen.getByText('Rent'))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('closes immediately on blur', () => {
    const { box } = setup()
    expect(screen.getByText('Rent')).toBeTruthy()
    fireEvent.blur(box)
    expect(screen.queryByText('Rent')).toBeNull()
  })

  it('closes on Escape', () => {
    const { box } = setup()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByText('Rent')).toBeNull()
  })
})
