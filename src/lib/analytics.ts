import type { ForecastState, Group, Opportunity, Person } from '../types'
import { effectiveProbability } from './funnel'
import { addWeeks, parseKey, weekKeyOf, weeksBetween, weekRange } from './weeks'

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

export interface RoleRevenue {
  role: string
  deals: number
  people: number
  weighted: number
  booked: number
}

/** Per energy-role-type, aggregated over DISTINCT deals that use that role. */
export function revenueByEnergyRole(state: ForecastState): RoleRevenue[] {
  const map = new Map<string, { deals: Set<string>; people: Set<string>; weighted: number; booked: number }>()
  for (const o of state.opportunities) {
    if (o.type === 'internal') continue
    const energy = o.assignments.filter((a) => a.group === 'energy')
    const rolesInDeal = new Set(energy.map((a) => a.role))
    for (const role of rolesInDeal) {
      const rec = map.get(role) || { deals: new Set(), people: new Set(), weighted: 0, booked: 0 }
      rec.deals.add(o.id)
      rec.weighted += oppWeightedRevenue(state, o)
      rec.booked += oppBookedRevenue(o)
      map.set(role, rec)
    }
    for (const a of energy) if (a.personId) map.get(a.role)?.people.add(a.personId)
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
    let weighted = 0
    let booked = 0
    const deals = new Set<string>()
    for (const o of state.opportunities) {
      if (!o.assignments.some((a) => a.personId === p.id)) continue
      deals.add(o.id)
      weighted += oppWeightedRevenue(state, o)
      booked += oppBookedRevenue(o)
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
  avgUtil: number // mean EXPECTED utilization across the stats window (idle weeks included)
  overWeeks: number // weeks expected-over capacity (stats window)
  underWeeks: number // weeks booked but expected-under capacity (stats window)
  idleWeeks: number // weeks with zero booking (stats window)
  peakUtil: number // peak EXPECTED utilization
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
      avgUtil,
      overWeeks: stats.filter((x) => x.util > OVER_CAP).length,
      underWeeks: stats.filter((x) => x.committed > 0 && x.util < target).length,
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
