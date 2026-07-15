import type { CustomerType, ForecastState, Group, Opportunity, Person, WorkType } from '../types'
import { WORK_TYPES } from '../types'
import { effectiveProbability } from './funnel'
import { addWeeks, parseKey, weekKeyOf, weeksBetween, weekRange } from './weeks'

/** How a project's team-time is classified (default: billable). */
export const oppWorkType = (o: Opportunity): WorkType => o.workType ?? 'billable'
/** New vs existing customer (default: existing). */
export const oppCustomerType = (o: Opportunity): CustomerType => o.customerType ?? 'existing'

/** The Monday-of-week an opportunity starts on. In-app data is always
 *  Monday-keyed, but imported / hand-edited JSON might carry a mid-week date;
 *  snapping here keeps every offset on the week grid so its FTE lands in the
 *  right week instead of silently vanishing (idx lookups would miss it). */
export function oppStartMonday(o: Opportunity): string {
  return weekKeyOf(parseKey(o.startWeek))
}

/** FTE-weighting probability. Signed deals and internal projects are certain
 *  work → 100%; forecast deals weight by their funnel close percentage. */
export function oppProbability(state: ForecastState, o: Opportunity): number {
  return o.type === 'internal' || o.booking === 'signed'
    ? 1
    : effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
}

/** True when the opportunity is contractually committed work (a signed deal or
 *  an internal project) rather than an unclosed forecast. */
export function oppIsBooked(o: Opportunity): boolean {
  return o.type === 'internal' || o.booking === 'signed'
}

/** Absolute end week key (exclusive-style: start + duration). */
export function opportunityEndWeek(o: Opportunity): string {
  return addWeeks(oppStartMonday(o), Math.max(1, o.durationWeeks))
}

/** The union planning horizon across all opportunities, floored at the
 *  current week and always at least `minWeeks` wide. */
export function horizon(
  opportunities: Opportunity[],
  minWeeks = 16,
): { start: string; weeks: string[] } {
  const today = weekKeyOf()
  let start = today
  let end = addWeeks(today, minWeeks)
  for (const o of opportunities) {
    const oStart = oppStartMonday(o)
    if (weeksBetween(start, oStart) < 0) start = oStart
    const oEnd = opportunityEndWeek(o)
    if (weeksBetween(end, oEnd) > 0) end = oEnd
  }
  const count = Math.max(minWeeks, weeksBetween(start, end))
  return { start, weeks: weekRange(start, count) }
}

export interface WeekDemand {
  week: string
  // full staffing if every opportunity lands (all at 100%)
  committedEnergy: number
  committedDelivery: number
  // probability-weighted forecast (signed & internal at 100%, forecast at close %)
  weightedEnergy: number
  weightedDelivery: number
  // only contractually booked work (signed deals + internal projects)
  signedEnergy: number
  signedDelivery: number
}

export function demandByWeek(state: ForecastState, weeks: string[]): WeekDemand[] {
  const idx = new Map(weeks.map((w, i) => [w, i]))
  const rows: WeekDemand[] = weeks.map((w) => ({
    week: w,
    committedEnergy: 0,
    committedDelivery: 0,
    weightedEnergy: 0,
    weightedDelivery: 0,
    signedEnergy: 0,
    signedDelivery: 0,
  }))
  for (const o of state.opportunities) {
    const prob = oppProbability(state, o)
    const booked = oppIsBooked(o)
    const base = oppStartMonday(o)
    for (const a of o.assignments) {
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = a.fte[String(off)] || 0
        if (!fte) continue
        const week = addWeeks(base, off)
        const i = idx.get(week)
        if (i == null) continue
        const row = rows[i]
        if (a.group === 'energy') {
          row.committedEnergy += fte
          row.weightedEnergy += fte * prob
          if (booked) row.signedEnergy += fte
        } else {
          row.committedDelivery += fte
          row.weightedDelivery += fte * prob
          if (booked) row.signedDelivery += fte
        }
      }
    }
  }
  return rows
}

