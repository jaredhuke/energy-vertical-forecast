import type { ForecastState, Opportunity } from '../types'
import { effectiveProbability, stageName } from './funnel'
import { addWeeks, isoWeekNum } from './weeks'

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

/** Load seed data shipped in /public/data on first run. */
export async function loadSeed(): Promise<Bundle | null> {
  const base = import.meta.env.BASE_URL
  try {
    const manifest = await fetch(`${base}data/manifest.json`).then((r) => r.json())
    const roster = await fetch(`${base}data/roster.json`).then((r) => r.json())
    const stages = await fetch(`${base}data/stages.json`).then((r) => r.json())
    const opportunities: Opportunity[] = await Promise.all(
      (manifest.opportunities as string[]).map((id) =>
        fetch(`${base}data/opportunities/${id}.json`).then((r) => r.json()),
      ),
    )
    return { roster, stages, opportunities, snapshots: [] }
  } catch (e) {
    console.warn('Seed load failed', e)
    return null
  }
}
