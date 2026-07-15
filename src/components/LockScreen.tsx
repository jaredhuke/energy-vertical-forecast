import { useState } from 'react'
import { useStore } from '../store/useStore'
import { DEFAULT_DATA_REPO, GitHubDataError, loadFromGitHub, testConnection, type GitHubConfig } from '../lib/githubData'

/** Front-door lock. The team shares ONE access key (a fine-grained GitHub token
 *  with Contents access to the private data repo). The key is validated against
 *  GitHub before entry, so a wrong key can't read the private data — the lock is
 *  real, not a password hidden in the page. */
export function LockScreen() {
  const setGithubCfg = useStore((s) => s.setGithubCfg)
  const setGithubSha = useStore((s) => s.setGithubSha)
  const setDemoMode = useStore((s) => s.setDemoMode)
  const replaceAll = useStore((s) => s.replaceAll)
  const markSaved = useStore((s) => s.markSaved)

  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function login() {
    if (!key.trim()) {
      setError('Enter your team access key.')
      return
    }
    const cfg: GitHubConfig = { ...DEFAULT_DATA_REPO, token: key.trim() }
    setBusy(true)
    setError('')
    try {
      await testConnection(cfg) // rejects a wrong/expired key before entry
      const { bundle, sha } = await loadFromGitHub(cfg)
      setGithubCfg(cfg)
      setGithubSha(sha)
      if (bundle.opportunities.length || bundle.roster.length) {
        replaceAll(bundle)
        markSaved()
      }
      // githubCfg is now set → App unlocks and renders.
    } catch (e) {
      setError(e instanceof GitHubDataError ? e.message : 'Could not sign in. Check your key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lockscreen">
      <div className="lock-card">
        <div className="brand" style={{ marginBottom: 6 }}>
          <span className="dot" />
          <h1 style={{ fontSize: 20 }}>Energy Vertical</h1>
          <span className="sub">Presales Forecast</span>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          This workspace is private. Enter your <b>team access key</b> to open the shared forecast.
        </p>

        <label className="field">
          <span>Team access key</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && login()}
            placeholder="github_pat_…"
            autoFocus
            autoComplete="off"
          />
        </label>

        {error && <div className="banner danger" role="alert" style={{ marginBottom: 10 }}>{error}</div>}

        <button className="btn primary" onClick={login} disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <details style={{ marginTop: 12, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer' }}>Don't have a key?</summary>
          <p style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
            Ask the workspace owner to (1) invite you to the{' '}
            <span className="mono">{DEFAULT_DATA_REPO.owner}/{DEFAULT_DATA_REPO.repo}</span> repository, then (2) share the
            team key — or make your own fine-grained token with <b>Contents: read &amp; write</b> on that repo at{' '}
            <span className="mono">github.com/settings/personal-access-tokens</span>. Your key is stored only in this
            browser and sent only to GitHub.
          </p>
        </details>

        <button className="link-btn" onClick={() => setDemoMode(true)} disabled={busy} style={{ marginTop: 14 }}>
          Just exploring? View the demo →
        </button>
      </div>
    </div>
  )
}
