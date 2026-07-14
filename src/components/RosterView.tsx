import { useStore } from '../store/useStore'
import type { Group, Person } from '../types'

const LEVELS = ['Junior', 'Consultant', 'Senior', 'Lead', 'Principal', 'Sr Principal', 'Director']

function RosterTable({ group }: { group: Group }) {
  const roster = useStore((s) => s.roster)
  const updatePerson = useStore((s) => s.updatePerson)
  const removePerson = useStore((s) => s.removePerson)
  const addPerson = useStore((s) => s.addPerson)
  const people = roster.filter((p) => p.group === group)

  const set = (id: string, patch: Partial<Person>) => updatePerson(id, patch)

  return (
    <div className="card">
      <div className="h-row">
        <h2>
          <span className={`swatch ${group}`} style={{ marginRight: 8 }} />
          {group === 'energy' ? 'Energy Vertical — direct' : 'Delivery — indirect'}
          <span className="faint" style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>{people.length}</span>
        </h2>
        <button className="btn sm" onClick={() => addPerson(group)}>+ Add person</button>
      </div>
      {people.length === 0 ? (
        <div className="empty">No {group} people yet.</div>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: '22%' }}>Name</th>
              <th style={{ width: '14%' }}>Level</th>
              <th style={{ width: '24%' }}>Title</th>
              <th style={{ width: '20%' }}>Role</th>
              <th className="num" style={{ width: 90 }}>Capacity</th>
              <th className="num" style={{ width: 110 }}>Rate $/week</th>
              <th style={{ width: 34 }}></th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td><input className="plain" style={{ width: '100%' }} value={p.name} onChange={(e) => set(p.id, { name: e.target.value })} /></td>
                <td>
                  <select value={p.level} onChange={(e) => set(p.id, { level: e.target.value })} style={{ width: '100%', background: 'transparent', borderColor: 'transparent' }}>
                    {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                    {!LEVELS.includes(p.level) && <option value={p.level}>{p.level}</option>}
                  </select>
                </td>
                <td><input className="plain" style={{ width: '100%' }} value={p.title} placeholder="—" onChange={(e) => set(p.id, { title: e.target.value })} /></td>
                <td><input className="plain" style={{ width: '100%' }} value={p.role} onChange={(e) => set(p.id, { role: e.target.value })} /></td>
                <td className="num"><input className="plain num" style={{ width: 60, textAlign: 'right' }} type="number" min={0} step={0.1} value={p.capacity} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => set(p.id, { capacity: Number(e.target.value) || 0 })} /></td>
                <td className="num"><input className="plain num" style={{ width: 80, textAlign: 'right' }} type="number" min={0} step={100} value={p.costRate ?? ''} placeholder="—" onWheel={(e) => e.currentTarget.blur()} onChange={(e) => set(p.id, { costRate: e.target.value === '' ? undefined : Number(e.target.value) })} /></td>
                <td><button className="icon-btn" title="Remove" onClick={() => { if (confirm(`Remove ${p.name}? Their assignments become unassigned.`)) removePerson(p.id) }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function RosterView() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="hint">
        Manage people here — name, level, role, weekly capacity (1.0 = full time), optional $/week rate. Their weekly
        forecast utilization is on the <b>Utilization</b> tab. Delivery lines can be named here or left abstract
        (added as role lines directly on an opportunity).
      </div>
      <RosterTable group="energy" />
      <RosterTable group="delivery" />
    </div>
  )
}
