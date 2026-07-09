import { weekLabel, isoWeekNum } from '../lib/weeks'
import type { WeekDemand } from '../lib/analytics'
import { signedTotal, weightedTotal } from '../lib/analytics'

// ---- Weekly demand: stacked energy+delivery bars for the chosen metric,
//      with the other metric drawn as a faint reference line. ----
export function WeeklyDemandChart({
  demand,
  mode,
}: {
  demand: WeekDemand[]
  mode: 'signed' | 'weighted'
}) {
  const H = 200
  const padT = 12
  const padB = 34
  const padL = 30
  const bandW = 40
  const W = padL + demand.length * bandW + 8
  const plotH = H - padT - padB

  // Weighted forecast is always ≥ signed, so it sets the axis ceiling.
  const maxVal = Math.max(
    1,
    ...demand.map((d) => Math.max(weightedTotal(d), signedTotal(d))),
  )
  const niceMax = Math.ceil(maxVal)
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH

  const barW = 22
  const gridlines = Array.from({ length: niceMax + 1 }, (_, i) => i)

  const otherLine = demand.map((d, i) => {
    const v = mode === 'signed' ? weightedTotal(d) : signedTotal(d)
    return `${padL + i * bandW + bandW / 2},${y(v)}`
  })

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} role="img" aria-label="Weekly FTE demand">
        {gridlines.map((g) => (
          <g key={g}>
            <line x1={padL} x2={W} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--text-faint)">
              {g}
            </text>
          </g>
        ))}
        {demand.map((d, i) => {
          const e = mode === 'signed' ? d.signedEnergy : d.weightedEnergy
          const dv = mode === 'signed' ? d.signedDelivery : d.weightedDelivery
          const x = padL + i * bandW + (bandW - barW) / 2
          const eH = (e / niceMax) * plotH
          const dH = (dv / niceMax) * plotH
          const showLbl = i % 2 === 0 || demand.length <= 12
          return (
            <g key={i}>
              <rect x={x} y={y(dv)} width={barW} height={dH} fill="var(--delivery)" opacity={0.9}>
                <title>{`${weekLabel(d.week)} — delivery ${dv.toFixed(1)}`}</title>
              </rect>
              <rect x={x} y={y(e + dv)} width={barW} height={eH} fill="var(--energy)" opacity={0.95}>
                <title>{`${weekLabel(d.week)} — energy ${e.toFixed(1)}`}</title>
              </rect>
              {showLbl && (
                <text x={x + barW / 2} y={H - 20} textAnchor="middle" fontSize="9" fill="var(--text-faint)">
                  {weekLabel(d.week)}
                </text>
              )}
              {showLbl && (
                <text x={x + barW / 2} y={H - 9} textAnchor="middle" fontSize="8" fill="var(--text-faint)">
                  {isoWeekNum(d.week)}
                </text>
              )}
            </g>
          )
        })}
        {/* reference line for the other metric */}
        <polyline
          points={otherLine.join(' ')}
          fill="none"
          stroke="var(--text-faint)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      </svg>
    </div>
  )
}

// ---- Horizontal bars (roles impacted) ----
export function HBars({
  items,
  color = 'var(--purple)',
}: {
  items: { label: string; sub?: string; value: number }[]
  color?: string
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.length === 0) return <div className="empty">No data yet</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {items.map((it, i) => (
        <div key={i}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 13 }}>
              {it.label}
              {it.sub && <span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>{it.sub}</span>}
            </span>
            <span className="num faint" style={{ fontSize: 12 }}>{it.value.toFixed(1)}</span>
          </div>
          <div className="bar-track">
            <div style={{ width: `${(it.value / max) * 100}%`, height: '100%', background: color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Sparkline (snapshot trends) ----
export function Sparkline({
  points,
  color = 'var(--blue)',
  height = 44,
  width = 220,
}: {
  points: number[]
  color?: string
  height?: number
  width?: number
}) {
  if (points.length < 2) return <div className="faint" style={{ fontSize: 12 }}>Need ≥2 snapshots</div>
  const max = Math.max(...points)
  const min = Math.min(...points)
  const span = max - min || 1
  const stepX = width / (points.length - 1)
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height}>
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={i * stepX} cy={y(p)} r={2.4} fill={color} />
      ))}
    </svg>
  )
}