export const committedTotal = (d: WeekDemand) => d.committedEnergy + d.committedDelivery
export const weightedTotal = (d: WeekDemand) => d.weightedEnergy + d.weightedDelivery
export const signedTotal = (d: WeekDemand) => d.signedEnergy + d.signedDelivery

// ---------------------------------------------------------------------------
// Stacked demand: a signed/committed floor (100% certain) plus forecast FTE
// grouped by close %, so a bar can be drawn green-at-the-bottom with forecast
// stacked on top, fading as likelihood drops.
// ---------------------------------------------------------------------------
export interface ForecastSeg {
  prob: number // close % (0..1) of this slice
  fte: number // full (unweighted) FTE at that likelihood
}
export interface WeekStack {
  week: string
  signed: number // FTE booked (signed deals + internal) — certain
  forecast: ForecastSeg[] // forecast FTE grouped by close %, most-likely first
  total: number // signed + all forecast FTE (full height of the bar)
}

export function demandStackByWeek(state: ForecastState, weeks: string[]): WeekStack[] {
  const idx = new Map(weeks.map((w, i) => [w, i]))
  const signed = new Array(weeks.length).fill(0)
  const forecast: Map<number, number>[] = weeks.map(() => new Map())
  for (const o of state.opportunities) {
    const booked = oppIsBooked(o)
    const prob = oppProbability(state, o) // booked → 1
    const base = oppStartMonday(o)
    for (const a of o.assignments) {
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = a.fte[String(off)] || 0
        if (!fte) continue
        const i = idx.get(addWeeks(base, off))
        if (i == null) continue
        if (booked) signed[i] += fte
        else forecast[i].set(prob, (forecast[i].get(prob) || 0) + fte)
      }
    }
  }
  return weeks.map((w, i) => {
    const segs = [...forecast[i].entries()]
      .map(([prob, fte]) => ({ prob, fte }))
      .sort((a, b) => b.prob - a.prob) // most likely nearest the signed floor
    return { week: w, signed: signed[i], forecast: segs, total: signed[i] + segs.reduce((s, f) => s + f.fte, 0) }
  })
}

export interface PersonLoad {
  person: Person
  byWeek: Record<string, { committed: number; weighted: number }>
  peakCommitted: number
  overWeeks: string[] // weeks where committed > capacity
}

/** Per-named-person weekly load, with over-allocation weeks flagged. */
export function personLoads(state: ForecastState, weeks: string[]): PersonLoad[] {
  const weekSet = new Set(weeks)
  const byId = new Map<string, PersonLoad>()
  const getLoad = (p: Person): PersonLoad => {
    let l = byId.get(p.id)
    if (!l) {
      l = { person: p, byWeek: {}, peakCommitted: 0, overWeeks: [] }
      byId.set(p.id, l)
    }
    return l
  }
  for (const o of state.opportunities) {
    const prob = oppProbability(state, o)
    for (const a of o.assignments) {
      if (!a.personId) continue
      const person = state.roster.find((p) => p.id === a.personId)
      if (!person) continue
      const load = getLoad(person)
      const base = oppStartMonday(o)
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = a.fte[String(off)] || 0
        if (!fte) continue
        const week = addWeeks(base, off)
        if (!weekSet.has(week)) continue
        const cell = (load.byWeek[week] ||= { committed: 0, weighted: 0 })
        cell.committed += fte
        cell.weighted += fte * prob
      }
    }
  }
  for (const load of byId.values()) {
    for (const [week, cell] of Object.entries(load.byWeek)) {
      if (cell.committed > load.peakCommitted) load.peakCommitted = cell.committed
      // Over-allocated = EXPECTED (weighted) load exceeds capacity, consistent
      // with forward utilization. Raw committed stays available per cell.
      if (cell.weighted > load.person.capacity + 1e-9) load.overWeeks.push(week)
    }
    load.overWeeks.sort()
  }
  return [...byId.values()].sort((a, b) => b.peakCommitted - a.peakCommitted)
}

