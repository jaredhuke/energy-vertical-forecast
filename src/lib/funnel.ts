import type { StageDef } from '../types'

/** Starting funnel ladder. Editable in-app; this is only the seed. */
export const DEFAULT_STAGES: StageDef[] = [
  { id: 'lead', name: 'Lead', probability: 0.05 },
  { id: 'qualified', name: 'Qualified', probability: 0.2 },
  { id: 'proposal', name: 'Proposal', probability: 0.4 },
  { id: 'negotiation', name: 'Negotiation', probability: 0.7 },
  { id: 'closed', name: 'Closed', probability: 1.0 },
]

/** Effective probability for an opportunity: override if set, else stage default. */
export function effectiveProbability(
  stages: StageDef[],
  stageId: string,
  override?: number | null,
): number {
  if (override != null) return override
  const stage = stages.find((s) => s.id === stageId)
  return stage ? stage.probability : 0
}

export function stageName(stages: StageDef[], stageId: string): string {
  return stages.find((s) => s.id === stageId)?.name ?? stageId
}
