import { describe, it, expect } from 'vitest'
import type { ForecastState, Opportunity, Person, StageDef } from '../types'
import {
  oppProbability,
  oppIsBooked,
  demandByWeek,
  demandStackByWeek,
  committedTotal,
  weightedTotal,
  signedTotal,
  totals,
  personLoads,
  rolesImpacted,
  funnelCounts,
  unstaffedRoles,
  oppWeightedRevenue,
  oppBookedRevenue,
  revenueTotals,
  revenueByEnergyRole,
  energyUtilization,
  rosterUtilization,
  activeHorizonWeeks,
  roleDemandVsCapacity,
  utilBand,
  oppCost,
  marginTotals,
  personTarget,
  timeSplitByWorkType,
  oppWorkType,
  oppCustomerType,
  pipelineByCustomerType,
} from './analytics'
import { addWeeks, weekKeyOf, mondayOf, dateKey, weekRange } from './weeks'

// ===========================================================================
// GOLDEN FIXTURE — every number below is hand-computed in the comments so the
// engine is checked against arithmetic done by a human, not against itself.
//
// weeks: four consecutive Mondays.  W0 2026-01-05 · W1 2026-01-12 ·
//        W2 2026-01-19 · W3 2026-01-26
//
// Roster:  Alice  energy  cap 1.0  role "Solution Architect"
//          Bob    energy  cap 0.5  role "Consultant"
//          Carol  delivery cap 1.0 role "Engineer"
//
// Stages:  lead 10% · proposal 50% · closed 100%
//
// O1 "signed"   external SIGNED  stage closed  $1.0M  W0..W1 (dur 2)
//     Alice(E) 0.5,0.5   Carol(D) 1.0,1.0
// O2 "forecast" external FORECAST stage proposal(50%) $2.0M  W1..W2 (dur 2)
//     Alice(E) 0.5,0.5   Bob(E) 0.6 (W1 only)
// O3 "internal" INTERNAL  W0 (dur 1)
//     Bob(E) 0.5
// ===========================================================================

const WEEKS = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']

const roster: Person[] = [
  { id: 'p-alice', name: 'Alice', group: 'energy', level: 'Principal', title: '', role: 'Solution Architect', capacity: 1.0 },
  { id: 'p-bob', name: 'Bob', group: 'energy', level: 'Consultant', title: '', role: 'Consultant', capacity: 0.5 },
  { id: 'p-carol', name: 'Carol', group: 'delivery', level: 'Senior', title: '', role: 'Engineer', capacity: 1.0 },
]

const stages: StageDef[] = [
  { id: 'lead', name: 'Lead', probability: 0.1 },
  { id: 'proposal', name: 'Proposal', probability: 0.5 },
  { id: 'closed', name: 'Closed', probability: 1.0 },
]

const opportunities: Opportunity[] = [
  {
    id: 'o1', name: 'signed', client: '', type: 'external', booking: 'signed', stageId: 'closed',
    dealValue: 1_000_000, startWeek: '2026-01-05', durationWeeks: 2,
    assignments: [
      { id: 'a1', personId: 'p-alice', role: 'Solution Architect', group: 'energy', fte: { '0': 0.5, '1': 0.5 } },
      { id: 'a2', personId: 'p-carol', role: 'Engineer', group: 'delivery', fte: { '0': 1, '1': 1 } },
    ],
  },
  {
    id: 'o2', name: 'forecast', client: '', type: 'external', booking: 'forecast', stageId: 'proposal',
    dealValue: 2_000_000, startWeek: '2026-01-12', durationWeeks: 2,
    assignments: [
      { id: 'a3', personId: 'p-alice', role: 'Solution Architect', group: 'energy', fte: { '0': 0.5, '1': 0.5 } },
      { id: 'a4', personId: 'p-bob', role: 'Consultant', group: 'energy', fte: { '0': 0.6 } },
    ],
  },
  {
    id: 'o3', name: 'internal', client: '', type: 'internal', booking: 'forecast', stageId: 'lead',
    dealValue: 0, startWeek: '2026-01-05', durationWeeks: 1,
    assignments: [{ id: 'a5', personId: 'p-bob', role: 'Consultant', group: 'energy', fte: { '0': 0.5 } }],
  },
]

const state: ForecastState = { roster, stages, opportunities, snapshots: [], editor: 't' }

describe('opportunity probability + booking', () => {
  it('signed and internal are certain (100%); forecast weights by stage', () => {
    expect(oppProbability(state, opportunities[0])).toBe(1) // signed
    expect(oppProbability(state, opportunities[1])).toBe(0.5) // proposal
    expect(oppProbability(state, opportunities[2])).toBe(1) // internal
    expect(oppIsBooked(opportunities[0])).toBe(true)
    expect(oppIsBooked(opportunities[1])).toBe(false)
    expect(oppIsBooked(opportunities[2])).toBe(true)
  })
  it('a probability override wins over the stage default (forecast only)', () => {
    const o = { ...opportunities[1], probabilityOverride: 0.9 }
    expect(oppProbability(state, o)).toBeCloseTo(0.9, 10)
    // but a signed deal is always 100% regardless of any override
    const s = { ...opportunities[0], probabilityOverride: 0.3 }
    expect(oppProbability(state, s)).toBe(1)
  })
})

