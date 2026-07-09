import { Fragment, useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Opportunity } from '../types'
import { effectiveProbability, stageName } from '../lib/funnel'
import { addWeeks, isoWeekNum, weekKeyOf, weekLabel, weekRange, weeksBetween } from '../lib/weeks'
import { fmtMoney } from '../lib/format'

const COL = 46 // px per week column — must match the colgroup width below

function weightedFteWeeks(o: Opportunity, prob: number): number {
  let sum = 0
  for (const a of o.assignments)
    for (let off = 0; off < o.durationWeeks; off++) sum += (a.fte[String(off)] || 0) * prob
  return sum
}

type DragState = { oppId: string; startX: number; origStart: string; el: HTMLElement }
type ResizeState = { oppId: string; startX: number; origDur: number; el: HTMLElement }

export function GanttView() {
  const opportunities = useStore((s) => s.opportunities)
  const stages = useStore((s) => s.stages)
  const roster = useStore((s) => s.roster)
  const selectedId = useStore((s) => s.selectedOpportunityId)
  const select = useStore((s) => s.selectOpportunity)
  const slide = useStore((s) => s.slideOpportunity)
  const removeAssignment = useStore((s) => s.removeAssignment)
  const addAssignment = useStore((s) => s.addAssignment)
  const setFte = useStore((s) => s.setFte)
  const addOpportunity = useStore((s) => s.addOpportunity)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editMode, setEditMode] = useState(false)
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [addPersonPick, setAddPersonPick] = useState('')
  const [addRoleText, setAddRoleText] = useState('')
  const [addRoleGroup, setAddRoleGroup] = useState<'energy' | 'delivery'>('energy')
  const dragRef = useRef<DragState | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Fixed axis start (4 weeks before today) so sliding never shifts the grid.
  const start = addWeeks(weekKeyOf(), -4)
  let end = addWeeks(weekKeyOf(), 18)
  for (const o of opportunities) {
    const oEnd = addWeeks(o.startWeek, o.durationWeeks)
    if (weeksBetween(end, oEnd) > 0) end = oEnd
  }
  const weeks = weekRange(start, weeksBetween(start, end) + 3)
  const todayCol = weeksBetween(start, weekKeyOf())

  // Stable row order: re-sort only when the set of opportunities changes.
  const orderIds = useMemo(
    () => [...opportunities].sort((a, b) => weeksBetween(b.startWeek, a.startWeek)).map((o) => o.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opportunities.map((o) => o.id).join('|')],
  )
  const byId = new Map(opportunities.map((o) => [o.id, o]))
  const sorted = orderIds.map((id) => byId.get(id)).filter((o): o is Opportunity => !!o)

  // ---- fluid slide: transform-follow the bar, snap to a week on release
  const onMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    d.el.style.transform = `translateX(${e.clientX - d.startX}px)`
  }, [])
  const onUp = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dw = Math.round((e.clientX - d.startX) / COL)
      d.el.style.transform = ''
      if (dw !== 0) useStore.getState().updateOpportunity(d.oppId, { startWeek: addWeeks(d.origStart, dw) })
      d.el.classList.remove('dragging')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      dragRef.current = null
      setDraggingId(null)
    },
    [onMove],
  )
  function onBarDown(e: React.PointerEvent, opp: Opportunity) {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.classList.add('dragging')
    dragRef.current = { oppId: opp.id, startX: e.clientX, origStart: opp.startWeek, el }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    setDraggingId(opp.id)
  }

  // ---- resize: drag the right edge to change duration, warn on data loss
  const onResizeMove = useCallback((e: PointerEvent) => {
    const d = resizeRef.current
    if (!d) return
    const w = Math.max(COL - 4, d.origDur * COL - 4 + (e.clientX - d.startX))
    d.el.style.width = `${w}px`
  }, [])
  const onResizeUp = useCallback(
    (e: PointerEvent) => {
      const d = resizeRef.current
      if (!d) return
      const newDur = Math.max(1, Math.round(d.origDur + (e.clientX - d.startX) / COL))
      d.el.classList.remove('resizing')
      window.removeEventListener('pointermove', onResizeMove)
      window.removeEventListener('pointerup', onResizeUp)
      resizeRef.current = null
      const st = useStore.getState()
      const opp = st.opportunities.find((o) => o.id === d.oppId)
      const resetWidth = () => (d.el.style.width = `${Math.max(0, d.origDur * COL - 4)}px`)
      if (!opp || newDur === d.origDur) return resetWidth()
      if (newDur < d.origDur) {
        const lost = opp.assignments.some((a) => Object.keys(a.fte).some((k) => Number(k) >= newDur))
        if (lost && !confirm(`Shortening “${opp.name}” to ${newDur} weeks will delete planned FTE beyond week ${newDur}. Continue?`)) {
          return resetWidth()
        }
      }
      st.setDuration(d.oppId, newDur) // re-render sets the width from the new duration
    },
    [onResizeMove],
  )
  function onResizeDown(e: React.PointerEvent, opp: Opportunity) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation() // don't start a slide
    const el = (e.currentTarget as HTMLElement).parentElement as HTMLElement
    el.classList.add('resizing')
    resizeRef.current = { oppId: opp.id, startX: e.clientX, origDur: opp.durationWeeks, el }
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', onResizeUp)
  }

  function quickAdd(oppId: string) {
    if (addPersonPick) {
      const p = roster.find((x) => x.id === addPersonPick)
      if (p) addAssignment(oppId, { personId: p.id, role: p.role, group: p.group })
    } else if (addRoleText.trim()) {
      addAssignment(oppId, { role: addRoleText.trim(), group: addRoleGroup })
    }
    setAddPersonPick('')
    setAddRoleText('')
    setAddingFor(null)
  }

  return (
    <div className="card">
      <div className="h-row">
        <h2>Timeline</h2>
        <div className="row wrap" style={{ gap: 10 }}>
          <span className="legend">
            <span><span className="swatch energy" /> Energy team</span>
            <span><span className="swatch delivery" /> Delivery team</span>
          </span>
          <button
            className={`btn sm ${editMode ? 'primary' : 'ghost'}`}
            onClick={() => setEditMode((v) => !v)}
            title="Reveal remove controls — deletions are permanent"
          >
            {editMode ? 'Done editing' : 'Edit roles'}
          </button>
          <button className="btn ghost sm" onClick={() => addOpportunity('internal')}>+ Internal project</button>
          <button className="btn primary sm" onClick={() => addOpportunity()}>+ New opportunity</button>
        </div>
      </div>
      {editMode && (
        <div className="edit-banner">Edit mode — role removals are permanent. Use “+” to add, and the × to remove.</div>
      )}

      {opportunities.length === 0 ? (
        <div className="empty">No opportunities yet — add your first pursuit.</div>
      ) : (
        <div className="gantt">
          <table style={{ width: 240 + weeks.length * COL }}>
            <colgroup>
              <col style={{ width: 240 }} />
              {weeks.map((w) => (
                <col key={w} style={{ width: COL }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="lab">Project / role</th>
                {weeks.map((w, i) => (
                  <th key={w} className={`wk ${i === todayCol ? 'today' : ''}`}>
                    <span className="wknum">{isoWeekNum(w)}</span>
                    <span className="wkdate">{weekLabel(w)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((opp) => {
                const internal = opp.type === 'internal'
                const prob = internal ? 1 : effectiveProbability(stages, opp.stageId, opp.probabilityOverride)
                const startCol = weeksBetween(start, opp.startWeek)
                const weighted = weightedFteWeeks(opp, prob)
                const isSel = opp.id === selectedId
                const isOpen = !collapsed.has(opp.id)
                const signed = opp.booking === 'signed'
                const money = opp.dealValue ? fmtMoney(opp.dealValue) : null
                const barText = internal
                  ? `Internal · ${weighted.toFixed(1)} FTE-weeks`
                  : signed
                    ? money ? `Signed · ${money}` : 'Signed'
                    : money ? `${money} @ ${Math.round(prob * 100)}%` : `${weighted.toFixed(1)} FTE-weeks`
                const energyN = opp.assignments.filter((a) => a.group === 'energy').length
                const deliveryN = opp.assignments.filter((a) => a.group === 'delivery').length
                const ordered = [
                  ...opp.assignments.filter((a) => a.group === 'energy'),
                  ...opp.assignments.filter((a) => a.group === 'delivery'),
                ]
                return (
                  <Fragment key={opp.id}>
                    {/* project bar row */}
                    <tr className={`barrow ${draggingId === opp.id ? 'grabbing' : ''} ${isSel ? 'sel' : ''}`}>
                      <td className="lab">
                        <div className="lab-top">
                          <button className={`caret-btn ${isOpen ? 'open' : ''}`} title={isOpen ? 'Collapse' : 'Expand'} aria-label={isOpen ? 'Collapse roles' : 'Expand roles'} onClick={() => toggle(opp.id)}>
                            <span className="caret" />
                          </button>
                          <button className="linklike proj" onClick={() => select(opp.id)} title="Open detail dialog">{opp.name}</button>
                          <span className="slide">
                            <button className="mini-btn" title="Add role" aria-label="Add role" onClick={() => setAddingFor(addingFor === opp.id ? null : opp.id)}>+</button>
                            <button className="mini-btn" title="Slide back 1 week" onClick={() => slide(opp.id, -1)}>‹</button>
                            <button className="mini-btn" title="Slide forward 1 week" onClick={() => slide(opp.id, 1)}>›</button>
                          </span>
                        </div>
                        <div className="lab-sub">
                          {internal ? (
                            <span className="chip xs internal">Internal</span>
                          ) : (
                            <>
                              <span className="chip xs">{stageName(stages, opp.stageId)} · {Math.round(prob * 100)}%</span>
                              <span className={`chip xs ${signed ? 'good' : ''}`}>{signed ? 'Signed' : 'Forecast'}</span>
                            </>
                          )}
                          <span className="faint num">{energyN} energy · {deliveryN} delivery · {opp.durationWeeks} weeks</span>
                        </div>
                      </td>
                      <td className="track" colSpan={weeks.length}>
                        <div className="track-inner">
                          {todayCol >= 0 && todayCol < weeks.length && <div className="today-line" style={{ left: todayCol * COL }} />}
                          <div
                            className={`gbar ${internal ? 'internal' : signed ? 'signed' : ''}`}
                            style={{ left: startCol * COL + 2, width: Math.max(0, opp.durationWeeks * COL - 4) }}
                            onPointerDown={(e) => onBarDown(e, opp)}
                            onDoubleClick={() => select(opp.id)}
                            title="Drag to slide · drag the right edge to resize · double-click to edit"
                          >
                            <span className="gbar-label">{barText}</span>
                            <span className="gbar-resize" title="Drag to change length" onPointerDown={(e) => onResizeDown(e, opp)} />
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* role rows, grouped energy-first */}
                    {isOpen &&
                      ordered.map((a) => {
                        const person = a.personId ? roster.find((p) => p.id === a.personId) : undefined
                        return (
                          <tr key={a.id} className={`rolerow ${isSel ? 'sel' : ''}`}>
                            <td className={`lab role team-${a.group}`}>
                              <span className="role-name">
                                <span className="role-text">{person ? person.name : a.role}<span className="faint"> {person ? person.role : 'role'}</span></span>
                              </span>
                              <span className="row" style={{ gap: 5, flex: '0 0 auto' }}>
                                <span className={`teamtag ${a.group}`}>{a.group === 'energy' ? 'Energy' : 'Delivery'}</span>
                                {editMode && (
                                  <button
                                    className="mini-btn danger"
                                    title="Remove role"
                                    onClick={() => {
                                      if (confirm(`Remove ${person ? person.name : a.role} from “${opp.name}”? This deletes their planned FTE.`))
                                        removeAssignment(opp.id, a.id)
                                    }}
                                  >×</button>
                                )}
                              </span>
                            </td>
                            {weeks.map((w, i) => {
                              const off = i - startCol
                              const inSpan = off >= 0 && off < opp.durationWeeks
                              if (!inSpan) return <td key={w} className={`cell out ${i === todayCol ? 'today' : ''}`} />
                              const v = a.fte[String(off)] || 0
                              return (
                                <td key={w} className={`cell ${v ? a.group : ''} ${i === todayCol ? 'today' : ''}`}>
                                  <input className="num" type="number" min={0} step={0.25} value={v || ''} placeholder="·"
                                    onChange={(e) => setFte(opp.id, a.id, off, Number(e.target.value) || 0)} />
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}

                    {/* quick-add row */}
                    {isOpen && addingFor === opp.id && (
                      <tr className="addrow">
                        <td className="addcell" colSpan={weeks.length + 1}>
                          <div className="quick-add">
                            <span className="faint">Add:</span>
                            <select value={addPersonPick} onChange={(e) => { setAddPersonPick(e.target.value); setAddRoleText('') }}>
                              <option value="">named person…</option>
                              {roster.filter((p) => !opp.assignments.some((a) => a.personId === p.id)).map((p) => (
                                <option key={p.id} value={p.id}>{p.name} — {p.role} ({p.group === 'energy' ? 'Energy' : 'Delivery'})</option>
                              ))}
                            </select>
                            <span className="faint">or role</span>
                            <input placeholder="e.g. Data Scientist" value={addRoleText} onChange={(e) => { setAddRoleText(e.target.value); setAddPersonPick('') }} style={{ width: 150 }} />
                            <select value={addRoleGroup} onChange={(e) => setAddRoleGroup(e.target.value as 'energy' | 'delivery')}>
                              <option value="energy">Energy</option>
                              <option value="delivery">Delivery</option>
                            </select>
                            <button className="btn sm primary" disabled={!addPersonPick && !addRoleText.trim()} onClick={() => quickAdd(opp.id)}>Add</button>
                            <button className="btn sm ghost" onClick={() => { setAddingFor(null); setAddPersonPick(''); setAddRoleText('') }}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="legend" style={{ marginTop: 10 }}>
        <span className="faint">Bar shows deal value @ close % · drag the bar to slide · drag its right edge to resize · double-click a name for full details</span>
      </div>
    </div>
  )
}
