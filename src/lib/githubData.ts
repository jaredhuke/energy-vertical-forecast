// ---------------------------------------------------------------------------
// GitHub backend for an INVITE-ONLY (private) shared dataset.
//
// A browser app cannot read a private repo from a plain URL — private content
// needs auth, and a static site can't hold a secret. So each collaborator
// supplies their OWN fine-grained token (Contents: read/write on just the data
// repo). The token lives only in that person's browser (localStorage) and is
// sent only to api.github.com (which is CORS-enabled). Nothing is ever baked
// into the public app.
//
// The whole dataset round-trips through one file — `<dir>/dataset.json` — with
// GitHub's file SHA used as an optimistic lock: if someone else saved since you
// loaded, your Save is rejected (409) instead of silently overwriting them, and
// the app tells you to Load the latest first.
// ---------------------------------------------------------------------------
import type { Bundle } from './persistence'
import type { Opportunity } from '../types'

export interface GitHubConfig {
  owner: string
  repo: string
  branch: string // default 'main'
  dir: string // path prefix inside the repo, default 'data'
  token: string
}

const API = 'https://api.github.com'

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** UTF-8-safe base64 (btoa alone corrupts non-ASCII). */
function b64encode(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}
function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const datasetPath = (cfg: GitHubConfig) => `${cfg.dir}/dataset.json`.replace(/\/{2,}/g, '/')

export interface GitHubLoad {
  bundle: Bundle
  sha: string | null // current file SHA — pass back to save() as the optimistic lock
}

export class GitHubDataError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'notfound' | 'conflict' | 'network' | 'bad' = 'bad',
  ) {
    super(message)
  }
}

/** Verify the token + repo are reachable. Throws GitHubDataError with a
 *  human-readable reason otherwise. Returns the repo's default branch. */
export async function testConnection(cfg: GitHubConfig): Promise<{ private: boolean; defaultBranch: string }> {
  let res: Response
  try {
    res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}`, { headers: ghHeaders(cfg.token) })
  } catch {
    throw new GitHubDataError('Could not reach github.com. Check your connection.', 'network')
  }
  if (res.status === 401) throw new GitHubDataError('Token rejected (401). Check the token is correct and not expired.', 'auth')
  if (res.status === 403) throw new GitHubDataError("Token lacks access (403). It needs Contents: read & write on this repo.", 'auth')
  if (res.status === 404) throw new GitHubDataError(`Repo ${cfg.owner}/${cfg.repo} not found, or your token can't see it. Ask to be invited, then give the token repo access.`, 'notfound')
  if (!res.ok) throw new GitHubDataError(`GitHub error ${res.status}.`, 'bad')
  const j = await res.json()
  return { private: !!j.private, defaultBranch: j.default_branch || 'main' }
}

function normalizeBundle(b: any): Bundle {
  return {
    roster: b?.roster ?? [],
    stages: b?.stages ?? [],
    opportunities: (b?.opportunities ?? []).sort((a: Opportunity, z: Opportunity) => a.id.localeCompare(z.id)),
    snapshots: b?.snapshots ?? [],
  }
}

/** Read the shared dataset. Returns sha:null when the file doesn't exist yet
 *  (empty repo) so the first Save creates it. */
export async function loadFromGitHub(cfg: GitHubConfig): Promise<GitHubLoad> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(datasetPath(cfg)).replace(/%2F/g, '/')}?ref=${encodeURIComponent(cfg.branch)}`
  let res: Response
  try {
    res = await fetch(url, { headers: ghHeaders(cfg.token), cache: 'no-store' })
  } catch {
    throw new GitHubDataError('Could not reach github.com. Check your connection.', 'network')
  }
  if (res.status === 404) return { bundle: normalizeBundle({}), sha: null } // no dataset yet
  if (res.status === 401 || res.status === 403) throw new GitHubDataError('Token rejected — check it has Contents access to the repo.', 'auth')
  if (!res.ok) throw new GitHubDataError(`GitHub read failed (${res.status}).`, 'bad')
  const j = await res.json()
  let parsed: any
  try {
    parsed = JSON.parse(b64decode(j.content))
  } catch {
    throw new GitHubDataError('dataset.json in the repo is not valid JSON.', 'bad')
  }
  return { bundle: normalizeBundle(parsed), sha: j.sha as string }
}

/** Write the shared dataset back. `sha` is the value from the last load — if
 *  the file changed on GitHub since then, GitHub returns 409 and we surface a
 *  conflict instead of clobbering a teammate. Returns the new SHA. */
export async function saveToGitHub(cfg: GitHubConfig, bundle: Bundle, sha: string | null, editor: string): Promise<string> {
  const roster = [...bundle.roster].sort((a, b) => a.id.localeCompare(b.id))
  const opportunities = [...bundle.opportunities].sort((a, b) => a.id.localeCompare(b.id))
  const content = b64encode(JSON.stringify({ roster, stages: bundle.stages, opportunities, snapshots: bundle.snapshots }, null, 2))
  const body: Record<string, unknown> = {
    message: `data: update forecast dataset${editor ? ` (${editor})` : ''}`,
    content,
    branch: cfg.branch,
  }
  if (sha) body.sha = sha
  let res: Response
  try {
    res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(datasetPath(cfg)).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new GitHubDataError('Could not reach github.com. Check your connection.', 'network')
  }
  if (res.status === 409 || res.status === 422) {
    throw new GitHubDataError('Someone else saved to the shared data since you loaded it. Load the latest first, then re-apply your change.', 'conflict')
  }
  if (res.status === 401 || res.status === 403) throw new GitHubDataError('Token rejected — it needs Contents: write on this repo.', 'auth')
  if (!res.ok) throw new GitHubDataError(`GitHub save failed (${res.status}).`, 'bad')
  const j = await res.json()
  return j.content?.sha as string
}
