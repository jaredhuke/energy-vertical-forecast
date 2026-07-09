import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import type { ForecastState } from '../types'
import { energyUtilization, horizon } from '../lib/analytics'
import type { PersonUtilization } from '../lib/analytics'
import { fmtMoney, fmtPct } from '../lib/format'

/** Small responsive weekly-load sparkbars with a capacity reference line. */
function UtilBars({ weekly, cap }: { weekly: number[]; cap: number }) {
  const H = 44
  const step = 6
  const n = Math.max(weekly.length, 1)
  const max = Math.max(cap * 1.15, ...weekly, 0.001)
  const y = (v: number) => H - (v / max) * H
  const capY = y(cap)
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${n * step} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      {weekly.map((v, i) => {
        const over = v > cap + 1e-9
        const h = (v / max) * H
        return (
          <rect
            key={i}
            x={i * step + 0.6}
            y={H - h}
            width={step - 1.2}
            height={h}
            fill={over ? 'var(--warn)' : 'var(--energy)'}
            opacity={v ? 0.9 : 0}
          />
        )
      })}
      <line x1={0} x2={n * step} y1={capY} y2={capY} stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function ScoreCard({ u }: { u: PersonUtilization }) {
  const over = u.overWeeks > 0
  return (
    <div className="card scorecard">
      <div className="sc-head">
        <div style={{ minWidth: 0 }}>
          <div className="sc-name">{u.person.name}</div>
          <div className="faint sc-role">{u.person.role} · {u.person.level}</div>
        </div>
        <div className="sc-peak">
          <div className="sc-peak-val num" style={{ color: over ? 'var(--warn)' : u.peakPct >= 0.8 ? 'var(--blue)' : 'var(--text)' }}>
            {fmtPct(u.peakPct)}
          </div>
          <div className="faint">peak util</div>
        </div>
      </div>

      <UtilBars weekly={u.weekly} cap={u.cap} />

      <div className="sc-stats">
        <div><span className="faint">Avg</span> <span className="num">{fmtPct(u.avgPct)}</span></div>
        <div><span className="faint">Cap</span> <span className="num">{u.cap.toFixed(1)}</span></div>
        <div>
          {over ? (
            <span className="chip warn">! over {u.overWeeks}w</span>
          ) : (
            <span className="faint">within capacity</span>
          )}
        </div>
      </div>

      <div className="sc-rev">
        <div><div className="faint">Influenced</div><div className="num sc-rev-v" style={{ color: 'var(--blue)' }}>{fmtMoney(u.weighted)}</div></div>
        <div><div className="faint">Booked</div><div className="num sc-rev-v" style={{ color: 'var(--good)' }}>{fmtMoney(u.booked)}</div></div>
        <div><div className="faint">Deals</div><div className="num sc-rev-v">{u.deals}</div></div>
      </div>
    </div>
  )
}

export function UtilizationView() {
  const roster = useStore((s) => s.roster)
  const stages = useStore((s) => s.stages)
  const opportunities = useStore((s) => s.opportunities)
  const snapshots = useStore((s) => s.snapshots)

  const state = useMemo<ForecastState>(
    () => ({ roster, stages, opportunities, snapshots, editor: '' }),
    [roster, stages, opportunities, snapshots],
  )
  const { weeks } = useMemo(() => horizon(opportunities), [opportunities])
  const utils = useMemo(() => energyUtilization(state, weeks), [state, weeks])

  const overCount = utils.filter((u) => u.overWeeks > 0).length
  const avgPeak = utils.length ? utils.reduce((a, u) => a + u.peakPct, 0) / utils.length : 0
  const totalWeighted = utils.reduce((a, u) => a + u.weighted, 0)
  const totalBooked = utils.reduce((a, u) => a + u.booked, 0)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="hint">
        Forecast utilization for every energy-vertical person — weekly load vs capacity, plus the pipeline value each one
        is influencing. Bars above the dashed capacity line are over-allocated.
      </div>

      <div className="kpis">
        <div className="kpi"><div className="label">Energy people</div><div className="value num">{utils.length}</div></div>
        <div className="kpi"><div className="label">Avg peak utilization</div><div className="value num">{fmtPct(avgPeak)}</div></div>
        <div className="kpi"><div className="label">Over-allocated</div><div className="value num" style={{ color: overCount ? 'var(--warn)' : 'var(--good)' }}>{overCount}</div></div>
        <div className="kpi"><div className="label">Influenced pipeline</div><div className="value num" style={{ color: 'var(--blue)' }}>{fmtMoney(totalWeighted)}</div></div>
        <div className="kpi"><div className="label">Influenced booked</div><div className="value num" style={{ color: 'var(--good)' }}>{fmtMoney(totalBooked)}</div></div>
      </div>

      {utils.length === 0 ? (
        <div className="empty">No energy-vertical people yet — add some in the Roster.</div>
      ) : (
        <div className="scorecards">
          {utils.map((u) => (
            <ScoreCard key={u.person.id} u={u} />
          ))}
        </div>
      )}
    </div>
  )
}
