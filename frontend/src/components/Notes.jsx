// The three notes (DESIGN.md § Visual design → Components). A save note is raised with a positive
// tick; a warning note says what is true and offers the fix; a refusal is only for a record that
// doesn't add up. Every one says it in words, so colour is never the only cue.
export function SaveNote({ children, ...rest }) {
  return (
    <p className="note" role="status" {...rest}>
      <span aria-hidden="true" className="mr-2 text-positive">✓</span>
      {children}
    </p>
  )
}

export function WarningNote({ children, ...rest }) {
  return (
    <p className="note note-warning" {...rest}>
      {children}
    </p>
  )
}

export function RefusalNote({ children, ...rest }) {
  return (
    <p className="note note-refusal" role="alert" {...rest}>
      {children}
    </p>
  )
}
