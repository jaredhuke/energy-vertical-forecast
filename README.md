# Energy Vertical — Forecast

A lightweight presales forecasting engine for the Energy Vertical. Plan sales
opportunities on a **weekly FTE** basis, weight them by funnel stage
(**probability to close**), and see the impact on both **energy-vertical
(direct)** roles and **delivery (indirect)** roles — data science, engineering,
design, etc.

## What it does

- **Weekly FTE grid** per opportunity — plan who / which role is on it, week by week.
- **Slide the whole opportunity** ±1 / ±4 weeks with one click; adjust stage and duration just as fast.
- **Weighted forecast** — every FTE is discounted by the stage's close % (Lead 5 → Qualified 20 → Proposal 40 → Negotiation 70 → Closed 100). Toggle committed vs weighted.
- **Capacity watch** — named energy-vertical people are checked for **over-allocation** across the whole pipeline.
- **Dashboard analytics** — funnel by stage, weekly demand, roles impacted, over-allocation.
- **Snapshots & trends** — capture the pipeline each week; the dashboard shows week-over-week deltas and sparklines ("last week 3 opportunities, this week 5").
- **Export** — CSV (Excel-friendly) and JSON bundle.

## Run it

```bash
npm install
npm run dev        # http://localhost:3120
```

Working data lives in your browser (localStorage) as you edit — nothing is lost
on refresh.

## Share it (static site)

Two shareable builds. Seed data is bundled at build time, so both work offline
with no server calls.

```bash
npm run build          # → dist/         static site for any host (GitLab Pages, S3, python -m http.server)
npm run build:share    # → dist-share/index.html   ONE self-contained file
```

`dist-share/index.html` inlines all JS/CSS and the seed — **email it, drop it in
Teams, or double-click to open** (works from `file://`, no server). Rename it to
anything (e.g. `Energy-Vertical-Forecast.html`). Each recipient gets their own
local copy; edits save to their browser. (The git "Connect repo" sync only works
when served over http/localhost, not from `file://` — use **Import/JSON** to move
data in the single-file version.)

## Hosted at EPAM (git.epam.com GitLab Pages), public

The app is hosted at EPAM on git.epam.com GitLab Pages with **public**
visibility — anyone at EPAM can open the link, no login or project membership
needed. The front end reads its data from a dataset file served alongside it.

- **Site:** your project's GitLab Pages URL (Settings → Pages). Public requires
  the **project visibility = Public** when you create it.
- **Dataset:** `…/data/dataset.json` (roster + stages + opportunities in one
  file). The front end fetches it on load.
- **How it deploys:** every push to `main` runs [`.gitlab-ci.yml`](.gitlab-ci.yml)
  → `npm run build` (its `prebuild` step regenerates `public/data/dataset.json`
  from the per-entity source files via [`scripts/build-dataset.mjs`](scripts/build-dataset.mjs))
  → publishes the built site to GitLab Pages.

**To publish new numbers:** edit the data (see below), commit, push. Pages
rebuilds and `dataset.json` updates. In the app, **Load published data** pulls
the latest over the working copy.

> The app is public at EPAM; the committed seed data is fictional. Real
> pipeline data stays in SharePoint (see below) — never commit it to the repo.
> The GitHub repo, if kept, is a **private** off-site mirror only.

## Data storage & collaboration

**Working copy:** your browser's localStorage (survives refresh).
**Shared source of truth:** a shared `data/` folder — one file per person and
per opportunity, so two editors editing *different* items never touch the same
file. `dataset.json` is the consolidated read artifact (regenerated on every
**Save ↑**); the per-entity files are the source of truth.

```
data/dataset.json                 ← consolidated read-file (built on Save)
data/stages.json
data/manifest.json
data/roster/<id>.json             ← one file per person
data/opportunities/<id>.json      ← one file per opportunity
```

> **Confidentiality:** real pipeline data (clients, deal values, staffing) is
> EPAM-internal — share it via SharePoint or git.epam.com only, never a public
> repo. The demo/seed data in this repo is fictional.

### Option A — SharePoint shared folder (EPAM-native, no git)

1. Put the `data/` folder in a SharePoint document library; everyone clicks
   **Sync** (or *Add shortcut to OneDrive*) so it appears in Finder/Explorer.
2. Run the app → **Connect shared folder** → pick that synced folder.
3. **Load ↓** pulls the shared data. Edit. **Save ↑** writes it back —
   OneDrive syncs it to the team automatically.

SharePoint gives you **per-file version history** (backup/audit) and
**permissions** (who edits vs who views) for free. If two people edit the
*same* item while offline, OneDrive keeps both as conflict copies — agree an
owner per opportunity, same as you would in git.

### Option B — Git clone (versioned snapshots)

1. Clone the repo and `git pull` for the latest.
2. Run the app → **Connect shared folder** → select the repo's **root** folder.
3. **Load ↓** to pull the repo's data into the app.
4. Edit. **Save ↑** writes your changes back into `public/data/`.
5. `git commit && git push` to share. **Each commit is a snapshot and a backup.**

> No Chromium? Use **Import** / **JSON** to load and download the bundle manually.
>
> Want everyone in sync in real time (no sync steps at all)? That needs a small
> backend — a separate build. The folder flows above are the zero-infra default.

## Model notes

- An assignment's weekly FTE is keyed by a **relative week offset**, so sliding an
  opportunity is a single-field change — the grid never re-keys.
- Weighted FTE·wk = planned FTE × close %, summed across the horizon.
- Delivery roles can be **named** (capacity-tracked) or left **abstract** (role
  lines added straight onto an opportunity).

## Stack

React + TypeScript + Vite + Zustand. No backend. ~zero runtime dependencies
beyond React. Deployable as static files (e.g. GitLab Pages) — `base` is relative.