describe('demandByWeek — hand-computed grid', () => {
  const d = demandByWeek(state, WEEKS)
  // W0: O1 Alice0.5(E,signed) + Carol1.0(D,signed) + O3 Bob0.5(E,internal)
  it('W0 committed/weighted/signed', () => {
    expect(d[0].committedEnergy).toBeCloseTo(1.0, 10) // 0.5 + 0.5
    expect(d[0].committedDelivery).toBeCloseTo(1.0, 10)
    expect(d[0].weightedEnergy).toBeCloseTo(1.0, 10) // both booked → ×1
    expect(d[0].weightedDelivery).toBeCloseTo(1.0, 10)
    expect(d[0].signedEnergy).toBeCloseTo(1.0, 10)
    expect(d[0].signedDelivery).toBeCloseTo(1.0, 10)
  })
  // W1: O1 Alice0.5(signed)+Carol1.0(signed) · O2 Alice0.5(50%)+Bob0.6(50%)
  it('W1 committed/weighted/signed', () => {
    expect(d[1].committedEnergy).toBeCloseTo(1.6, 10) // 0.5 + 0.5 + 0.6
    expect(d[1].committedDelivery).toBeCloseTo(1.0, 10)
    expect(d[1].weightedEnergy).toBeCloseTo(1.05, 10) // 0.5 + 0.25 + 0.30
    expect(d[1].weightedDelivery).toBeCloseTo(1.0, 10)
    expect(d[1].signedEnergy).toBeCloseTo(0.5, 10) // only O1 Alice
    expect(d[1].signedDelivery).toBeCloseTo(1.0, 10)
  })
  // W2: O2 Alice 0.5 (50%)
  it('W2 committed/weighted/signed', () => {
    expect(d[2].committedEnergy).toBeCloseTo(0.5, 10)
    expect(d[2].weightedEnergy).toBeCloseTo(0.25, 10)
    expect(d[2].signedEnergy).toBeCloseTo(0, 10)
  })
  it('W3 is empty', () => {
    expect(committedTotal(d[3])).toBe(0)
  })
})

describe('totals across the horizon (FTE-weeks)', () => {
  it('committed 5.1, weighted 4.3', () => {
    const t = totals(demandByWeek(state, WEEKS))
    // committed: 2.0 + 2.6 + 0.5 + 0 = 5.1 ; weighted: 2.0 + 2.05 + 0.25 = 4.3
    expect(t.committed).toBeCloseTo(5.1, 10)
    expect(t.weighted).toBeCloseTo(4.3, 10)
  })
})

describe('demandStackByWeek — signed floor + forecast slices', () => {
  const s = demandStackByWeek(state, WEEKS)
  it('W0: all booked → signed 2.0, no forecast', () => {
    expect(s[0].signed).toBeCloseTo(2.0, 10) // 0.5+1.0+0.5
    expect(s[0].forecast).toEqual([])
    expect(s[0].total).toBeCloseTo(2.0, 10)
  })
  it('W1: signed 1.5, one 50% forecast slice of 1.1', () => {
    expect(s[1].signed).toBeCloseTo(1.5, 10) // O1 Alice0.5 + Carol1.0
    expect(s[1].forecast).toHaveLength(1)
    expect(s[1].forecast[0].prob).toBeCloseTo(0.5, 10)
    expect(s[1].forecast[0].fte).toBeCloseTo(1.1, 10) // 0.5 + 0.6 merged at 50%
    expect(s[1].total).toBeCloseTo(2.6, 10)
  })
  it('stack total per week equals committedTotal per week', () => {
    const d = demandByWeek(state, WEEKS)
    s.forEach((wk, i) => expect(wk.total).toBeCloseTo(committedTotal(d[i]), 10))
  })
})

describe('personLoads — over-capacity flagging', () => {
  const loads = personLoads(state, WEEKS)
  const byId = Object.fromEntries(loads.map((l) => [l.person.id, l]))
  it('Alice peaks at 1.0 in W1, never over her 1.0 capacity', () => {
    expect(byId['p-alice'].peakCommitted).toBeCloseTo(1.0, 10)
    expect(byId['p-alice'].overWeeks).toEqual([])
  })
  it('Bob peaks at 0.6 raw, but is NOT expected-over (0.6 FTE @ 50% = 0.3 < 0.5 cap)', () => {
    expect(byId['p-bob'].peakCommitted).toBeCloseTo(0.6, 10) // raw booking peak
    expect(byId['p-bob'].overWeeks).toEqual([]) // over-capacity is EXPECTED (weighted) now
  })
})

