import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { typeAmount } from './testAmounts.js'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuickAdd from './QuickAdd.jsx'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  fill: vi.fn(),
  readyToAssign: vi.fn(),
  recent: vi.fn(),
  goals: vi.fn(),
}))

vi.mock('./api.js', () => ({
  api: {
    payees: {
      list: () =>
        Promise.resolve([
          { id: 1, name: 'Hydro' }, { id: 2, name: 'Loblaws' }, { id: 3, name: 'Cafe' },
          { id: 4, name: 'Costco' }, { id: 5, name: 'Esso' }, { id: 6, name: 'Gym' }, { id: 7, name: 'Zed' },
        ]),
      recent: mocks.recent,
      fill: mocks.fill,
      create: vi.fn(),
    },
    accounts: { list: () => Promise.resolve([{ id: 10, name: 'Chequing' }, { id: 11, name: 'Visa' }]) },
    categories: { list: () => Promise.resolve([{ id: 20, name: 'Groceries' }, { id: 21, name: 'Utilities' }]) },
    goals: { list: mocks.goals },
    splits: { list: () => Promise.resolve([{ id: 30, name: 'Household' }]) },
    transactions: { create: mocks.create },
    readyToAssign: mocks.readyToAssign,
  },
}))

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname}</p>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/transactions', '/quick-add']} initialIndex={1}>
      <Where />
      <Routes>
        <Route path="/quick-add" element={<QuickAdd pickerDate="2026-10-13" />} />
        <Route path="/transactions" element={<p>Transactions page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

const chip = (name) => screen.findByRole('button', { name })

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.recent.mockResolvedValue([
    { id: 2, name: 'Loblaws' }, { id: 1, name: 'Hydro' }, { id: 3, name: 'Cafe' },
    { id: 4, name: 'Costco' }, { id: 5, name: 'Esso' }, { id: 6, name: 'Gym' },
  ])
  mocks.fill.mockResolvedValue({ category_id: 20, account_id: 10, split_id: null })
  mocks.goals.mockResolvedValue([])
  mocks.create.mockResolvedValue({ id: 99, notes: [] })
  mocks.readyToAssign.mockResolvedValue({ categories: [{ category_id: 20, available_cents: 5000 }] })
})

