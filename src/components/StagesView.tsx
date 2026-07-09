import { useStore } from '../store/useStore'

export function StagesView() {
  const stages = useStore((s) => s.stages)
  const updateStage = useStore((s) => s.updateStage)
  const opportunities = useStore((s) => s.opportunities)

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 640 }}>
      <div className="hint">
        These stages and their default close probabilities drive the weighted forecast (weighted FTE = planned FTE ×
        close %). Editing a probability re-weights every opportunity in that stage instantly. Individual opportunities
        can still override their own close % in the editor.
      </div>
      <div className="card">
        <h2>Funnel stages</h2>
        <table className="sheet">
          <thead>
            <tr><th>Stage</th><th className="num" style={{ width: 160 }}>Default close %</th><th className="num" style={{ width: 110 }}>Opportunities</th></tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.id}>
                <td><input className="plain" value={s.name} onChange={(e) => updateStage(s.id, { name: e.target.value })} /></td>
                <td className="num">
                  <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={Math.round(s.probability * 100)}
                      onChange={(e) => updateStage(s.id, { probability: Number(e.target.value) / 100 })}
                      style={{ width: 90 }}
                    />
                    <span className="num" style={{ width: 42, textAlign: 'right', color: 'var(--blue)' }}>{Math.round(s.probability * 100)}%</span>
                  </div>
                </td>
                <td className="num faint">{opportunities.filter((o) => o.stageId === s.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
