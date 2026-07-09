import { Fragment, useCallback, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Opportunity } from '../types'
import { effectiveProbability, stageName } from '../lib/funnel'
import { horizon } from '../lib/analytics'
import { addWeeks, isoWeekNum, weekKeyOf, weekLabel, weekRange, weeksBetween } from '../lib/weeks'

const COL = 46 // px per week column — must match .gantt td.cell width in theme.css

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
  const setFte = useStore((s) => s.setFte)
  const addOpportunity = useStore((s) => s.addOpportunity)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragRef = useRef<{ oppId: string; startX: number; origStart: string } | null>(null)

  // Shared timeline axis with a little padding on each side.
  const base = horizon(opportunities, 18)
  const start = addWeeks(base.weeks[0], -1)
  const weeks = weekRange(start, base.weeks.length + 4)
  const todayCol = weeksBetween(start, weekKeyOf())

  const onMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dw = Math.round((e.clientX - d.startX) / COL)
    const target = addWeeks(d.origStart, dw)
    const st = useStore.getState()
    const cur = st.opportunities.find((o) => o.id === d.oppId)
    if (cur && cur.startWeek !== target) st.updateOpportunity(d.oppId, { startWeek: target })
  }, [])

  const onUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    setDraggingId(null)
  }, [onMove])

  function onBarDown(e: React.PointerEvent, opp: Opportunity) {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { oppId: opp.id, startX: e.clientX, origStart: opp.startWeek }
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
          <span className="hint">Drag a bar to slide · click a name to edit details · type in a cell to set FTE</span>
          <button className="btn primary sm" onClick={() => addOpportunity()}>+ New opportunity</button>
        </div>
      </div>

      {opportunities.length === 0 ? (
        <div className="empty">No opportunities yet — add your first pursuit.</div>
      ) : (
        <div className="gantt">
          <table>
            <thead>
              <tr>
                <th className="lab">Project / role</th>
                {weeks.map((w, i) => (
                  <th key={w} className={`wk ${i === todayCol ? 'today' : ''}`}>
                    {weekLabel(w)}
                    <span className="wknum">{isoWeekNum(w)}</span>
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
                return (
                  <Fragment key={opp.id}>
                    {/* project bar row */}
                    <tr className={`barrow ${draggingId === opp.id ? 'grabbing' : ''} ${isSel ? 'sel' : ''}`}>
                      <td className="lab">
                        <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                          <button className="linklike proj" onClick={() => select(opp.id)} title="Edit details">{opp.name}</button>
                          <span className="row" style={{ gap: 2 }}>
                            <button className="icon-btn" title="Slide back 1 week" onClick={() => slide(opp.id, -1)}>‹</button>
                            <button className="icon-btn" title="Slide forward 1 week" onClick={() => slide(opp.id, 1)}>›</button>
                          </span>
                        </div>
                        <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                          <span className="chip" style={{ padding: '0 6px' }}>{stageName(stages, opp.stageId)} · {Math.round(prob * 100)}%</span>
                          <span style={{ marginLeft: 6 }}>{opp.durationWeeks} wk</span>
                        </div>
                      </td>
                      {weeks.map((w, i) => {
                        const inSpan = i >= startCol && i < startCol + opp.durationWeeks
                        const isFirst = i === startCol
                        return (
                          <td
                            key={w}
                            className={`barcell ${inSpan ? 'on' : ''} ${i === todayCol ? 'today' : ''}`}
                            onPointerDown={inSpan ? (e) => onBarDown(e, opp) : undefined}
                          >
                            {isFirst && <span className="barlabel">{weighted.toFixed(1)} FTE·wk</span>}
                          </td>
                        )
                      })}
                    </tr>

                    {/* role rows */}
                    {opp.assignments.map((a) => {
                      const person = a.personId ? roster.find((p) => p.id === a.personId) : undefined
                      return (
                        <tr key={a.id} className={isSel ? 'sel' : ''}>
                          <td className="lab role">
                            <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                              <span className="row" style={{ gap: 6, minWidth: 0 }}>
                                <span className={`swatch ${a.group}`} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {person ? person.name : a.role}
                                  <span className="faint" style={{ marginLeft: 5, fontSize: 11 }}>{person ? person.role : 'role'}</span>
                                </span>
                              </span>
                              <button className="icon-btn" title="Remove role" onClick={() => removeAssignment(opp.id, a.id)}>×</button>
                            </div>
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
        <span className="faint">Cells show planned FTE per role per week</span>
      </div>
    </div>
  )
}