/** Weighted + committed FTE-weeks summed by role, ranked. */
export function rolesImpacted(
  state: ForecastState,
): { role: string; group: string; committed: number; weighted: number }[] {
  const map = new Map<string, { role: string; group: string; committed: number; weighted: number }>()
  for (const o of state.opportunities) {
    const prob = oppProbability(state, o)
    for (const a of o.assignments) {
      const key = `${a.group}:${a.role}`
      const rec = map.get(key) || { role: a.role, group: a.group, committed: 0, weighted: 0 }
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = a.fte[String(off)] || 0
        rec.committed += fte
        rec.weighted += fte * prob
      }
      map.set(key, rec)
    }
  }
  return [...map.values()].sort((a, b) => b.weighted - a.weighted)
}

export interface UnstaffedRole {
  oppId: string
  oppName: string
  role: string
  group: Group
  fteWeeks: number // planned FTE-weeks with no named person yet
}

/** Role lines that carry planned FTE but have no named person assigned —
 *  demand you still need to staff. */
export function unstaffedRoles(state: ForecastState): UnstaffedRole[] {
  const out: UnstaffedRole[] = []
  for (const o of state.opportunities) {
    for (const a of o.assignments) {
      if (a.personId) continue
      let fteWeeks = 0
      for (let off = 0; off < o.durationWeeks; off++) fteWeeks += a.fte[String(off)] || 0
      if (fteWeeks > 0) out.push({ oppId: o.id, oppName: o.name, role: a.role, group: a.group, fteWeeks })
    }
  }
  return out.sort((a, b) => b.fteWeeks - a.fteWeeks)
}

// ---------------------------------------------------------------------------
// Demand vs capacity, by role — "can we deliver the pipeline?" For each role
// it compares weekly DEMAND (FTE the pipeline needs, expected or planned)
// against the roster CAPACITY for that role, and flags the shortfall weeks.
// A role with demand but nobody in the roster (capacity 0) is all shortfall.
// ---------------------------------------------------------------------------
export interface RoleCapacityCell {
  demand: number // FTE needed this week (× close % in 'expected' mode)
  capacity: number // roster capacity for the role (constant across weeks)
  short: number // max(0, demand − capacity)
}
export interface RoleCapacityRow {
  role: string
  group: Group
  capacity: number // total roster capacity for the role
  people: number // roster headcount with the role
  weekly: RoleCapacityCell[]
  peakDemand: number // within the stats window
  peakShort: number // biggest FTE shortfall within the window
  shortWeeks: number // weeks demand > capacity within the window
}

