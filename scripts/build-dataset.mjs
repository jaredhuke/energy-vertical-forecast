// Consolidate the file-per-entity source data (roster.json, stages.json,
// opportunities/*.json) into a single public/data/dataset.json that the
// deployed front end fetches at runtime. Keeping the per-opportunity files as
// the source of truth keeps edits merge-friendly; this is the built artifact.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'public', 'data')
const oppDir = join(dataDir, 'opportunities')
const rosterDir = join(dataDir, 'roster')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const readDir = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(dir, f)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))

// One file per person / per opportunity so two editors never overwrite each
// other; stages is a single rarely-edited file.
const roster = readDir(rosterDir)
const stages = readJson(join(dataDir, 'stages.json'))
const opportunities = readDir(oppDir)

// Bundle shape (matches persistence.ts `Bundle`): no snapshots in the seed.
const dataset = { roster, stages, opportunities, snapshots: [] }

writeFileSync(join(dataDir, 'dataset.json'), JSON.stringify(dataset, null, 2) + '\n')
console.log(
  `dataset.json written: ${roster.length} people, ${stages.length} stages, ${opportunities.length} opportunities`,
)
