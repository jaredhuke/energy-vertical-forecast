import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { GANTT_LABEL_MAX, GANTT_LABEL_MIN, useStore } from '../store/useStore'
import type { ForecastState, Opportunity } from '../types'
import { effectiveProbability, stageName } from '../lib/funnel'
import { oppStartMonday, personLoads } from '../lib/analytics'
import { addWeeks, isoWeekNum, weekKeyOf, weekLabel, weekRange, weeksBetween } from '../lib/weeks'
import { fmtMoney } from '../lib/format'

/** Prevent scroll-wheel from silently changing a focused number input while
 *  panning the timeline — a classic spreadsheet-app data hazard. */
const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => (e.currentTarget as HTMLInputElement).blur()

const COL = 46 // px per week column — must match the colgroup width below

function weightedFteWeeks(o: Opportunity, prob: number): number {
  let sum = 0
  for (const a of o.assignments)
    for (let off = 0; off < o.durationWeeks; off++) sum += (a.fte[String(off)] || 0) * prob
  return sum
}


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
  const labelW = useStore((s) => s.ganttLabelWidth)
  const setLabelW = useStore((s) => s.setGanttLabelWidth)

  const tableRef = useRef<HTMLTableElement>(null)
  const labelColRef = useRef<HTMLTableColElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null) // the horizontally-scrolling timeline

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editMode, setEditMode] = useState(false)
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [addPersonPick, setAddPersonPick] = useState('')
  const [addRoleText, setAddRoleText] = useState('')
  const [addRoleGroup, setAddRoleGroup] = useState<'energy' | 'delivery'>('energy')

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Fixed axis start (8 weeks before today) so sliding a bar never shifts the
  // grid; the window shows recent past → future and pans horizontally.
  const start = addWeeks(weekKeyOf(), -8)
  let end = addWeeks(weekKeyOf(), 20)
  for (const o of opportunities) {
    const oEnd = addWeeks(oppStartMonday(o), o.durationWeeks)
    if (weeksBetween(end, oEnd) > 0) end = oEnd
  }
  const weeks = weekRange(start, weeksBetween(start, end) + 3)
  const todayCol = weeksBetween(start, weekKeyOf())

  // Calendar pan: scroll the timeline left/right; "Now" re-centres on today.
  // Direct scrollLeft (not scrollBy{smooth}, which no-ops in some browsers);
  // the .gantt CSS scroll-behavior adds the smooth animation where supported.
  const panBy = (cols: number) => {
    const el = scrollRef.current
    if (el) el.scrollLeft = Math.max(0, el.scrollLeft + cols * COL)
  }
  const scrollToToday = () => {
    const el = scrollRef.current
    if (el) el.scrollLeft = Math.max(0, (todayCol - 2) * COL)
  }
  // Land the initial view on "now" (not 8 weeks of past) once, on mount.
  useEffect(() => {
    scrollToToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cross-project load per named person per week, so a cell that pushes
  // someone over capacity warns right where you're typing.
  const stateObj = useMemo<ForecastState>(
    () => ({ roster, stages, opportunities, snapshots: [], editor: '' }),
    [roster, stages, opportunities],
  )
  const loadByPerson = useMemo(
    () => new Map(personLoads(stateObj, weeks).map((l) => [l.person.id, l])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stateObj, weeks.length, weeks[0]],
  )

  // Stable row order: re-sort only when the set of opportunities changes.
  const orderIds = useMemo(
    () => [...opportunities].sort((a, b) => weeksBetween(b.startWeek, a.startWeek)).map((o) => o.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opportunities.map((o) => o.id).join('|')],
  )
  const byId = new Map(opportunities.map((o) => [o.id, o]))
  const sorted = orderIds.map((id) => byId.get(id)).filter((o): o is Opportunity => !!o)

  // ---- fluid slide: transform-follow the bar, snap to a week on release.
  //      Escape or a cancelled pointer (alt-tab, touch interrupt) aborts the
  //      move cleanly instead of leaking listeners mid-drag.
  function onBarDown(e: React.PointerEvent, opp: Opportunity) {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const startX = e.clientX
    const origStart = opp.startWeek
    el.classList.add('dragging')
    const move = (ev: PointerEvent) => {
      el.style.transform = `translateX(${ev.clientX - startX}px)`
    }
    const finish = (commit: boolean, clientX?: number) => {
      el.style.transform = ''
      el.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      setDraggingId(null)
      if (commit && clientX != null) {
        const dw = Math.round((clientX - startX) / COL)
        if (dw !== 0) useStore.getState().updateOpportunity(opp.id, { startWeek: addWeeks(origStart, dw) })
      }
    }
    const up = (ev: PointerEvent) => finish(true, ev.clientX)
    const cancel = () => finish(false)
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    setDraggingId(opp.id)
  }

  // ---- resize: drag the right edge to change duration, warn on data loss.
  //      Escape / pointer-cancel aborts, restoring the original width.
  function onResizeDown(e: React.PointerEvent, opp: Opportunity) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation() // don't start a slide
    const el = (e.currentTarget as HTMLElement).parentElement as HTMLElement
    const startX = e.clientX
    const origDur = opp.durationWeeks
    el.classList.add('resizing')
    const resetWidth = () => (el.style.width = `${Math.max(0, origDur * COL - 4)}px`)
    const move = (ev: PointerEvent) => {
      el.style.width = `${Math.max(COL - 4, origDur * COL - 4 + (ev.clientX - startX))}px`
    }
    const finish = (commit: boolean, clientX?: number) => {
      el.classList.remove('resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      if (!commit) return resetWidth()
      const newDur = Math.max(1, Math.round(origDur + ((clientX ?? startX) - startX) / COL))
      const st = useStore.getState()
      const cur = st.opportunities.find((o) => o.id === opp.id)
      if (!cur || newDur === origDur) return resetWidth()
      if (newDur < origDur) {
        const lost = cur.assignments.some((a) => Object.keys(a.fte).some((k) => Number(k) >= newDur))
        if (lost && !confirm(`Shortening “${cur.name}” to ${newDur} weeks will delete planned FTE beyond week ${newDur}. Continue?`)) {
          return resetWidth()
        }
      }
      st.setDuration(opp.id, newDur) // re-render sets the width from the new duration
    }
    const up = (ev: PointerEvent) => finish(true, ev.clientX)
    const cancel = () => finish(false)
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
  }

  // ---- pinned-column resize: drag the header handle; double-click auto-fits
  //      the longest name. Live-follows via direct DOM (no re-render churn),
  //      commits to the store on release; Escape / pointer-cancel aborts.
  function onLabelResizeDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const origW = labelW
    const apply = (w: number) => {
      const clamped = Math.max(GANTT_LABEL_MIN, Math.min(GANTT_LABEL_MAX, w))
      if (labelColRef.current) labelColRef.current.style.width = `${clamped}px`
      if (tableRef.current) tableRef.current.style.width = `${clamped + weeks.length * COL}px`
      return clamped
    }
    let lastW = origW
    tableRef.current?.classList.add('col-resizing')
    const move = (ev: PointerEvent) => {
      lastW = apply(origW + (ev.clientX - startX))
    }
    const finish = (commit: boolean) => {
      tableRef.current?.classList.remove('col-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      if (commit) setLabelW(lastW)
      else apply(origW)
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
  }
  function autoFitLabel() {
    const table = tableRef.current
    if (!table) return
    let max = GANTT_LABEL_MIN
    // project rows: caret (21) + slide buttons (~84) + paddings (~24)
    table.querySelectorAll<HTMLElement>('.lab .proj').forEach((el) => {
      max = Math.max(max, el.scrollWidth + 21 + 84 + 24)
    })
    // role rows: teamtag (~74) + indent/padding (~30)
    table.querySelectorAll<HTMLElement>('.lab .role-text').forEach((el) => {
      max = Math.max(max, el.scrollWidth + 74 + 30)
    })
    setLabelW(max)
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
          <div className="pan" role="group" aria-label="Slide the calendar">
            <button className="mini-btn" title="Slide 4 weeks earlier" aria-label="Slide earlier" onClick={() => panBy(-4)}>‹</button>
            <button className="mini-btn now" title="Jump to today" onClick={() => scrollToToday()}>Now</button>
            <button className="mini-btn" title="Slide 4 weeks later" aria-label="Slide later" onClick={() => panBy(4)}>›</button>
          </div>
          <button
            className={`btn sm ${editMode ? 'primary' : 'ghost'}`}
            onClick={() => setEditMode((v) => !v)}
            aria-pressed={editMode}
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
        <div className="gantt" ref={scrollRef}>
          <table ref={tableRef} style={{ width: labelW + weeks.length * COL }}>
            <colgroup>
              <col ref={labelColRef} style={{ width: labelW }} />
              {weeks.map((w) => (
                <col key={w} style={{ width: COL }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="lab">
                  Project / role
                  <span
                    className="col-resize"
                    title="Drag to resize this column · double-click to fit the longest name"
                    onPointerDown={onLabelResizeDown}
                    onDoubleClick={autoFitLabel}
                  />
                </th>
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
                              // Warn in-place when this person's EXPECTED (close-%
                              // weighted) load across all projects exceeds capacity
                              // this week — consistent with forward utilization.
                              const load = person ? loadByPerson.get(person.id) : undefined
                              const wkExpected = load?.byWeek[w]?.weighted ?? 0
                              const wkCommitted = load?.byWeek[w]?.committed ?? 0
                              const over = !!person && v > 0 && wkExpected > person.capacity + 1e-9
                              return (
                                <td
                                  key={w}
                                  className={`cell ${v ? a.group : ''} ${over ? 'overcap' : ''} ${i === todayCol ? 'today' : ''}`}
                                  title={over ? `Over capacity in ${weekLabel(w)}: ${person!.name} is expected at ${wkExpected.toFixed(2)} FTE of ${person!.capacity.toFixed(1)} across all projects (${wkCommitted.toFixed(2)} booked if every deal lands)` : undefined}
                                >
                                  <input className="num" type="number" min={0} step={0.25} value={v || ''} placeholder="·"
                                    aria-label={`${person ? person.name : a.role}, ${weekLabel(w)} FTE`}
                                    onWheel={blurOnWheel}
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
