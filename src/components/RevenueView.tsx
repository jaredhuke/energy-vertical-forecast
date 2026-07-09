import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import type { ForecastState } from '../types'
import { energyUtilization, horizon, revenueByEnergyRole, revenueTotals } from '../lib/analytics'
import { fmtMoney } from '../lib/format'

export function RevenueView() {
  const roster = useStore((s) => s.roster)
  const stages = useStore((s) => s.stages)
  const opportunities = useStore((s) => s.opportunities)
  const snapshots = useStore((s) => s.snapshots)

  const state = useMemo<ForecastState>(
    () => ({ roster, stages, opportunities, snapshots, editor: '' }),
    [roster, stages, opportunities, snapshots],
  )
  const t = useMemo(() => revenueTotals(state), [state])
  const byRole = useMemo(() => revenueByEnergyRole(state), [state])
  const { weeks } = useMemo(() => horizon(opportunities), [opportunities])
  const perPerson = useMemo(
    () => energyUtilization(state, weeks).slice().sort((a, b) => b.weighted + b.booked - (a.weighted + a.booked)),
    [state, weeks],
  )

  const roleMax = Math.max(1, ...byRole.map((r) => r.weighted + r.booked))

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="hint">
        The revenue energy-vertical people are pulling through. <b>Pull-through = deal value × close %</b>; a signed deal
        books at 100%. Per-role and per-person figures are <i>influence</i> — a deal counts for everyone staffed on it.
      </div>

      <div className="kpis">
        <div className="kpi"><div className="label">Pipeline TCV</div><div className="value num">{fmtMoney(t.tcv)}</div><div className="delta flat">{t.forecastCount + t.signedCount} deals</div></div>
        <div className="kpi"><div className="label">Weighted pull-through</div><div className="value num" style={{ color: 'var(--blue)' }}>{fmtMoney(t.weighted)}</div><div className="delta flat">{t.forecastCount} forecast</div></div>
        <div className="kpi"><div className="label">Signed / booked</div><div className="value num" style={{ color: 'var(--good)' }}>{fmtMoney(t.booked)}</div><div className="delta flat">{t.signedCount} signed</div></div>
        <div className="kpi"><div className="label">Blended value</div><div className="value num">{fmtMoney(t.blended)}</div><div className="delta flat">weighted + booked</div></div>
      </div>

      <div className="card">
        <h2>Value by energy role</h2>
        {byRole.length === 0 ? (
          <div className="empty">Staff energy-vertical people on opportunities to see role value.</div>
        ) : (
          <table className="sheet">
            <thead>
              <tr>
                <th>Role</th><th className="num">People</th><th className="num">Deals</th>
                <th className="num">Weighted $</th><th className="num">Booked $</th><th style={{ width: '30%' }}>Total influence</th>
              </tr>
            </thead>
            <tbody>
              {byRole.map((r) => {
                const total = r.weighted + r.booked
                return (
                  <tr key={r.role}>
                    <td style={{ fontWeight: 550 }}>{r.role}</td>
                    <td className="num faint">{r.people}</td>
                    <td className="num faint">{r.deals}</td>
                    <td className="num" style={{ color: 'var(--blue)' }}>{fmtMoney(r.weighted)}</td>
                    <td className="num" style={{ color: r.booked ? 'var(--good)' : 'var(--text-faint)' }}>{fmtMoney(r.booked)}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="bar-track" style={{ flex: 1 }}>
                          <div style={{ width: `${(total / roleMax) * 100}%`, height: '100%', background: 'var(--grad)' }} />
                        </div>
                        <span className="num" style={{ width: 56, textAlign: 'right' }}>{fmtMoney(total)}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Value by energy professional</h2>
        {perPerson.length === 0 ? (
          <div className="empty">No energy-vertical people yet.</div>
        ) : (
          <table className="sheet">
            <thead>
              <tr>
                <th>Person</th><th>Role</th><th className="num">Deals</th>
                <th className="num">Weighted $</th><th className="num">Booked $</th><th className="num">Total $</th>
              </tr>
            </thead>
            <tbody>
              {perPerson.map((u) => (
                <tr key={u.person.id}>
                  <td style={{ fontWeight: 550 }}>{u.person.name}<span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>{u.person.level}</span></td>
                  <td className="faint">{u.person.role}</td>
                  <td className="num faint">{u.deals}</td>
                  <td className="num" style={{ color: 'var(--blue)' }}>{fmtMoney(u.weighted)}</td>
                  <td className="num" style={{ color: u.booked ? 'var(--good)' : 'var(--text-faint)' }}>{fmtMoney(u.booked)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmtMoney(u.weighted + u.booked)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
