import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '../store/useStore'
import type { ForecastState } from '../types'
import { opportunityEndWeek, rosterUtilization, utilBand } from '../lib/analytics'
import type { RosterUtilRow, RosterWeekCell } from '../lib/analytics'
import { isoWeekNum, parseKey, weekLabel, weeksThroughYear } from '../lib/weeks'
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
  const colW = grain === 'month' ? 60 : 40

  const state = useMemo<ForecastState>(
    () => ({ roster, stages, opportunities, snapshots, editor: '' }),
    [roster, stages, opportunities, snapshots],
  )

  // Horizon: as many future years as the screen width allows — never capped at
  // the current year. Wider screens see further; long deals extend it further.
  const cardRef = useRef<HTMLDivElement>(null)
  const [availW, setAvailW] = useState(1280)
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setAvailW(entries[0].contentRect.width))
    ro.observe(el)
    setAvailW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const throughYear = useMemo(() => {
    const now = new Date()
    const colsFit = Math.max(1, Math.floor((availW - 268) / colW))
    const weeksFit = grain === 'month' ? Math.ceil(colsFit * 4.35) : colsFit
    const fitYear = new Date(now.getFullYear(), now.getMonth(), now.getDate() + weeksFit * 7).getFullYear()
    const oppYear = opportunities.length
      ? Math.max(...opportunities.map((o) => parseKey(opportunityEndWeek(o)).getFullYear()))
      : now.getFullYear()
    return Math.max(now.getFullYear() + 1, fitYear, oppYear)
  }, [availW, colW, grain, opportunities])
  const weeks = useMemo(() => weeksThroughYear(throughYear), [throughYear])

  // Summary numbers cover the next 12 months so the multi-year grid doesn't
  // dilute averages with far-future idle weeks.
  const STATS_WEEKS = 52
  const rows = useMemo(
    () => rosterUtilization(state, weeks, target, Math.min(STATS_WEEKS, weeks.length)),
    [state, weeks, target],
  )

  // Month buckets: consecutive weeks grouped by their Monday's month + year.
  const monthGroups = useMemo(() => {
    const groups: { month: number; year: number; idx: number[] }[] = []
    weeks.forEach((w, i) => {
      const d = parseKey(w)
      const last = groups[groups.length - 1]
      if (last && last.month === d.getMonth() && last.year === d.getFullYear()) last.idx.push(i)
      else groups.push({ month: d.getMonth(), year: d.getFullYear(), idx: [i] })
    })
    return groups
  }, [weeks])

  // Year boundaries are marked: January / first-week-of-year columns show the
  // year and get a stronger left border.
  const cols =
    grain === 'month'
      ? monthGroups.map((g) => ({
          top: MONTHS[g.month],
          bottom: g.month === 0 ? String(g.year) : `${g.idx.length} weeks`,
          yearStart: g.month === 0,
          title: `${MONTHS[g.month]} ${g.year}`,
          cell: (r: RosterUtilRow) => aggCells(g.idx.map((i) => r.weekly[i])),
        }))
      : weeks.map((w, i) => {
          const d = parseKey(w)
          const yearStart = i > 0 && d.getFullYear() !== parseKey(weeks[i - 1]).getFullYear()
          return {
            top: isoWeekNum(w),
            bottom: yearStart ? String(d.getFullYear()) : weekLabel(w),
            yearStart,
            title: `${weekLabel(w)}, ${d.getFullYear()}`,
            cell: (r: RosterUtilRow) => r.weekly[i],
          }
        })

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

      <div className="card" ref={cardRef}>
        <div className="h-row">
          <h2>Utilization heatmap — through {throughYear}</h2>
          <div className="row wrap" style={{ gap: 14 }}>
            <div className="seg">
              <button className={grain === 'week' ? 'on' : ''} aria-pressed={grain === 'week'} onClick={() => setGrain('week')}>Weekly</button>
              <button className={grain === 'month' ? 'on' : ''} aria-pressed={grain === 'month'} onClick={() => setGrain('month')}>Monthly</button>
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
            <span className="ru-legend"><span className="sw" style={{ background: `rgba(${BAND_RGB.over},0.6)` }} /> Over (marked !)</span>
            <span className="faint" style={{ fontSize: 11 }}>opacity = certainty</span>
          </div>
        </div>

        <div className="kpis" style={{ marginBottom: 14 }}>
          <div className="kpi"><div className="label">People</div><div className="value num">{rows.length}</div></div>
          <div className="kpi"><div className="label">Roster average utilization</div><div className="value num" style={{ color: rosterAvg < target ? 'var(--blue)' : rosterAvg > 1.02 ? 'var(--warn)' : 'var(--good)' }}>{fmtPct(rosterAvg)}</div><div className="delta flat">target {targetPct}% · next 12 months</div></div>
          <div className="kpi"><div className="label">Below target</div><div className="value num" style={{ color: belowTarget ? 'var(--blue)' : 'var(--good)' }}>{belowTarget}</div><div className="delta flat">average under {targetPct}% · next 12 months</div></div>
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
                    <th key={i} className={`ru-wk${c.yearStart ? ' ys' : ''}`} title={c.title}>
                      <span className="wknum">{c.top}</span>
                      <span className={`wkdate${c.yearStart ? ' yr' : ''}`}>{c.bottom}</span>
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
                          <td key={i} className={`ru-cell${c.yearStart ? ' ys' : ''}`} style={cellStyle(cell, target)} title={cell.committed ? `${c.title}: ${Math.round(cell.util * 100)}%${cell.util > 1.02 ? ' — OVER CAPACITY' : ''} (target ${targetPct}%) · ${cell.committed.toFixed(2)} FTE · ${Math.round(cell.certainty * 100)}% certain` : `${c.title}: idle`}>
                            {/* over-capacity is marked by "!" + bold, not colour alone */}
                            {cell.committed > 0 ? <span className={cell.util > 1.02 ? 'ru-over-num' : ''}>{Math.round(cell.util * 100)}{cell.util > 1.02 ? '!' : ''}</span> : null}
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
          The grid runs through {throughYear} (scroll right; year boundaries are marked); the per-person averages and week
          counts cover the <b>next 12 months</b> so far-future idle weeks don't dilute them.
        </div>
      </div>
    </div>
  )
}
