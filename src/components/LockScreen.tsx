import { useState } from 'react'
import { useStore } from '../store/useStore'
import { loadEncryptedDataset, WrongPasswordError } from '../lib/persistence'

/** Front-door lock. The team shares ONE password. It decrypts the published
 *  dataset (public/data/dataset.enc) — the real data is AES-GCM ciphertext at
 *  rest, so a wrong password simply can't decrypt it. No token anywhere. */
export function LockScreen() {
  const setPassphrase = useStore((s) => s.setPassphrase)
  const setDemoMode = useStore((s) => s.setDemoMode)
  const replaceAll = useStore((s) => s.replaceAll)
  const markSaved = useStore((s) => s.markSaved)

  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function signIn() {
    if (!pw.trim()) {
      setError('Enter the team password.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const bundle = await loadEncryptedDataset(pw)
      setPassphrase(pw)
      replaceAll(bundle)
      markSaved()
      // passphrase is now set → App unlocks and renders.
    } catch (e) {
      setError(e instanceof WrongPasswordError ? 'Wrong password. Try again.' : (e as Error).message || 'Could not sign in.')
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
          This workspace is private. Enter the <b>team password</b> to open the shared forecast.
        </p>

        <label className="field">
          <span>Team password</span>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && signIn()}
            placeholder="team password"
            autoFocus
            autoComplete="current-password"
          />
        </label>

        {error && <div className="banner danger" role="alert" style={{ marginBottom: 10 }}>{error}</div>}

        <button className="btn primary" onClick={signIn} disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>
          Don't have it? Ask the workspace owner for the team password. It's kept only in this browser.
        </p>

        <button className="link-btn" onClick={() => setDemoMode(true)} disabled={busy} style={{ marginTop: 14 }}>
          Just exploring? View the demo →
        </button>
      </div>
    </div>
  )
}
