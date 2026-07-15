import { useState } from 'react'
import { useStore } from '../store/useStore'
import { GitHubDataError, loadFromGitHub, testConnection, type GitHubConfig } from '../lib/githubData'

/** Connect the app to a PRIVATE (invite-only) GitHub repo as the shared
 *  dataset. Each person supplies their OWN fine-grained token — it is stored
 *  only in this browser and sent only to api.github.com. */
export function GitHubConnectModal({ onClose }: { onClose: () => void }) {
  const existing = useStore((s) => s.githubCfg)
  const setGithubCfg = useStore((s) => s.setGithubCfg)
  const setGithubSha = useStore((s) => s.setGithubSha)
  const replaceAll = useStore((s) => s.replaceAll)
  const markSaved = useStore((s) => s.markSaved)

  const [repo, setRepo] = useState(existing ? `${existing.owner}/${existing.repo}` : '')
  const [branch, setBranch] = useState(existing?.branch ?? 'main')
  const [token, setToken] = useState(existing?.token ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  async function connect() {
    setError('')
    setOk('')
    const m = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').match(/^([^/\s]+)\/([^/\s]+)$/)
    if (!m) {
      setError('Enter the repo as owner/name — e.g. jaredhuke/energy-vertical-forecast-data.')
      return
    }
    if (!token.trim()) {
      setError('Paste a fine-grained token with Contents access to that repo.')
      return
    }
    const cfg: GitHubConfig = { owner: m[1], repo: m[2], branch: branch.trim() || 'main', dir: 'data', token: token.trim() }
    setBusy(true)
    try {
      const info = await testConnection(cfg)
      const { bundle, sha } = await loadFromGitHub(cfg)
      setGithubCfg(cfg)
      setGithubSha(sha)
      if (bundle.opportunities.length || bundle.roster.length) {
        replaceAll(bundle)
        markSaved()
      }
      setOk(
        `Connected to ${cfg.owner}/${cfg.repo}${info.private ? ' (private)' : ' — note: this repo is PUBLIC'}. ` +
          (sha ? `Loaded ${bundle.opportunities.length} opportunities · ${bundle.roster.length} people.` : 'No dataset in the repo yet — your first Save creates it.'),
      )
      setTimeout(onClose, 1100)
    } catch (e) {
      setError(e instanceof GitHubDataError ? e.message : 'Could not connect. Check the repo and token.')
    } finally {
      setBusy(false)
    }
  }

  function disconnect() {
    setGithubCfg(null)
    onClose()
  }

  return (
    <div style={{ minWidth: 440, maxWidth: 520 }}>
      <h2 style={{ marginTop: 0 }}>Shared data on GitHub</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Point the app at a <b>private (invite-only)</b> GitHub repo so a team works from one dataset. Everyone loads and
        saves the same files. Your token is kept <b>only in this browser</b> and is sent only to GitHub.
      </p>

      <label className="field">
        <span>Repository</span>
        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name  ·  e.g. jaredhuke/energy-vertical-forecast-data" autoFocus />
      </label>

      <label className="field">
        <span>Branch</span>
        <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" style={{ maxWidth: 160 }} />
      </label>

      <label className="field">
        <span>Fine-grained token</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" />
      </label>

      <details style={{ margin: '4px 0 12px', fontSize: 12 }}>
        <summary style={{ cursor: 'pointer' }}>How do I get a token?</summary>
        <ol style={{ margin: '8px 0 0 18px', lineHeight: 1.5 }}>
          <li>Ask the repo owner to invite you as a collaborator (Settings → Collaborators).</li>
          <li>
            Create a token at <span className="mono">github.com/settings/personal-access-tokens</span> → Fine-grained
            token.
          </li>
          <li>Resource owner = the repo owner; Repository access = only that data repo.</li>
          <li>Permissions → Repository → <b>Contents: Read and write</b>. Copy the <span className="mono">github_pat_…</span> value here.</li>
        </ol>
      </details>

      {error && <div className="banner danger" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
      {ok && <div className="banner ok" role="status" style={{ marginBottom: 10 }}>{ok}</div>}

      <div className="ctl-row" style={{ justifyContent: 'flex-end' }}>
        {existing && (
          <button className="btn ghost" onClick={disconnect} disabled={busy} style={{ marginRight: 'auto' }}>
            Disconnect
          </button>
        )}
        <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={connect} disabled={busy}>
          {busy ? 'Connecting…' : 'Connect & load'}
        </button>
      </div>
    </div>
  )
}
