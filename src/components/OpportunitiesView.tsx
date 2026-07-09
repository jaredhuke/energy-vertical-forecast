import { useStore } from '../store/useStore'
import { GanttView } from './GanttView'
import { OpportunityMeta } from './OpportunityMeta'

export function OpportunitiesView() {
  const opportunities = useStore((s) => s.opportunities)
  const selectedId = useStore((s) => s.selectedOpportunityId)
  const selected = opportunities.find((o) => o.id === selectedId) || null

  return (
    <div className="grid" style={{ gap: 16 }}>
      <GanttView />
      {selected && <OpportunityMeta key={selected.id} opp={selected} />}
    </div>
  )
}
