import { useMemo, useState, type CSSProperties } from 'react'
import { useStore } from '../store/useStore'
import type { ForecastState } from '../types'
import { rosterUtilization, utilBand } from '../lib/analytics'
import type { RosterUtilRow, RosterWeekCell } from '../lib/analytics'
import { isoWeekNum, parseKey, weekLabel, weeksToYearEnd } from '../lib/weeks'
import { fmtPct } from '../lib/format'

const BAND_RGB: Record<'over' | 'on' | 'under', string> = {
  over: '229, 90, 90', // red — over capacity
  on: '46, 176, 120', // green — at/above target, within capacity
  under: '91, 140, 255', // blue — below target
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Cell background: hue = band vs target, opacity = forecast certainty (close %). */
function cellStyle(cell: RosterWeekCell, target: number): CSSProperties {
  if (cell.committed === 0) return {}
  const rgb = BAND_RGB[utilBand(cell.util, target)]
  const alpha = 0.12 + 0.62 * cell.certainty
  return { background: `rgba(${rgb}, ${alpha.toFixed(3)})` }
}

/** Aggregate several weekly cells into one (for the monthly view). */
function aggCells(cells: RosterWeekCell[]): RosterWeekCell {
  const committed = cells.reduce((s, c) => s + c.committed, 0)
  const util = cells.reduce((s, c) => s + c.util, 0) / (cells.length || 1) // average weekly utilization
  const weighted = cells.reduce((s, c) => s + c.committed * c.certainty, 0)
  return { util, committed, certainty: committed > 0 ? weighted / committed : 0 }
}

export function UtilizationView() {
  const roster = useStore((s) => s.roster)
  const stages = useStore((s) => s.stages)
  const opportunities = useStore((s) => s.opportunities)
  const snapshots = useStore((s) => s.snapshots)
  const setView = useStore((s) => s.setView)
  const target = useStore((s) => s.utilizationTarget)
  const setTarget = useStore((s) => s.setUtilizationTarget)

  const [grain, setGrain] = useState<'week' | 'month'>('week')

  const state = useMemo<ForecastState>(
    () => ({ roster, stages, opportunities, snapshots, editor: '' }),
    [roster, stages, opportunities, snapshots],
  )
  const weeks = useMemo(() => weeksToYearEnd(), [])
  const rows = useMemo(() => rosterUtilization(state, weeks, target), [state, weeks, target])

  // Month buckets: consecutive weeks grouped by their Monday's month.
  const monthGroups = useMemo(() => {
    const groups: { label: string; idx: number[] }[] = []
    weeks.forEach((w, i) => {
      const label = MONTHS[parseKey(w).getMonth()]
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.idx.push(i)
      else groups.push({ label, idx: [i] })
    })
    return groups
  }, [weeks])

  const cols =
    grain === 'month'
      ? monthGroups.map((g) => ({ top: g.label, bottom: `${g.idx.length} weeks`, cell: (r: RosterUtilRow) => aggCells(g.idx.map((i) => r.weekly[i])) }))
      : weeks.map((w, i) => ({ top: isoWeekNum(w), bottom: weekLabel(w), cell: (r: RosterUtilRow) => r.weekly[i] }))
  const colW = grain === 'month' ? 60 : 40

  const overPeople = rows.filter((r) => r.peakUtil > 1.02).length
  const belowTarget = rows.filter((r) => r.avgUtil < target).length
  const rosterAvg = rows.length ? rows.reduce((s, r) => s + r.avgUtil, 0) / rows.length : 0
  const targetPct = Math.round(target * 100)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="hint">
        Utilization is the <b>people × projects</b> view — the transpose of the Opportunities timeline (edit FTE there;
        this reads from the same data, internal projects included). Bands are set against your <b>utilization target</b>:
        below target = under-utilized (blue), target→capacity = on target (green), over capacity = over-allocated (red).
        Colour strength = booking certainty (funnel close %; signed & internal = 100%).
      </div>

      <div className="card">
        <div className="h-row">
          <h2>Utilization heatmap — through year end</h2>
          <div className="row wrap" style={{ gap: 14 }}>
            <div className="seg" role="tablist">
              <button className={grain === 'week' ? 'on' : ''} onClick={() => setGrain('week')}>Weekly</button>
              <button className={grain === 'month' ? 'on' : ''} onClick={() => setGrain('month')}>Monthly</button>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="faint" style={{ fontSize: 12 }}>Target</span>
              <div className="stepper">
                <button title="−5%" onClick={() => setTarget(target - 0.05)}>−</button>
                <span className="val">{targetPct}%</span>
                <button title="+5%" onClick={() => setTarget(target + 0.05)}>+</button>
              </div>
            </div>
            <span className="ru-legend"><span className="sw" style={{ background: `rgba(${BAND_RGB.under},0.6)` }} /> Under {targetPct}%</span>
            <span className="ru-legend"><span className="sw" style={{ background: `rgba(${BAND_RGB.on},0.6)` }} /> On target</span>
            <span className="ru-legend"><span className="sw" style={{ background: `rgba(${BAND_RGB.over},0.6)` }} /> Over</span>
            <span className="faint" style={{ fontSize: 11 }}>opacity = certainty</span>
          </div>
        </div>

        <div className="kpis" style={{ marginBottom: 14 }}>
          <div className="kpi"><div className="label">People</div><div className="value num">{rows.length}</div></div>
          <div className="kpi"><div className="label">Roster average utilization</div><div className="value num" style={{ color: rosterAvg < target ? 'var(--blue)' : rosterAvg > 1.02 ? 'var(--warn)' : 'var(--good)' }}>{fmtPct(rosterAvg)}</div><div className="delta flat">target {targetPct}%</div></div>
          <div className="kpi"><div className="label">Below target</div><div className="value num" style={{ color: belowTarget ? 'var(--blue)' : 'var(--good)' }}>{belowTarget}</div><div className="delta flat">average under {targetPct}%</div></div>
          <div className="kpi"><div className="label">Over-allocated</div><div className="value num" style={{ color: overPeople ? 'var(--warn)' : 'var(--good)' }}>{overPeople}</div><div className="delta flat">peak &gt; 100%</div></div>
        </div>

        {rows.length === 0 ? (
          <div className="empty">No people in the roster yet — add some under the Roster tab.</div>
        ) : (
          <div className="util-grid">
            <table style={{ width: 268 + cols.length * colW }}>
              <colgroup>
                <col style={{ width: 268 }} />
                {cols.map((_, i) => (
                  <col key={i} style={{ width: colW }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="ru-lab">Person · average / over / under</th>
                  {cols.map((c, i) => (
                    <th key={i} className="ru-wk">
                      <span className="wknum">{c.top}</span>
                      <span className="wkdate">{c.bottom}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const avgBand = utilBand(r.avgUtil, target)
                  return (
                    <tr key={r.person.id}>
                      <td className={`ru-lab team-${r.person.group}`}>
                        <div className="ru-name">
                          {r.person.name}
                          <span className="faint"> {r.person.role} · {r.person.level} · capacity {r.person.capacity.toFixed(1)}</span>
                        </div>
                        <div className="ru-stats">
                          <span>average <b style={{ color: avgBand === 'over' ? 'var(--warn)' : avgBand === 'under' ? 'var(--blue)' : 'var(--good)' }}>{fmtPct(r.avgUtil)}</b></span>
                          <span className="ru-over">over {r.overWeeks}</span>
                          <span className="ru-under">under {r.underWeeks}</span>
                          <span className="faint">idle {r.idleWeeks}</span>
                        </div>
                      </td>
                      {cols.map((c, i) => {
                        const cell = c.cell(r)
                        return (
                          <td key={i} className="ru-cell" style={cellStyle(cell, target)} title={cell.committed ? `${c.top}: ${Math.round(cell.util * 100)}% (target ${targetPct}%) · ${cell.committed.toFixed(2)} FTE · ${Math.round(cell.certainty * 100)}% certain` : `${c.top}: idle`}>
                            {cell.committed > 0 ? <span className={cell.util > 1.02 ? 'ru-over-num' : ''}>{Math.round(cell.util * 100)}</span> : null}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          Edit allocations in the <button className="linklike" style={{ color: 'var(--blue)', fontWeight: 500 }} onClick={() => setView('opportunities')}>Opportunities timeline</button> — this view updates live.
        </div>
      </div>
    </div>
  )
}
