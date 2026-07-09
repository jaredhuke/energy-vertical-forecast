import type { ForecastState, Opportunity, Person, StageDef } from '../types'
import { effectiveProbability, stageName } from './funnel'
import { addWeeks, isoWeekNum } from './weeks'

// Seed data bundled at build time (not fetched) so the app works from any
// host AND from a single-file / file:// build with no network.
import rosterSeed from '../../public/data/roster.json'
import stagesSeed from '../../public/data/stages.json'
const oppModules = import.meta.glob('../../public/data/opportunities/*.json', {
  eager: true,
  import: 'default',
})

/** The persisted shape (everything except transient UI state). */
export type Bundle = Pick<ForecastState, 'roster' | 'stages' | 'opportunities' | 'snapshots'>

export function toBundle(state: ForecastState): Bundle {
  return {
    roster: state.roster,
    stages: state.stages,
    opportunities: state.opportunities,
    snapshots: state.snapshots,
  }
}

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function exportJson(state: ForecastState) {
  download('forecast-bundle.json', JSON.stringify(toBundle(state), null, 2), 'application/json')
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Flatten every assignment × week into one CSV row (Excel-friendly). */
export function exportCsv(state: ForecastState) {
  const header = [
    'Opportunity',
    'Client',
    'Stage',
    'Probability',
    'Group',
    'Role',
    'Person',
    'WeekStart',
    'ISOWeek',
    'FTE',
    'WeightedFTE',
  ]
  const rows: string[] = [header.join(',')]
  for (const o of state.opportunities) {
    const prob = effectiveProbability(state.stages, o.stageId, o.probabilityOverride)
    for (const a of o.assignments) {
      const person = a.personId ? state.roster.find((p) => p.id === a.personId)?.name ?? '' : ''
      for (let off = 0; off < o.durationWeeks; off++) {
        const fte = a.fte[String(off)] || 0
        if (!fte) continue
        const week = addWeeks(o.startWeek, off)
        rows.push(
          [
            o.name,
            o.client,
            stageName(state.stages, o.stageId),
            prob.toFixed(2),
            a.group,
            a.role,
            person,
            week,
            isoWeekNum(week),
            fte.toFixed(2),
            (fte * prob).toFixed(3),
          ]
            .map(csvCell)
            .join(','),
        )
      }
    }
  }
  download('forecast-allocations.csv', rows.join('\n'), 'text/csv')
}

/** Seed data (bundled from /public/data at build time) for first run. */
export async function loadSeed(): Promise<Bundle | null> {
  try {
    const opportunities = Object.values(oppModules) as Opportunity[]
    return {
      roster: rosterSeed as Person[],
      stages: stagesSeed as StageDef[],
      opportunities: opportunities.sort((a, b) => a.id.localeCompare(b.id)),
      snapshots: [],
    }
  } catch (e) {
    console.warn('Seed load failed', e)
    return null
  }
}
