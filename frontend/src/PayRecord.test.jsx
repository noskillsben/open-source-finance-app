import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PayRecord from './PayRecord.jsx'

vi.mock('./api.js', () => {
  const list = () => Promise.resolve([])
  return {
    api: {
      incomeStreams: { list },
      categories: { list },
      accounts: { list },
      goals: { list },
      transactions: { list },
      readyToAssign: () => Promise.resolve({ ready_to_assign_cents: 0, overspent_cents: 0, categories: [] }),
    },
  }
})

function renderOneOff() {
  return render(
    <MemoryRouter initialEntries={['/pay/one-off']}>
      <Routes>
        <Route path="/pay/one-off" element={<PayRecord pickerDate="2026-09-23" />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('PayRecord with no named pay behind it', () => {
  it('opens with no named pay, hides the four goal blocks, and pre-fills nothing', async () => {
    renderOneOff()

    expect(await screen.findByRole('heading', { level: 2, name: 'One-off income' })).toBeInTheDocument()

    // Blocks 4, 6, 7, 8: nothing binds to a one-off, so none of them render.
    expect(screen.queryByText('Retain income')).not.toBeInTheDocument()
    expect(screen.queryByText('Bills')).not.toBeInTheDocument()
    expect(screen.queryByText('Funding rules')).not.toBeInTheDocument()
    expect(screen.queryByText('Goal set-asides')).not.toBeInTheDocument()

    // Gross, destination account and income category all start empty.
    expect(screen.getByLabelText(/Gross/)).toHaveValue('')
    expect(screen.getByLabelText('Income category')).toHaveValue('')
    expect(screen.getByLabelText('Destination account')).toHaveValue('')
  })
})
