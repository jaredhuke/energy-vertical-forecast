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
