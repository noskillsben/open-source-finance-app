// Status words and the pool pill. `tone` colours the word: positive for recorded or paid,
// warning for due or overdue. Never an amount.
export default function Pill({ tone, children }) {
  const toneClass = tone === 'positive' ? 'pill-positive' : tone === 'warning' ? 'pill-warning' : ''
  return <span className={`pill ${toneClass}`.trim()}>{children}</span>
}