describe('Quick add', () => {
  it('1: shows chips for the six most recent payees and a search box', async () => {
    renderPage()
    const group = await screen.findByRole('group', { name: 'Recent payees' })
    expect(group.querySelectorAll('button')).toHaveLength(6)
    expect(screen.getByPlaceholderText('Search payees…')).toBeInTheDocument()
    expect(mocks.recent).toHaveBeenCalledWith('2026-10-13')
  })

  it('2: starts on - Spent with a text amount field, never type=number', async () => {
    renderPage()
    await chip('Loblaws')
    expect(screen.getByRole('button', { name: '− Spent' })).toHaveAttribute('aria-pressed', 'true')
    const amount = screen.getByLabelText('Amount')
    expect(amount).toHaveAttribute('type', 'text')
    expect(amount).toHaveAttribute('inputmode', 'decimal')
  })

  it('3: fills category and account from the last payment and says where they came from', async () => {
    renderPage()
    fireEvent.click(await chip('Loblaws'))
    expect(await screen.findByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('Chequing')).toBeInTheDocument()
    expect(screen.getByText(/come from your last payment to Loblaws; the date is Show as of/)).toBeInTheDocument()
    expect(screen.getByText('Oct 13, 2026')).toBeInTheDocument()
    expect(mocks.fill).toHaveBeenCalledWith(2, '2026-10-13')
    // each is one tap to change
    fireEvent.click(screen.getByRole('button', { name: 'Change account' }))
    expect(screen.getByLabelText('Account')).toBeInTheDocument()
  })

  it('4: saves through the one transaction write, then offers Add another and Done', async () => {
    renderPage()
    fireEvent.click(await chip('Loblaws'))
    await screen.findByText('Groceries')
    typeAmount(screen.getByLabelText('Amount'), '-12.50')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Recorded Loblaws, −\$12\.50\./)).toBeInTheDocument()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      date: '2026-10-13',
      payee_id: 2,
      goal_id: null,
      account_lines: [{ account_id: 10, cents: -1250 }],
      category_lines: [{ category_id: 20, cents: -1250 }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add another' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByLabelText('Amount')).toHaveValue('')
    expect(screen.getByRole('button', { name: '− Spent' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('5: Done goes back to the previous page', async () => {
    renderPage()
    fireEvent.click(await chip('Loblaws'))
    await screen.findByText('Groceries')
    typeAmount(screen.getByLabelText('Amount'), '-5')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Transactions page')).toBeInTheDocument()
  })

  it('an overspent category saves with a warning note', async () => {
    mocks.readyToAssign.mockResolvedValue({ categories: [{ category_id: 20, available_cents: -700 }] })
    renderPage()
    fireEvent.click(await chip('Loblaws'))
    await screen.findByText('Groceries')
    typeAmount(screen.getByLabelText('Amount'), '-12.50')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Groceries is now overspent by \$7\.00/)).toBeInTheDocument()
    expect(screen.getByText(/Recorded Loblaws/)).toBeInTheDocument()
  })

  it('a live recurring bill asks, and links only on Yes', async () => {
    mocks.fill.mockResolvedValue({ category_id: 21, account_id: 10, split_id: null })
    mocks.goals.mockResolvedValue([
      {
        goal: { id: 40, kind: 'recurring_bill', category_id: 21, name: 'Hydro' },
        earliest_unpaid_due_on: '2026-10-01',
        earliest_unpaid_due_text: 'Oct 1',
      },
    ])
    renderPage()
    fireEvent.click(await chip('Hydro'))
    await screen.findByText('Utilities')
    typeAmount(screen.getByLabelText('Amount'), '-80')
    expect(await screen.findByText(/This pays/)).toHaveTextContent('This pays Hydro, due Oct 1?')

    // unanswered is not linked
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(/Recorded/)
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ goal_id: null, goal_due_on: null })

    fireEvent.click(screen.getByRole('button', { name: 'Add another' }))
    fireEvent.click(await chip('Hydro'))
    await screen.findByText('Utilities')
    typeAmount(screen.getByLabelText('Amount'), '-80')
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ goal_id: 40, goal_due_on: '2026-10-01' })
  })

  it('a split from the last payment shows one line and opens the full form', async () => {
    mocks.fill.mockResolvedValue({ category_id: 20, account_id: 10, split_id: 30 })
    renderPage()
    fireEvent.click(await chip('Loblaws'))
    expect(await screen.findByText(/was a shared bill \(Household\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the full form' }))
    expect(await screen.findByText('Transactions page')).toBeInTheDocument()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('More details opens the full form with everything typed', async () => {
    let seen
    function Catch() {
      seen = useLocation().state
      return <p>Transactions page</p>
    }
    render(
      <MemoryRouter initialEntries={['/quick-add']}>
        <Routes>
          <Route path="/quick-add" element={<QuickAdd pickerDate="2026-10-13" />} />
          <Route path="/transactions" element={<Catch />} />
        </Routes>
      </MemoryRouter>
    )
    fireEvent.click(await chip('Loblaws'))
    await screen.findByText('Groceries')
    typeAmount(screen.getByLabelText('Amount'), '-12.50')
    fireEvent.click(screen.getByRole('button', { name: 'More details' }))
    await screen.findByText('Transactions page')
    expect(seen.quickAdd).toMatchObject({
      date: '2026-10-13', payee_id: 2, account_id: 10, category_id: 20, amount_text: '-12.50', goal: null,
    })
  })

  it('a typed memo is sent on save, a blank one sends null, and Add another clears it', async () => {
    renderPage()
    fireEvent.click(await chip('Loblaws'))
    await screen.findByText('Groceries')
    typeAmount(screen.getByLabelText('Amount'), '-12.50')
    fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '  weekly shop ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(/Recorded Loblaws/)
    expect(mocks.create.mock.calls[0][0].memo).toBe('weekly shop')
    fireEvent.click(screen.getByRole('button', { name: 'Add another' }))
    expect(screen.getByLabelText('Memo')).toHaveValue('')
    fireEvent.click(await chip('Loblaws'))
    await screen.findByText('Groceries')
    typeAmount(screen.getByLabelText('Amount'), '-3')
    fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(/Recorded Loblaws/)
    expect(mocks.create.mock.calls[1][0].memo).toBeNull()
  })

  it('More details carries the memo', async () => {
    let seen
    function Catch() {
      seen = useLocation().state
      return <p>Transactions page</p>
    }
    render(
      <MemoryRouter initialEntries={['/quick-add']}>
        <Routes>
          <Route path="/quick-add" element={<QuickAdd pickerDate="2026-10-13" />} />
          <Route path="/transactions" element={<Catch />} />
        </Routes>
      </MemoryRouter>
    )
    fireEvent.click(await chip('Loblaws'))
    await screen.findByText('Groceries')
    fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'birthday' } })
    fireEvent.click(screen.getByRole('button', { name: 'More details' }))
    await screen.findByText('Transactions page')
    expect(seen.quickAdd.memo).toBe('birthday')
  })

  it('a refused save shows the backend reason and keeps what was typed', async () => {
    mocks.create.mockRejectedValue(new Error('Lines do not add up.'))
    renderPage()
    fireEvent.click(await chip('Loblaws'))
    await screen.findByText('Groceries')
    typeAmount(screen.getByLabelText('Amount'), '-12.50')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Lines do not add up.')).toBeInTheDocument()
    expect(screen.getByLabelText('Amount')).toHaveValue('12.50')
    expect(screen.getByRole('button', { name: '− Spent' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('second click: the save succeeded but the follow-up check failed, so it never saves twice', async () => {
    mocks.readyToAssign.mockRejectedValue(new Error('network down'))
    renderPage()
    fireEvent.click(await chip('Loblaws'))
    await screen.findByText('Groceries')
    typeAmount(screen.getByLabelText('Amount'), '-12.50')
    const save = screen.getByRole('button', { name: 'Save' })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(await screen.findByText(/the overspent check did not run: network down/)).toBeInTheDocument()
    expect(screen.getByText(/Recorded Loblaws/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Add another' })).toBeInTheDocument()
  })
})
