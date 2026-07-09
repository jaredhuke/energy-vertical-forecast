import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Assignment, ForecastState, Group, Opportunity, Person, Snapshot } from '../types'
import { DEFAULT_STAGES, effectiveProbability } from '../lib/funnel'
import { demandByWeek, horizon, totals } from '../lib/analytics'
import type { Bundle } from '../lib/persistence'
import { addWeeks } from '../lib/weeks'

export type View = 'dashboard' | 'opportunities' | 'utilization' | 'revenue' | 'roster' | 'stages'

function uid(prefix: string): string {
  const rnd =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 1e9).toString(36)
  return `${prefix}-${rnd}`
}

function nowIso(): string {
  return new Date().toISOString()
}

interface UiState {
  view: View
  selectedOpportunityId: string | null
  weightedView: boolean // dashboard: show weighted vs committed
  utilizationTarget: number // target utilization (0..1), e.g. 0.8 = 80% billable
  dirHandle: unknown | null // File System Access handle (not persisted)
  dirName: string | null
  dirty: boolean // unsaved changes vs connected folder
}

interface Actions {
  setView: (v: View) => void
  selectOpportunity: (id: string | null) => void
  setWeightedView: (b: boolean) => void
  setUtilizationTarget: (t: number) => void
  setEditor: (name: string) => void

  // roster
  addPerson: (group: Group) => string
  updatePerson: (id: string, patch: Partial<Person>) => void
  removePerson: (id: string) => void

  // stages
  updateStage: (id: string, patch: { name?: string; probability?: number }) => void

  // opportunities
  addOpportunity: () => string
  updateOpportunity: (id: string, patch: Partial<Opportunity>) => void
  removeOpportunity: (id: string) => void
  duplicateOpportunity: (id: string) => void
  slideOpportunity: (id: string, deltaWeeks: number) => void
  setDuration: (id: string, weeks: number) => void

  // assignments
  addAssignment: (oppId: string, init: Partial<Assignment>) => void
  updateAssignment: (oppId: string, aId: string, patch: Partial<Assignment>) => void
  removeAssignment: (oppId: string, aId: string) => void
  setFte: (oppId: string, aId: string, offset: number, value: number) => void

  // snapshots + data
  takeSnapshot: (label: string) => void
  removeSnapshot: (id: string) => void
  replaceAll: (bundle: Bundle) => void

  // file system
  setDir: (handle: unknown, name: string) => void
  markSaved: () => void
}

export type Store = ForecastState & UiState & Actions

function touch(o: Opportunity, editor: string): Opportunity {
  return { ...o, updatedAt: nowIso(), updatedBy: editor }
}

