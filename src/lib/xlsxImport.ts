// ---------------------------------------------------------------------------
// Excel import: a downloadable template + a forgiving parser that turns a
// filled workbook (or a converted EPAM delivery spreadsheet) into a DRAFT
// opportunity plus a list of human-readable issues. The Import wizard shows
// the draft, asks the open questions, and only then creates the opportunity.
// Weeks in the grid are RELATIVE (Week 1..N from the start week) to match the
// app's slide-friendly data model.
// ---------------------------------------------------------------------------
import * as XLSX from 'xlsx'
import type { Group, Person, StageDef } from '../types'
import { dateKey, mondayOf, weekKeyOf } from './weeks'

export const TEMPLATE_WEEKS = 26

// Field labels used in column A of the Opportunity sheet. The parser matches
// them loosely (case-insensitive, prefix), so small edits don't break import.
const L = {
  name: 'Opportunity name',
  client: 'Client',
  type: 'Type (external / internal)',
  stage: 'Stage',
  close: 'Close % (blank = stage default)',
  deal: 'Deal value ($)',
  booking: 'Booking (forecast / signed)',
  start: 'Start week (a Monday)',
  duration: 'Duration (weeks)',
}
const GRID_FIRST_COL = 'Person or role'

/** Build the import template as a workbook (pure — no download side effect). */
export function buildTemplateWorkbook(stages: StageDef[], roster: Person[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  const instructions = [
    ['ENERGY VERTICAL FORECAST — OPPORTUNITY IMPORT TEMPLATE'],
    [],
    ['How to use'],
    ['1.', 'Fill the fields at the top of the "Opportunity" sheet.'],
    ['2.', 'One staffing row per person or role line. Put weekly FTE (for example 0.5) under Week 1, Week 2, … — weeks count from the start week.'],
    ['3.', 'Team must be "energy" or "delivery".'],
    ['4.', `Stage must be one of: ${stages.map((s) => s.name).join(' / ')}. Or leave Stage and set Close % directly.`],
    ['5.', 'Person names that match the app roster link automatically; unknown names import as role lines (you can still match them in the preview).'],
    ['6.', 'In the app: Data → Import from Excel… — review the preview, answer anything flagged, then Create.'],
    [],
    ['Converting an EPAM delivery spreadsheet'],
    ['•', 'Copy each staffing row into the grid, set Team, and re-key calendar weeks to Week 1..N from the start week.'],
    ['•', 'Monthly allocations: divide across that month’s weeks (a 100% month ≈ 1.0 FTE in each of its weeks).'],
    ['•', 'Messy source file? Give it to Claude together with this template — it converts and you just review the preview.'],
    [],
    ['Roster known to the app right now'],
    ...roster.map((p) => ['', `${p.name} — ${p.role} (${p.group}), capacity ${p.capacity}`]),
  ]
  const wsI = XLSX.utils.aoa_to_sheet(instructions)
  wsI['!cols'] = [{ wch: 3 }, { wch: 110 }]
  XLSX.utils.book_append_sheet(wb, wsI, 'Instructions')

  const nextMonday = (() => {
    const d = new Date()
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
    return dateKey(mondayOf(d))
  })()

  const weekHeader = Array.from({ length: TEMPLATE_WEEKS }, (_, i) => `Week ${i + 1}`)
  const grid: (string | number)[][] = [
    [L.name, ''],
    [L.client, ''],
    [L.type, 'external'],
    [L.stage, stages[2]?.name ?? stages[0]?.name ?? ''],
    [L.close, ''],
    [L.deal, 0],
    [L.booking, 'forecast'],
    [L.start, nextMonday],
    [L.duration, 12],
    [],
    [GRID_FIRST_COL, 'Team', ...weekHeader],
    // Two example rows to copy over (delete them if unused).
    [roster.find((p) => p.group === 'energy')?.name ?? 'Solution Architect', 'energy', 0.5, 0.5, 1, 1],
    ['Data Scientist', 'delivery', '', 0.6, 0.6, 0.6],
  ]
  const wsO = XLSX.utils.aoa_to_sheet(grid)
  wsO['!cols'] = [{ wch: 34 }, { wch: 10 }, ...weekHeader.map(() => ({ wch: 8 }))]
  XLSX.utils.book_append_sheet(wb, wsO, 'Opportunity')
  return wb
}

export function downloadTemplate(stages: StageDef[], roster: Person[]) {
  XLSX.writeFile(buildTemplateWorkbook(stages, roster), 'opportunity-import-template.xlsx')
}

// ---------------------------------------------------------------------------

export interface DraftRow {
  label: string
  team: Group
  teamGuessed: boolean // true when the Team cell was missing/unrecognised
  personId?: string // roster match (editable in the wizard)
  fte: Record<string, number> // relative week offset -> FTE
}

export interface ImportDraft {
  name: string
  client: string
  type: 'external' | 'internal'
  stageId: string | null // null = not matched (wizard asks)
  stageRaw: string
  closePct: number | null // explicit close % override, 0..1
  dealValue: number
  booking: 'forecast' | 'signed'
  startWeek: string // normalised to a Monday key
  startAdjusted: boolean // true when we had to snap a non-Monday date
  durationWeeks: number
  rows: DraftRow[]
  issues: string[] // human sentences, shown in the wizard
}

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Loose roster match: exact normalised name, else initial-style match
 *  ("J. Huke" ↔ "Jared Huke"), else unique substring. */
function matchPerson(label: string, roster: Person[]): Person | undefined {
  const n = norm(label)
  if (!n) return undefined
  const exact = roster.find((p) => norm(p.name) === n)
  if (exact) return exact
  const candidates = roster.filter((p) => {
    const pn = norm(p.name)
    const [pFirst, ...pRest] = pn.split(' ')
    const [lFirst, ...lRest] = n.split(' ')
    const lastEqual = pRest.join(' ') && pRest.join(' ') === lRest.join(' ')
    const initialStyle = lastEqual && lFirst.length >= 1 && pFirst.startsWith(lFirst[0])
    return initialStyle || pn.includes(n) || n.includes(pn)
  })
  return candidates.length === 1 ? candidates[0] : undefined
}

function cellDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return dateKey(v)
  const s = String(v ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : dateKey(d)
}

/** Parse a filled template (xlsx / xls / csv) into a draft + issues. */
export function parseOpportunityWorkbook(
  data: ArrayBuffer,
  stages: StageDef[],
  roster: Person[],
): ImportDraft {
  const wb = XLSX.read(data, { cellDates: true })
  // Prefer a sheet named like "Opportunity"; else the first sheet that has the grid header.
  const sheetName =
    wb.SheetNames.find((n) => /opportunit/i.test(n)) ??
    wb.SheetNames.find((n) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1 })
      return rows.some((r) => norm(r?.[0]) === norm(GRID_FIRST_COL))
    }) ??
    wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '' })

  const issues: string[] = []
  const field = (label: string): unknown => {
    const want = norm(label).split(' ').slice(0, 2).join(' ') // match on the first two words
    const row = rows.find((r) => norm(r?.[0]).startsWith(want))
    return row?.[1]
  }

  // ---- header fields
  const name = String(field(L.name) ?? '').trim()
  if (!name) issues.push('No opportunity name — give it one below.')
  const client = String(field(L.client) ?? '').trim()

  const typeRaw = norm(field(L.type))
  const type: 'external' | 'internal' = typeRaw.startsWith('int') ? 'internal' : 'external'

  const stageRaw = String(field(L.stage) ?? '').trim()
  const stage = stages.find((s) => norm(s.name) === norm(stageRaw) || norm(s.id) === norm(stageRaw))
  if (type === 'external' && stageRaw && !stage)
    issues.push(`Stage “${stageRaw}” doesn't match your funnel (${stages.map((s) => s.name).join(' / ')}) — pick one below.`)

  const closeRaw = field(L.close)
  let closePct: number | null = null
  if (closeRaw !== '' && closeRaw != null) {
    const v = Number(closeRaw)
    if (isNaN(v)) issues.push(`Close % “${closeRaw}” isn't a number — using the stage default instead.`)
    else closePct = Math.max(0, Math.min(100, v > 1 ? v : v * 100)) / 100
  }

  const dealValue = Number(field(L.deal)) || 0
  const bookingRaw = norm(field(L.booking))
  const booking: 'forecast' | 'signed' = bookingRaw.startsWith('sign') ? 'signed' : 'forecast'

  const startRaw = field(L.start)
  const startParsed = cellDate(startRaw)
  let startWeek = weekKeyOf()
  let startAdjusted = false
  if (!startParsed) {
    issues.push(`Start week “${startRaw || '(blank)'}” isn't a date — set it below (defaulting to this week).`)
  } else {
    startWeek = weekKeyOf(new Date(startParsed + 'T00:00:00'))
    if (startWeek !== startParsed) {
      startAdjusted = true
      issues.push(`Start ${startParsed} isn't a Monday — snapped to the week of ${startWeek}.`)
    }
  }

  // ---- staffing grid
  const headIdx = rows.findIndex((r) => norm(r?.[0]) === norm(GRID_FIRST_COL))
  const draftRows: DraftRow[] = []
  let maxWeekUsed = 0
  if (headIdx === -1) {
    issues.push('No staffing grid found (a header row starting with “Person or role”) — the opportunity will import without roles.')
  } else {
    const head = rows[headIdx]
    // Map column index -> relative week offset, from "Week N" headers.
    const weekCols: { col: number; off: number }[] = []
    head.forEach((h, c) => {
      const m = /^week\s*(\d+)/i.exec(String(h ?? '').trim())
      if (m) weekCols.push({ col: c, off: Number(m[1]) - 1 })
    })
    if (weekCols.length === 0) issues.push('The staffing grid has no “Week 1, Week 2, …” columns — no FTE was read.')

    for (let r = headIdx + 1; r < rows.length; r++) {
      const label = String(rows[r]?.[0] ?? '').trim()
      if (!label) continue
      const teamRaw = norm(rows[r]?.[1])
      const team: Group = teamRaw.startsWith('e') ? 'energy' : 'delivery'
      const teamGuessed = !(teamRaw.startsWith('e') || teamRaw.startsWith('d'))
      const fte: Record<string, number> = {}
      for (const { col, off } of weekCols) {
        const v = Number(rows[r]?.[col])
        if (v > 0) {
          fte[String(off)] = v
          if (off + 1 > maxWeekUsed) maxWeekUsed = off + 1
        }
      }
      const person = matchPerson(label, roster)
      if (teamGuessed) issues.push(`“${label}”: Team wasn't energy/delivery — guessed ${person?.group ?? 'delivery'}; check it below.`)
      draftRows.push({
        label,
        team: teamGuessed && person ? person.group : team,
        teamGuessed,
        personId: person?.id,
        fte,
      })
    }
    if (draftRows.length === 0) issues.push('The staffing grid is empty — add people or roles after import in the timeline.')
    const unmatched = draftRows.filter((d) => !d.personId)
    if (unmatched.length)
      issues.push(`Not in the roster (will import as role lines unless you match them): ${unmatched.map((d) => `“${d.label}”`).join(', ')}.`)
  }

  let durationWeeks = Number(field(L.duration)) || 0
  if (durationWeeks < maxWeekUsed) {
    if (durationWeeks > 0)
      issues.push(`Duration ${durationWeeks} weeks is shorter than the staffed ${maxWeekUsed} weeks — extended to ${maxWeekUsed}.`)
    durationWeeks = Math.max(maxWeekUsed, durationWeeks || 8)
  }
  durationWeeks = Math.max(1, Math.min(104, durationWeeks))

  return {
    name,
    client,
    type,
    stageId: stage?.id ?? null,
    stageRaw,
    closePct,
    dealValue,
    booking,
    startWeek,
    startAdjusted,
    durationWeeks,
    rows: draftRows,
    issues,
  }
}
