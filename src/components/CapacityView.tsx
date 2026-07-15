import { useMemo, useState, type CSSProperties } from 'react'
import { useStore } from '../store/useStore'
import type { ForecastState } from '../types'
import { activeHorizonWeeks, horizon, roleDemandVsCapacity } from '../lib/analytics'
import type { RoleCapacityCell, RoleCapacityRow } from '../lib/analytics'
import { isoWeekNum, parseKey, weekLabel } from '../lib/weeks'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Blue = spare capacity (room), green = well-used, orange = short (demand > capacity).
const SPARE = '91, 140, 255'
const OK = '46, 176, 120'
const SHORT = '224, 114, 66'

/** Fill = demand ÷ capacity. Capacity 0 with demand = fully short. */
function fillOf(c: RoleCapacityCell): number {
  if (c.capacity > 0) return c.demand / c.capacity
  return c.demand > 0 ? 1.5 : 0
}
function cellStyle(c: RoleCapacityCell, target: number): CSSProperties {
  if (c.demand <= 0 && c.capacity <= 0) return {}
  const f = fillOf(c)
  const rgb = f > 1.02 ? SHORT : f < target ? SPARE : OK
  // stronger as it approaches / exceeds capacity
  const alpha = 0.14 + 0.5 * Math.min(1.4, f)
  return { background: `rgba(${rgb}, ${alpha.toFixed(3)})` }
}

/** Aggregate weekly cells into one (monthly view): demand averaged, capacity constant. */
function aggCells(cells: RoleCapacityCell[]): RoleCapacityCell {
  const capacity = cells[0]?.capacity ?? 0
  const demand = cells.reduce((s, c) => s + c.demand, 0) / (cells.length || 1)
  return { demand, capacity, short: Math.max(0, demand - capacity) }
}

