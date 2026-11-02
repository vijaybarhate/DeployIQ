# DeployIQ Demo Guide — 3-case ops-console walkthrough (develop + feat/ops-console)

The demo opens on the ops console: `http://localhost:5173/console`
(reference-inspired two-panel layout: container explorer + live tail on the
left, incident diagnostic + AI report on the right). Capabilities covered:
free-model engine picker with live health check, manual log ingestion, SRE
Copilot grounded Q&A, per-investigation model override, .docx reports.

## 1. Architecture under demo (console + backend services)

```text
docker compose (demo/crashme: ok / boom / dead)
  -> Docker watcher (MONITORED_PROJECTS=deployiq-demo) tails logs,
     normalizes evidence, groups by error_signature (dedup)
  -> FastAPI:
       GET /api/v1/docker/containers + /logs (read-only, scope-enforced)
       POST /api/v1/incidents/manual (evidence extractor, matched lines)
       GET /api/v1/models + /models/check|/status (verified free catalogue)
       POST /api/v1/copilot/ask (stateless grounded Q&A, no persistence)
       POST /api/v1/incidents/{id}/investigations (explicit trigger only)
       GET  .../investigations/{inv}/report (.docx download)
  -> LangGraph: evidence -> rag (BM25 runbooks) -> root_cause
     (verified free model per pick, 1 compatibility retry) -> report
     (Pydantic validation, snapshots frozen per attempt)
  -> React Ops Console (/console): container explorer + live tail (left),
     incident diagnostic + AI report + .docx (right, nothing auto-runs)
```

Investigation calls are synchronous: the trigger request waits for the
pipeline to finish (pending/running states are visible when a run takes
longer than the UI poll interval; history refreshes after trigger). There
is no background queue — no investigation ever starts on its own.

## 2. Exact reproducible setup (Windows PowerShell)

Prerequisites: Docker Desktop running, root `.env` present with
`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (a `:free` model) and optional
`OPENROUTER_FALLBACK_MODELS` (all `:free`). For pooled availability checks,
add teammate keys as `OPENROUTER_API_KEY1`, `_KEY2`, … `_KEY9` (same file);
the backend logs the pooled key count at startup (never the values) and the
console shows per-key live/limited status. Never commit `.env`.
`DATABASE_URL` defaults to `sqlite:///./deployiq.db` when the app is launched
from `backend/` (do not leave it blank — empty values override the default).
`MONITORED_PROJECTS` must be set in **each** terminal (it is read from the
environment; root `.env` is also loaded as fallback).

Backend migration, from `backend/`:

```powershell
$env:MONITORED_PROJECTS = "deployiq-demo"
.\.venv\Scripts\python.exe -m alembic upgrade head
```

API, in a separate `backend/` terminal:

```powershell
$env:MONITORED_PROJECTS = "deployiq-demo"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Watcher, in another `backend/` terminal:

```powershell
$env:MONITORED_PROJECTS = "deployiq-demo"
.\.venv\Scripts\python.exe -m app.collector.watch
```

Frontend, from `frontend/`:

```powershell
npm run dev
```

Health endpoints (do not confuse them):

- Backend API: `http://127.0.0.1:8000/api/v1/healthz` (also reports Docker
  connectivity).
- CrashMe container: `http://localhost:18000/health` (200 unless its
  `/tmp/unhealthy` flag exists).
- Dashboard: `http://localhost:5173` (Vite dev server, proxies `/api`).

## 3. Verified live run (3-case demo, Windows + Docker 29.8.2)