export function roleDemandVsCapacity(
  state: ForecastState,
  weeks: string[],
  mode: 'expected' | 'planned' = 'expected',
  statsWeeks?: number,
): RoleCapacityRow[] {
  const idx = new Map(weeks.map((w, i) => [w, i]))
  // capacity + headcount per role (keyed by group:role)
  const cap = new Map<string, { role: string; group: Group; capacity: number; people: number }>()
  for (const p of state.roster) {
    const key = `${p.group}:${p.role}`
    const rec = cap.get(key) || { role: p.role, group: p.group, capacity: 0, people: 0 }
    rec.capacity += p.capacity || 0
    rec.people += 1
    cap.set(key, rec)
  }
  // weekly demand per role
  const demand = new Map<string, number[]>()
  const ensure = (key: string, role: string, group: Group) => {
    let a = demand.get(key)
    if (!a) {
      a = new Array(weeks.length).fill(0)
      demand.set(key, a)
      if (!cap.has(key)) cap.set(key, { role, group, capacity: 0, people: 0 }) // demand for a role we have nobody for
    }
    return a
  }
  for (const o of state.opportunities) {
    const prob = mode === 'planned' ? 1 : oppProbability(state, o)
    const base = oppStartMonday(o)
    for (const a of o.assignments) {
      const key = `${a.group}:${a.role}`
      const arr = ensure(key, a.role, a.group)
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = a.fte[String(off)] || 0
        if (!fte) continue
        const i = idx.get(addWeeks(base, off))
        if (i == null) continue
        arr[i] += fte * prob
      }
    }
  }
  const win = statsWeeks ?? activeHorizonWeeks(state, weeks)
  const rows: RoleCapacityRow[] = [...cap.entries()].map(([key, c]) => {
    const d = demand.get(key) ?? new Array(weeks.length).fill(0)
    const weekly: RoleCapacityCell[] = d.map((dem) => ({ demand: dem, capacity: c.capacity, short: Math.max(0, dem - c.capacity) }))
    const stats = weekly.slice(0, Math.max(1, Math.min(win, weekly.length)))
    return {
      role: c.role,
      group: c.group,
      capacity: c.capacity,
      people: c.people,
      weekly,
      peakDemand: stats.reduce((m, x) => Math.max(m, x.demand), 0),
      peakShort: stats.reduce((m, x) => Math.max(m, x.short), 0),
      shortWeeks: stats.filter((x) => x.short > 1e-9).length,
    }
  })
  // Biggest gaps first (peak shortfall), energy grouped ahead of delivery.
  return rows.sort((a, b) => {
    if (a.group !== b.group) return a.group === 'energy' ? -1 : 1
    if (b.peakShort !== a.peakShort) return b.peakShort - a.peakShort
    return b.peakDemand - a.peakDemand
  })
}

export function funnelCounts(state: ForecastState): { stageId: string; count: number }[] {
  return state.stages.map((s) => ({
    stageId: s.id,
    count: state.opportunities.filter((o) => o.type !== 'internal' && o.stageId === s.id).length,
  }))
}

/** Grand totals across the horizon (FTE-weeks). */
export function totals(demand: WeekDemand[]) {
  let committed = 0
  let weighted = 0
  for (const d of demand) {
    committed += committedTotal(d)
    weighted += weightedTotal(d)
  }
  return { committed, weighted }
}

// ---------------------------------------------------------------------------
// Revenue — the value energy people pull through. Forecast deals contribute
// weighted pipeline ($ = deal value × close %); signed deals are actual booked
// revenue (100%). "Influence" per person/role = the deals they are staffed on.
// ---------------------------------------------------------------------------

export function oppWeightedRevenue(state: ForecastState, o: Opportunity): number {
  if (o.type === 'internal' || o.booking === 'signed') return 0
  const prob = effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
  return (o.dealValue || 0) * prob
}

export function oppBookedRevenue(o: Opportunity): number {
  return o.type !== 'internal' && o.booking === 'signed' ? o.dealValue || 0 : 0
}

export function revenueTotals(state: ForecastState) {
  let tcv = 0
  let weighted = 0
  let booked = 0
  let signedCount = 0
  let forecastCount = 0
  for (const o of state.opportunities) {
    if (o.type === 'internal') continue // internal projects are not sales revenue
    tcv += o.dealValue || 0
    if (o.booking === 'signed') {
      booked += o.dealValue || 0
      signedCount++
    } else {
      weighted += oppWeightedRevenue(state, o)
      forecastCount++
    }
  }
  return { tcv, weighted, booked, signedCount, forecastCount, blended: weighted + booked }
}

// ---------------------------------------------------------------------------
// Cost & margin (optional — hidden by default). Cost = staffing spend from the
// roster's per-person weekly cost rates. Expected (weighted) figures multiply
// BOTH revenue and cost by close % (you only staff/spend if you win); signed
// deals count fully. Internal projects are pure cost (no revenue), tracked
// separately as investment.
// ---------------------------------------------------------------------------

/** Full staffing cost of a deal if it lands = Σ named-assignment FTE-weeks ×
 *  that person's weekly cost rate. Role lines / people with no rate add 0. */
