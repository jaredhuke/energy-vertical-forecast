// ---------------------------------------------------------------------------
// Optional File System Access integration (Chromium browsers). Lets you point
// the app at your cloned git.epam.com repo's /data folder and read/write the
// per-opportunity JSON files directly — then you just `git commit`. Everywhere
// else the app falls back to JSON import/export (see persistence.ts).
//
// File layout written into the chosen folder:
//   data/dataset.json           consolidated read-file the deployed app fetches
//   data/stages.json
//   data/snapshots.json
//   data/manifest.json          { opportunities: [id, ...] }
//   data/roster/<id>.json       one file per person
//   data/opportunities/<id>.json  one file per opportunity
// One file per entity so two editors never overwrite each other's changes;
// dataset.json is regenerated on every Save so no CI step is needed for data.
// ---------------------------------------------------------------------------
import type { Bundle } from './persistence'
import type { Opportunity, Person } from '../types'

// Minimal typings — the DOM lib doesn't always ship these.
type DirHandle = any

export const fsSupported = (): boolean =>
  typeof (window as any).showDirectoryPicker === 'function'

export async function pickDirectory(): Promise<DirHandle | null> {
  if (!fsSupported()) return null
  try {
    return await (window as any).showDirectoryPicker({ mode: 'readwrite' })
  } catch {
    return null // user cancelled
  }
}

async function readJson(dir: DirHandle, path: string): Promise<any> {
  const parts = path.split('/')
  let handle: DirHandle = dir
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i], { create: false })
  }
  const file = await (await handle.getFileHandle(parts[parts.length - 1])).getFile()
  return JSON.parse(await file.text())
}

async function writeJson(dir: DirHandle, path: string, data: unknown): Promise<void> {
  const parts = path.split('/')
  let handle: DirHandle = dir
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i], { create: true })
  }
  const fh = await handle.getFileHandle(parts[parts.length - 1], { create: true })
  const w = await fh.createWritable()
  await w.write(JSON.stringify(data, null, 2))
  await w.close()
}

/** Resolve the data folder: prefer <repo>/public/data (what the app serves),
 *  fall back to <dir>/data. Lets you Connect to the repo root directly. */
async function resolveDataDir(dir: DirHandle, create: boolean): Promise<DirHandle> {
  try {
    const pub = await dir.getDirectoryHandle('public', { create: false })
    return await pub.getDirectoryHandle('data', { create })
  } catch {
    return await dir.getDirectoryHandle('data', { create })
  }
}

/** Read every *.json file in a subdirectory, sorted by id (order-stable). */
async function readDirJson<T extends { id: string }>(dataDir: DirHandle, sub: string): Promise<T[]> {
  const out: T[] = []
  try {
    const subDir = await dataDir.getDirectoryHandle(sub, { create: false })
    for await (const [name, h] of (subDir as any).entries()) {
      if (h.kind === 'file' && name.endsWith('.json')) {
        out.push(JSON.parse(await (await h.getFile()).text()))
      }
    }
  } catch {
    /* directory absent → empty */
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** Read a full bundle from a connected repo (public/data or data). */
export async function readBundle(dir: DirHandle): Promise<Bundle> {
  const dataDir = await resolveDataDir(dir, false)
  const roster = await readDirJson<Person>(dataDir, 'roster')
  const stages = await readJson(dataDir, 'stages.json')
  let snapshots: Bundle['snapshots'] = []
  try {
    snapshots = await readJson(dataDir, 'snapshots.json')
  } catch {
    snapshots = []
  }
  const opportunities = await readDirJson<Opportunity>(dataDir, 'opportunities')
  return { roster, stages, opportunities, snapshots }
}

/** Write every entity in a subdirectory as <id>.json, pruning removed files. */
async function writeDirJson(
  dataDir: DirHandle,
  sub: string,
  items: { id: string }[],
): Promise<void> {
  const subDir = await dataDir.getDirectoryHandle(sub, { create: true })
  const keep = new Set(items.map((it) => `${it.id}.json`))
  for await (const [name, h] of (subDir as any).entries()) {
    if (h.kind === 'file' && name.endsWith('.json') && !keep.has(name)) {
      await subDir.removeEntry(name)
    }
  }
  for (const it of items) {
    await writeJson(subDir, `${it.id}.json`, it)
  }
}

/** Write the full bundle back out as per-file JSON, pruning removed files.
 *  One file per person / per opportunity keeps different editors merge-clean. */
export async function writeBundle(dir: DirHandle, bundle: Bundle): Promise<void> {
  const dataDir = await resolveDataDir(dir, true)
  const roster = [...bundle.roster].sort((a, b) => a.id.localeCompare(b.id))
  const opportunities = [...bundle.opportunities].sort((a, b) => a.id.localeCompare(b.id))
  await writeJson(dataDir, 'stages.json', bundle.stages)
  await writeJson(dataDir, 'snapshots.json', bundle.snapshots)
  await writeJson(dataDir, 'manifest.json', { opportunities: opportunities.map((o) => o.id) })
  await writeDirJson(dataDir, 'roster', roster)
  await writeDirJson(dataDir, 'opportunities', opportunities)
  // The consolidated read-file the deployed app fetches — kept current on every
  // Save so a plain commit+push publishes the shared data (no CI needed).
  await writeJson(dataDir, 'dataset.json', { roster, stages: bundle.stages, opportunities, snapshots: bundle.snapshots })
}
