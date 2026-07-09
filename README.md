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

## Data, backups & snapshots via git.epam.com

Data is small and versioned by git, which doubles as your **snapshot history and
backup**. Recommended flow for a few occasional editors:

1. Clone the repo (this folder) from git.epam.com.
2. Run the app, click **Connect repo** (Chromium browsers), point it at this folder.
3. Edit. Click **Save → repo** to write the JSON files:
   ```
   data/roster.json
   data/stages.json
   data/manifest.json
   data/opportunities/<id>.json   ← one file per opportunity
   ```
4. `git commit && git push`. **Each commit is a snapshot and a backup.**

Because each opportunity is its own file, two people editing *different*
opportunities never hit a merge conflict. For a weekly trend, click **Snapshot**
(records a summary row) and commit — the dashboard sparklines read those.

> No Chromium? Use **Import** / **JSON** buttons to load and download the bundle
> manually, and commit the downloaded file.

## Model notes

- An assignment's weekly FTE is keyed by a **relative week offset**, so sliding an
  opportunity is a single-field change — the grid never re-keys.
- Weighted FTE·wk = planned FTE × close %, summed across the horizon.
- Delivery roles can be **named** (capacity-tracked) or left **abstract** (role
  lines added straight onto an opportunity).

## Stack

React + TypeScript + Vite + Zustand. No backend. ~zero runtime dependencies
beyond React. Deployable as static files (e.g. GitLab Pages) — `base` is relative.
