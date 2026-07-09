// ---------------------------------------------------------------------------
// Week math. A "week" is identified by the date of its Monday, formatted
// 'YYYY-MM-DD'. Sliding an opportunity is just adding/subtracting 7 days.
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Format a Date as a local 'YYYY-MM-DD' key (no timezone drift). */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse a 'YYYY-MM-DD' key into a local Date at midnight. */
export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** The Monday on or before the given date. */
export function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = out.getDay() // 0 Sun .. 6 Sat
  const delta = dow === 0 ? -6 : 1 - dow
  out.setDate(out.getDate() + delta)
  return out
}

/** Week key for the Monday of the week containing `d` (defaults to today). */
export function weekKeyOf(d: Date = new Date()): string {
  return dateKey(mondayOf(d))
}

/** Add n weeks to a week key, returning a new week key. */
export function addWeeks(key: string, n: number): string {
  const d = parseKey(key)
  d.setDate(d.getDate() + n * 7)
  return dateKey(d)
}

/** Whole weeks between two week keys (b - a). */
export function weeksBetween(a: string, b: string): number {
  const ms = parseKey(b).getTime() - parseKey(a).getTime()
  return Math.round(ms / (7 * 24 * 3600 * 1000))
}

/** Inclusive list of week keys from start spanning `count` weeks. */
export function weekRange(startKey: string, count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(addWeeks(startKey, i))
  return out
}

/** Week keys from the current week through the last week of the current year. */
export function weeksToYearEnd(from: Date = new Date()): string[] {
  const start = weekKeyOf(from)
  const endMonday = weekKeyOf(new Date(from.getFullYear(), 11, 31))
  const count = Math.max(1, weeksBetween(start, endMonday) + 1)
  return weekRange(start, count)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Short label like 'Jul 6'. */
export function weekLabel(key: string): string {
  const d = parseKey(key)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** ISO-8601 week number, e.g. 28 -> 'W28'. */
export function isoWeekNum(key: string): string {
  const d = parseKey(key)
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayNr = (d.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getDay() + 6) % 7)) /
        7,
    )
  return `W${week}`
}
