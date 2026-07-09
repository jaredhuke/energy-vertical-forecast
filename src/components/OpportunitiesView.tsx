import { useStore } from '../store/useStore'
import { effectiveProbability, stageName } from '../lib/funnel'
import { weekLabel, isoWeekNum } from '../lib/weeks'
import type { Opportunity } from '../types'
import { OpportunityEditor } from './OpportunityEditor'

function weightedFteWeeks(o: Opportunity, prob: number): number {
  let sum = 0
  for (const a of o.assignments)
    for (let off = 0; off < o.durationWeeks; off++) sum += (a.fte[String(off)] || 0) * prob
  return sum
}

export function OpportunitiesView() {
  const opportunities = useStore((s) => s.opportunities)
  const stages = useStore((s) => s.stages)
  const selectedId = useStore((s) => s.selectedOpportunityId)
  const select = useStore((s) => s.selectOpportunity)
  const addOpportunity = useStore((s) => s.addOpportunity)

  const selected = opportunities.find((o) => o.id === selectedId) || null

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="h-row">
          <h2>Opportunities</h2>
          <button className="btn primary sm" onClick={() => addOpportunity()}>+ New opportunity</button>
        </div>
        {opportunities.length === 0 ? (
          <div className="empty">No opportunities yet — add your first pursuit.</div>
        ) : (
          <table className="sheet">
            <thead>
              <tr>
                <th>Name</th><th>Client</th><th>Stage</th><th className="num">Close</th>
                <th>Start</th><th className="num">Weeks</th><th className="num">Weighted FTE·wk</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => {
                const prob = effectiveProbability(stages, o.stageId, o.probabilityOverride)
                return (
                  <tr
                    key={o.id}
                    onClick={() => select(o.id)}
                    style={{ cursor: 'pointer', outline: o.id === selectedId ? '1px solid var(--blue)' : 'none' }}
                  >
                    <td style={{ fontWeight: 550 }}>{o.name}</td>
                    <td className="faint">{o.client || '—'}</td>
                    <td><span className="chip">{stageName(stages, o.stageId)}</span></td>
                    <td className="num">{Math.round(prob * 100)}%</td>
                    <td>{weekLabel(o.startWeek)} <span className="faint">{isoWeekNum(o.startWeek)}</span></td>
                    <td className="num">{o.durationWeeks}</td>
                    <td className="num" style={{ color: 'var(--blue)' }}>{weightedFteWeeks(o, prob).toFixed(1)}</td>
                    <td className="faint" style={{ fontSize: 12 }}>{o.updatedBy || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && <OpportunityEditor key={selected.id} opp={selected} />}
    </div>
  )
}
