import { fireEvent, screen } from '@testing-library/react'

// The signed amount box holds digits only; the − Spent / + Received toggle beside it sets the sign.
// These helpers let a test speak in signed text ("-12.50") the way the form's value does.
function toggle(input, name) {
  const group = input.parentElement?.querySelector('[role="group"]')
  return group ? [...group.querySelectorAll('button')].find((b) => b.textContent.includes(name)) : null
}

export function readAmount(input) {
  return `${toggle(input, 'Spent')?.getAttribute('aria-pressed') === 'true' ? '-' : ''}${input.value}`
}

export function typeAmount(input, text) {
  const spent = toggle(input, 'Spent')
  const negative = /^[-−]/.test(text)
  if (spent && negative && spent.getAttribute('aria-pressed') !== 'true') fireEvent.click(spent)
  if (spent && !negative && text !== '' && toggle(input, 'Received').getAttribute('aria-pressed') !== 'true') {
    fireEvent.click(toggle(input, 'Received'))
  }
  fireEvent.change(input, { target: { value: spent ? text.replace(/^[-−]/, '') : text } })
}

export const amountBoxes = () => screen.getAllByPlaceholderText('0.00')
