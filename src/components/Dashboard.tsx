import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import type { ForecastState } from '../types'
import {
  signedTotal,
  demandByWeek,
  demandStackByWeek,
  energyUtilization,
  funnelCounts,
  horizon,
  personLoads,
  revenueTotals,
  roleDemandVsCapacity,
  rolesImpacted,
  rosterUtilization,
  totals,
  unstaffedRoles,
  weightedTotal,
} from '../lib/analytics'
import { stageName } from '../lib/funnel'
import { weekLabel, weeksThroughYear } from '../lib/weeks'
import { fmtMoney, fmtMoneyFull, fmtPct } from '../lib/format'
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
  const target = useStore((s) => s.utilizationTarget)
  const setView = useStore((s) => s.setView)
  const selectPerson = useStore((s) => s.selectPerson)
  const selectOpportunity = useStore((s) => s.selectOpportunity)

  const state = useMemo<ForecastState>(
    () => ({ roster, stages, opportunities, snapshots, editor: '' }),
    [roster, stages, opportunities, snapshots],
  )

  // Staffing signals (forward/expected utilization, next 12 months).
  const utilWeeks = useMemo(() => weeksThroughYear(new Date().getFullYear() + 1), [])
  const utilRows = useMemo(
    () => rosterUtilization(state, utilWeeks, target), // expected mode, active-horizon window
    [state, utilWeeks, target],
  )
  const overUtil = utilRows.filter((r) => r.peakUtil > 1.02)
  const underUtil = utilRows.filter((r) => r.idleWeeks < utilWeeks.length && r.avgUtil < target).sort((a, b) => a.avgUtil - b.avgUtil)
  const idlePeople = utilRows.filter((r) => r.idleWeeks === utilWeeks.length)
  const unstaffed = useMemo(() => unstaffedRoles(state), [state])
  const targetPct = Math.round(target * 100)
  // Team capacity target for the demand chart: total roster capacity × target %.
  // e.g. 10 people at 1.0 capacity with an 80% target = 8.0 target FTE.
  const targetFte = useMemo(() => roster.reduce((s, p) => s + (p.capacity || 0), 0) * target, [roster, target])

  const { weeks } = useMemo(() => horizon(opportunities), [opportunities])
  const demand = useMemo(() => demandByWeek(state, weeks), [state, weeks])
  const stack = useMemo(() => demandStackByWeek(state, weeks), [state, weeks])
  const t = useMemo(() => totals(demand), [demand])
  const funnel = useMemo(() => funnelCounts(state), [state])
  const roles = useMemo(() => rolesImpacted(state), [state])
  const loads = useMemo(() => personLoads(state, weeks), [state, weeks])

  const peak = demand.reduce(
    (acc, d) => {
      const w = weightedTotal(d)
      if (w > acc.w) {
        acc.w = w
        acc.wWeek = d.week
        acc.wSigned = signedTotal(d)
      }
      return acc
    },
    { w: 0, wWeek: weeks[0], wSigned: 0 },
  )

  const over = loads.filter((l) => l.overWeeks.length > 0)
  const last = snapshots.length ? snapshots[snapshots.length - 1] : null

  // Utilization = the headline metric; revenue next.
  const utils = useMemo(() => energyUtilization(state, weeks), [state, weeks])
  const avgPeak = utils.length ? utils.reduce((a, u) => a + u.peakPct, 0) / utils.length : 0
  const rev = useMemo(() => revenueTotals(state), [state])
  // Capacity gaps — roles where demand exceeds roster capacity (links to Capacity view).
  const capRows = useMemo(() => roleDemandVsCapacity(state, utilWeeks), [state, utilWeeks])
  const rolesShort = capRows.filter((r) => r.shortWeeks > 0).length
  const peakShortFte = capRows.reduce((s, r) => s + r.peakShort, 0)

  const energyRoles = roles.filter((r) => r.group === 'energy').map((r) => ({ label: r.role, value: r.weighted }))
  const deliveryRoles = roles.filter((r) => r.group === 'delivery').map((r) => ({ label: r.role, value: r.weighted }))

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Capacity & demand — headline metrics */}
      <div className="section-title" style={{ margin: 0 }}>Capacity &amp; demand</div>
      <div className="kpis">
        <div className="kpi">
          <div className="label">Peak utilization · avg</div>
          <div className="value num" style={{ color: avgPeak > 1 ? 'var(--warn)' : 'var(--blue)' }}>{fmtPct(avgPeak)}</div>
          <div className="delta flat">busiest week, averaged over {utils.length} energy people</div>
        </div>
        <button className="kpi kpi-link" onClick={() => setView('capacity')} title="Open the Capacity view">
          <div className="label">Roles short</div>
          <div className="value num" style={{ color: rolesShort ? 'var(--bad)' : 'var(--good)' }}>{rolesShort}</div>
          <div className="delta flat">{rolesShort ? `${peakShortFte.toFixed(1)} FTE peak gap →` : 'demand within capacity'}</div>
        </button>
        <div className="kpi">
          <div className="label">Weighted forecast · FTE-weeks</div>
          <div className="value num">{t.weighted.toFixed(1)}</div>
          <Delta now={t.weighted} was={last?.weightedFte ?? null} />
        </div>
        <div className="kpi">
          <div className="label">Peak weighted week</div>
          <div className="value num">{peak.w.toFixed(1)}</div>
          <div className="delta flat">{weekLabel(peak.wWeek)} · {peak.wSigned.toFixed(1)} signed</div>
        </div>
      </div>

      {/* Revenue — next */}
      <div className="section-title" style={{ margin: '4px 0 0' }}>Revenue pulled through</div>
      <div className="kpis">
        <div className="kpi">
          <div className="label">Weighted pull-through</div>
          <div className="value num" title={fmtMoneyFull(rev.weighted)} style={{ color: 'var(--blue)' }}>{fmtMoney(rev.weighted)}</div>
          <div className="delta flat">{rev.forecastCount} forecast deals</div>
        </div>
        <div className="kpi">
          <div className="label">Signed / booked</div>
          <div className="value num" title={fmtMoneyFull(rev.booked)} style={{ color: 'var(--good)' }}>{fmtMoney(rev.booked)}</div>
          <div className="delta flat">{rev.signedCount} signed</div>
        </div>
        <div className="kpi">
          <div className="label">Pipeline value</div>
          <div className="value num" title={fmtMoneyFull(rev.tcv)}>{fmtMoney(rev.tcv)}</div>
          <div className="delta flat">{opportunities.length} opportunities</div>
        </div>
        <div className="kpi">
          <div className="label">Blended value</div>
          <div className="value num" title={fmtMoneyFull(rev.blended)}>{fmtMoney(rev.blended)}</div>
          <div className="delta flat">weighted + booked</div>
        </div>
      </div>

      {/* Staffing signals — who needs work, who's overbooked, roles to fill */}
      <div className="section-title" style={{ margin: '4px 0 0' }}>Staffing signals · staffed horizon (expected utilization)</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <div className="card">
          <div className="h-row"><h2>Unstaffed roles <span className="faint" style={{ letterSpacing: 0, textTransform: 'none' }}>{unstaffed.length}</span></h2></div>
          {unstaffed.length === 0 ? (
            <div className="empty">Every planned role has a name.</div>
          ) : (
            <div className="signal-list">
              {unstaffed.slice(0, 6).map((u, i) => (
                <button key={i} className="signal-row stack" onClick={() => { selectOpportunity(u.oppId); setView('opportunities') }} title={`Open ${u.oppName}`}>
                  <span className="row" style={{ gap: 6, minWidth: 0 }}><span className={`teamtag ${u.group}`}>{u.group === 'energy' ? 'Energy' : 'Delivery'}</span><span className="signal-name">{u.role}</span><span className="faint num" style={{ fontSize: 11 }}>{u.fteWeeks.toFixed(1)} FTE-weeks</span></span>
                  <span className="signal-proj">{u.oppName}</span>
                </button>
              ))}
              {unstaffed.length > 6 && <div className="faint" style={{ fontSize: 11, padding: '4px 2px' }}>+{unstaffed.length - 6} more</div>}
            </div>
          )}
        </div>

        <div className="card">
          <div className="h-row"><h2>Over-allocated <span className="faint" style={{ letterSpacing: 0, textTransform: 'none', color: overUtil.length ? 'var(--warn)' : undefined }}>{overUtil.length}</span></h2></div>
          {overUtil.length === 0 ? (
            <div className="empty">Nobody is expected over capacity.</div>
          ) : (
            <div className="signal-list">
              {overUtil.slice(0, 6).map((r) => (
                <button key={r.person.id} className="signal-row" onClick={() => selectPerson(r.person.id)} title={`Open ${r.person.name}`}>
                  <span className="signal-name">{r.person.name}</span>
                  <span className="num" style={{ color: 'var(--warn)', fontWeight: 600 }}>{fmtPct(r.peakUtil)} peak · {r.overWeeks} wks</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="h-row"><h2>Under-utilized <span className="faint" style={{ letterSpacing: 0, textTransform: 'none' }}>{underUtil.length}</span></h2></div>
          {underUtil.length === 0 && idlePeople.length === 0 ? (
            <div className="empty">Everyone is at or above target.</div>
          ) : (
            <div className="signal-list">
              {underUtil.slice(0, 6).map((r) => (
                <button key={r.person.id} className="signal-row" onClick={() => selectPerson(r.person.id)} title={`Open ${r.person.name}`}>
                  <span className="signal-name">{r.person.name}{r.idleWeeks === utilWeeks.length ? <span className="faint"> · idle</span> : null}</span>
                  <span className="num" style={{ color: 'var(--blue)' }}>{fmtPct(r.avgUtil)} avg <span className="faint">/ {targetPct}%</span></span>
                </button>
              ))}
              {underUtil.length > 6 && <div className="faint" style={{ fontSize: 11, padding: '4px 2px' }}>+{underUtil.length - 6} more below {targetPct}%</div>}
            </div>
          )}
        </div>
      </div>

      {/* Weekly demand */}
      <div className="card">
        <div className="h-row">
          <h2>Weekly FTE demand</h2>
          <div className="legend">
            <span><span className="swatch signed" /> Signed / committed</span>
            <span><span className="swatch forecast" /> Forecast</span>
            <span style={{ color: 'var(--blue)' }}>— — Target {targetFte.toFixed(1)} FTE <span className="faint">({targetPct}% of {roster.length})</span></span>
          </div>
        </div>
        {opportunities.length === 0 ? (
          <div className="empty">No opportunities yet. Add one under the Opportunities tab.</div>
        ) : (
          <WeeklyDemandChart weeks={stack} target={targetFte} />
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
                <tr><th>Person</th><th className="num">Peak</th><th className="num">Capacity</th><th>Status</th></tr>
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
