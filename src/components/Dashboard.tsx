import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import type { ForecastState } from '../types'
import {
  committedTotal,
  demandByWeek,
  energyUtilization,
  funnelCounts,
  horizon,
  personLoads,
  revenueTotals,
  rolesImpacted,
  totals,
  weightedTotal,
} from '../lib/analytics'
import { stageName } from '../lib/funnel'
import { weekLabel } from '../lib/weeks'
import { fmtMoney, fmtPct } from '../lib/format'
import { HBars, Sparkline, WeeklyDemandChart } from './charts'

function Delta({ now, was, unit = '' }: { now: number; was: number | null; unit?: string }) {
  if (was == null) return <div className="delta flat">— no prior snapshot</div>
  const d = now - was
  const cls = d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat'
  const sign = d > 0 ? '+' : ''
  return (
    <div className={`delta ${cls}`}>
      {sign}
      {Math.abs(d) < 10 ? d.toFixed(1) : Math.round(d)}
      {unit} vs last snapshot
    </div>
  )
}

export function Dashboard() {
  const opportunities = useStore((s) => s.opportunities)
  const stages = useStore((s) => s.stages)
  const roster = useStore((s) => s.roster)
  const snapshots = useStore((s) => s.snapshots)
  const weightedView = useStore((s) => s.weightedView)
  const setWeightedView = useStore((s) => s.setWeightedView)

  const state = useMemo<ForecastState>(
    () => ({ roster, stages, opportunities, snapshots, editor: '' }),
    [roster, stages, opportunities, snapshots],
  )

  const { weeks } = useMemo(() => horizon(opportunities), [opportunities])
  const demand = useMemo(() => demandByWeek(state, weeks), [state, weeks])
  const t = useMemo(() => totals(demand), [demand])
  const funnel = useMemo(() => funnelCounts(state), [state])
  const roles = useMemo(() => rolesImpacted(state), [state])
  const loads = useMemo(() => personLoads(state, weeks), [state, weeks])

  const peak = demand.reduce(
    (acc, d) => {
      const c = committedTotal(d)
      const w = weightedTotal(d)
      if (c > acc.c) acc.c = c
      if (w > acc.w) {
        acc.w = w
        acc.wWeek = d.week
      }
      return acc
    },
    { c: 0, w: 0, wWeek: weeks[0] },
  )

  const over = loads.filter((l) => l.overWeeks.length > 0)
  const last = snapshots.length ? snapshots[snapshots.length - 1] : null

  // Utilization = the headline metric; revenue next.
  const utils = useMemo(() => energyUtilization(state, weeks), [state, weeks])
  const avgPeak = utils.length ? utils.reduce((a, u) => a + u.peakPct, 0) / utils.length : 0
  const rev = useMemo(() => revenueTotals(state), [state])

  const energyRoles = roles.filter((r) => r.group === 'energy').map((r) => ({ label: r.role, value: r.weighted }))
  const deliveryRoles = roles.filter((r) => r.group === 'delivery').map((r) => ({ label: r.role, value: r.weighted }))

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Utilization — headline metrics */}
      <div className="section-title" style={{ margin: 0 }}>Energy team utilization</div>
      <div className="kpis">
        <div className="kpi">
          <div className="label">Avg peak utilization</div>
          <div className="value num" style={{ color: avgPeak > 1 ? 'var(--warn)' : 'var(--blue)' }}>{fmtPct(avgPeak)}</div>
          <div className="delta flat">{utils.length} energy people</div>
        </div>
        <div className="kpi">
          <div className="label">Over-allocated</div>
          <div className="value num" style={{ color: over.length ? 'var(--warn)' : 'var(--good)' }}>{over.length}</div>
          <div className="delta flat">{over.length ? 'above capacity' : 'all within capacity'}</div>
        </div>
        <div className="kpi">
          <div className="label">Weighted forecast · FTE-weeks</div>
          <div className="value num">{t.weighted.toFixed(1)}</div>
          <Delta now={t.weighted} was={last?.weightedFte ?? null} />
        </div>
        <div className="kpi">
          <div className="label">Peak weighted week</div>
          <div className="value num">{peak.w.toFixed(1)}</div>
          <div className="delta flat">{weekLabel(peak.wWeek)} · {peak.c.toFixed(1)} signed</div>
        </div>
      </div>

      {/* Revenue — next */}
      <div className="section-title" style={{ margin: '4px 0 0' }}>Revenue pulled through</div>
      <div className="kpis">
        <div className="kpi">
          <div className="label">Weighted pull-through</div>
          <div className="value num" style={{ color: 'var(--blue)' }}>{fmtMoney(rev.weighted)}</div>
          <div className="delta flat">{rev.forecastCount} forecast deals</div>
        </div>
        <div className="kpi">
          <div className="label">Signed / booked</div>
          <div className="value num" style={{ color: 'var(--good)' }}>{fmtMoney(rev.booked)}</div>
          <div className="delta flat">{rev.signedCount} signed</div>
        </div>
        <div className="kpi">
          <div className="label">Pipeline value</div>
          <div className="value num">{fmtMoney(rev.tcv)}</div>
          <div className="delta flat">{opportunities.length} opportunities</div>
        </div>
        <div className="kpi">
          <div className="label">Blended value</div>
          <div className="value num">{fmtMoney(rev.blended)}</div>
          <div className="delta flat">weighted + booked</div>
        </div>
      </div>

      {/* Weekly demand */}
      <div className="card">
        <div className="h-row">
          <h2>Weekly FTE demand</h2>
          <div className="row wrap" style={{ gap: 12, justifyContent: 'flex-end' }}>
            <div className="legend">
              <span><span className="swatch energy" /> Energy</span>
              <span><span className="swatch delivery" /> Delivery</span>
              <span style={{ color: 'var(--text-faint)' }}>--- {weightedView ? 'signed' : 'weighted forecast'}</span>
            </div>
            <div className="seg" role="tablist">
              <button className={weightedView ? 'on' : ''} onClick={() => setWeightedView(true)}>Weighted forecast</button>
              <button className={!weightedView ? 'on' : ''} onClick={() => setWeightedView(false)}>Signed</button>
            </div>
          </div>
        </div>
        {opportunities.length === 0 ? (
          <div className="empty">No opportunities yet. Add one under the Opportunities tab.</div>
        ) : (
          <WeeklyDemandChart demand={demand} mode={weightedView ? 'weighted' : 'committed'} />
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {/* Funnel */}
        <div className="card">
          <h2>Funnel by stage</h2>
          <table className="sheet">
            <tbody>
              {funnel.map((f) => {
                const max = Math.max(1, ...funnel.map((x) => x.count))
                const st = stages.find((s) => s.id === f.stageId)
                return (
                  <tr key={f.stageId}>
                    <td style={{ width: 120 }}>{stageName(stages, f.stageId)}</td>
                    <td className="faint num" style={{ width: 44 }}>{Math.round((st?.probability ?? 0) * 100)}%</td>
                    <td>
                      <div className="bar-track">
                        <div style={{ width: `${(f.count / max) * 100}%`, height: '100%', background: 'var(--grad)' }} />
                      </div>
                    </td>
                    <td className="num" style={{ width: 30 }}>{f.count}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Capacity / over-allocation */}
        <div className="card">
          <div className="h-row"><h2>Capacity watch</h2>
            {over.length === 0 && <span className="chip good">All within capacity</span>}
          </div>
          {loads.length === 0 ? (
            <div className="empty">Assign named energy-vertical people to see capacity.</div>
          ) : (
            <table className="sheet">
              <thead>
                <tr><th>Person</th><th className="num">Peak</th><th className="num">Cap</th><th>Status</th></tr>
              </thead>
              <tbody>
                {loads.slice(0, 8).map((l) => (
                  <tr key={l.person.id}>
                    <td>{l.person.name}<span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>{l.person.level}</span></td>
                    <td className="num">{l.peakCommitted.toFixed(1)}</td>
                    <td className="num faint">{l.person.capacity.toFixed(1)}</td>
                    <td>
                      {l.overWeeks.length > 0 ? (
                        <span className="chip warn" title={l.overWeeks.map(weekLabel).join(', ')}>
                          ! over {l.overWeeks.length} week{l.overWeeks.length > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="faint" style={{ fontSize: 12 }}>ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Roles impacted */}
        <div className="card">
          <h2>Energy roles impacted · weighted FTE-weeks</h2>
          <HBars items={energyRoles} color="var(--energy)" />
        </div>
        <div className="card">
          <h2>Delivery roles impacted · weighted FTE-weeks</h2>
          <HBars items={deliveryRoles} color="var(--delivery)" />
        </div>
      </div>

      {/* Trends */}
      <div className="card">
        <div className="h-row">
          <h2>Trends across snapshots</h2>
          <span className="hint">{snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'} · take one each week to build the trend</span>
        </div>
        {snapshots.length < 2 ? (
          <div className="hint">
            Take a snapshot now, then again next week — deltas and these sparklines populate automatically.
            Each snapshot is also a git commit when you Save to your repo folder.
          </div>
        ) : (
          <div className="row wrap" style={{ gap: 32 }}>
            <div>
              <div className="section-title">Opportunities</div>
              <Sparkline points={snapshots.map((s) => s.opportunityCount)} color="var(--blue)" />
            </div>
            <div>
              <div className="section-title">Weighted FTE-weeks</div>
              <Sparkline points={snapshots.map((s) => s.weightedFte)} color="var(--purple)" />
            </div>
            <div>
              <div className="section-title">Committed FTE-weeks</div>
              <Sparkline points={snapshots.map((s) => s.committedFte)} color="var(--text-dim)" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