/** Mutate one opportunity by id, stamping it and marking the store dirty. */
function mapOpp(state: Store, id: string, fn: (o: Opportunity) => Opportunity): Partial<Store> {
  return {
    opportunities: state.opportunities.map((o) => (o.id === id ? touch(fn(o), state.editor) : o)),
    dirty: true,
  }
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      // ---- state ----
      roster: [],
      stages: DEFAULT_STAGES,
      opportunities: [],
      snapshots: [],
      editor: 'me',

      view: 'dashboard',
      selectedOpportunityId: null,
      weightedView: true,
      utilizationTarget: 0.8,
      dirHandle: null,
      dirName: null,
      dirty: false,

      // ---- ui ----
      setView: (view) => set({ view }),
      selectOpportunity: (selectedOpportunityId) => set({ selectedOpportunityId, view: 'opportunities' }),
      setWeightedView: (weightedView) => set({ weightedView }),
      setUtilizationTarget: (t) => set({ utilizationTarget: Math.max(0.1, Math.min(1.2, t)) }),
      setEditor: (editor) => set({ editor }),

      // ---- roster ----
      addPerson: (group) => {
        const id = uid('p')
        const person: Person = {
          id,
          name: 'New person',
          group,
          level: 'Senior',
          title: '',
          role: group === 'energy' ? 'Consultant' : 'Engineer',
          capacity: 1,
        }
        set((s) => ({ roster: [...s.roster, person], dirty: true }))
        return id
      },
      updatePerson: (id, patch) =>
        set((s) => ({ roster: s.roster.map((p) => (p.id === id ? { ...p, ...patch } : p)), dirty: true })),
      removePerson: (id) =>
        set((s) => ({
          roster: s.roster.filter((p) => p.id !== id),
          // unlink any assignments that referenced this person
          opportunities: s.opportunities.map((o) => ({
            ...o,
            assignments: o.assignments.map((a) =>
              a.personId === id ? { ...a, personId: undefined } : a,
            ),
          })),
          dirty: true,
        })),

      // ---- stages ----
      updateStage: (id, patch) =>
        set((s) => ({
          stages: s.stages.map((st) => (st.id === id ? { ...st, ...patch } : st)),
          dirty: true,
        })),

      // ---- opportunities ----
      addOpportunity: () => {
        const id = uid('opp')
        const opp: Opportunity = {
          id,
          name: 'New opportunity',
          client: '',
          stageId: get().stages[0]?.id ?? 'lead',
          dealValue: 0,
          booking: 'forecast',
          startWeek: mondayKey(),
          durationWeeks: 8,
          assignments: [],
          updatedAt: nowIso(),
          updatedBy: get().editor,
        }
        set((s) => ({ opportunities: [...s.opportunities, opp], selectedOpportunityId: id, view: 'opportunities', dirty: true }))
        return id
      },
      updateOpportunity: (id, patch) => set((s) => mapOpp(s, id, (o) => ({ ...o, ...patch }))),
      removeOpportunity: (id) =>
        set((s) => ({
          opportunities: s.opportunities.filter((o) => o.id !== id),
          selectedOpportunityId: s.selectedOpportunityId === id ? null : s.selectedOpportunityId,
          dirty: true,
        })),
      duplicateOpportunity: (id) =>
        set((s) => {
          const src = s.opportunities.find((o) => o.id === id)
          if (!src) return {}
          const copy: Opportunity = {
            ...src,
            id: uid('opp'),
            name: `${src.name} (copy)`,
            assignments: src.assignments.map((a) => ({ ...a, id: uid('a'), fte: { ...a.fte } })),
            updatedAt: nowIso(),
            updatedBy: s.editor,
          }
          return { opportunities: [...s.opportunities, copy], selectedOpportunityId: copy.id, dirty: true }
        }),
      slideOpportunity: (id, deltaWeeks) =>
        set((s) => mapOpp(s, id, (o) => ({ ...o, startWeek: addWeeks(o.startWeek, deltaWeeks) }))),
      setDuration: (id, weeks) =>
        set((s) =>
          mapOpp(s, id, (o) => {
            const d = Math.max(1, Math.min(104, Math.round(weeks)))
            // trim any FTE beyond the new duration
            const assignments = o.assignments.map((a) => {
              const fte: Record<string, number> = {}
              for (const [k, v] of Object.entries(a.fte)) if (Number(k) < d) fte[k] = v
              return { ...a, fte }
            })
            return { ...o, durationWeeks: d, assignments }
          }),
        ),

      // ---- assignments ----
      addAssignment: (oppId, init) =>
        set((s) =>
          mapOpp(s, oppId, (o) => {
            const a: Assignment = {
              id: uid('a'),
              role: init.role ?? 'Engineer',
              group: init.group ?? 'delivery',
              personId: init.personId,
              fte: init.fte ?? {},
            }
            return { ...o, assignments: [...o.assignments, a] }
          }),
        ),
      updateAssignment: (oppId, aId, patch) =>
        set((s) =>
          mapOpp(s, oppId, (o) => ({
            ...o,
            assignments: o.assignments.map((a) => (a.id === aId ? { ...a, ...patch } : a)),
          })),
        ),
      removeAssignment: (oppId, aId) =>
        set((s) =>
          mapOpp(s, oppId, (o) => ({ ...o, assignments: o.assignments.filter((a) => a.id !== aId) })),
        ),
      setFte: (oppId, aId, offset, value) =>
        set((s) =>
          mapOpp(s, oppId, (o) => ({
            ...o,
            assignments: o.assignments.map((a) => {
              if (a.id !== aId) return a
              const fte = { ...a.fte }
              if (value > 0) fte[String(offset)] = value
              else delete fte[String(offset)]
              return { ...a, fte }
            }),
          })),
        ),

      // ---- snapshots + data ----
      takeSnapshot: (label) =>
        set((s) => {
          const { weeks } = horizon(s.opportunities)
          const demand = demandByWeek(s, weeks)
          const t = totals(demand)
          const byStage: Record<string, number> = {}
          for (const st of s.stages) byStage[st.id] = s.opportunities.filter((o) => o.stageId === st.id).length
          const snap: Snapshot = {
            id: uid('snap'),
            takenAt: nowIso(),
            label: label || new Date().toISOString().slice(0, 10),
            opportunityCount: s.opportunities.length,
            byStage,
            committedFte: t.committed,
            weightedFte: t.weighted,
          }
          return { snapshots: [...s.snapshots, snap], dirty: true }
        }),
      removeSnapshot: (id) => set((s) => ({ snapshots: s.snapshots.filter((x) => x.id !== id), dirty: true })),
      replaceAll: (bundle) =>
        set({
          roster: bundle.roster,
          stages: bundle.stages,
          opportunities: bundle.opportunities,
          snapshots: bundle.snapshots ?? [],
          selectedOpportunityId: null,
          dirty: false,
        }),

      // ---- file system ----
      setDir: (dirHandle, dirName) => set({ dirHandle, dirName }),
      markSaved: () => set({ dirty: false }),
    }),
    {
      name: 'evf-state-v1',
      version: 2,
      // Backfill deal value + booking status onto pre-existing opportunities
      // so the Revenue/Utilization views have data without a re-seed.
      migrate: (persisted, _from) => {
        const s = persisted as Partial<ForecastState>
        const defaults: Record<string, [number, 'forecast' | 'signed']> = {
          'opp-nexus': [2400000, 'forecast'],
          'opp-atlas': [1600000, 'forecast'],
          'opp-orbit': [1200000, 'signed'],
          'opp-vertex': [800000, 'forecast'],
        }
        if (s?.opportunities) {
          s.opportunities = s.opportunities.map((o) => ({
            ...o,
            dealValue: o.dealValue ?? defaults[o.id]?.[0] ?? 0,
            booking: o.booking ?? defaults[o.id]?.[1] ?? 'forecast',
          }))
        }
        return s
      },
      partialize: (s) => ({
        roster: s.roster,
        stages: s.stages,
        opportunities: s.opportunities,
        snapshots: s.snapshots,
        editor: s.editor,
        utilizationTarget: s.utilizationTarget,
      }),
    },
  ),
)

function mondayKey(): string {
  const d = new Date()
  const dow = d.getDay()
  const delta = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + delta)
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Convenience selector: effective probability for an opportunity. */
export function useOppProbability(o: Opportunity): number {
  const stages = useStore((s) => s.stages)
  return effectiveProbability(stages, o.stageId, o.probabilityOverride)
}
