import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PayRecord from './PayRecord.jsx'

// Transactions the mocked backend already holds; a test sets it before rendering.
let existingTransactions = []

vi.mock('./api.js', () => {
  const list = () => Promise.resolve([])
  return {
    api: {
      incomeStreams: { list },
      categories: { list },
      accounts: { list },
      goals: { list },
      transactions: { list: () => Promise.resolve(existingTransactions) },
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
  beforeEach(() => {
    existingTransactions = []
  })

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

  it('never offers the duplicate guard, Set actual or Delete this pay, even on a date already recorded', async () => {
    // A one-off recorded earlier on the same date: unlinked, same shape the screen writes.
    existingTransactions = [
      {
        id: 7, date: '2026-09-23', income_stream_id: null,
        account_lines: [{ account_id: 1, cents: 50000 }],
        category_lines: [{ category_id: 1, cents: 50000 }],
      },
    ]

    // Opening the screen twice on the same date is a fresh one-shot form both times.
    for (let visit = 0; visit < 2; visit++) {
      const { unmount } = renderOneOff()
      expect(await screen.findByRole('heading', { level: 2, name: 'One-off income' })).toBeInTheDocument()

      expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument()
      expect(screen.queryByText(/already recorded/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/set actual/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/delete this pay/i)).not.toBeInTheDocument()
      expect(screen.queryByText('recorded')).not.toBeInTheDocument()
      unmount()
    }
  })
})
