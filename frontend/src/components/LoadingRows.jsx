// Placeholder rows in the shape of what is coming, and no word.
export default function LoadingRows({ rows = 4 }) {
  return (
    <div aria-busy="true" aria-label="Loading" role="status" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-lg bg-raised md:h-11 max-md:h-14" />
      ))}
    </div>
  )
}
