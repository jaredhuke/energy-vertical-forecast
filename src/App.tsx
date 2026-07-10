import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import type { View } from './store/useStore'
import { exportCsv, exportJson, loadPublishedDataset, loadSeed, toBundle } from './lib/persistence'
import { fsSupported, pickDirectory, readBundle, writeBundle } from './lib/fs'
import { Dashboard } from './components/Dashboard'
import { OpportunitiesView } from './components/OpportunitiesView'
import { UtilizationView } from './components/UtilizationView'
import { RevenueView } from './components/RevenueView'
import { RosterView } from './components/RosterView'
import { StagesView } from './components/StagesView'

export default function App() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const opportunities = useStore((s) => s.opportunities)
  const roster = useStore((s) => s.roster)
  const editor = useStore((s) => s.editor)
  const setEditor = useStore((s) => s.setEditor)
  const replaceAll = useStore((s) => s.replaceAll)
  const takeSnapshot = useStore((s) => s.takeSnapshot)
  const dirName = useStore((s) => s.dirName)
  const dirHandle = useStore((s) => s.dirHandle)
  const dirty = useStore((s) => s.dirty)
  const setDir = useStore((s) => s.setDir)
  const markSaved = useStore((s) => s.markSaved)

  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')

  // First run: read the published dataset (the public data the site is hosted
  // with); fall back to the build-time bundled seed when offline / on file://.
  useEffect(() => {
    if (roster.length === 0 && opportunities.length === 0) {
      loadPublishedDataset().then((b) => {
        if (b && (b.opportunities.length || b.roster.length)) replaceAll(b)
        else loadSeed().then((s) => s && replaceAll(s))
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pull the latest published dataset on demand (replaces the working copy).
  async function loadPublished() {
    if (dirty && !confirm('Load the latest published data? Your unsaved local changes will be replaced.')) return
    setBusy('load')
    const b = await loadPublishedDataset()
    setBusy('')
    if (b) replaceAll(b)
    else alert('No published dataset found. It appears once the site is deployed with public/data/dataset.json.')
  }

  async function connect() {
    const handle = await pickDirectory()
    if (!handle) return
    setDir(handle, (handle as any).name ?? 'repo')
    // offer to load what's already there
    try {
      setBusy('load')
      const b = await readBundle(handle)
      if (b.opportunities.length || b.roster.length) {
        if (confirm(`Load ${b.opportunities.length} opportunities and ${b.roster.length} people from this folder? This replaces the current working data.`)) {
          replaceAll(b)
        }
      }
    } catch {
      /* folder may not have data/ yet — that's fine, first Save creates it */
    } finally {
      setBusy('')
    }
  }

  async function save() {
    if (!dirHandle) return
    try {
      setBusy('save')
      await writeBundle(dirHandle, toBundle(useStore.getState()))
      markSaved()
    } catch (e) {
      alert('Save failed: ' + (e as Error).message)
    } finally {
      setBusy('')
    }
  }

  // Pull teammates' changes: re-read the repo's data files into the app.
  async function load() {
    if (!dirHandle) return
    if (dirty && !confirm('You have unsaved changes. Load the latest from the repo anyway? Your unsaved edits will be replaced.')) return
    try {
      setBusy('load')
      const b = await readBundle(dirHandle)
      replaceAll(b)
      markSaved()
    } catch (e) {
      alert('Load failed: ' + (e as Error).message + '\nMake sure you selected the repo root (it has a public/data folder).')
    } finally {
      setBusy('')
    }
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then((t) => {
      try {
        const b = JSON.parse(t)
        replaceAll({ roster: b.roster ?? [], stages: b.stages ?? [], opportunities: b.opportunities ?? [], snapshots: b.snapshots ?? [] })
      } catch {
        alert('Not a valid forecast bundle JSON.')
      }
    })
    e.target.value = ''
  }

  function snapshot() {
    const label = prompt('Snapshot label', new Date().toISOString().slice(0, 10))
    if (label !== null) takeSnapshot(label)
  }

  // Dashboard overview first, then Opportunities (where you build the plan),
  // then the Utilization and Revenue read-outs, then Roster and Funnel.
  const tabs: { id: View; label: string; count?: number }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'opportunities', label: 'Opportunities', count: opportunities.length },
    { id: 'utilization', label: 'Utilization' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'roster', label: 'Roster', count: roster.length },
    { id: 'stages', label: 'Funnel' },
  ]

  return (
    <div className="app">
      <header className="header">
        <div className="header-row">
          <div className="brand">
            <span className="dot" />
            <h1>Energy Vertical</h1>
            <span className="sub">Presales Forecast</span>
          </div>

          <div className="spacer" />

          <div className="controls">
          <label className="row" style={{ gap: 6, fontSize: 12 }} title="Stamped on edits you make">
            <span className="faint">Editor</span>
            <input value={editor} onChange={(e) => setEditor(e.target.value)} style={{ width: 90 }} />
          </label>

          {fsSupported() &&
            (dirHandle ? (
              <>
                <button className="btn ghost" onClick={load} disabled={busy === 'load'} title="Re-read the shared folder (pull teammates' changes — OneDrive sync or git pull)">
                  {busy === 'load' ? 'Loading…' : 'Load ↓'}
                </button>
                <button className="btn" onClick={save} disabled={busy === 'save'} title={`Write JSON files into ${dirName} — OneDrive syncs them to the team automatically; in a git clone, commit and push`}>
                  {dirty && <span className="dirty-dot" />} {busy === 'save' ? 'Saving…' : `Save ↑ ${dirName}`}
                </button>
              </>
            ) : (
              <button className="btn ghost" onClick={connect} title="Point at the shared data folder — a OneDrive-synced SharePoint library or a cloned git repo">
                Connect shared folder
              </button>
            ))}

          <button className="btn ghost sm" onClick={loadPublished} disabled={busy === 'load'} title="Fetch the latest published data the site is hosted with (replaces your working copy)">
            {busy === 'load' ? 'Loading…' : 'Load published data'}
          </button>
          <button className="btn ghost sm" onClick={() => fileInput.current?.click()}>Import</button>
          <button className="btn ghost sm" onClick={() => exportCsv(useStore.getState())}>CSV</button>
          <button className="btn ghost sm" onClick={() => exportJson(useStore.getState())}>JSON</button>
          <button className="btn primary sm" onClick={snapshot}>Snapshot</button>
          <input ref={fileInput} type="file" accept="application/json" hidden onChange={onImportFile} />
          </div>
        </div>

        <nav className="tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tab ${view === t.id ? 'active' : ''}`}
              onClick={() => setView(t.id)}
            >
              {t.label}
              {t.count != null && <span className="count">{t.count}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        {view === 'dashboard' && <Dashboard />}
        {view === 'opportunities' && <OpportunitiesView />}
        {view === 'utilization' && <UtilizationView />}
        {view === 'revenue' && <RevenueView />}
        {view === 'roster' && <RosterView />}
        {view === 'stages' && <StagesView />}
      </main>
    </div>
  )
}