describe('revenue — pull-through math', () => {
  it('per-opportunity weighted vs booked', () => {
    expect(oppWeightedRevenue(state, opportunities[0])).toBe(0) // signed → weighted 0
    expect(oppBookedRevenue(opportunities[0])).toBe(1_000_000)
    expect(oppWeightedRevenue(state, opportunities[1])).toBe(1_000_000) // 2M × 50%
    expect(oppBookedRevenue(opportunities[1])).toBe(0)
    expect(oppWeightedRevenue(state, opportunities[2])).toBe(0) // internal
    expect(oppBookedRevenue(opportunities[2])).toBe(0)
  })
  it('revenueTotals: TCV 3.0M, weighted 1.0M, booked 1.0M, blended 2.0M', () => {
    const r = revenueTotals(state)
    expect(r.tcv).toBe(3_000_000) // 1M + 2M (internal excluded)
    expect(r.weighted).toBe(1_000_000)
    expect(r.booked).toBe(1_000_000)
    expect(r.blended).toBe(2_000_000)
    expect(r.signedCount).toBe(1)
    expect(r.forecastCount).toBe(1)
  })
  it('revenueByEnergyRole — deal value SPLIT across the energy people on it', () => {
    const rows = revenueByEnergyRole(state)
    const sa = rows.find((r) => r.role === 'Solution Architect')!
    const con = rows.find((r) => r.role === 'Consultant')!
    // O1 (signed $1M) has 1 energy person (Alice) → SA booked 1M.
    // O2 ($2M @ 50% = $1M weighted) has 2 energy (Alice, Bob) → 500k each.
    expect(sa.deals).toBe(2) // O1 + O2
    expect(sa.people).toBe(1) // Alice
    expect(sa.weighted).toBe(500_000) // O2 split 2 ways
    expect(sa.booked).toBe(1_000_000) // O1, only energy person
    expect(con.deals).toBe(1) // O2 (O3 internal excluded)
    expect(con.weighted).toBe(500_000) // O2 split 2 ways
    expect(con.booked).toBe(0)
  })
  it('the split is additive: role shares sum to the pipeline (no double-count)', () => {
    const rows = revenueByEnergyRole(state)
    const roleW = rows.reduce((s, r) => s + r.weighted, 0)
    const roleB = rows.reduce((s, r) => s + r.booked, 0)
    const t = revenueTotals(state)
    // every non-internal deal in the fixture is energy-staffed, so shares total the pipeline
    expect(roleW).toBeCloseTo(t.weighted, 6)
    expect(roleB).toBeCloseTo(t.booked, 6)
  })
  it('a $100k deal with 2 energy people = $50k associated with each', () => {
    const st: ForecastState = {
      ...state,
      opportunities: [{
        id: 'oh', name: '', client: '', type: 'external', booking: 'signed', stageId: 'closed',
        dealValue: 100_000, startWeek: '2026-01-05', durationWeeks: 1,
        assignments: [
          { id: 'e1', personId: 'p-alice', role: 'Solution Architect', group: 'energy', fte: { '0': 1 } },
          { id: 'e2', personId: 'p-bob', role: 'Consultant', group: 'energy', fte: { '0': 1 } },
        ],
      }],
    }
    const rows = Object.fromEntries(revenueByEnergyRole(st).map((r) => [r.role, r]))
    expect(rows['Solution Architect'].booked).toBe(50_000)
    expect(rows['Consultant'].booked).toBe(50_000)
    const u = Object.fromEntries(energyUtilization(st, WEEKS).map((x) => [x.person.id, x]))
    expect(u['p-alice'].booked).toBe(50_000) // per-person share too
    expect(u['p-bob'].booked).toBe(50_000)
  })
})

describe('energyUtilization — per energy person (EXPECTED / weighted)', () => {
  const u = Object.fromEntries(energyUtilization(state, WEEKS).map((x) => [x.person.id, x]))
  it('Alice: expected weekly [0.5,0.75,0.25,0], peak 75%, avg over active 50%', () => {
    expect(u['p-alice'].weekly).toEqual([0.5, 0.75, 0.25, 0]) // W1: 0.5 signed + 0.5×50%
    expect(u['p-alice'].peakPct).toBeCloseTo(0.75, 10)
    expect(u['p-alice'].avgPct).toBeCloseTo(0.5, 10) // (0.5+0.75+0.25)/3
    expect(u['p-alice'].deals).toBe(2)
    expect(u['p-alice'].weighted).toBe(500_000) // O2 $1M weighted, split 2 energy → her 500k
    expect(u['p-alice'].booked).toBe(1_000_000) // O1 signed, she's the only energy person
  })
  it('Bob (cap 0.5): expected peak 100% (0.5 internal / 0.5 cap), NOT over', () => {
    expect(u['p-bob'].weekly).toEqual([0.5, 0.3, 0, 0]) // W0 internal ×1, W1 0.6×50%
    expect(u['p-bob'].peakPct).toBeCloseTo(1.0, 10) // 0.5 / 0.5
    expect(u['p-bob'].overWeeks).toBe(0) // expected never exceeds capacity
    expect(u['p-bob'].weighted).toBe(500_000) // O2 split 2 ways
    expect(u['p-bob'].booked).toBe(0)
  })
  it('delivery people are excluded from energy utilization', () => {
    expect(energyUtilization(state, WEEKS).some((x) => x.person.id === 'p-carol')).toBe(false)
  })
})

