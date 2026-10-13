import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BottomBar } from '../Nav.jsx'
import { formatCents, parseCents } from '../utils/format.js'
import MoneyInput from './MoneyInput.jsx'
import SidePanel, { FormOpenProvider } from './SidePanel.jsx'

describe('MoneyInput', () => {
  it('is a text field with the decimal keypad, never type=number', () => {
    render(<MoneyInput label="Amount" value="" onChange={() => {}} />)
    const field = screen.getByLabelText('Amount')
    expect(field).toHaveAttribute('type', 'text')
    expect(field).toHaveAttribute('inputmode', 'decimal')
  })

  it('sets the sign from the - Spent / + Received toggle, not from typing', () => {
    const onChange = vi.fn()
    render(<MoneyInput signed value="12.50" onChange={onChange} />)
    expect(screen.getByRole('button', { name: '+ Received' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '− Spent' }))
    expect(onChange).toHaveBeenCalledWith('-12.50')
  })

  it('flips back to received by dropping the minus', () => {
    const onChange = vi.fn()
    render(<MoneyInput signed value="-12.50" onChange={onChange} />)
    expect(screen.getByRole('button', { name: '− Spent' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '+ Received' }))
    expect(onChange).toHaveBeenCalledWith('12.50')
  })
})

describe('SidePanel', () => {
  it('closes on Escape and on the close button', () => {
    const onClose = vi.fn()
    render(<SidePanel title="Edit · Rent" onClose={onClose}><input aria-label="Name" /></SidePanel>)
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('puts focus in the first field when it opens', () => {
    render(<SidePanel title="Add" onClose={() => {}}><input aria-label="Name" /></SidePanel>)
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })
})

describe('bottom bar', () => {
  function bar(panelOpen) {
    return render(
      <MemoryRouter>
        <FormOpenProvider>
          <BottomBar onAdd={() => {}} />
          {panelOpen && <SidePanel title="Add" onClose={() => {}}><input aria-label="Name" /></SidePanel>}
        </FormOpenProvider>
      </MemoryRouter>,
    )
  }

  it('carries Categories, Transactions, +, Due dates and More', () => {
    bar(false)
    const nav = screen.getByRole('navigation', { name: 'Bottom bar' })
    for (const name of ['Categories', 'Transactions', 'Due dates', 'More']) {
      expect(nav).toHaveTextContent(name)
    }
    expect(screen.getByRole('button', { name: 'Quick add' })).toBeInTheDocument()
    expect(nav.querySelectorAll('svg')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('navigation', { name: 'More' })).toBeInTheDocument()
  })

  it('is hidden while a form is open', () => {
    bar(true)
    expect(screen.queryByRole('navigation', { name: 'Bottom bar' })).toBeNull()
  })
})

describe('money formatting', () => {
  it('prints a true minus and parses it back', () => {
    expect(formatCents(-52500)).toBe('−$525.00')
    expect(parseCents('−$525.00')).toBe(-52500)
  })
})
