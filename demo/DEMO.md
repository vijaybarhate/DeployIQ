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

## 2. Verified live run (2026-11-01, Windows + Docker 29.8.2)

| Step | Command / action | Result |
|---|---|---|
| Compose up | `docker compose -f demo/docker-compose.yml up -d --build` | `deployiq-demo-crashme-1` Up, healthy |
| Migrate | `alembic upgrade head` (from `backend/`) | clean |
| API | `uvicorn app.main:app --port 8000` | `/healthz` ok, docker connected |
| Watcher | `python -m app.collector.watch` | streaming |
| Crash | `GET :18000/boom` | HTTP 500, traceback in `docker logs` |
| Incident | `GET /api/v1/incidents` | `1e1c14e0…` ZeroDivisionError, obs=2 (deduped into ONE incident) |
| Investigate | `POST /api/v1/incidents/{id}/investigations` | completed in ~15s |
| RCA | investigation `77b45195…` | diagnosed, actual_model `nvidia/nemotron-3.5-super-vl:free`, 2903 tokens, finding E-001 + RB-007, approval-required fix steps, confidence 0.92 |
| Crash-exit | `GET :18000/die` | container Exited(1); reset via `docker compose restart crashme` |

## 3. Failure / fallback paths (demonstrated or covered by tests)

- Provider null/strict-schema output -> plain-JSON retry (max 1), else honest
  `failed`/`validation_failed` with `error_code`, never a fake report.
- Duplicate active investigation -> 409 with workbench message + refresh.
- History/investigation fetch failure -> distinct error state + Retry button
  (unit + Playwright covered).
- Ghost/expired polling cleanup -> bounded misses, interval stops (unit).
- Backend unreachable -> Incident Center error state (Playwright smoke).

## 4. Repeatable 5–7 minute demo script

1. (0:00) `docker compose up -d`, show crashme healthy + backend `/healthz`.
2. (1:00) `curl :18000/boom` -> 500; show traceback via `docker logs --tail`.
3. (2:00) Dashboard Incident Center: new ZeroDivisionError incident, evidence,
   observation count grows on repeat booms (dedup, stays ONE incident).
4. (3:00) Open incident -> Run AI investigation -> watch Queued -> Running
   (elapsed clock, model label) -> Completed.
5. (4:30) Report: root cause, finding chips E-001/RB-007 -> click citation
   (focus jumps, panel opens), approval-required recommendation.
6. (5:30) Failure path: stop backend (or bad key) -> error + Retry; restart.
7. (6:30) `docker compose restart crashme` (clean reset). Q&A.

## 5. Reset

```powershell
docker compose -f demo/docker-compose.yml restart crashme
# optional full reset: docker compose down -v (also clears nothing app-side;
# app DB lives in backend/deployiq.db — back it up before wiping)
```