describe('rosterUtilization — the heatmap numbers (EXPECTED / weighted)', () => {
  const rows = Object.fromEntries(rosterUtilization(state, WEEKS, 0.8).map((r) => [r.person.id, r]))
  it('Alice expected util [0.5,0.75,0.25,0], avg 37.5%, 3 under-target, 1 idle, 0 over', () => {
    expect(rows['p-alice'].weekly.map((c) => c.util)).toEqual([0.5, 0.75, 0.25, 0])
    expect(rows['p-alice'].avgUtil).toBeCloseTo(0.375, 10) // (0.5+0.75+0.25+0)/4
    expect(rows['p-alice'].underWeeks).toBe(3) // all three active weeks are < 80%
    expect(rows['p-alice'].idleWeeks).toBe(1)
    expect(rows['p-alice'].overWeeks).toBe(0)
    expect(rows['p-alice'].peakUtil).toBeCloseTo(0.75, 10)
  })
  it('Bob expected util [1.0,0.6,0,0] — 0.6 FTE @ 50% = 60%, NOT over, avg 40%', () => {
    expect(rows['p-bob'].weekly.map((c) => c.util)).toEqual([1.0, 0.6, 0, 0])
    expect(rows['p-bob'].overWeeks).toBe(0) // 0.6 raw → 0.3 expected < 0.5 cap
    expect(rows['p-bob'].avgUtil).toBeCloseTo(0.4, 10) // (1.0+0.6)/4
  })
  it('certainty = FTE-weighted close % of the week (signed/internal = 100%)', () => {
    // Alice W1: 0.5 signed(×1) + 0.5 forecast(×0.5) = 0.75 weighted over 1.0 committed
    expect(rows['p-alice'].weekly[1].certainty).toBeCloseTo(0.75, 10)
    // Bob W1: 0.6 forecast at 50% → 0.5 certainty
    expect(rows['p-bob'].weekly[1].certainty).toBeCloseTo(0.5, 10)
    // Bob W0: 0.5 internal → 100% certain
    expect(rows['p-bob'].weekly[0].certainty).toBeCloseTo(1.0, 10)
  })
  it('THE RULE: 1 FTE on a 50%-likely deal = 50% forward utilization', () => {
    const st: ForecastState = {
      ...state,
      roster: [{ ...roster[0], id: 'p-x', capacity: 1 }],
      opportunities: [{
        id: 'ox', name: '', client: '', type: 'external', booking: 'forecast', stageId: 'proposal',
        dealValue: 0, startWeek: '2026-01-05', durationWeeks: 1,
        assignments: [{ id: 'x', personId: 'p-x', role: 'X', group: 'energy', fte: { '0': 1 } }],
      }],
    }
    const cell = rosterUtilization(st, WEEKS, 0.8)[0].weekly[0]
    expect(cell.util).toBeCloseTo(0.5, 10) // 1 FTE × 50% ÷ 1.0 cap
    expect(cell.committed).toBeCloseTo(1.0, 10) // raw FTE still available for the tooltip
  })
  it('a signed 1.5 FTE on cap 1.0 is expected-over (150%)', () => {
    const st: ForecastState = {
      ...state,
      roster: [{ ...roster[0], id: 'p-y', capacity: 1 }],
      opportunities: [{
        id: 'oy', name: '', client: '', type: 'external', booking: 'signed', stageId: 'closed',
        dealValue: 0, startWeek: '2026-01-05', durationWeeks: 1,
        assignments: [{ id: 'y', personId: 'p-y', role: 'X', group: 'energy', fte: { '0': 1.5 } }],
      }],
    }
    const row = rosterUtilization(st, WEEKS, 0.8)[0]
    expect(row.weekly[0].util).toBeCloseTo(1.5, 10) // signed → 100% certain → 1.5 expected
    expect(row.overWeeks).toBe(1)
  })
  it('divide-by-zero guard: capacity 0 does not produce NaN/Infinity util', () => {
    const zeroCap: Person = { ...roster[0], id: 'p-zero', name: 'Zero', capacity: 0 }
    const st: ForecastState = {
      ...state,
      roster: [zeroCap],
      opportunities: [{ ...opportunities[0], assignments: [{ id: 'z', personId: 'p-zero', role: 'X', group: 'energy', fte: { '0': 0.5 } }] }],
    }
    const r = rosterUtilization(st, WEEKS, 0.8)[0]
    expect(Number.isFinite(r.weekly[0].util)).toBe(true)
    expect(Number.isFinite(r.avgUtil)).toBe(true)
  })
})

