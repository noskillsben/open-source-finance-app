// Shares `total` cents out across `weights` in proportion, each rounded toward zero, the leftover cents
// going to the largest weight (the first, on a tie), so the shares add up to `total` exactly. One rule
// for both "follow the money" pre-fills (DESIGN.md § Accounts → Linked categories, point 2).
export function shareOut(total, weights) {
  const sum = weights.reduce((a, w) => a + w, 0)
  if (weights.length === 0 || sum <= 0 || total === 0) return weights.map(() => 0)
  const shares = weights.map((w) => Math.trunc((total * w) / sum))
  const largest = weights.indexOf(Math.max(...weights))
  shares[largest] += total - shares.reduce((a, s) => a + s, 0)
  return shares
}
