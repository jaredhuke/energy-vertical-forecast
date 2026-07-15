import { useMemo, type CSSProperties } from 'react'
import { useStore } from '../store/useStore'
import type { ForecastState, Opportunity, Person } from '../types'
import {
  oppBookedRevenue,
  oppWeightedRevenue,
  personTarget,
  rosterUtilization,
  utilBand,
} from '../lib/analytics'
import { effectiveProbability, stageName } from '../lib/funnel'
import { isoWeekNum, weekLabel, weeksThroughYear } from '../lib/weeks'
import { fmtMoneyFull, fmtPct } from '../lib/format'

const BAND_RGB: Record<'over' | 'on' | 'under', string> = {
  over: '246, 132, 58', // bright warm orange (matches the heatmap; low vibration)
  on: '46, 176, 120',
  under: '91, 140, 255',
}
function cellStyle(util: number, certainty: number, committed: number, target: number): CSSProperties {
  if (committed === 0) return {}
  const rgb = BAND_RGB[utilBand(util, target)]
  return { background: `rgba(${rgb}, ${(0.14 + 0.62 * certainty).toFixed(3)})` }
}

/** Everything about one person: profile, forward (expected) utilization week by
 *  week, per-project breakdown, and the metrics that matter. */
export function PersonDetail({ person, onClose }: { person: Person; onClose?: () => void }) {
  const roster = useStore((s) => s.roster)
  const stages = useStore((s) => s.stages)
  const opportunities = useStore((s) => s.opportunities)
  const target = useStore((s) => s.utilizationTarget)
  const setView = useStore((s) => s.setView)
  const selectOpportunity = useStore((s) => s.selectOpportunity)
  const selectPerson = useStore((s) => s.selectPerson)

  const state = useMemo<ForecastState>(
    () => ({ roster, stages, opportunities, snapshots: [], editor: '' }),
    [roster, stages, opportunities],
  )
  const weeks = useMemo(() => weeksThroughYear(new Date().getFullYear() + 1), [])
  const row = useMemo(
    () => rosterUtilization(state, weeks, target).find((r) => r.person.id === person.id),
    [state, weeks, target, person.id],
  )
  const pTarget = row?.target ?? personTarget(person, target) // this person's target (own, or global fallback)
  const targetPct = Math.round(pTarget * 100)

  // Projects this person is staffed on, with their contribution.
  const projects = useMemo(() => {
    const rows: {
      opp: Opportunity
      peakFte: number
      fteWeeks: number
      weighted: number
      booked: number
    }[] = []
    for (const o of opportunities) {
      const mine = o.assignments.filter((a) => a.personId === person.id)
      if (mine.length === 0) continue
      let peakFte = 0
      let fteWeeks = 0
      for (const a of mine) {
        for (let off = 0; off < o.durationWeeks; off++) {
          const fte = a.fte[String(off)] || 0
          fteWeeks += fte
          if (fte > peakFte) peakFte = fte
        }
      }
      rows.push({ opp: o, peakFte, fteWeeks, weighted: oppWeightedRevenue(state, o), booked: oppBookedRevenue(o) })
    }
    return rows.sort((a, b) => b.fteWeeks - a.fteWeeks)
  }, [opportunities, person.id, state])

  const influencedWeighted = projects.reduce((s, p) => s + p.weighted, 0)
  const influencedBooked = projects.reduce((s, p) => s + p.booked, 0)

  const openProject = (id: string) => {
    selectPerson(null)
    selectOpportunity(id)
    setView('opportunities')
  }

  return (
    <div className="card">
      <div className="h-row">
        <h2>
          {person.name}
          <span className="faint" style={{ marginLeft: 10, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            {person.role} · {person.level} · {person.group === 'energy' ? 'Energy' : 'Delivery'} · capacity {person.capacity.toFixed(1)}
          </span>
          <span style={{ marginLeft: 10, fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: 'var(--blue)' }}>
            · target {targetPct}%{person.targetUtil == null && <span className="faint" style={{ fontWeight: 400 }}> (team default)</span>}
          </span>
        </h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm" onClick={() => { selectPerson(null); setView('roster') }}>Edit in roster</button>
          {onClose && <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>×</button>}
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="label">Peak forward utilization</div>
          <div className="value num" style={{ color: (row?.peakUtil ?? 0) > 1.02 ? 'var(--warn)' : (row?.peakUtil ?? 0) < pTarget ? 'var(--blue)' : 'var(--good)' }}>{fmtPct(row?.peakUtil ?? 0)}</div>
          <div className="delta flat">expected, next 12 months</div>
        </div>
        <div className="kpi">
          <div className="label">Average forward utilization</div>
          <div className="value num" style={{ color: (row?.avgUtil ?? 0) < pTarget ? 'var(--blue)' : (row?.avgUtil ?? 0) > 1.02 ? 'var(--warn)' : 'var(--good)' }}>{fmtPct(row?.avgUtil ?? 0)}</div>
          <div className="delta flat">vs {targetPct}% target</div>
        </div>
        <div className="kpi">
          <div className="label">Over / under / idle weeks</div>
          <div className="value num" style={{ fontSize: 20 }}>
            <span style={{ color: 'var(--warn)' }}>{row?.overWeeks ?? 0}</span> ·{' '}
            <span style={{ color: 'var(--blue)' }}>{row?.underWeeks ?? 0}</span> ·{' '}
            <span className="faint">{row?.idleWeeks ?? 0}</span>
          </div>
          <div className="delta flat">next 12 months</div>
        </div>
        <div className="kpi">
          <div className="label">Influence (weighted / booked)</div>
          <div className="value num" style={{ fontSize: 18 }} title={`${fmtMoneyFull(influencedWeighted)} weighted · ${fmtMoneyFull(influencedBooked)} booked`}>
            <span style={{ color: 'var(--blue)' }}>{fmtMoneyFull(influencedWeighted)}</span>
          </div>
          <div className="delta flat">{fmtMoneyFull(influencedBooked)} booked · {projects.length} projects</div>
        </div>
      </div>

      <div className="section-title">Forward utilization — expected, week by week</div>
      {row ? (
        <div className="util-grid" style={{ marginTop: 6 }}>
          <table style={{ width: weeks.length * 40 }}>
            <thead>
              <tr>
                {weeks.map((w, i) => (
                  <th key={i} className="ru-wk"><span className="wknum">{isoWeekNum(w)}</span><span className="wkdate">{weekLabel(w)}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {row.weekly.map((c, i) => (
                  <td
                    key={i}
                    className={`ru-cell${c.util > 1.02 ? ' over' : ''}`}
                    style={cellStyle(c.util, c.certainty, c.committed, pTarget)}
                    title={c.committed ? `${weekLabel(weeks[i])}: ${Math.round(c.util * 100)}% forward · ${c.committed.toFixed(2)} FTE at ${Math.round(c.certainty * 100)}% likely` : `${weekLabel(weeks[i])}: idle`}
                  >
                    {c.committed > 0 ? <span className={c.util > 1.02 ? 'ru-over-num' : ''}>{Math.round(c.util * 100)}</span> : null}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">Not staffed on anything yet.</div>
      )}
      <div className="hint" style={{ marginTop: 6 }}>Expected utilization = FTE × close % ÷ capacity. Colour = band vs target; strength = booking certainty.</div>

      <div className="section-title" style={{ marginTop: 18 }}>Projects ({projects.length})</div>
      {projects.length === 0 ? (
        <div className="empty">No projects.</div>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>Project</th><th>Type / stage</th><th className="num">Close %</th>
              <th className="num">Peak FTE</th><th className="num">FTE-weeks</th><th className="num">Weighted $</th><th className="num">Booked $</th>
            </tr>
          </thead>
          <tbody>
            {projects.map(({ opp, peakFte, fteWeeks, weighted, booked }) => (
              <tr key={opp.id}>
                <td><button className="linklike" style={{ color: 'var(--blue)', fontWeight: 550 }} onClick={() => openProject(opp.id)}>{opp.name}</button></td>
                <td className="faint">
                  {opp.type === 'internal'
                    ? 'Internal'
                    : `${stageName(stages, opp.stageId)}${opp.booking === 'signed' ? ' · signed' : ''}`}
                </td>
                <td className="num faint">{opp.type === 'internal' ? '100%' : `${Math.round(effectiveProbability(stages, opp.stageId, opp.probabilityOverride) * 100)}%`}</td>
                <td className="num">{peakFte.toFixed(2)}</td>
                <td className="num">{fteWeeks.toFixed(1)}</td>
                <td className="num" style={{ color: weighted ? 'var(--blue)' : 'var(--text-faint)' }}>{fmtMoneyFull(weighted)}</td>
                <td className="num" style={{ color: booked ? 'var(--good)' : 'var(--text-faint)' }}>{fmtMoneyFull(booked)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="hint" style={{ marginTop: 8 }}>Weighted / booked $ is <i>influence</i> — the whole deal counts for everyone staffed on it (see Revenue). Prob is the deal's close %.</div>
    </div>
  )
}
