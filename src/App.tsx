import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from './store/useStore'
import type { View } from './store/useStore'
import { exportCsv, exportJson, loadPublishedDataset, loadSeed, toBundle } from './lib/persistence'
import { fsSupported, pickDirectory, readBundle, writeBundle } from './lib/fs'
import { downloadTemplate, parseOpportunityWorkbook, type ImportDraft } from './lib/xlsxImport'
import { ImportExcel } from './components/ImportExcel'
import { Modal } from './components/Modal'
import { Dashboard } from './components/Dashboard'
import { OpportunitiesView } from './components/OpportunitiesView'
import { UtilizationView } from './components/UtilizationView'
import { CapacityView } from './components/CapacityView'
import { RevenueView } from './components/RevenueView'
import { RosterView } from './components/RosterView'
import { StagesView } from './components/StagesView'
import { PersonDetail } from './components/PersonDetail'

/** Compact dropdown for the data actions so the header stays ONE row of
 *  uniform-height controls at any window width (zero double-height buttons,
 *  zero reflow). Closes on outside click and Escape. */
function DataMenu({ items }: { items: { label: ReactNode; onPick: () => void; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button className="btn ghost sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Data <span aria-hidden="true" style={{ fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it, i) => (
            <button key={i} role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onPick() }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const opportunities = useStore((s) => s.opportunities)
  const roster = useStore((s) => s.roster)
  const stages = useStore((s) => s.stages)
  const editor = useStore((s) => s.editor)
  const setEditor = useStore((s) => s.setEditor)
  const replaceAll = useStore((s) => s.replaceAll)
  const takeSnapshot = useStore((s) => s.takeSnapshot)
  const dirName = useStore((s) => s.dirName)
  const dirHandle = useStore((s) => s.dirHandle)
  const dirty = useStore((s) => s.dirty)
  const setDir = useStore((s) => s.setDir)
  const markSaved = useStore((s) => s.markSaved)
  const lastDeleted = useStore((s) => s.lastDeleted)
  const undoDelete = useStore((s) => s.undoDelete)
  const clearUndo = useStore((s) => s.clearUndo)
  const selectedPersonId = useStore((s) => s.selectedPersonId)
  const selectPerson = useStore((s) => s.selectPerson)
  const selectedPerson = roster.find((p) => p.id === selectedPersonId) || null

  const fileInput = useRef<HTMLInputElement>(null)
  const excelInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [excelDraft, setExcelDraft] = useState<{ draft: ImportDraft; fileName: string } | null>(null)

  // The Undo toast lingers 8 seconds, then the deletion becomes final.
  useEffect(() => {
    if (!lastDeleted) return
    const t = setTimeout(clearUndo, 8000)
    return () => clearTimeout(t)
  }, [lastDeleted, clearUndo])

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
        // Guard against wiping real data with the wrong file: it must actually
        // look like a forecast bundle, and replacing non-empty data is confirmed.
        const looksRight = Array.isArray(b?.opportunities) || Array.isArray(b?.roster)
        if (!looksRight) {
          alert(`"${file.name}" doesn't look like a forecast bundle (no opportunities or roster). Nothing was imported.`)
          return
        }
        const incoming = { roster: b.roster ?? [], stages: b.stages ?? [], opportunities: b.opportunities ?? [], snapshots: b.snapshots ?? [] }
        const hasData = opportunities.length > 0 || roster.length > 0
        if (hasData && !confirm(`Import ${incoming.opportunities.length} opportunities and ${incoming.roster.length} people from "${file.name}"? This replaces your current working data.`)) return
        replaceAll(incoming)
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

  function onExcelFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    file
      .arrayBuffer()
      .then((buf) => {
        const draft = parseOpportunityWorkbook(buf, stages, roster)
        setExcelDraft({ draft, fileName: file.name })
      })
      .catch(() => alert(`Couldn't read "${file.name}" as a spreadsheet. Use the Excel template (Data → Download Excel template) or a .xlsx / .csv file.`))
    e.target.value = ''
  }

  // Dashboard overview first, then Opportunities (where you build the plan),
  // then the Utilization and Revenue read-outs, then Roster and Funnel.
  const tabs: { id: View; label: string; count?: number }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'opportunities', label: 'Opportunities', count: opportunities.length },
    { id: 'utilization', label: 'Utilization' },
    { id: 'capacity', label: 'Capacity' },
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
                  {dirty && <span className="dirty-dot" />} {busy === 'save' ? 'Saving…' : 'Save ↑'} <span className="dirlabel">{dirName}</span>
                </button>
              </>
            ) : (
              <button className="btn ghost" onClick={connect} title="Point at the shared data folder — a OneDrive-synced SharePoint library or a cloned git repo">
                Connect shared folder
              </button>
            ))}

          <DataMenu
            items={[
              { label: 'Import from Excel…', onPick: () => excelInput.current?.click() },
              { label: 'Download Excel template', onPick: () => downloadTemplate(stages, roster) },
              { label: 'Load published data', onPick: loadPublished, disabled: busy === 'load' },
              { label: 'Import JSON…', onPick: () => fileInput.current?.click() },
              { label: 'Export CSV', onPick: () => exportCsv(useStore.getState()) },
              { label: 'Export JSON', onPick: () => exportJson(useStore.getState()) },
            ]}
          />
          <button className="btn primary sm" onClick={snapshot}>Snapshot</button>
          <input ref={fileInput} type="file" accept="application/json" hidden onChange={onImportFile} />
          <input ref={excelInput} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onExcelFile} />
          </div>
        </div>

        <nav className="tabs" aria-label="Views">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tab ${view === t.id ? 'active' : ''}`}
              aria-current={view === t.id ? 'page' : undefined}
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
        {view === 'capacity' && <CapacityView />}
        {view === 'revenue' && <RevenueView />}
        {view === 'roster' && <RosterView />}
        {view === 'stages' && <StagesView />}
      </main>

      {excelDraft && (
        <Modal onClose={() => setExcelDraft(null)}>
          <ImportExcel draft={excelDraft.draft} fileName={excelDraft.fileName} onClose={() => setExcelDraft(null)} />
        </Modal>
      )}

      {selectedPerson && (
        <Modal onClose={() => selectPerson(null)}>
          <PersonDetail key={selectedPerson.id} person={selectedPerson} onClose={() => selectPerson(null)} />
        </Modal>
      )}

      {lastDeleted && (
        <div className="toast" role="status">
          <span>Deleted “{lastDeleted.name}”</span>
          <button className="btn sm primary" onClick={undoDelete}>Undo</button>
          <button className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={clearUndo}>×</button>
        </div>
      )}
    </div>
  )
}
