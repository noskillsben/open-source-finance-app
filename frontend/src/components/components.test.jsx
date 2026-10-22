import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
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

describe('MoneyInput digits-only box', () => {
  function Harness({ start }) {
    const [v, setV] = useState(start)
    return <><MoneyInput signed label="Amount" value={v} onChange={setV} /><output data-testid="out">{v}</output></>
  }

  it('never shows a sign with Spent selected', () => {
    render(<Harness start="-12.50" />)
    expect(screen.getByLabelText('Amount')).toHaveValue('12.50')
    expect(screen.getByRole('button', { name: '− Spent' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows an empty box for Spent with nothing typed yet', () => {
    render(<Harness start="-" />)
    expect(screen.getByLabelText('Amount')).toHaveValue('')
  })

  it('strips typed or pasted signs and leaves the toggle alone', () => {
    render(<Harness start="-5" />)
    const box = screen.getByLabelText('Amount')
    fireEvent.change(box, { target: { value: '-5-' } })
    expect(box).toHaveValue('5')
    fireEvent.change(box, { target: { value: '20-' } })
    expect(box).toHaveValue('20')
    expect(screen.getByTestId('out')).toHaveTextContent('-20')
    expect(screen.getByRole('button', { name: '− Spent' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a minus typed while Received stays Received', () => {
    render(<Harness start="5" />)
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '−50' } })
    expect(screen.getByTestId('out').textContent).toBe('50')
    expect(screen.getByRole('button', { name: '+ Received' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggling keeps the digits', () => {
    render(<Harness start="12.50" />)
    fireEvent.click(screen.getByRole('button', { name: '− Spent' }))
    expect(screen.getByLabelText('Amount')).toHaveValue('12.50')
    expect(screen.getByTestId('out').textContent).toBe('-12.50')
    fireEvent.click(screen.getByRole('button', { name: '+ Received' }))
    expect(screen.getByTestId('out').textContent).toBe('12.50')
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

  it('collapses stray signs to one leading minus', () => {
    for (const t of ['20-', '--20', '-+20', '−20']) expect(parseCents(t)).toBe(-2000)
    expect(parseCents('+20')).toBe(2000)
    expect(parseCents('abc')).toBeNull()
    expect(parseCents('-')).toBeNull()
    expect(parseCents('1.2.3')).toBeNull()
  })
})