export function CapacityView() {
  const roster = useStore((s) => s.roster)
  const stages = useStore((s) => s.stages)
  const opportunities = useStore((s) => s.opportunities)
  const snapshots = useStore((s) => s.snapshots)
  const setView = useStore((s) => s.setView)
  const target = useStore((s) => s.utilizationTarget)

  const [mode, setMode] = useState<'expected' | 'planned'>('expected')
  const [grain, setGrain] = useState<'week' | 'month'>('week')
  const colW = grain === 'month' ? 60 : 42

  const state = useMemo<ForecastState>(
    () => ({ roster, stages, opportunities, snapshots, editor: '' }),
    [roster, stages, opportunities, snapshots],
  )
  // The demand horizon (now → last opportunity end, min 16 weeks) — no dead far-future.
  const weeks = useMemo(() => horizon(opportunities).weeks, [opportunities])
  const statsWin = useMemo(() => activeHorizonWeeks(state, weeks), [state, weeks])
  const rows = useMemo(() => roleDemandVsCapacity(state, weeks, mode, statsWin), [state, weeks, mode, statsWin])

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

  const cols =
    grain === 'month'
      ? monthGroups.map((g) => ({ top: MONTHS[g.month], bottom: `${g.idx.length}w`, title: `${MONTHS[g.month]} ${g.year}`, cell: (r: RoleCapacityRow) => aggCells(g.idx.map((i) => r.weekly[i])) }))
      : weeks.map((w, i) => ({ top: isoWeekNum(w), bottom: weekLabel(w), title: `${weekLabel(w)}, ${parseKey(w).getFullYear()}`, cell: (r: RoleCapacityRow) => r.weekly[i] }))

  const rolesShort = rows.filter((r) => r.shortWeeks > 0).length
  const totalPeakShort = rows.reduce((s, r) => s + r.peakShort, 0)
  const noCapacityRoles = rows.filter((r) => r.capacity <= 0 && r.peakDemand > 0).length
  const fmt = (n: number) => n.toFixed(1)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="hint">
        <b>Can we deliver the pipeline?</b> For every role this compares weekly <b>demand</b> (the FTE the pipeline needs)
        against your <b>roster capacity</b> for that role. Each cell is demand ÷ capacity: <b style={{ color: 'var(--blue)' }}>blue</b> = spare room,
        <b style={{ color: 'var(--good)' }}> green</b> = well used, <b style={{ color: 'var(--bad)' }}>orange</b> = <b>short</b> (demand over capacity — hire, borrow, or push the deal).
        Toggle <b>Expected</b> (risk-adjusted by close %) vs <b>Planned</b> (if every deal lands). A role with demand but nobody in the roster is all shortfall.
      </div>

      <div className="card">
        <div className="h-row">
          <h2>Demand vs capacity — by role</h2>
          <div className="row wrap" style={{ gap: 14 }}>
            <div className="seg" title="Expected = FTE × close %. Planned = raw FTE if every deal lands.">
              <button className={mode === 'expected' ? 'on' : ''} aria-pressed={mode === 'expected'} onClick={() => setMode('expected')}>Expected</button>
              <button className={mode === 'planned' ? 'on' : ''} aria-pressed={mode === 'planned'} onClick={() => setMode('planned')}>Planned</button>
            </div>
            <div className="seg">
              <button className={grain === 'week' ? 'on' : ''} aria-pressed={grain === 'week'} onClick={() => setGrain('week')}>Weekly</button>
              <button className={grain === 'month' ? 'on' : ''} aria-pressed={grain === 'month'} onClick={() => setGrain('month')}>Monthly</button>
            </div>
            <span className="ru-legend"><span className="sw" style={{ background: `rgba(${SPARE},0.6)` }} /> Spare</span>
            <span className="ru-legend"><span className="sw" style={{ background: `rgba(${OK},0.6)` }} /> Well used</span>
            <span className="ru-legend"><span className="sw" style={{ background: `rgba(${SHORT},0.6)` }} /> Short</span>
          </div>
        </div>

        <div className="kpis" style={{ marginBottom: 14 }}>
          <div className="kpi"><div className="label">Roles</div><div className="value num">{rows.length}</div></div>
          <div className="kpi"><div className="label">Roles short</div><div className="value num" style={{ color: rolesShort ? 'var(--bad)' : 'var(--good)' }}>{rolesShort}</div><div className="delta flat">{mode} · demand &gt; capacity</div></div>
          <div className="kpi"><div className="label">Total peak shortfall</div><div className="value num" style={{ color: totalPeakShort > 0.05 ? 'var(--bad)' : 'var(--good)' }}>{fmt(totalPeakShort)}</div><div className="delta flat">FTE across roles</div></div>
          <div className="kpi"><div className="label">Roles with no capacity</div><div className="value num" style={{ color: noCapacityRoles ? 'var(--warn)' : 'var(--good)' }}>{noCapacityRoles}</div><div className="delta flat">demand, nobody staffed</div></div>
        </div>

        {rows.length === 0 ? (
          <div className="empty">No roles yet — staff people or role lines on opportunities in the timeline.</div>
        ) : (
          <div className="util-grid">
            <table style={{ width: 268 + cols.length * colW }}>
              <colgroup>
                <col style={{ width: 268 }} />
                {cols.map((_, i) => (<col key={i} style={{ width: colW }} />))}
              </colgroup>
              <thead>
                <tr>
                  <th className="ru-lab">Role · capacity / gap</th>
                  {cols.map((c, i) => (
                    <th key={i} className="ru-wk" title={c.title}>
                      <span className="wknum">{c.top}</span>
                      <span className="wkdate">{c.bottom}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.group}:${r.role}`}>
                    <td className={`ru-lab team-${r.group}`}>
                      <div className="ru-name">
                        {r.role}
                        <span className="faint"> {r.group === 'energy' ? 'Energy' : 'Delivery'} · {r.people} {r.people === 1 ? 'person' : 'people'} · cap {fmt(r.capacity)}</span>
                      </div>
                      <div className="ru-stats">
                        <span>peak demand <b>{fmt(r.peakDemand)}</b></span>
                        {r.shortWeeks > 0 ? (
                          <span className="ru-over">short {r.shortWeeks}w · peak {fmt(r.peakShort)}</span>
                        ) : (
                          <span className="faint">covered</span>
                        )}
                      </div>
                    </td>
                    {cols.map((c, i) => {
                      const cell = c.cell(r)
                      const f = fillOf(cell)
                      const isShort = cell.short > 1e-9 || (cell.capacity <= 0 && cell.demand > 0)
                      return (
                        <td
                          key={i}
                          className="ru-cell"
                          style={cellStyle(cell, target)}
                          title={cell.demand > 0 || cell.capacity > 0
                            ? `${c.title}: demand ${fmt(cell.demand)} FTE vs capacity ${fmt(cell.capacity)}${cell.capacity > 0 ? ` (${Math.round(f * 100)}%)` : ''}${isShort ? ` — SHORT ${fmt(cell.capacity > 0 ? cell.short : cell.demand)} FTE` : ''}`
                            : `${c.title}: no demand`}
                        >
                          {cell.demand > 0 ? (
                            <span className={isShort ? 'ru-over-num' : ''}>{cell.capacity > 0 ? Math.round(f * 100) : fmt(cell.demand)}{isShort ? '!' : ''}</span>
                          ) : null}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          Numbers are demand as a % of that role's capacity (or the raw FTE when there's no one staffed). Fix a shortfall by
          adding people in the <button className="linklike" style={{ color: 'var(--blue)', fontWeight: 500 }} onClick={() => setView('roster')}>Roster</button> or
          rebalancing FTE in the <button className="linklike" style={{ color: 'var(--blue)', fontWeight: 500 }} onClick={() => setView('opportunities')}>Opportunities timeline</button>.
        </div>
      </div>
    </div>
  )
}
