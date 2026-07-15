import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import type { ForecastState } from '../types'
import { energyUtilization, horizon, marginTotals, pipelineByCustomerType, revenueByEnergyRole, revenueTotals } from '../lib/analytics'
import { fmtMoney, fmtMoneyFull } from '../lib/format'

const pct = (v: number) => `${Math.round(v * 100)}%`

export function RevenueView() {
  const roster = useStore((s) => s.roster)
  const stages = useStore((s) => s.stages)
  const opportunities = useStore((s) => s.opportunities)
  const snapshots = useStore((s) => s.snapshots)
  const showCostMargin = useStore((s) => s.showCostMargin)
  const setShowCostMargin = useStore((s) => s.setShowCostMargin)

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
  const m = useMemo(() => marginTotals(state), [state])
  const byCustomer = useMemo(() => pipelineByCustomerType(state), [state])

  // Role-level cost = Σ its people's cost (roles inherit cost from named staff).
  const roleCost = useMemo(() => {
    const map = new Map<string, number>()
    for (const u of perPerson) map.set(u.person.role, (map.get(u.person.role) || 0) + u.cost)
    return map
  }, [perPerson])

  const roleMax = Math.max(1, ...byRole.map((r) => r.weighted + r.booked))
  const totalCost = m.weightedCost + m.bookedCost
  const noRates = showCostMargin && totalCost === 0

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="hint">
        The revenue energy-vertical people are pulling through. <b>Pull-through = deal value × close %</b>; a signed deal
        books at 100%. Each deal's value is <b>split equally across the energy people on it</b> — a $100k deal with two
        energy people is $50k associated with each — so the role and person figures add up to the pipeline (no double-counting).
      </div>

      {/* Toggle NEVER wraps (no double-height). Cost & margin is off by default. */}
      <div className="ctl-row">
        <div className="seg" title="Reveal staffing cost and margin. Cost is sensitive, so this stays off until you turn it on.">
          <button className={showCostMargin ? 'on' : ''} aria-pressed={showCostMargin} onClick={() => setShowCostMargin(!showCostMargin)}>
            Cost &amp; margin: {showCostMargin ? 'shown' : 'hidden'}
          </button>
        </div>
        {noRates && (
          <span className="faint" style={{ fontSize: 12 }}>
            Set weekly cost rates in Roster to populate these figures.
          </span>
        )}
      </div>

      <div className="kpis">
        <div className="kpi"><div className="label">Pipeline value</div><div className="value num" title={fmtMoneyFull(t.tcv)}>{fmtMoney(t.tcv)}</div><div className="delta flat">{t.forecastCount + t.signedCount} deals</div></div>
        <div className="kpi"><div className="label">Weighted pull-through</div><div className="value num" title={fmtMoneyFull(t.weighted)} style={{ color: 'var(--blue)' }}>{fmtMoney(t.weighted)}</div><div className="delta flat">{t.forecastCount} forecast</div></div>
        <div className="kpi"><div className="label">Signed / booked</div><div className="value num" title={fmtMoneyFull(t.booked)} style={{ color: 'var(--good)' }}>{fmtMoney(t.booked)}</div><div className="delta flat">{t.signedCount} signed</div></div>
        <div className="kpi"><div className="label">Blended value</div><div className="value num" title={fmtMoneyFull(t.blended)}>{fmtMoney(t.blended)}</div><div className="delta flat">weighted + booked</div></div>
      </div>

      {showCostMargin && (
        <div className="kpis">
          <div className="kpi"><div className="label">Staffing cost</div><div className="value num" title={fmtMoneyFull(totalCost)}>{fmtMoney(totalCost)}</div><div className="delta flat">expected spend</div></div>
          <div className="kpi"><div className="label">Weighted margin</div><div className="value num" title={fmtMoneyFull(m.weightedMargin)} style={{ color: 'var(--blue)' }}>{fmtMoney(m.weightedMargin)}</div><div className="delta flat">forecast value − cost</div></div>
          <div className="kpi"><div className="label">Signed margin</div><div className="value num" title={fmtMoneyFull(m.bookedMargin)} style={{ color: 'var(--good)' }}>{fmtMoney(m.bookedMargin)}</div><div className="delta flat">booked value − cost</div></div>
          <div className="kpi"><div className="label">Blended margin</div><div className="value num">{pct(m.blendedMarginPct)}</div><div className="delta flat">{m.internalCost ? `+ ${fmtMoney(m.internalCost)} internal` : 'of blended value'}</div></div>
        </div>
      )}

      {/* Pillar 4 — pipeline split by customer type × booked vs anticipated */}
      <div className="card">
        <div className="h-row">
          <h2>New vs existing customer pipeline</h2>
          <span className="faint" style={{ fontSize: 11 }}>booked = signed · anticipated = forecast × close % · set New/Existing in Opportunities</span>
        </div>
        <table className="sheet">
          <thead>
            <tr>
              <th>Customer</th><th className="num">Deals</th>
              <th className="num">Booked $</th><th className="num">Anticipated $</th><th className="num">Total $</th>
            </tr>
          </thead>
          <tbody>
            {byCustomer.map((c) => {
              const total = c.booked + c.anticipated
              return (
                <tr key={c.customerType}>
                  <td style={{ fontWeight: 550 }}>{c.label}</td>
                  <td className="num faint">{c.count}</td>
                  <td className="num" style={{ color: c.booked ? 'var(--good)' : 'var(--text-faint)' }}>{fmtMoneyFull(c.booked)}</td>
                  <td className="num" style={{ color: c.anticipated ? 'var(--blue)' : 'var(--text-faint)' }}>{fmtMoneyFull(c.anticipated)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmtMoneyFull(total)}</td>
                </tr>
              )
            })}
            <tr style={{ borderTop: '2px solid var(--border-strong)' }}>
              <td style={{ fontWeight: 600 }}>All</td>
              <td className="num faint">{byCustomer.reduce((s, c) => s + c.count, 0)}</td>
              <td className="num" style={{ color: 'var(--good)', fontWeight: 600 }}>{fmtMoneyFull(byCustomer.reduce((s, c) => s + c.booked, 0))}</td>
              <td className="num" style={{ color: 'var(--blue)', fontWeight: 600 }}>{fmtMoneyFull(byCustomer.reduce((s, c) => s + c.anticipated, 0))}</td>
              <td className="num" style={{ fontWeight: 700 }}>{fmtMoneyFull(byCustomer.reduce((s, c) => s + c.booked + c.anticipated, 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Value by energy role</h2>
        {byRole.length === 0 ? (
          <div className="empty">Staff energy-vertical people on opportunities to see role value.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="sheet">
              <thead>
                <tr>
                  <th>Role</th><th className="num">People</th><th className="num">Deals</th>
                  <th className="num">Weighted $</th><th className="num">Booked $</th>
                  {showCostMargin && <><th className="num">Cost $</th><th className="num">Margin $</th><th className="num">Margin %</th></>}
                  <th style={{ width: '24%' }}>Total value</th>
                </tr>
              </thead>
              <tbody>
                {byRole.map((r) => {
                  const total = r.weighted + r.booked
                  const cost = roleCost.get(r.role) || 0
                  const margin = total - cost
                  return (
                    <tr key={r.role}>
                      <td style={{ fontWeight: 550 }}>{r.role}</td>
                      <td className="num faint">{r.people}</td>
                      <td className="num faint">{r.deals}</td>
                      <td className="num" style={{ color: 'var(--blue)' }}>{fmtMoneyFull(r.weighted)}</td>
                      <td className="num" style={{ color: r.booked ? 'var(--good)' : 'var(--text-faint)' }}>{fmtMoneyFull(r.booked)}</td>
                      {showCostMargin && <>
                        <td className="num faint">{cost ? fmtMoneyFull(cost) : '—'}</td>
                        <td className="num" style={{ fontWeight: 550 }}>{fmtMoneyFull(margin)}</td>
                        <td className="num faint">{total ? pct(margin / total) : '—'}</td>
                      </>}
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <div className="bar-track" style={{ flex: 1 }}>
                            <div style={{ width: `${(total / roleMax) * 100}%`, height: '100%', background: 'var(--grad)' }} />
                          </div>
                          <span className="num" style={{ width: 92, textAlign: 'right' }}>{fmtMoneyFull(total)}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Value by energy professional</h2>
        {perPerson.length === 0 ? (
          <div className="empty">No energy-vertical people yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="sheet">
              <thead>
                <tr>
                  <th>Person</th><th>Role</th><th className="num">Deals</th>
                  <th className="num">Weighted $</th><th className="num">Booked $</th>
                  {showCostMargin && <><th className="num">Cost $</th><th className="num">Margin $</th><th className="num">Margin %</th></>}
                  <th className="num">Total $</th>
                </tr>
              </thead>
              <tbody>
                {perPerson.map((u) => {
                  const total = u.weighted + u.booked
                  const margin = total - u.cost
                  return (
                    <tr key={u.person.id}>
                      <td style={{ fontWeight: 550 }}>{u.person.name}<span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>{u.person.level}</span></td>
                      <td className="faint">{u.person.role}</td>
                      <td className="num faint">{u.deals}</td>
                      <td className="num" style={{ color: 'var(--blue)' }}>{fmtMoneyFull(u.weighted)}</td>
                      <td className="num" style={{ color: u.booked ? 'var(--good)' : 'var(--text-faint)' }}>{fmtMoneyFull(u.booked)}</td>
                      {showCostMargin && <>
                        <td className="num faint">{u.cost ? fmtMoneyFull(u.cost) : '—'}</td>
                        <td className="num" style={{ fontWeight: 550 }}>{fmtMoneyFull(margin)}</td>
                        <td className="num faint">{total ? pct(margin / total) : '—'}</td>
                      </>}
                      <td className="num" style={{ fontWeight: 600 }}>{fmtMoneyFull(total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