describe('rosterUtilization — planned mode + active-horizon window (Part 1)', () => {
  it("planned mode shows RAW booked FTE (Alice W1 = 1.0), expected shows weighted (0.75)", () => {
    const p = Object.fromEntries(rosterUtilization(state, WEEKS, 0.8, 'planned').map((r) => [r.person.id, r]))
    expect(p['p-alice'].weekly.map((c) => c.util)).toEqual([0.5, 1.0, 0.5, 0]) // committed ÷ cap
    expect(p['p-alice'].peakUtil).toBeCloseTo(1.0, 10)
    // Bob planned W0 = 0.5 internal / 0.5 cap = 100% (expected mode is the same here)
    expect(p['p-bob'].weekly[0].util).toBeCloseTo(1.0, 10)
  })
  it('active-horizon window: work only in the first 2 of 26 weeks averages over ~a quarter, not 26', () => {
    const longWeeks = weekRange('2026-01-05', 26)
    const st: ForecastState = {
      ...state,
      roster: [{ ...roster[0], id: 'p-x', capacity: 1 }],
      opportunities: [{
        id: 'ox', name: '', client: '', type: 'external', booking: 'signed', stageId: 'closed',
        dealValue: 0, startWeek: '2026-01-05', durationWeeks: 2,
        assignments: [{ id: 'x', personId: 'p-x', role: 'X', group: 'energy', fte: { '0': 1, '1': 1 } }],
      }],
    }
    // last staffed week index = 1 → window floored to 13 (a quarter), NOT 26.
    expect(activeHorizonWeeks(st, longWeeks)).toBe(13)
    const row = rosterUtilization(st, longWeeks, 0.8)[0]
    expect(row.avgUtil).toBeCloseTo(2 / 13, 6) // over 13 weeks, not the diluted 2/26
  })
  it('active-horizon window extends to the last staffed week when the pipeline is longer than a quarter', () => {
    const longWeeks = weekRange('2026-01-05', 40)
    const st: ForecastState = {
      ...state,
      roster: [{ ...roster[0], id: 'p-x', capacity: 1 }],
      opportunities: [{
        id: 'ox', name: '', client: '', type: 'external', booking: 'signed', stageId: 'closed',
        dealValue: 0, startWeek: '2026-01-05', durationWeeks: 20,
        assignments: [{ id: 'x', personId: 'p-x', role: 'X', group: 'energy', fte: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i), 1])) }],
      }],
    }
    expect(activeHorizonWeeks(st, longWeeks)).toBe(20) // through the last staffed week
  })
})

describe('roleDemandVsCapacity — can we deliver the pipeline? (Part 2)', () => {
  it('expected mode: demand vs roster capacity per role', () => {
    const rows = Object.fromEntries(roleDemandVsCapacity(state, WEEKS, 'expected').map((r) => [`${r.group}:${r.role}`, r]))
    const sa = rows['energy:Solution Architect']
    expect(sa.capacity).toBeCloseTo(1.0, 10) // Alice
    expect(sa.weekly[1].demand).toBeCloseTo(0.75, 10) // O1 0.5(×1) + O2 0.5(×0.5)
    expect(sa.shortWeeks).toBe(0)
    const con = rows['energy:Consultant']
    expect(con.capacity).toBeCloseTo(0.5, 10) // Bob
    expect(con.weekly[0].demand).toBeCloseTo(0.5, 10) // O3 internal 0.5 ×1
    expect(con.shortWeeks).toBe(0) // 0.5 demand == 0.5 cap, not over
    const eng = rows['delivery:Engineer']
    expect(eng.capacity).toBeCloseTo(1.0, 10)
    expect(eng.weekly[0].demand).toBeCloseTo(1.0, 10)
  })
  it('planned mode surfaces a real shortfall (Consultant needs 0.6 vs 0.5 capacity in W1)', () => {
    const con = roleDemandVsCapacity(state, WEEKS, 'planned').find((r) => r.role === 'Consultant')!
    expect(con.weekly[1].demand).toBeCloseTo(0.6, 10)
    expect(con.weekly[1].short).toBeCloseTo(0.1, 10)
    expect(con.shortWeeks).toBe(1)
    expect(con.peakShort).toBeCloseTo(0.1, 10)
  })
  it('demand for a role nobody in the roster has is ALL shortfall (capacity 0)', () => {
    const st: ForecastState = {
      ...state,
      opportunities: [{
        id: 'ods', name: '', client: '', type: 'external', booking: 'signed', stageId: 'closed',
        dealValue: 0, startWeek: '2026-01-05', durationWeeks: 1,
        assignments: [{ id: 'u', role: 'Data Scientist', group: 'delivery', fte: { '0': 1 } }],
      }],
    }
    const ds = roleDemandVsCapacity(st, WEEKS, 'expected').find((r) => r.role === 'Data Scientist')!
    expect(ds.capacity).toBe(0)
    expect(ds.people).toBe(0)
    expect(ds.weekly[0].demand).toBeCloseTo(1.0, 10)
    expect(ds.weekly[0].short).toBeCloseTo(1.0, 10)
  })
})

describe('unstaffedRoles', () => {
  it('lists role lines with planned FTE and no named person (excludes staffed + zero-FTE)', () => {
    const st: ForecastState = {
      ...state,
      opportunities: [{
        ...opportunities[0], id: 'ou',
        assignments: [
          { id: 'r1', role: 'Data Scientist', group: 'delivery', fte: { '0': 0.6, '1': 0.6 } }, // unstaffed, 1.2
          { id: 'r2', personId: 'p-alice', role: 'SA', group: 'energy', fte: { '0': 0.5 } }, // staffed → excluded
          { id: 'r3', role: 'Placeholder', group: 'delivery', fte: {} }, // no FTE → excluded
        ],
      }],
    }
    const u = unstaffedRoles(st)
    expect(u).toHaveLength(1)
    expect(u[0].role).toBe('Data Scientist')
    expect(u[0].fteWeeks).toBeCloseTo(1.2, 10)
  })
})

