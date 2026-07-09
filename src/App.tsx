import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import type { View } from './store/useStore'
import { exportCsv, exportJson, loadSeed, toBundle } from './lib/persistence'
import { fsSupported, pickDirectory, readBundle, writeBundle } from './lib/fs'
import { Dashboard } from './components/Dashboard'
import { OpportunitiesView } from './components/OpportunitiesView'
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

  // First-run seed
  useEffect(() => {
    if (roster.length === 0 && opportunities.length === 0) {
      loadSeed().then((b) => {
        if (b) replaceAll(b)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const tabs: { id: View; label: string; count?: number }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'opportunities', label: 'Opportunities', count: opportunities.length },
    { id: 'roster', label: 'Roster', count: roster.length },
    { id: 'stages', label: 'Funnel' },
  ]

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="dot" />
          <h1>Energy Vertical</h1>
          <span className="sub">Presales Forecast</span>
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

        <div className="spacer" />

        <div className="row wrap" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 6, fontSize: 12 }} title="Stamped on edits you make">
            <span className="faint">Editor</span>
            <input value={editor} onChange={(e) => setEditor(e.target.value)} style={{ width: 90 }} />
          </label>

          {fsSupported() &&
            (dirHandle ? (
              <button className="btn" onClick={save} disabled={busy === 'save'} title={`Write JSON files into ${dirName}/data`}>
                {dirty && <span className="dirty-dot" />} {busy === 'save' ? 'Saving…' : `Save → ${dirName}`}
              </button>
            ) : (
              <button className="btn ghost" onClick={connect} title="Point at your cloned git.epam.com repo folder">
                Connect repo
              </button>
            ))}

          <button className="btn ghost sm" onClick={() => fileInput.current?.click()}>Import</button>
          <button className="btn ghost sm" onClick={() => exportCsv(useStore.getState())}>CSV</button>
          <button className="btn ghost sm" onClick={() => exportJson(useStore.getState())}>JSON</button>
          <button className="btn primary sm" onClick={snapshot}>Snapshot</button>
          <input ref={fileInput} type="file" accept="application/json" hidden onChange={onImportFile} />
        </div>
      </header>

      <main className="main">
        {view === 'dashboard' && <Dashboard />}
        {view === 'opportunities' && <OpportunitiesView />}
        {view === 'roster' && <RosterView />}
        {view === 'stages' && <StagesView />}
      </main>
    </div>
  )
}