export function oppCost(o: Opportunity, roster: Person[]): number {
  let cost = 0
  for (const a of o.assignments) {
    if (!a.personId) continue
    const rate = roster.find((p) => p.id === a.personId)?.costRate
    if (!rate) continue
    let fteWeeks = 0
    for (let off = 0; off < o.durationWeeks; off++) fteWeeks += a.fte[String(off)] || 0
    cost += fteWeeks * rate
  }
  return cost
}

export interface MarginTotals {
  weightedRevenue: number
  weightedCost: number
  weightedMargin: number // expected revenue − expected cost
  bookedRevenue: number
  bookedCost: number
  bookedMargin: number
  blendedMarginPct: number // (weighted + booked margin) ÷ (weighted + booked revenue)
  internalCost: number // pure investment, no revenue
}

export function marginTotals(state: ForecastState): MarginTotals {
  let weightedRevenue = 0
  let weightedCost = 0
  let bookedRevenue = 0
  let bookedCost = 0
  let internalCost = 0
  for (const o of state.opportunities) {
    const cost = oppCost(o, state.roster)
    if (o.type === 'internal') {
      internalCost += cost
      continue
    }
    if (o.booking === 'signed') {
      bookedRevenue += o.dealValue || 0
      bookedCost += cost
    } else {
      const p = effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
      weightedRevenue += (o.dealValue || 0) * p
      weightedCost += cost * p
    }
  }
  const weightedMargin = weightedRevenue - weightedCost
  const bookedMargin = bookedRevenue - bookedCost
  const rev = weightedRevenue + bookedRevenue
  return {
    weightedRevenue,
    weightedCost,
    weightedMargin,
    bookedRevenue,
    bookedCost,
    bookedMargin,
    blendedMarginPct: rev ? (weightedMargin + bookedMargin) / rev : 0,
    internalCost,
  }
}

export interface RoleRevenue {
  role: string
  deals: number
  people: number
  weighted: number
  booked: number
}

/** Number of energy staffing lines on a deal. A deal's value is SPLIT equally
 *  across them — a $100k deal with 2 energy people is $100k for the group but
 *  $50k associated with each. Keeps role/person totals additive (no overlap). */
export function energyCount(o: Opportunity): number {
  return o.assignments.filter((a) => a.group === 'energy').length
}

/** Per energy-role-type: each deal's value split equally across its energy
 *  people, then summed by role (so two roles on a $100k deal get $50k each). */
export function revenueByEnergyRole(state: ForecastState): RoleRevenue[] {
  const map = new Map<string, { deals: Set<string>; people: Set<string>; weighted: number; booked: number }>()
  for (const o of state.opportunities) {
    if (o.type === 'internal') continue
    const energy = o.assignments.filter((a) => a.group === 'energy')
    const n = energy.length
    if (n === 0) continue
    const wShare = oppWeightedRevenue(state, o) / n
    const bShare = oppBookedRevenue(o) / n
    for (const a of energy) {
      const rec = map.get(a.role) || { deals: new Set(), people: new Set(), weighted: 0, booked: 0 }
      rec.deals.add(o.id)
      rec.weighted += wShare
      rec.booked += bShare
      if (a.personId) rec.people.add(a.personId)
      map.set(a.role, rec)
    }
  }
  return [...map.entries()]
    .map(([role, r]) => ({ role, deals: r.deals.size, people: r.people.size, weighted: r.weighted, booked: r.booked }))
    .sort((a, b) => b.weighted + b.booked - (a.weighted + a.booked))
}

export interface PersonUtilization {
  person: Person
  weekly: number[] // expected (probability-weighted) FTE aligned to `weeks`
  cap: number
  peak: number
  avg: number // over active weeks
  peakPct: number // peak EXPECTED utilization
  avgPct: number // average EXPECTED utilization over active weeks
  overWeeks: number // weeks expected-over capacity
  weighted: number // influenced weighted pipeline $
  booked: number // influenced booked $
  cost: number // this person's staffing cost (expected: signed full, forecast × close %)
  deals: number
}

