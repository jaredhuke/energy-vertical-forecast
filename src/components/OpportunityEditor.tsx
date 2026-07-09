import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Opportunity } from '../types'
import { effectiveProbability } from '../lib/funnel'
import { addWeeks, isoWeekNum, weekLabel } from '../lib/weeks'

export function OpportunityEditor({ opp }: { opp: Opportunity }) {
  const stages = useStore((s) => s.stages)
  const roster = useStore((s) => s.roster)
  const update = useStore((s) => s.updateOpportunity)
  const slide = useStore((s) => s.slideOpportunity)
  const setDuration = useStore((s) => s.setDuration)
  const removeOpportunity = useStore((s) => s.removeOpportunity)
  const duplicateOpportunity = useStore((s) => s.duplicateOpportunity)
  const addAssignment = useStore((s) => s.addAssignment)
  const updateAssignment = useStore((s) => s.updateAssignment)
  const removeAssignment = useStore((s) => s.removeAssignment)
  const setFte = useStore((s) => s.setFte)

  const [personPick, setPersonPick] = useState('')
  const [roleText, setRoleText] = useState('')
  const [roleGroup, setRoleGroup] = useState<'energy' | 'delivery'>('delivery')

  const prob = effectiveProbability(stages, opp.stageId, opp.probabilityOverride)
  const offsets = Array.from({ length: opp.durationWeeks }, (_, i) => i)

  const weekTotal = (off: number) =>
    opp.assignments.reduce((s, a) => s + (a.fte[String(off)] || 0), 0)
  const rowTotal = (aId: string) => {
    const a = opp.assignments.find((x) => x.id === aId)
    if (!a) return 0
    return offsets.reduce((s, off) => s + (a.fte[String(off)] || 0), 0)
  }
  const grandTotal = offsets.reduce((s, off) => s + weekTotal(off), 0)

  const availablePeople = roster.filter((p) => !opp.assignments.some((a) => a.personId === p.id))

  function addPerson() {
    const p = roster.find((x) => x.id === personPick)
    if (!p) return
    addAssignment(opp.id, { personId: p.id, role: p.role, group: p.group })
    setPersonPick('')
  }
  function addRoleLine() {
    if (!roleText.trim()) return
    addAssignment(opp.id, { role: roleText.trim(), group: roleGroup })
    setRoleText('')
  }

  return (
    <div className="card">
      {/* --- opportunity header --- */}
      <div className="row wrap" style={{ gap: 12, marginBottom: 14, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '2 1 220px' }}>
          Opportunity
          <input value={opp.name} onChange={(e) => update(opp.id, { name: e.target.value })} />
        </label>
        <label className="field" style={{ flex: '1 1 160px' }}>
          Client
          <input value={opp.client} onChange={(e) => update(opp.id, { client: e.target.value })} />
        </label>
        <label className="field" style={{ flex: '0 1 150px' }}>
          Stage
          <select value={opp.stageId} onChange={(e) => update(opp.id, { stageId: e.target.value })}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name} · {Math.round(s.probability * 100)}%</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: '0 1 130px' }}>
          Close % {opp.probabilityOverride == null && <span className="faint">(auto)</span>}
          <input
            type="number" min={0} max={100} step={5}
            value={Math.round(prob * 100)}
            onChange={(e) => {
              const v = e.target.value
              update(opp.id, { probabilityOverride: v === '' ? null : Math.max(0, Math.min(100, Number(v))) / 100 })
            }}
          />
        </label>
        {opp.probabilityOverride != null && (
          <button className="btn ghost sm" onClick={() => update(opp.id, { probabilityOverride: null })}>Reset to stage</button>
        )}
      </div>

      {/* --- slide + duration + actions --- */}
      <div className="row wrap" style={{ gap: 18, marginBottom: 16 }}>
        <div>
          <div className="section-title" style={{ margin: '0 0 6px' }}>Slide whole opportunity</div>
          <div className="row" style={{ gap: 8 }}>
            <div className="stepper">
              <button title="Back 4 weeks" onClick={() => slide(opp.id, -4)}>«</button>
              <button title="Back 1 week" onClick={() => slide(opp.id, -1)}>‹</button>
              <span className="val">{weekLabel(opp.startWeek)} · {isoWeekNum(opp.startWeek)}</span>
              <button title="Forward 1 week" onClick={() => slide(opp.id, 1)}>›</button>
              <button title="Forward 4 weeks" onClick={() => slide(opp.id, 4)}>»</button>
            </div>
          </div>
        </div>
        <div>
          <div className="section-title" style={{ margin: '0 0 6px' }}>Duration (weeks)</div>
          <div className="stepper">
            <button onClick={() => setDuration(opp.id, opp.durationWeeks - 1)}>−</button>
            <span className="val">{opp.durationWeeks}</span>
            <button onClick={() => setDuration(opp.id, opp.durationWeeks + 1)}>+</button>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="row" style={{ gap: 8, alignSelf: 'flex-end' }}>
          <span className="chip">weighted {(rowTotalAll(opp, prob)).toFixed(1)} FTE·wk</span>
          <button className="btn ghost sm" onClick={() => duplicateOpportunity(opp.id)}>Duplicate</button>
          <button className="btn ghost sm danger" onClick={() => { if (confirm(`Delete "${opp.name}"?`)) removeOpportunity(opp.id) }}>Delete</button>
        </div>
      </div>

      {/* --- FTE grid --- */}
      <div className="fte-grid">
        <table>
          <thead>
            <tr>
              <th className="rowhead" style={{ textAlign: 'left' }}>Role / person</th>
              {offsets.map((off) => {
                const wk = addWeeks(opp.startWeek, off)
                return (
                  <th key={off} className="wk">
                    {weekLabel(wk)}
                    <span className="wknum">{isoWeekNum(wk)}</span>
                  </th>
                )
              })}
              <th className="wk" style={{ background: 'var(--surface-3)' }}>Σ</th>
            </tr>
          </thead>
          <tbody>
            {opp.assignments.length === 0 && (
              <tr>
                <td className="rowhead faint" colSpan={offsets.length + 2}>No roles yet — add people or role lines below.</td>
              </tr>
            )}
            {opp.assignments.map((a) => {
              const person = a.personId ? roster.find((p) => p.id === a.personId) : undefined
              return (
                <tr key={a.id}>
                  <td className="rowhead">
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <span className="row" style={{ gap: 7 }}>
                        <span className={`swatch ${a.group}`} />
                        {person ? (
                          <span>{person.name}<span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>{person.role} · {person.level}</span></span>
                        ) : (
                          <span>
                            <input
                              className="plain"
                              style={{ width: 130 }}
                              value={a.role}
                              onChange={(e) => updateAssignment(opp.id, a.id, { role: e.target.value })}
                            />
                            <span className="faint" style={{ fontSize: 11 }}>role</span>
                          </span>
                        )}
                      </span>
                      <button className="icon-btn" title="Remove row" onClick={() => removeAssignment(opp.id, a.id)}>×</button>
                    </div>
                  </td>
                  {offsets.map((off) => {
                    const v = a.fte[String(off)] || 0
                    return (
                      <td key={off} className={v ? `filled ${a.group === 'delivery' ? 'delivery' : ''}` : ''}>
                        <input
                          className="cell num"
                          type="number" min={0} step={0.25}
                          value={v || ''}
                          placeholder="·"
                          onChange={(e) => setFte(opp.id, a.id, off, Number(e.target.value) || 0)}
                        />
                      </td>
                    )
                  })}
                  <td className="num" style={{ background: 'var(--surface-2)', padding: '0 8px', color: 'var(--text-dim)' }}>
                    {rowTotal(a.id).toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {opp.assignments.length > 0 && (
            <tfoot>
              <tr>
                <td className="rowhead">Committed FTE / week</td>
                {offsets.map((off) => {
                  const tot = weekTotal(off)
                  return <td key={off}>{tot ? tot.toFixed(2) : ''}</td>
                })}
                <td>{grandTotal.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* --- add rows --- */}
      <div className="row wrap" style={{ gap: 20, marginTop: 14 }}>
        <div className="row" style={{ gap: 8 }}>
          <select value={personPick} onChange={(e) => setPersonPick(e.target.value)} style={{ minWidth: 200 }}>
            <option value="">Add named person…</option>
            {availablePeople.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.role} ({p.group === 'energy' ? 'Energy' : 'Delivery'})</option>
            ))}
          </select>
          <button className="btn sm" disabled={!personPick} onClick={addPerson}>Add person</button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input placeholder="Add role line (e.g. Data Scientist)" value={roleText} onChange={(e) => setRoleText(e.target.value)} style={{ width: 200 }} />
          <select value={roleGroup} onChange={(e) => setRoleGroup(e.target.value as 'energy' | 'delivery')}>
            <option value="delivery">Delivery</option>
            <option value="energy">Energy</option>
          </select>
          <button className="btn sm" disabled={!roleText.trim()} onClick={addRoleLine}>Add role</button>
        </div>
      </div>
    </div>
  )
}

function rowTotalAll(opp: Opportunity, prob: number): number {
  let s = 0
  for (const a of opp.assignments)
    for (let off = 0; off < opp.durationWeeks; off++) s += (a.fte[String(off)] || 0) * prob
  return s
}
