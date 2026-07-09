import { Fragment, useCallback, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Opportunity } from '../types'
import { effectiveProbability, stageName } from '../lib/funnel'
import { horizon } from '../lib/analytics'
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

export function GanttView() {
  const opportunities = useStore((s) => s.opportunities)
  const stages = useStore((s) => s.stages)
  const roster = useStore((s) => s.roster)
  const selectedId = useStore((s) => s.selectedOpportunityId)
  const select = useStore((s) => s.selectOpportunity)
  const slide = useStore((s) => s.slideOpportunity)
  const removeAssignment = useStore((s) => s.removeAssignment)
  const setFte = useStore((s) => s.setFte)
  const addOpportunity = useStore((s) => s.addOpportunity)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const dragRef = useRef<DragState | null>(null)

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Shared timeline axis with a little padding on each side.
  const base = horizon(opportunities, 18)
  const start = addWeeks(base.weeks[0], -1)
  const weeks = weekRange(start, base.weeks.length + 4)
  const todayCol = weeksBetween(start, weekKeyOf())

  // ---- fluid drag: transform-follow the bar element, snap to a week on release
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
      d.el.style.transform = '' // cleared in the same tick as the commit → no flash
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

  const sorted = [...opportunities].sort((a, b) => weeksBetween(b.startWeek, a.startWeek))

  return (
    <div className="card">
      <div className="h-row">
        <h2>Timeline</h2>
        <div className="row" style={{ gap: 12 }}>
          <span className="hint">Drag a bar to slide · click a name to edit · type in a cell to set FTE</span>
          <button className="btn primary sm" onClick={() => addOpportunity()}>+ New opportunity</button>
        </div>
      </div>

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
                const prob = effectiveProbability(stages, opp.stageId, opp.probabilityOverride)
                const startCol = weeksBetween(start, opp.startWeek)
                const weighted = weightedFteWeeks(opp, prob)
                const isSel = opp.id === selectedId
                const isOpen = !collapsed.has(opp.id)
                const signed = opp.booking === 'signed'
                const money = opp.dealValue ? fmtMoney(opp.dealValue) : null
                const barText = signed
                  ? money
                    ? `Signed · ${money}`
                    : 'Signed'
                  : money
                    ? `${money} @ ${Math.round(prob * 100)}%`
                    : `${weighted.toFixed(1)} FTE·wk`
                return (
                  <Fragment key={opp.id}>
                    {/* project bar row */}
                    <tr className={`barrow ${draggingId === opp.id ? 'grabbing' : ''} ${isSel ? 'sel' : ''}`}>
                      <td className="lab">
                        <div className="lab-top">
                          <button
                            className={`caret-btn ${isOpen ? 'open' : ''}`}
                            title={isOpen ? 'Collapse roles' : 'Expand roles'}
                            aria-label={isOpen ? 'Collapse roles' : 'Expand roles'}
                            onClick={() => toggle(opp.id)}
                          >
                            <span className="caret" />
                          </button>
                          <button className="linklike proj" onClick={() => select(opp.id)} title="Edit details">
                            {opp.name}
                          </button>
                          <span className="slide">
                            <button className="mini-btn" title="Slide back 1 week" onClick={() => slide(opp.id, -1)}>‹</button>
                            <button className="mini-btn" title="Slide forward 1 week" onClick={() => slide(opp.id, 1)}>›</button>
                          </span>
                        </div>
                        <div className="lab-sub">
                          <span className="chip xs">{stageName(stages, opp.stageId)} · {Math.round(prob * 100)}%</span>
                          <span className={`chip xs ${signed ? 'good' : ''}`}>{signed ? 'Signed' : 'Forecast'}</span>
                          <span className="faint">{opp.durationWeeks}w</span>
                        </div>
                      </td>
                      <td className="track" colSpan={weeks.length}>
                        <div className="track-inner">
                          {todayCol >= 0 && todayCol < weeks.length && (
                            <div className="today-line" style={{ left: todayCol * COL }} />
                          )}
                          <div
                            className={`gbar ${signed ? 'signed' : ''}`}
                            style={{ left: startCol * COL + 2, width: Math.max(0, opp.durationWeeks * COL - 4) }}
                            onPointerDown={(e) => onBarDown(e, opp)}
                            onDoubleClick={() => select(opp.id)}
                            title="Drag to slide · double-click to edit"
                          >
                            <span className="gbar-label">{barText}</span>
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* role rows */}
                    {isOpen &&
                      opp.assignments.map((a) => {
                        const person = a.personId ? roster.find((p) => p.id === a.personId) : undefined
                        return (
                          <tr key={a.id} className={`rolerow ${isSel ? 'sel' : ''}`}>
                            <td className="lab role">
                              <span className="role-name">
                                <span className={`swatch ${a.group}`} />
                                <span className="role-text">
                                  {person ? person.name : a.role}
                                  <span className="faint"> {person ? person.role : 'role'}</span>
                                </span>
                              </span>
                              <button className="mini-btn" title="Remove role" onClick={() => removeAssignment(opp.id, a.id)}>×</button>
                            </td>
                            {weeks.map((w, i) => {
                              const off = i - startCol
                              const inSpan = off >= 0 && off < opp.durationWeeks
                              if (!inSpan) return <td key={w} className={`cell out ${i === todayCol ? 'today' : ''}`} />
                              const v = a.fte[String(off)] || 0
                              return (
                                <td key={w} className={`cell ${v ? a.group : ''} ${i === todayCol ? 'today' : ''}`}>
                                  <input
                                    className="num"
                                    type="number" min={0} step={0.25}
                                    value={v || ''}
                                    placeholder="·"
                                    onChange={(e) => setFte(opp.id, a.id, off, Number(e.target.value) || 0)}
                                  />
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="legend" style={{ marginTop: 10 }}>
        <span><span className="swatch energy" /> Energy (direct)</span>
        <span><span className="swatch delivery" /> Delivery (indirect)</span>
        <span className="faint">Bar shows deal value @ close % · cells are planned FTE/week</span>
      </div>
    </div>
  )
}
