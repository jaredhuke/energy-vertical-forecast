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
  utilBand,
} from './analytics'
import { addWeeks, weekKeyOf, mondayOf, dateKey } from './weeks'

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
  it('revenueByEnergyRole — deal value attributed to each staffed role (influence)', () => {
    const rows = revenueByEnergyRole(state)
    const sa = rows.find((r) => r.role === 'Solution Architect')!
    const con = rows.find((r) => r.role === 'Consultant')!
    expect(sa.deals).toBe(2) // O1 + O2
    expect(sa.people).toBe(1) // Alice
    expect(sa.weighted).toBe(1_000_000) // from O2
    expect(sa.booked).toBe(1_000_000) // from O1
    expect(con.deals).toBe(1) // O2 (O3 internal excluded)
    expect(con.weighted).toBe(1_000_000)
    expect(con.booked).toBe(0)
  })
})

describe('energyUtilization — per energy person (EXPECTED / weighted)', () => {
  const u = Object.fromEntries(energyUtilization(state, WEEKS).map((x) => [x.person.id, x]))
  it('Alice: expected weekly [0.5,0.75,0.25,0], peak 75%, avg over active 50%', () => {
    expect(u['p-alice'].weekly).toEqual([0.5, 0.75, 0.25, 0]) // W1: 0.5 signed + 0.5×50%
    expect(u['p-alice'].peakPct).toBeCloseTo(0.75, 10)
    expect(u['p-alice'].avgPct).toBeCloseTo(0.5, 10) // (0.5+0.75+0.25)/3
    expect(u['p-alice'].deals).toBe(2)
    expect(u['p-alice'].weighted).toBe(1_000_000)
    expect(u['p-alice'].booked).toBe(1_000_000)
  })
  it('Bob (cap 0.5): expected peak 100% (0.5 internal / 0.5 cap), NOT over', () => {
    expect(u['p-bob'].weekly).toEqual([0.5, 0.3, 0, 0]) // W0 internal ×1, W1 0.6×50%
    expect(u['p-bob'].peakPct).toBeCloseTo(1.0, 10) // 0.5 / 0.5
    expect(u['p-bob'].overWeeks).toBe(0) // expected never exceeds capacity
    expect(u['p-bob'].weighted).toBe(1_000_000) // O2 influence
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

// Sanity: the week helpers the whole model rests on.
describe('week helpers', () => {
  it('mondayOf snaps any day to its Monday; addWeeks steps 7 days', () => {
    expect(dateKey(mondayOf(new Date(2026, 0, 7)))).toBe('2026-01-05') // Wed → Mon
    expect(addWeeks('2026-01-05', 1)).toBe('2026-01-12')
    expect(weekKeyOf(new Date(2026, 0, 8))).toBe('2026-01-05') // Thu → that week's Monday
  })
})
