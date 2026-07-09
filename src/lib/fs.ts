// ---------------------------------------------------------------------------
// Optional File System Access integration (Chromium browsers). Lets you point
// the app at your cloned git.epam.com repo's /data folder and read/write the
// per-opportunity JSON files directly — then you just `git commit`. Everywhere
// else the app falls back to JSON import/export (see persistence.ts).
//
// File layout written into the chosen folder:
//   data/roster.json
//   data/stages.json
//   data/snapshots.json
//   data/manifest.json          { opportunities: [id, ...] }
//   data/opportunities/<id>.json
// ---------------------------------------------------------------------------
import type { Bundle } from './persistence'
import type { Opportunity } from '../types'

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

/** Read a full bundle from a connected /data folder. */
export async function readBundle(dir: DirHandle): Promise<Bundle> {
  const dataDir = await dir.getDirectoryHandle('data', { create: false })
  const manifest = await readJson(dataDir, 'manifest.json')
  const roster = await readJson(dataDir, 'roster.json')
  const stages = await readJson(dataDir, 'stages.json')
  let snapshots: Bundle['snapshots'] = []
  try {
    snapshots = await readJson(dataDir, 'snapshots.json')
  } catch {
    snapshots = []
  }
  const opportunities: Opportunity[] = []
  for (const id of manifest.opportunities as string[]) {
    opportunities.push(await readJson(dataDir, `opportunities/${id}.json`))
  }
  return { roster, stages, opportunities, snapshots }
}

/** Write the full bundle back out as per-file JSON, pruning removed opps. */
export async function writeBundle(dir: DirHandle, bundle: Bundle): Promise<void> {
  const dataDir = await dir.getDirectoryHandle('data', { create: true })
  await writeJson(dataDir, 'roster.json', bundle.roster)
  await writeJson(dataDir, 'stages.json', bundle.stages)
  await writeJson(dataDir, 'snapshots.json', bundle.snapshots)
  await writeJson(dataDir, 'manifest.json', { opportunities: bundle.opportunities.map((o) => o.id) })

  const oppDir = await dataDir.getDirectoryHandle('opportunities', { create: true })
  const keep = new Set(bundle.opportunities.map((o) => `${o.id}.json`))
  // prune stale files
  for await (const [name, h] of (oppDir as any).entries()) {
    if (h.kind === 'file' && name.endsWith('.json') && !keep.has(name)) {
      await oppDir.removeEntry(name)
    }
  }
  for (const o of bundle.opportunities) {
    await writeJson(oppDir, `${o.id}.json`, o)
  }
}
