// ---------------------------------------------------------------------------
// Domain model for the Energy Vertical presales forecasting engine.
//
// Key modelling decision: an assignment's weekly FTE is keyed by a RELATIVE
// week offset (0..durationWeeks-1), never an absolute date. That means
// "slide the whole opportunity a few weeks" is a one-field change to
// `startWeek` — no re-keying of the grid. Absolute weeks are derived only
// when we aggregate for the dashboard.
// ---------------------------------------------------------------------------

/** Which side of the house a person / role line sits on. */
export type Group = 'energy' | 'delivery'

/** A person in the roster. Energy-vertical folks are named; delivery lines
 *  may be named or left as abstract role capacity (see Assignment). */
export interface Person {
  id: string
  name: string
  group: Group
  level: string // e.g. Senior, Lead, Principal, Sr Principal
  title: string // free-text job title
  role: string // roll-up category, e.g. Solution Architect, Data Scientist
  capacity: number // weekly capacity in FTE (1.0 = full time)
  costRate?: number // optional $/week — unlocks cost forecasting later
}

/** A funnel stage with its default probability of closing (0..1). */
export interface StageDef {
  id: string
  name: string
  probability: number
}

/** One resourcing line inside an opportunity. Either a named person
 *  (personId set) or an abstract role line (personId undefined). */
export interface Assignment {
  id: string
  personId?: string // set => named person; undefined => abstract role line
  role: string // display + analytics roll-up
  group: Group
  /** relative-week-offset (as a string key) -> planned FTE for that week */
  fte: Record<string, number>
}

/** A single sales pursuit being forecast. */
export interface Opportunity {
  id: string
  name: string
  client: string
  stageId: string
  /** if set (0..1), overrides the stage's default probability */
  probabilityOverride?: number | null
  /** Monday-of-week key 'YYYY-MM-DD' for week offset 0 */
  startWeek: string
  durationWeeks: number
  assignments: Assignment[]
  notes?: string
  updatedAt?: string
  updatedBy?: string
}

/** A lightweight point-in-time summary used for week-over-week trends.
 *  The durable, diffable snapshot is the git commit itself; this is the
 *  in-app rollup that powers the trend sparkline. */
export interface Snapshot {
  id: string
  takenAt: string // ISO datetime
  label: string
  opportunityCount: number
  byStage: Record<string, number> // stageId -> count
  committedFte: number // total across horizon
  weightedFte: number // total across horizon
}

export interface ForecastState {
  roster: Person[]
  stages: StageDef[]
  opportunities: Opportunity[]
  snapshots: Snapshot[]
  editor: string // who's editing (for the updatedBy stamp)
}