describe('funnel counts (internal excluded)', () => {
  it('lead 0, proposal 1, closed 1', () => {
    const f = Object.fromEntries(funnelCounts(state).map((x) => [x.stageId, x.count]))
    expect(f).toEqual({ lead: 0, proposal: 1, closed: 1 })
  })
})

describe('rolesImpacted', () => {
  it('sums FTE-weeks by role, weighted by probability', () => {
    const r = Object.fromEntries(rolesImpacted(state).map((x) => [`${x.group}:${x.role}`, x]))
    // Solution Architect (Alice): O1 1.0 committed (signed ×1) + O2 1.0 committed (×0.5 → 0.5)
    expect(r['energy:Solution Architect'].committed).toBeCloseTo(2.0, 10)
    expect(r['energy:Solution Architect'].weighted).toBeCloseTo(1.5, 10) // 1.0 + 0.5
    // Consultant (Bob): O2 0.6 (×0.5 → 0.3) + O3 0.5 internal (×1 → 0.5)
    expect(r['energy:Consultant'].committed).toBeCloseTo(1.1, 10)
    expect(r['energy:Consultant'].weighted).toBeCloseTo(0.8, 10) // 0.3 + 0.5
  })
})

describe('utilBand thresholds', () => {
  it('over > 1.02, under < target, else on', () => {
    expect(utilBand(1.2, 0.8)).toBe('over')
    expect(utilBand(1.02, 0.8)).toBe('on') // exactly 1.02 is not over
    expect(utilBand(0.5, 0.8)).toBe('under')
    expect(utilBand(0.9, 0.8)).toBe('on')
    expect(utilBand(1.0, 0.8)).toBe('on')
  })
})

// ===========================================================================
// CROSS-CONSISTENCY INVARIANTS — must hold for ANY data, not just the fixture.
// These are the properties the whole UI leans on; if one breaks, a number
// somewhere is lying.
// ===========================================================================
describe('invariants that must always hold', () => {
  const d = demandByWeek(state, WEEKS)
  it('per week: signed ≤ weighted ≤ committed (the ordering the demand chart shows)', () => {
    for (const w of d) {
      expect(signedTotal(w)).toBeLessThanOrEqual(weightedTotal(w) + 1e-9)
      expect(weightedTotal(w)).toBeLessThanOrEqual(committedTotal(w) + 1e-9)
    }
  })
  it('sum of stack totals equals committed FTE-weeks', () => {
    const stackSum = demandStackByWeek(state, WEEKS).reduce((s, w) => s + w.total, 0)
    expect(stackSum).toBeCloseTo(totals(d).committed, 10)
  })
  it('roster-heatmap committed FTE = per-week demand committed (same underlying data)', () => {
    const heat = rosterUtilization(state, WEEKS, 0.8)
    const heatTotal = heat.reduce((s, r) => s + r.weekly.reduce((a, c) => a + c.committed, 0), 0)
    // Note: heatmap counts only NAMED assignments; the fixture is fully named,
    // so it must equal total committed FTE-weeks.
    expect(heatTotal).toBeCloseTo(totals(d).committed, 10)
  })
  it('revenue blended = weighted pull-through + booked, and never counts internal', () => {
    const r = revenueTotals(state)
    expect(r.blended).toBe(r.weighted + r.booked)
    const withBigInternal: ForecastState = {
      ...state,
      opportunities: [...opportunities, { ...opportunities[2], id: 'o4', dealValue: 9_999_999 }],
    }
    expect(revenueTotals(withBigInternal).tcv).toBe(revenueTotals(state).tcv) // internal $ ignored
  })
})

// ===========================================================================
// DATA-INTEGRITY HAZARD — a non-Monday startWeek must NOT silently vanish.
// (In-app data is always Monday-keyed, but imported/hand-edited JSON might not
// be. The engine now snaps offsets to the week grid so the FTE still lands.)
// ===========================================================================
describe('non-Monday startWeek does not drop FTE', () => {
  it('a Wednesday start still contributes its FTE to the week it falls in', () => {
    const wed = '2026-01-07' // Wednesday, inside the W0 (2026-01-05) week
    const st: ForecastState = {
      ...state,
      opportunities: [
        { ...opportunities[0], id: 'ox', booking: 'forecast', stageId: 'closed', startWeek: wed, assignments: [{ id: 'z', personId: 'p-alice', role: 'X', group: 'energy', fte: { '0': 1 } }] },
      ],
      roster,
    }
    const d = demandByWeek(st, WEEKS)
    const totalCommitted = d.reduce((s, w) => s + committedTotal(w), 0)
    expect(totalCommitted).toBeCloseTo(1, 10) // the 1 FTE is present somewhere, not dropped
  })
})