/** Per energy person: weekly forecast utilization + influenced revenue. */
export function energyUtilization(state: ForecastState, weeks: string[]): PersonUtilization[] {
  const loads = new Map(personLoads(state, weeks).map((l) => [l.person.id, l]))
  const out: PersonUtilization[] = []
  for (const p of state.roster.filter((x) => x.group === 'energy')) {
    const load = loads.get(p.id)
    // Forward/expected utilization: probability-weighted FTE (matches the heatmap).
    const weekly = weeks.map((w) => load?.byWeek[w]?.weighted || 0)
    const cap = p.capacity || 1
    const active = weekly.filter((v) => v > 0)
    const peak = weekly.reduce((m, v) => Math.max(m, v), 0)
    const avg = active.length ? active.reduce((a, b) => a + b, 0) / active.length : 0
    // Revenue = this person's SHARE of each deal (deal value ÷ energy people),
    // so per-person figures add up to the pipeline instead of double-counting.
    let weighted = 0
    let booked = 0
    let cost = 0
    const deals = new Set<string>()
    for (const o of state.opportunities) {
      const mine = o.assignments.filter((a) => a.group === 'energy' && a.personId === p.id).length
      if (mine === 0) continue
      const n = energyCount(o)
      deals.add(o.id)
      weighted += (oppWeightedRevenue(state, o) * mine) / n
      booked += (oppBookedRevenue(o) * mine) / n
      // This person's staffing cost on the deal = their FTE-weeks × their rate,
      // weighted the same way as revenue (signed full, forecast × close %).
      // Internal projects carry no revenue here, so they're excluded from margin.
      if (p.costRate && o.type !== 'internal') {
        let fteWeeks = 0
        for (const a of o.assignments.filter((a) => a.personId === p.id)) {
          for (let off = 0; off < o.durationWeeks; off++) fteWeeks += a.fte[String(off)] || 0
        }
        const prob = o.booking === 'signed' ? 1 : effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
        cost += fteWeeks * p.costRate * prob
      }
    }
    out.push({
      person: p,
      weekly,
      cap,
      peak,
      avg,
      peakPct: peak / cap,
      avgPct: avg / cap,
      overWeeks: load?.overWeeks.length ?? 0,
      weighted,
      booked,
      cost,
      deals: deals.size,
    })
  }
  return out.sort((a, b) => b.peakPct - a.peakPct)
}

// ---------------------------------------------------------------------------
// Roster utilization heatmap — every person × week (through year-end). Each
// cell is forecast utilization (committed FTE ÷ capacity); the certainty is
// the FTE-weighted close % of that week's bookings (signed = 100%), which the
// UI maps to colour saturation.
// ---------------------------------------------------------------------------

/** Certainty of an opportunity: signed = 1, else its effective close %. */
function oppCertainty(state: ForecastState, o: Opportunity): number {
  return o.type === 'internal' || o.booking === 'signed' ? 1 : effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
}

export interface RosterWeekCell {
  util: number // FORWARD/expected utilization = Σ(FTE × close %) ÷ capacity
  committed: number // raw FTE booked this week (certain + speculative), for the tooltip
  certainty: number // FTE-weighted close % of this week's bookings (0..1) → opacity
}

export interface RosterUtilRow {
  person: Person
  weekly: RosterWeekCell[]
  target: number // this person's target utilization (their own, or the global fallback)
  avgUtil: number // mean EXPECTED utilization across the stats window (idle weeks included)
  overWeeks: number // weeks expected-over capacity (stats window)
  underWeeks: number // weeks booked but expected-under capacity (stats window)
  idleWeeks: number // weeks with zero booking (stats window)
  peakUtil: number // peak EXPECTED utilization
}

/** A person's target utilization: their own `targetUtil` if set, else the
 *  global target. One place so every view agrees. */