| Step | Command / action | Result |
|---|---|---|
| Compose up | `docker compose -f demo/docker-compose.yml up -d --build` | `crashme-ok`, `crashme-boom`, `crashme-dead` Up, healthy |
| Migrate | `alembic upgrade head` (from `backend/`) | clean |
| API | uvicorn on :8000 | `/api/v1/healthz` ok, docker connected |
| Watcher | `python -m app.collector.watch` | streaming |
| Case 1 all-good | open `crashme-ok` logs in Ops Console | only `/health 200` lines, Diagnose honestly refuses (422, no evidence) |
| Case 2 app-error | `curl.exe -i http://127.0.0.1:18001/boom` (also auto-fires ~15s after boot) | HTTP 500, ZeroDivisionError traceback in `docker logs`; watcher auto-records ONE incident, repeat booms raise observation count (dedup) |
| Case 3 hard-crash | `crashme-dead` calls `/die` ~45s after boot | container Exited(1); watcher auto-records exit-code incident, no click needed |
| Investigate | console Diagnose / incident Run AI investigation | completed, actual_model freeRouter pick, findings cite E-00x + RB-00x |
| RCA | investigation result | diagnosed, approval-required fix steps, confidence estimate |

## 4. Failure / fallback paths (demonstrated or covered by tests)

- Provider null/strict-schema output -> plain-JSON retry (max 1), else honest
  `failed`/`validation_failed` with `error_code`, never a fake report.
- Duplicate active investigation -> 409 with workbench message + refresh.
- History/investigation fetch failure -> distinct error state + Retry button
  (unit + Playwright covered).
- Ghost/expired polling cleanup -> bounded misses, interval stops (unit).
- Backend unreachable -> Incident Center error state (Playwright smoke).

## 5. Repeatable 7–10 minute demo script (3 cases)

1. (0:00) `docker compose -f demo/docker-compose.yml up -d --build`, show
   all three containers healthy + backend `/api/v1/healthz`.
2. (1:00) **Case 1 — all good:** open `crashme-ok` in Ops Console, show clean
   `/health 200` tail. Diagnose honestly refuses (no evidence) — the system
   never invents incidents.
3. (2:30) **Case 2 — app error:** `curl.exe -i http://127.0.0.1:18001/boom`
   -> 500 live in front of the audience; show the traceback in the console
   tail. Incident Center: ONE ZeroDivisionError incident; boom again ->
   observation count grows, still ONE incident (dedup story).
4. (4:30) In the console right panel: Diagnose recorded it -> press Investigate
    (the trigger waits for the pipeline; on slow runs the status polls as
    running). Completed report shows root cause, finding chips (E-00x/RB-00x)
    -> click a citation (focus jumps, panel opens), approval-required
    recommendation, and Download report (.docx). Same flow works from the
    incident details page workbench.
5. (7:00) **Case 3 — hard crash:** `crashme-dead` already Exited(1) — its
   exit-code incident appeared with zero clicks. Re-run the death live:
   `docker compose -f demo/docker-compose.yml restart crashme-dead`, wait
   ~45s, watch the incident land. Q&A.
6. Failure path (optional): stop backend -> error + Retry; restart.

## 6. Reset semantics (read before demoing)

- CrashMe reset (containers only):
  `docker compose -f demo/docker-compose.yml restart crashme-ok crashme-boom`
  replays the boom timer (~15s); `restart crashme-dead` replays the death
  (~45s). Application history is untouched, see below.
- Full application-state reset (incidents/investigations): with the DEFAULT
  SQLite configuration and the app run from `backend/`, the database lives at
  `backend/deployiq.db`, which is OUTSIDE the Compose project, so
  `docker compose down -v` does NOT clear it. Before touching the database:
  1. Stop the API and watcher processes first (never delete a SQLite file
     the application is using).
  2. Check the configured `DATABASE_URL` (environment or root `.env`) — only
     proceed below if it is unset or points at the default
     `sqlite:///./deployiq.db`.
  3. Back up `backend/deployiq.db`, delete it, then re-run
     `alembic upgrade head` from `backend/` for a truly clean Incident Center.
  An alternate SQLite path or a PostgreSQL `DATABASE_URL` needs its own
  reset procedure (do NOT apply the file-delete steps to it). Do NOT expect a
  clean dashboard from restarting only CrashMe.