// ===========================================================================
// COST & MARGIN — hidden feature. Cost = FTE-weeks × per-person weekly rate.
// Rates added on top of the golden roster: Alice $5,000 · Bob $3,000 · Carol
// $4,000 (per FTE-week). Every figure below is hand-computed.
// ===========================================================================
const costRoster: Person[] = [
  { ...roster[0], costRate: 5000 }, // Alice
  { ...roster[1], costRate: 3000 }, // Bob
  { ...roster[2], costRate: 4000 }, // Carol
]
const costState: ForecastState = { ...state, roster: costRoster }

describe('oppCost — staffing spend per deal', () => {
  it('O1 signed = Alice 1.0 FTE-wk × 5000 + Carol 2.0 × 4000 = 13,000', () => {
    expect(oppCost(opportunities[0], costRoster)).toBe(5000 + 8000)
  })
  it('O2 forecast = Alice 1.0 × 5000 + Bob 0.6 × 3000 = 6,800 (full, un-weighted)', () => {
    expect(oppCost(opportunities[1], costRoster)).toBeCloseTo(5000 + 1800, 6)
  })
  it('O3 internal = Bob 0.5 × 3000 = 1,500', () => {
    expect(oppCost(opportunities[2], costRoster)).toBe(1500)
  })
  it('people with no rate contribute nothing (base roster has none)', () => {
    expect(oppCost(opportunities[0], roster)).toBe(0)
  })
})

describe('marginTotals — portfolio cost & margin', () => {
  const m = marginTotals(costState)
  it('signed: booked $1.0M − cost $13,000 = $987,000', () => {
    expect(m.bookedRevenue).toBe(1_000_000)
    expect(m.bookedCost).toBe(13_000)
    expect(m.bookedMargin).toBe(987_000)
  })
  it('forecast: BOTH revenue and cost weighted by 50% → $1.0M − $3,400', () => {
    expect(m.weightedRevenue).toBe(1_000_000) // 2.0M × 0.5
    expect(m.weightedCost).toBeCloseTo(3_400, 6) // 6,800 × 0.5
    expect(m.weightedMargin).toBeCloseTo(996_600, 6)
  })
  it('internal is pure cost, tracked apart from revenue/margin', () => {
    expect(m.internalCost).toBe(1_500)
  })
  it('blended margin % = (996,600 + 987,000) ÷ 2,000,000 = 99.18%', () => {
    expect(m.blendedMarginPct).toBeCloseTo(1_983_600 / 2_000_000, 8)
  })
  it('no rates → zero cost, 100% margin, and never negative', () => {
    const m0 = marginTotals(state)
    expect(m0.weightedCost).toBe(0)
    expect(m0.bookedCost).toBe(0)
    expect(m0.blendedMarginPct).toBe(1)
  })
})

describe('energyUtilization cost — per person, revenue-consistent weighting', () => {
  const u = energyUtilization(costState, WEEKS)
  const alice = u.find((x) => x.person.id === 'p-alice')!
  const bob = u.find((x) => x.person.id === 'p-bob')!
  it('Alice = O1 5000 (signed) + O2 2500 (0.5×) = 7,500', () => {
    expect(alice.cost).toBeCloseTo(7500, 6)
  })
  it('Bob = O2 only: 0.6 × 3000 × 0.5 = 900 (internal O3 excluded)', () => {
    expect(bob.cost).toBeCloseTo(900, 6)
  })
  it('per-person cost never exceeds the un-weighted staffing spend', () => {
    for (const x of u) expect(x.cost).toBeGreaterThanOrEqual(0)
  })
})

// ===========================================================================
// PER-PERSON TARGET UTILIZATION — each person's own target, else the global.
// ===========================================================================
describe('per-person target utilization', () => {
  it('personTarget: own targetUtil wins, else the global falls through', () => {
    expect(personTarget(roster[0], 0.8)).toBe(0.8) // Alice has no targetUtil
    expect(personTarget({ ...roster[0], targetUtil: 0.5 }, 0.8)).toBe(0.5)
    expect(personTarget({ ...roster[0], targetUtil: 0 }, 0.8)).toBe(0) // 0 is a real target, not "unset"
  })

  it('rosterUtilization row.target = own target, or the global fallback', () => {
    const st: ForecastState = { ...state, roster: [{ ...roster[0], targetUtil: 0.5 }, roster[1], roster[2]] }
    const rows = rosterUtilization(st, WEEKS, 0.8)
    expect(rows.find((r) => r.person.id === 'p-alice')!.target).toBe(0.5) // own
    expect(rows.find((r) => r.person.id === 'p-bob')!.target).toBe(0.8) // global fallback
  })

  it('underWeeks is measured against the PERSON’s target, not the global', () => {
    // One person, capacity 1.0, booked 0.6 FTE (signed → certain) for 4 weeks:
    // util = 0.6 every week. Under an 80% target (0.6 < 0.8), on a 50% target.
    const p: Person = { id: 'p-x', name: 'X', group: 'energy', level: '', title: '', role: 'R', capacity: 1.0 }
    const oppX: Opportunity = {
      id: 'ox', name: 'x', client: '', type: 'external', booking: 'signed', stageId: 'closed',
      dealValue: 0, startWeek: '2026-01-05', durationWeeks: 4,
      assignments: [{ id: 'a', personId: 'p-x', role: 'R', group: 'energy', fte: { '0': 0.6, '1': 0.6, '2': 0.6, '3': 0.6 } }],
    }
    const base: ForecastState = { roster: [p], stages, opportunities: [oppX], snapshots: [], editor: 't' }
    // global 80% → all 4 weeks under
    expect(rosterUtilization(base, WEEKS, 0.8)[0].underWeeks).toBe(4)
    // personal 50% target → none under (0.6 ≥ 0.5)
    const withTarget: ForecastState = { ...base, roster: [{ ...p, targetUtil: 0.5 }] }
    const row = rosterUtilization(withTarget, WEEKS, 0.8)[0]
    expect(row.target).toBe(0.5)
    expect(row.underWeeks).toBe(0)
  })
})

