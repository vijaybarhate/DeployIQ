# M3.3-E Live Demo — DeployIQ end-to-end (develop @490be4e + feat/m3.3-live-demo)

## 1. Architecture under demo (implemented, no new backend)

```text
docker compose (demo/crashme)
  -> GET /boom => HTTP 500 + ZeroDivisionError traceback on stderr
  -> Docker watcher (MONITORED_PROJECTS=deployiq-demo) tails logs,
     normalizes evidence, groups by error_signature (dedup)
  -> FastAPI: GET /api/v1/incidents, POST .../investigations
  -> LangGraph: evidence -> rag (BM25 runbooks) -> root_cause
     (OpenRouter free-model routing + 1 compatibility retry) -> report
     (Pydantic validation, snapshots frozen per attempt)
  -> React: Incident Center + Investigation Workbench (polling, live region,
     focus restore, keyboard + Escape, retry states)
```

## 2. Exact reproducible setup (Windows PowerShell)

Prerequisites: Docker Desktop running, root `.env` present with
`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (a `:free` model) and optional
`OPENROUTER_FALLBACK_MODELS` (all `:free`). Never commit `.env`.
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

## 3. Verified live run (2026-11-01, Windows + Docker 29.8.2)

| Step | Command / action | Result |
|---|---|---|
| Compose up | `docker compose -f demo/docker-compose.yml up -d --build` | `deployiq-demo-crashme-1` Up, healthy |
| Migrate | `alembic upgrade head` (from `backend/`) | clean |
| API | uvicorn on :8000 | `/api/v1/healthz` ok, docker connected |
| Watcher | `python -m app.collector.watch` | streaming |
| Crash | `GET :18000/boom` | HTTP 500, traceback in `docker logs` |
| Incident | `GET /api/v1/incidents` | one deduplicated ZeroDivisionError incident (obs=2) |
| Investigate | `POST /api/v1/incidents/{id}/investigations` | completed in ~15s |
| RCA | investigation result | diagnosed, actual_model `nvidia/nemotron-3.5-super-vl:free`, 2903 tokens, finding E-001 + RB-007, approval-required fix steps, confidence 0.92 |
| Crash-exit | `GET :18000/die` | container Exited(1); reset via compose restart (below) |

## 4. Failure / fallback paths (demonstrated or covered by tests)

- Provider null/strict-schema output -> plain-JSON retry (max 1), else honest
  `failed`/`validation_failed` with `error_code`, never a fake report.
- Duplicate active investigation -> 409 with workbench message + refresh.
- History/investigation fetch failure -> distinct error state + Retry button
  (unit + Playwright covered).
- Ghost/expired polling cleanup -> bounded misses, interval stops (unit).
- Backend unreachable -> Incident Center error state (Playwright smoke).

## 5. Repeatable 5–7 minute demo script

1. (0:00) `docker compose -f demo/docker-compose.yml up -d --build`, show
   crashme healthy + backend `/api/v1/healthz`.
2. (1:00) `curl.exe -i http://127.0.0.1:18000/boom` -> 500; show traceback
   via `docker compose -f demo/docker-compose.yml logs --tail 50 crashme`.
3. (2:00) Dashboard Incident Center: new ZeroDivisionError incident, evidence,
   observation count grows on repeat booms (dedup, stays ONE incident).
4. (3:00) Open incident -> Run AI investigation -> watch Queued -> Running
   (elapsed clock, model label) -> Completed.
5. (4:30) Report: root cause, finding chips E-001/RB-007 -> click citation
   (focus jumps, panel opens), approval-required recommendation.
6. (5:30) Failure path: stop backend (or bad key) -> error + Retry; restart.
7. (6:30) `docker compose -f demo/docker-compose.yml restart crashme`
   (container-only reset; application history is untouched, see section 6).
   Q&A.

## 6. Reset semantics (read before demoing)

- CrashMe reset (container only):
  `docker compose -f demo/docker-compose.yml restart crashme`.
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
