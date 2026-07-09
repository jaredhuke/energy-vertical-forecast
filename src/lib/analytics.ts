import type { ForecastState, Opportunity, Person } from '../types'
import { effectiveProbability } from './funnel'
import { addWeeks, weekKeyOf, weeksBetween, weekRange } from './weeks'

/** Absolute end week key (exclusive-style: start + duration). */
export function opportunityEndWeek(o: Opportunity): string {
  return addWeeks(o.startWeek, Math.max(1, o.durationWeeks))
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
    if (weeksBetween(start, o.startWeek) < 0) start = o.startWeek
    const oEnd = opportunityEndWeek(o)
    if (weeksBetween(end, oEnd) > 0) end = oEnd
  }
  const count = Math.max(minWeeks, weeksBetween(start, end))
  return { start, weeks: weekRange(start, count) }
}

export interface WeekDemand {
  week: string
  committedEnergy: number
  committedDelivery: number
  weightedEnergy: number
  weightedDelivery: number
}

export function demandByWeek(state: ForecastState, weeks: string[]): WeekDemand[] {
  const idx = new Map(weeks.map((w, i) => [w, i]))
  const rows: WeekDemand[] = weeks.map((w) => ({
    week: w,
    committedEnergy: 0,
    committedDelivery: 0,
    weightedEnergy: 0,
    weightedDelivery: 0,
  }))
  for (const o of state.opportunities) {
    const prob = effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
    for (const a of o.assignments) {
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = a.fte[String(off)] || 0
        if (!fte) continue
        const week = addWeeks(o.startWeek, off)
        const i = idx.get(week)
        if (i == null) continue
        const row = rows[i]
        if (a.group === 'energy') {
          row.committedEnergy += fte
          row.weightedEnergy += fte * prob
        } else {
          row.committedDelivery += fte
          row.weightedDelivery += fte * prob
        }
      }
    }
  }
  return rows
}

export const committedTotal = (d: WeekDemand) => d.committedEnergy + d.committedDelivery
export const weightedTotal = (d: WeekDemand) => d.weightedEnergy + d.weightedDelivery

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
    const prob = effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
    for (const a of o.assignments) {
      if (!a.personId) continue
      const person = state.roster.find((p) => p.id === a.personId)
      if (!person) continue
      const load = getLoad(person)
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = a.fte[String(off)] || 0
        if (!fte) continue
        const week = addWeeks(o.startWeek, off)
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
      if (cell.committed > load.person.capacity + 1e-9) load.overWeeks.push(week)
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
    const prob = effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
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

export function funnelCounts(state: ForecastState): { stageId: string; count: number }[] {
  return state.stages.map((s) => ({
    stageId: s.id,
    count: state.opportunities.filter((o) => o.stageId === s.id).length,
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
  if (o.booking === 'signed') return 0
  const prob = effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
  return (o.dealValue || 0) * prob
}

export function oppBookedRevenue(o: Opportunity): number {
  return o.booking === 'signed' ? o.dealValue || 0 : 0
}

export function revenueTotals(state: ForecastState) {
  let tcv = 0
  let weighted = 0
  let booked = 0
  let signedCount = 0
  let forecastCount = 0
  for (const o of state.opportunities) {
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
  weekly: number[] // committed FTE aligned to `weeks`
  cap: number
  peak: number
  avg: number // over active weeks
  peakPct: number
  avgPct: number
  overWeeks: number
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
    const weekly = weeks.map((w) => load?.byWeek[w]?.committed || 0)
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
  return o.booking === 'signed' ? 1 : effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
}

export interface RosterWeekCell {
  util: number // committed FTE / capacity (1 = fully booked)
  committed: number // FTE this week
  certainty: number // FTE-weighted close % of this week's bookings (0..1)
}

export interface RosterUtilRow {
  person: Person
  weekly: RosterWeekCell[]
  avgUtil: number // mean utilization across the whole horizon (idle weeks included)
  overWeeks: number // weeks over capacity
  underWeeks: number // weeks booked but under capacity (spare on active weeks)
  idleWeeks: number // weeks with zero booking
  peakUtil: number
}

const OVER = 1.05
const UNDER = 0.85

/** Per-person weekly utilization + certainty across `weeks`, all roster people. */
export function rosterUtilization(state: ForecastState, weeks: string[]): RosterUtilRow[] {
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
    for (const asg of o.assignments) {
      if (!asg.personId) continue
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = asg.fte[String(off)] || 0
        if (!fte) continue
        const i = idx.get(addWeeks(o.startWeek, off))
        if (i == null) continue
        ensure(committed, asg.personId)[i] += fte
        ensure(weighted, asg.personId)[i] += fte * cert
      }
    }
  }
  const rows: RosterUtilRow[] = state.roster.map((p) => {
    const cap = p.capacity || 1
    const c = committed.get(p.id) ?? new Array(weeks.length).fill(0)
    const w = weighted.get(p.id) ?? new Array(weeks.length).fill(0)
    const weekly: RosterWeekCell[] = weeks.map((_, i) => ({
      util: c[i] / cap,
      committed: c[i],
      certainty: c[i] > 0 ? w[i] / c[i] : 0,
    }))
    const avgUtil = weekly.reduce((s, x) => s + x.util, 0) / (weeks.length || 1)
    return {
      person: p,
      weekly,
      avgUtil,
      overWeeks: weekly.filter((x) => x.util > OVER).length,
      underWeeks: weekly.filter((x) => x.committed > 0 && x.util < UNDER).length,
      idleWeeks: weekly.filter((x) => x.committed === 0).length,
      peakUtil: weekly.reduce((m, x) => Math.max(m, x.util), 0),
    }
  })
  // Energy team first, then by average utilization (busiest at the top).
  return rows.sort((a, b) => {
    if (a.person.group !== b.person.group) return a.person.group === 'energy' ? -1 : 1
    return b.avgUtil - a.avgUtil
  })
}

/** Utilization band for colour affordance. */
export function utilBand(util: number): 'over' | 'on' | 'under' {
  return util > OVER ? 'over' : util < UNDER ? 'under' : 'on'
}