// ===========================================================================
// WHERE OUR TIME GOES — team FTE-weeks split by work type (expected-weighted).
// Golden: o1 signed → 3.0 FTE-wk, o2 forecast@50% → 1.6×0.5 = 0.8, o3 internal
// → 0.5. Total expected = 4.3.
// ===========================================================================
describe('timeSplitByWorkType + work/customer helpers', () => {
  it('defaults: everything is billable, existing customer', () => {
    expect(oppWorkType(opportunities[0])).toBe('billable')
    expect(oppCustomerType(opportunities[0])).toBe('existing')
    expect(oppWorkType({ ...opportunities[0], workType: 'ip' })).toBe('ip')
    expect(oppCustomerType({ ...opportunities[0], customerType: 'new' })).toBe('new')
  })
  it('with no tags, all time is billable (expected FTE-weeks)', () => {
    const { slices, total } = timeSplitByWorkType(state, WEEKS)
    expect(total).toBeCloseTo(4.3, 6)
    expect(slices.find((s) => s.workType === 'billable')!.fteWeeks).toBeCloseTo(4.3, 6)
    expect(slices.find((s) => s.workType === 'ip')!.fteWeeks).toBe(0)
    expect(slices.find((s) => s.workType === 'partner')!.fteWeeks).toBe(0)
  })
  it('buckets each project by its work type, expected-weighted', () => {
    const st: ForecastState = {
      ...state,
      opportunities: [
        { ...opportunities[0], workType: 'billable' }, // signed → 3.0
        { ...opportunities[1], workType: 'ip' }, // forecast 50% → 0.8
        { ...opportunities[2], workType: 'partner' }, // internal → 0.5
      ],
    }
    const { slices } = timeSplitByWorkType(st, WEEKS)
    const g = (w: string) => slices.find((s) => s.workType === w)!.fteWeeks
    expect(g('billable')).toBeCloseTo(3.0, 6)
    expect(g('ip')).toBeCloseTo(0.8, 6)
    expect(g('partner')).toBeCloseTo(0.5, 6)
    // shares sum to 1
    expect(slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 6)
  })
})

// ===========================================================================
// PIPELINE BY CUSTOMER TYPE — new vs existing × booked vs anticipated.
// ===========================================================================
describe('pipelineByCustomerType', () => {
  it('defaults to existing; internal excluded; booked vs anticipated split', () => {
    const rows = pipelineByCustomerType(state)
    const ex = rows.find((r) => r.customerType === 'existing')!
    const nw = rows.find((r) => r.customerType === 'new')!
    // o1 signed $1.0M (booked), o2 forecast 50% of $2.0M = $1.0M (anticipated), o3 internal excluded
    expect(ex.booked).toBe(1_000_000)
    expect(ex.anticipated).toBeCloseTo(1_000_000, 6)
    expect(ex.count).toBe(2)
    expect(nw.count).toBe(0)
    expect(nw.booked + nw.anticipated).toBe(0)
  })
  it('respects the customerType tag', () => {
    const st: ForecastState = {
      ...state,
      opportunities: [{ ...opportunities[0], customerType: 'new' }, opportunities[1], opportunities[2]],
    }
    const rows = pipelineByCustomerType(st)
    expect(rows.find((r) => r.customerType === 'new')!.booked).toBe(1_000_000) // o1 → new
    expect(rows.find((r) => r.customerType === 'existing')!.anticipated).toBeCloseTo(1_000_000, 6) // o2 stays
  })
})

// Sanity: the week helpers the whole model rests on.
describe('week helpers', () => {
  it('mondayOf snaps any day to its Monday; addWeeks steps 7 days', () => {
    expect(dateKey(mondayOf(new Date(2026, 0, 7)))).toBe('2026-01-05') // Wed → Mon
    expect(addWeeks('2026-01-05', 1)).toBe('2026-01-12')
    expect(weekKeyOf(new Date(2026, 0, 8))).toBe('2026-01-05') // Thu → that week's Monday
  })
})