export function personTarget(p: Person, globalTarget: number): number {
  return p.targetUtil != null ? p.targetUtil : globalTarget
}

const OVER_CAP = 1.02 // above capacity → over-allocated (unsustainable)
const MIN_STATS_WEEKS = 13 // don't average over less than a quarter

/** How many weeks the summary stats should cover: from now through the LAST
 *  week anyone in the roster is booked (so trailing empty far-future weeks
 *  don't dilute the averages to near-zero), floored at one quarter and capped
 *  at the grid. This is the "planned/staffed horizon". */
export function activeHorizonWeeks(state: ForecastState, weeks: string[]): number {
  const idx = new Map(weeks.map((w, i) => [w, i]))
  let last = -1
  for (const o of state.opportunities) {
    const base = oppStartMonday(o)
    for (const a of o.assignments) {
      if (!a.personId) continue
      for (let off = 0; off < o.durationWeeks; off++) {
        if (!(a.fte[String(off)] > 0)) continue
        const i = idx.get(addWeeks(base, off))
        if (i != null && i > last) last = i
      }
    }
  }
  return Math.min(weeks.length, Math.max(MIN_STATS_WEEKS, last + 1))
}

/** Per-person weekly utilization + certainty across `weeks`, all roster people.
 *  Bands are relative to `target` (e.g. 0.8): below target = under-utilized,
 *  target..capacity = on target, above capacity = over-allocated.
 *  `mode`: 'expected' (default) weights each cell by close % (forward, risk-
 *  adjusted — 1 FTE on a 50%-likely deal = 50%); 'planned' shows raw booked
 *  FTE if everything lands (1 FTE = 100%). `statsWeeks` caps the window the
 *  summary numbers (average / over / under / idle / peak) are computed over;
 *  it defaults to the active/staffed horizon so dead far-future weeks don't
 *  dilute — the weekly cells themselves always span the full grid. */
export function rosterUtilization(
  state: ForecastState,
  weeks: string[],
  target: number,
  mode: 'expected' | 'planned' = 'expected',
  statsWeeks?: number,
): RosterUtilRow[] {
  const idx = new Map(weeks.map((w, i) => [w, i]))
  const committed = new Map<string, number[]>()
  const weighted = new Map<string, number[]>()
  const ensure = (m: Map<string, number[]>, id: string) => {
    let a = m.get(id)
    if (!a) {
      a = new Array(weeks.length).fill(0)
      m.set(id, a)
    }
    return a
  }
  for (const o of state.opportunities) {
    const cert = oppCertainty(state, o)
    const base = oppStartMonday(o)
    for (const asg of o.assignments) {
      if (!asg.personId) continue
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = asg.fte[String(off)] || 0
        if (!fte) continue
        const i = idx.get(addWeeks(base, off))
        if (i == null) continue
        ensure(committed, asg.personId)[i] += fte
        ensure(weighted, asg.personId)[i] += fte * cert
      }
    }
  }
  const win = statsWeeks ?? activeHorizonWeeks(state, weeks)
  const rows: RosterUtilRow[] = state.roster.map((p) => {
    const cap = p.capacity || 1
    const pt = personTarget(p, target) // this person's own target (or the global fallback)
    const c = committed.get(p.id) ?? new Array(weeks.length).fill(0)
    const w = weighted.get(p.id) ?? new Array(weeks.length).fill(0)
    const weekly: RosterWeekCell[] = weeks.map((_, i) => ({
      // 'expected' = FTE × close % (forward, risk-adjusted); 'planned' = raw
      // booked FTE (if everything lands). Opacity (certainty) always shows risk.
      util: (mode === 'planned' ? c[i] : w[i]) / cap,
      committed: c[i],
      certainty: c[i] > 0 ? w[i] / c[i] : 0,
    }))
    // Summary numbers over the active/staffed window (not the dead far-future).
    const stats = weekly.slice(0, Math.max(1, Math.min(win, weekly.length)))
    const avgUtil = stats.reduce((s, x) => s + x.util, 0) / (stats.length || 1)
    return {
      person: p,
      weekly,
      target: pt,
      avgUtil,
      overWeeks: stats.filter((x) => x.util > OVER_CAP).length,
      underWeeks: stats.filter((x) => x.committed > 0 && x.util < pt).length,
      idleWeeks: stats.filter((x) => x.committed === 0).length,
      peakUtil: stats.reduce((m, x) => Math.max(m, x.util), 0),
    }
  })
  // Energy team first, then by average utilization (busiest at the top).
  return rows.sort((a, b) => {
    if (a.person.group !== b.person.group) return a.person.group === 'energy' ? -1 : 1
    return b.avgUtil - a.avgUtil
  })
}

