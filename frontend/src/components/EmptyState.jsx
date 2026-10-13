// What is missing and the one action that fills it.
export default function EmptyState({ children, action }) {
  return (
    <div className="flex flex-col items-start gap-3 py-6">
      <p className="text-text-2">{children}</p>
      {action}
    </div>
  )
}
