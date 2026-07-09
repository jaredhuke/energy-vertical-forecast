import { useMemo, type CSSProperties } from 'react'
import { useStore } from '../store/useStore'
import type { ForecastState } from '../types'
import { rosterUtilization, utilBand } from '../lib/analytics'
import type { RosterWeekCell } from '../lib/analytics'
import { isoWeekNum, weekLabel, weeksToYearEnd } from '../lib/weeks'
import { fmtPct } from '../lib/format'

const BAND_RGB: Record<'over' | 'on' | 'under', string> = {
  over: '229, 90, 90', // red — over capacity
  on: '46, 176, 120', // green — at capacity
  under: '91, 140, 255', // blue — spare capacity
}

/** Cell background: hue = over/under, opacity = forecast certainty (close %). */
function cellStyle(cell: RosterWeekCell): CSSProperties {
  if (cell.committed === 0) return {}
  const rgb = BAND_RGB[utilBand(cell.util)]
  const alpha = 0.12 + 0.62 * cell.certainty
  return { background: `rgba(${rgb}, ${alpha.toFixed(3)})` }
}

export function UtilizationView() {
  const roster = useStore((s) => s.roster)
  const stages = useStore((s) => s.stages)
  const opportunities = useStore((s) => s.opportunities)
  const snapshots = useStore((s) => s.snapshots)
  const setView = useStore((s) => s.setView)

  const state = useMemo<ForecastState>(
    () => ({ roster, stages, opportunities, snapshots, editor: '' }),
    [roster, stages, opportunities, snapshots],
  )
  const weeks = useMemo(() => weeksToYearEnd(), [])
  const rows = useMemo(() => rosterUtilization(state, weeks), [state, weeks])

  const overPeople = rows.filter((r) => r.peakUtil > 1.05).length
  const rosterAvg = rows.length ? rows.reduce((s, r) => s + r.avgUtil, 0) / rows.length : 0

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="hint">
        Utilization is the <b>people × projects</b> view — the transpose of the Opportunities timeline (edit FTE there;
        this reads from the same data). Every person's weekly forecast utilization through year-end: cell colour affords
        over- vs under-booking; colour strength shows how certain the booking is (funnel close %, signed = 100%).
      </div>

      <div className="card">
        <div className="h-row">
          <h2>Utilization heatmap — through year end</h2>
          <div className="row" style={{ gap: 14 }}>
            <span className="ru-legend"><span className="sw" style={{ background: `rgba(${BAND_RGB.under},0.6)` }} /> Under</span>
            <span className="ru-legend"><span className="sw" style={{ background: `rgba(${BAND_RGB.on},0.6)` }} /> On target</span>
            <span className="ru-legend"><span className="sw" style={{ background: `rgba(${BAND_RGB.over},0.6)` }} /> Over</span>
            <span className="faint" style={{ fontSize: 11 }}>opacity = close-% certainty</span>
          </div>
        </div>

        <div className="kpis" style={{ marginBottom: 14 }}>
          <div className="kpi"><div className="label">People</div><div className="value num">{rows.length}</div></div>
          <div className="kpi"><div className="label">Roster avg utilization</div><div className="value num" style={{ color: 'var(--blue)' }}>{fmtPct(rosterAvg)}</div></div>
          <div className="kpi"><div className="label">Over-allocated (peak &gt;100%)</div><div className="value num" style={{ color: overPeople ? 'var(--warn)' : 'var(--good)' }}>{overPeople}</div></div>
          <div className="kpi"><div className="label">Weeks shown</div><div className="value num">{weeks.length}</div></div>
        </div>

        {rows.length === 0 ? (
          <div className="empty">No people in the roster yet — add some under the Roster tab.</div>
        ) : (
          <div className="util-grid">
            <table style={{ width: 268 + weeks.length * 40 }}>
              <colgroup>
                <col style={{ width: 268 }} />
                {weeks.map((w) => (
                  <col key={w} style={{ width: 40 }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="ru-lab">Person · avg / over / under</th>
                  {weeks.map((w) => (
                    <th key={w} className="ru-wk">
                      <span className="wknum">{isoWeekNum(w)}</span>
                      <span className="wkdate">{weekLabel(w)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const avgBand = utilBand(r.avgUtil)
                  return (
                    <tr key={r.person.id}>
                      <td className={`ru-lab team-${r.person.group}`}>
                        <div className="ru-name">
                          {r.person.name}
                          <span className="faint"> {r.person.role} · {r.person.level} · cap {r.person.capacity.toFixed(1)}</span>
                        </div>
                        <div className="ru-stats">
                          <span>avg <b style={{ color: avgBand === 'over' ? 'var(--warn)' : avgBand === 'under' ? 'var(--blue)' : 'var(--good)' }}>{fmtPct(r.avgUtil)}</b></span>
                          <span className="ru-over">over {r.overWeeks}</span>
                          <span className="ru-under">under {r.underWeeks}</span>
                          <span className="faint">idle {r.idleWeeks}</span>
                        </div>
                      </td>
                      {r.weekly.map((cell, i) => (
                        <td key={i} className="ru-cell" style={cellStyle(cell)} title={cell.committed ? `${weekLabel(weeks[i])}: ${Math.round(cell.util * 100)}% · ${cell.committed.toFixed(2)} FTE · ${Math.round(cell.certainty * 100)}% certain` : `${weekLabel(weeks[i])}: idle`}>
                          {cell.committed > 0 ? (
                            <span className={cell.util > 1.05 ? 'ru-over-num' : ''}>{Math.round(cell.util * 100)}</span>
                          ) : null}
                        </td>
                      ))}
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
