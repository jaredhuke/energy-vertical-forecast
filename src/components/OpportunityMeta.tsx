import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Opportunity } from '../types'
import { effectiveProbability } from '../lib/funnel'
import { isoWeekNum, weekLabel } from '../lib/weeks'
import { fmtMoney } from '../lib/format'

/** Compact detail panel for the selected project: meta, slide, duration,
 *  add-roles, duplicate/delete. Weekly FTE itself is edited in the Gantt. */
export function OpportunityMeta({ opp, onClose }: { opp: Opportunity; onClose?: () => void }) {
  const stages = useStore((s) => s.stages)
  const roster = useStore((s) => s.roster)
  const update = useStore((s) => s.updateOpportunity)
  const slide = useStore((s) => s.slideOpportunity)
  const setDuration = useStore((s) => s.setDuration)
  const removeOpportunity = useStore((s) => s.removeOpportunity)
  const duplicateOpportunity = useStore((s) => s.duplicateOpportunity)
  const addAssignment = useStore((s) => s.addAssignment)
  const removeAssignment = useStore((s) => s.removeAssignment)

  const [personPick, setPersonPick] = useState('')
  const [roleText, setRoleText] = useState('')
  const [roleGroup, setRoleGroup] = useState<'energy' | 'delivery'>('delivery')

  const internal = opp.type === 'internal'
  const prob = effectiveProbability(stages, opp.stageId, opp.probabilityOverride)
  const dealValue = opp.dealValue ?? 0
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
      <div className="h-row">
        <h2>Details — {opp.name}</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm" onClick={() => duplicateOpportunity(opp.id)}>Duplicate</button>
          <button className="btn ghost sm danger" onClick={() => { if (confirm(`Delete "${opp.name}"?`)) removeOpportunity(opp.id) }}>Delete</button>
          {onClose && <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>×</button>}
        </div>
      </div>

      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '2 1 200px' }}>
          Opportunity
          <input value={opp.name} onChange={(e) => update(opp.id, { name: e.target.value })} />
        </label>
        <label className="field" style={{ flex: '1 1 150px' }}>
          Client
          <input value={opp.client} onChange={(e) => update(opp.id, { client: e.target.value })} />
        </label>
        <div className="field">
          <span>Type</span>
          <div className="seg">
            <button className={!internal ? 'on' : ''} aria-pressed={!internal} onClick={() => update(opp.id, { type: 'external' })}>External</button>
            <button className={internal ? 'on' : ''} aria-pressed={internal} onClick={() => update(opp.id, { type: 'internal' })}>Internal</button>
          </div>
        </div>
        {!internal && (
          <>
            <label className="field" style={{ flex: '0 1 160px' }}>
              Stage
              <select value={opp.stageId} onChange={(e) => update(opp.id, { stageId: e.target.value })}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {Math.round(s.probability * 100)}%</option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: '0 1 140px' }}>
              <span>
                Close %{' '}
                {opp.probabilityOverride == null ? (
                  <span className="faint">(auto from stage)</span>
                ) : (
                  <button
                    className="linklike"
                    style={{ color: 'var(--blue)', fontSize: 11 }}
                    title="Clear the manual override and follow the stage default again"
                    onClick={(e) => { e.preventDefault(); update(opp.id, { probabilityOverride: null }) }}
                  >
                    override — reset to auto
                  </button>
                )}
              </span>
              <input
                type="number" min={0} max={100} step={5}
                value={Math.round(prob * 100)}
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => {
                  const v = e.target.value
                  update(opp.id, { probabilityOverride: v === '' ? null : Math.max(0, Math.min(100, Number(v))) / 100 })
                }}
              />
            </label>
          </>
        )}
        <div className="field">
          <span>Start</span>
          <div className="stepper">
            <button title="Back 4 weeks" onClick={() => slide(opp.id, -4)}>«</button>
            <button title="Back 1 week" onClick={() => slide(opp.id, -1)}>‹</button>
            <span className="val">{weekLabel(opp.startWeek)} · {isoWeekNum(opp.startWeek)}</span>
            <button title="Forward 1 week" onClick={() => slide(opp.id, 1)}>›</button>
            <button title="Forward 4 weeks" onClick={() => slide(opp.id, 4)}>»</button>
          </div>
        </div>
        <div className="field">
          <span>Duration (weeks)</span>
          <div className="stepper">
            <button onClick={() => setDuration(opp.id, opp.durationWeeks - 1)}>−</button>
            <span className="val">{opp.durationWeeks}</span>
            <button onClick={() => setDuration(opp.id, opp.durationWeeks + 1)}>+</button>
          </div>
        </div>
        {!internal && (
          <>
            <label className="field" style={{ flex: '0 1 170px' }}>
              <span>Deal value — total contract value ($) <span className="faint num">{dealValue > 0 ? `= ${fmtMoney(dealValue)}` : ''}</span></span>
              <input
                type="number" min={0} step={50000}
                value={opp.dealValue ?? 0}
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => update(opp.id, { dealValue: Number(e.target.value) || 0 })}
              />
            </label>
            <div className="field">
              <span>Booking</span>
              <div className="seg">
                <button className={opp.booking !== 'signed' ? 'on' : ''} aria-pressed={opp.booking !== 'signed'} onClick={() => update(opp.id, { booking: 'forecast' })}>Forecast</button>
                <button className={opp.booking === 'signed' ? 'on' : ''} aria-pressed={opp.booking === 'signed'} onClick={() => update(opp.id, { booking: 'signed' })}>Signed</button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="revenue-note">
        {internal ? (
          <>Internal project — consumes capacity (counts in <b>utilization at 100% certainty</b>); no funnel stage, deal value, or revenue.</>
        ) : opp.booking === 'signed' ? (
          <>Booked revenue <b>{fmtMoney(dealValue)}</b> — signed, counts as actual bookings.</>
        ) : (
          <>Pull-through <b>{fmtMoney(dealValue * prob)}</b> = {fmtMoney(dealValue)} deal × {Math.round(prob * 100)}% close</>
        )}
      </div>

      <div className="section-title" style={{ marginTop: 18 }}>Roles on this opportunity</div>
      <div className="row wrap" style={{ gap: 20, alignItems: 'flex-start' }}>
        {(['energy', 'delivery'] as const).map((group) => {
          const list = opp.assignments.filter((a) => a.group === group)
          return (
            <div key={group} style={{ flex: '1 1 240px', minWidth: 220 }}>
              <span className={`teamtag ${group}`}>{group === 'energy' ? 'Energy team' : 'Delivery team'}</span>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {list.length === 0 ? (
                  <span className="faint" style={{ fontSize: 12 }}>none yet</span>
                ) : (
                  list.map((a) => {
                    const person = a.personId ? roster.find((p) => p.id === a.personId) : undefined
                    return (
                      <div key={a.id} className="manage-row">
                        <span className="row" style={{ gap: 6, minWidth: 0 }}>
                          <span className={`swatch ${group}`} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {person ? person.name : a.role}
                            <span className="faint" style={{ marginLeft: 5, fontSize: 11 }}>{person ? person.role : 'role'}</span>
                          </span>
                        </span>
                        <button
                          className="btn ghost sm danger"
                          onClick={() => { if (confirm(`Remove ${person ? person.name : a.role} from “${opp.name}”? This deletes their planned FTE.`)) removeAssignment(opp.id, a.id) }}
                        >Remove</button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="section-title" style={{ marginTop: 18 }}>Add a role</div>
      <div className="row wrap" style={{ gap: 20 }}>
        <div className="row" style={{ gap: 8 }}>
          <select value={personPick} onChange={(e) => setPersonPick(e.target.value)} style={{ minWidth: 210 }}>
            <option value="">Add named person…</option>
            {availablePeople.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.role} ({p.group === 'energy' ? 'Energy' : 'Delivery'})</option>
            ))}
          </select>
          <button className="btn sm" disabled={!personPick} onClick={addPerson}>Add person</button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input placeholder="Add role line (e.g. Data Scientist)" value={roleText} onChange={(e) => setRoleText(e.target.value)} style={{ width: 210 }} />
          <select value={roleGroup} onChange={(e) => setRoleGroup(e.target.value as 'energy' | 'delivery')}>
            <option value="delivery">Delivery</option>
            <option value="energy">Energy</option>
          </select>
          <button className="btn sm" disabled={!roleText.trim()} onClick={addRoleLine}>Add role</button>
        </div>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>Edit weekly FTE per role in the timeline. Drag a project bar to slide it.</div>
    </div>
  )
}