/** Utilization band vs target: over-capacity (over), below-target (under), else on. */
export function utilBand(util: number, target: number): 'over' | 'on' | 'under' {
  return util > OVER_CAP ? 'over' : util < target ? 'under' : 'on'
}

// ---------------------------------------------------------------------------
// Where our time goes — team FTE-weeks split by work type (billable / IP /
// client-partner) over the active/staffed window. Expected mode weights each
// week by the deal's close % (signed & internal = 100%); planned = raw FTE.
// ---------------------------------------------------------------------------
export interface WorkTypeSlice {
  workType: WorkType
  label: string
  fteWeeks: number // team FTE-weeks in this bucket over the window
  share: number // fraction of total (0..1)
}

export function timeSplitByWorkType(
  state: ForecastState,
  weeks: string[],
  mode: 'expected' | 'planned' = 'expected',
  statsWeeks?: number,
): { slices: WorkTypeSlice[]; total: number } {
  const win = statsWeeks ?? activeHorizonWeeks(state, weeks)
  const idx = new Map(weeks.map((w, i) => [w, i]))
  const buckets: Record<WorkType, number> = { billable: 0, ip: 0, partner: 0 }
  for (const o of state.opportunities) {
    const cert = mode === 'planned' ? 1 : oppCertainty(state, o)
    const base = oppStartMonday(o)
    const wt = oppWorkType(o)
    for (const a of o.assignments) {
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = a.fte[String(off)] || 0
        if (!fte) continue
        const i = idx.get(addWeeks(base, off))
        if (i == null || i >= win) continue // only within the active/staffed window
        buckets[wt] += fte * cert
      }
    }
  }
  const total = buckets.billable + buckets.ip + buckets.partner
  const slices = WORK_TYPES.map((t) => ({ workType: t.id, label: t.label, fteWeeks: buckets[t.id], share: total ? buckets[t.id] / total : 0 }))
  return { slices, total }
}

// ---------------------------------------------------------------------------
// Pipeline split by customer type (new vs existing) × booked (signed) vs
// anticipated (forecast pull-through). Internal projects are not revenue.
// ---------------------------------------------------------------------------
export interface CustomerPipeline {
  customerType: CustomerType
  label: string
  booked: number // signed bookings $
  anticipated: number // forecast weighted pull-through $
  count: number
  tcv: number // total contract value $
}

export function pipelineByCustomerType(state: ForecastState): CustomerPipeline[] {
  const b: Record<CustomerType, { booked: number; anticipated: number; count: number; tcv: number }> = {
    new: { booked: 0, anticipated: 0, count: 0, tcv: 0 },
    existing: { booked: 0, anticipated: 0, count: 0, tcv: 0 },
  }
  for (const o of state.opportunities) {
    if (o.type === 'internal') continue // internal work is not sales revenue
    const ct = oppCustomerType(o)
    b[ct].count++
    b[ct].tcv += o.dealValue || 0
    b[ct].booked += oppBookedRevenue(o)
    b[ct].anticipated += oppWeightedRevenue(state, o)
  }
  return [
    { customerType: 'new', label: 'New customer', ...b.new },
    { customerType: 'existing', label: 'Existing customer', ...b.existing },
  ]
}
