import { weekLabel, isoWeekNum } from '../lib/weeks'
import type { WeekStack } from '../lib/analytics'

const SIGNED_RGB = '22, 160, 108' // green — booked / committed, 100% certain
const FORECAST_RGB = '37, 99, 235' // blue — forecast; opacity encodes likelihood

// ---- Weekly demand: one stacked bar per week. Green signed/committed floor at
//      the bottom (certain), forecast stacked on top and fading with its close
//      % likelihood — most likely just above the floor, longest-shots at the top.
export function WeeklyDemandChart({ weeks }: { weeks: WeekStack[] }) {
  const H = 200
  const padT = 12
  const padB = 34
  const padL = 30
  const bandW = 40
  const W = padL + weeks.length * bandW + 8
  const plotH = H - padT - padB

  const maxVal = Math.max(1, ...weeks.map((d) => d.total))
  const niceMax = Math.ceil(maxVal)
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH
  const hgt = (v: number) => (v / niceMax) * plotH

  const barW = 22
  const gridlines = Array.from({ length: niceMax + 1 }, (_, i) => i)

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} role="img" aria-label="Weekly FTE demand: signed floor plus forecast by likelihood">
        {gridlines.map((g) => (
          <g key={g}>
            <line x1={padL} x2={W} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--text-faint)">
              {g}
            </text>
          </g>
        ))}
        {weeks.map((d, i) => {
          const x = padL + i * bandW + (bandW - barW) / 2
          const showLbl = i % 2 === 0 || weeks.length <= 12
          // Build stacked segments from the bottom up: signed floor, then
          // forecast slices (already sorted most-likely first).
          const segs: { fte: number; fill: string; label: string }[] = []
          if (d.signed > 0) segs.push({ fte: d.signed, fill: `rgb(${SIGNED_RGB})`, label: `signed / committed ${d.signed.toFixed(1)}` })
          for (const f of d.forecast) {
            segs.push({
              fte: f.fte,
              // Opacity encodes likelihood, but the floor is high enough that
              // even a 5%-likely lead is clearly visible (a ghost slice reads
              // as "my FTE didn't show up"); the gradient still reads.
              fill: `rgba(${FORECAST_RGB}, ${(0.38 + 0.52 * f.prob).toFixed(3)})`,
              label: `${Math.round(f.prob * 100)}% likely · ${f.fte.toFixed(1)}`,
            })
          }
          let base = 0 // cumulative FTE from the bottom
          return (
            <g key={i}>
              {segs.map((s, j) => {
                const yTop = y(base + s.fte)
                base += s.fte
                return (
                  <rect key={j} x={x} y={yTop} width={barW} height={hgt(s.fte)} fill={s.fill} stroke="#fff" strokeWidth={0.5}>
                    <title>{`${weekLabel(d.week)} — ${s.label} FTE`}</title>
                  </rect>
                )
              })}
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
