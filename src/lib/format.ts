/** Compact currency: $2.4M, $960K, $40K, $1.2B. */
export function fmtMoney(n: number): string {
  const s = n < 0 ? '-' : ''
  const a = Math.abs(n)
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}K`
  return `${s}$${Math.round(a)}`
}

/** Full currency with separators: $2,400,000. */
export function fmtMoneyFull(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function fmtPct(x: number): string {
  return `${Math.round(x * 100)}%`
}
