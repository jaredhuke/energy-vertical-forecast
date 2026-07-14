import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Assignment, Group, Opportunity } from '../types'
import type { DraftRow, ImportDraft } from '../lib/xlsxImport'
import { weekKeyOf } from '../lib/weeks'
import { fmtMoney } from '../lib/format'

function rid(): string {
  return `a-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.floor(Math.random() * 1e9).toString(36)}`
}

/** Preview + fix-up step between a parsed workbook and a real opportunity.
 *  Every issue the parser flagged is answerable right here — nothing imports
 *  until you've seen what it understood. */
export function ImportExcel({ draft, fileName, onClose }: { draft: ImportDraft; fileName: string; onClose: () => void }) {
  const stages = useStore((s) => s.stages)
  const roster = useStore((s) => s.roster)
  const insertOpportunity = useStore((s) => s.insertOpportunity)

  const [name, setName] = useState(draft.name)
  const [client, setClient] = useState(draft.client)
  const [type, setType] = useState(draft.type)
  const [stageId, setStageId] = useState<string | null>(draft.stageId)
  const [closePct, setClosePct] = useState<number | null>(draft.closePct)
  const [dealValue, setDealValue] = useState(draft.dealValue)
  const [booking, setBooking] = useState(draft.booking)
  const [startWeek, setStartWeek] = useState(draft.startWeek)
  const [durationWeeks, setDurationWeeks] = useState(draft.durationWeeks)
  const [rows, setRows] = useState<DraftRow[]>(draft.rows)

  const internal = type === 'internal'
  const patchRow = (i: number, patch: Partial<DraftRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const totals = useMemo(() => {
    let fteWeeks = 0
    for (const r of rows) for (const v of Object.values(r.fte)) fteWeeks += v
    return { rows: rows.length, fteWeeks }
  }, [rows])

  const needsStage = !internal && stageId == null && closePct == null
  const canCreate = name.trim().length > 0 && !needsStage

  function create() {
    const assignments: Assignment[] = rows.map((r) => {
      const person = r.personId ? roster.find((p) => p.id === r.personId) : undefined
      return {
        id: rid(),
        personId: person?.id,
        role: person ? person.role : r.label,
        group: person ? person.group : r.team,
        fte: r.fte,
      }
    })
    const opp: Omit<Opportunity, 'id' | 'updatedAt' | 'updatedBy'> = {
      name: name.trim(),
      client: client.trim(),
      type,
      stageId: stageId ?? stages[0]?.id ?? 'lead',
      probabilityOverride: internal ? undefined : closePct,
      dealValue: internal ? 0 : dealValue,
      booking: internal ? 'forecast' : booking,
      startWeek,
      durationWeeks,
      assignments,
    }
    insertOpportunity(opp)
    onClose()
  }

  return (
    <div className="card">
      <div className="h-row">
        <h2>Import from Excel — {fileName}</h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>×</button>
      </div>

      {draft.issues.length > 0 && (
        <div className="import-issues">
          <div className="import-issues-title">Checked the file — {draft.issues.length === 1 ? 'one thing needs' : `${draft.issues.length} things need`} your eye</div>
          <ul>
            {draft.issues.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '2 1 200px' }}>
          Opportunity
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it to import" />
        </label>
        <label className="field" style={{ flex: '1 1 140px' }}>
          Client
          <input value={client} onChange={(e) => setClient(e.target.value)} />
        </label>
        <div className="field">
          <span>Type</span>
          <div className="seg">
            <button className={!internal ? 'on' : ''} aria-pressed={!internal} onClick={() => setType('external')}>External</button>
            <button className={internal ? 'on' : ''} aria-pressed={internal} onClick={() => setType('internal')}>Internal</button>
          </div>
        </div>
        {!internal && (
          <>
            <label className="field" style={{ flex: '0 1 170px' }}>
              <span>Stage {needsStage && <b style={{ color: 'var(--warn)' }}>— pick one</b>}</span>
              <select value={stageId ?? ''} onChange={(e) => setStageId(e.target.value || null)}>
                <option value="">{draft.stageRaw ? `“${draft.stageRaw}” → choose…` : 'Choose…'}</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {Math.round(s.probability * 100)}%</option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: '0 1 110px' }}>
              <span>Close % <span className="faint">{closePct == null ? '(stage default)' : '(override)'}</span></span>
              <input
                type="number" min={0} max={100} step={5}
                value={closePct == null ? '' : Math.round(closePct * 100)}
                placeholder="auto"
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => setClosePct(e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
              />
            </label>
            <label className="field" style={{ flex: '0 1 150px' }}>
              <span style={{ whiteSpace: 'nowrap' }}>Deal value ($) <span className="faint num">{dealValue > 0 ? `= ${fmtMoney(dealValue)}` : ''}</span></span>
              <input type="number" min={0} step={50000} value={dealValue} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setDealValue(Number(e.target.value) || 0)} />
            </label>
            <div className="field">
              <span>Booking</span>
              <div className="seg">
                <button className={booking !== 'signed' ? 'on' : ''} aria-pressed={booking !== 'signed'} onClick={() => setBooking('forecast')}>Forecast</button>
                <button className={booking === 'signed' ? 'on' : ''} aria-pressed={booking === 'signed'} onClick={() => setBooking('signed')}>Signed</button>
              </div>
            </div>
          </>
        )}
        <label className="field">
          <span>Start week {draft.startAdjusted && <span className="faint">(snapped to Monday)</span>}</span>
          <input
            type="date"
            value={startWeek}
            onChange={(e) => {
              const v = e.target.value
              if (v) setStartWeek(weekKeyOf(new Date(v + 'T00:00:00')))
            }}
          />
        </label>
        <label className="field" style={{ flex: '0 1 110px' }}>
          Duration (weeks)
          <input type="number" min={1} max={104} value={durationWeeks} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setDurationWeeks(Math.max(1, Math.min(104, Number(e.target.value) || 1)))} />
        </label>
      </div>

      <div className="section-title" style={{ marginTop: 18 }}>Staffing found in the file</div>
      {rows.length === 0 ? (
        <div className="empty">No staffing rows — you can add roles on the timeline after import.</div>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>Row in file</th>
              <th style={{ width: 220 }}>Matches roster person</th>
              <th style={{ width: 110 }}>Team</th>
              <th className="num" style={{ width: 110 }}>FTE-weeks</th>
              <th className="num" style={{ width: 110 }}>Weeks staffed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const person = r.personId ? roster.find((p) => p.id === r.personId) : undefined
              const fteWeeks = Object.values(r.fte).reduce((s, v) => s + v, 0)
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 550 }}>{r.label}</td>
                  <td>
                    <select
                      value={r.personId ?? ''}
                      onChange={(e) => {
                        const p = roster.find((x) => x.id === e.target.value)
                        patchRow(i, { personId: p?.id, team: p ? p.group : r.team })
                      }}
                    >
                      <option value="">— role line (no person) —</option>
                      {roster.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} — {p.role} ({p.group})</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {person ? (
                      <span className={`teamtag ${person.group}`}>{person.group === 'energy' ? 'Energy' : 'Delivery'}</span>
                    ) : (
                      <select value={r.team} onChange={(e) => patchRow(i, { team: e.target.value as Group })}>
                        <option value="energy">Energy</option>
                        <option value="delivery">Delivery</option>
                      </select>
                    )}
                  </td>
                  <td className="num">{fteWeeks.toFixed(2)}</td>
                  <td className="num faint">{Object.keys(r.fte).length}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="h-row" style={{ marginTop: 16 }}>
        <span className="faint num">
          {totals.rows} staffing {totals.rows === 1 ? 'row' : 'rows'} · {totals.fteWeeks.toFixed(1)} FTE-weeks over {durationWeeks} weeks
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!canCreate} title={canCreate ? 'Create this opportunity' : 'Name it and pick a stage (or close %) first'} onClick={create}>
            Create opportunity
          </button>
        </div>
      </div>
    </div>
  )
}
