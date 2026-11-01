# DeployIQ — AI-Powered DevOps Copilot

Automated root-cause analysis and grounded incident remediation via multi-agent systems.

## Status

Milestones M1–M3.2 implemented on feature branches (see GitHub PRs); `main`
tracks stable releases only. See the ChatGPT mentorship conversation for
architecture reviews.

## Stack (MVP)

- Backend: Python 3.12, FastAPI, Pydantic, SQLAlchemy
- AI: LangGraph, OpenRouter (free-model routing, structured JSON output)
- RAG: DevOps runbooks (ranked retrieval; pgvector where feasible)
- Frontend: React 19 + TypeScript + Vite + Tailwind CSS v4 (in development on feature branches)
- Reports: ReportLab PDF
- Infra: Docker Desktop, Docker Compose, GitHub Actions

## Quickstart (placeholder)

1. Copy `.env.example` to `.env` and fill in values (never commit `.env`).
2. Create the virtualenv and install pinned deps:
   `python -m venv backend/.venv && backend/.venv/Scripts/python -m pip install -r backend/requirements.txt`
3. Apply database migrations from `backend/` (migrations replace `create_all`;
   the app never auto-creates schema at startup):
   - Fresh database: `backend/.venv/Scripts/python -m alembic upgrade head`
   - Pre-existing dev database (has incidents but predates Alembic): stamp the
     baseline first, then upgrade:
     `backend/.venv/Scripts/python -m alembic stamp 0001_baseline_incidents`
     `backend/.venv/Scripts/python -m alembic upgrade head`
   (Verify the existing schema matches the baseline before stamping.)
4. Start the API from `backend/` (migrations must run first):
   `$env:MONITORED_PROJECTS="deployiq-demo"; .venv/Scripts/python -m uvicorn app.main:app`
5. Start the watcher from `backend/` (same requirement — it exits instead of
   running against an unmigrated database):
   `$env:MONITORED_PROJECTS="deployiq-demo"; .venv/Scripts/python -m app.collector.watch`
6. Frontend (dev server with backend proxy): `cd frontend && npm install && npm run dev`.
   See `frontend/README.md` for typecheck, lint, test and build commands.

## Security

- Never commit `.env` or secrets.
- No arbitrary LLM-generated shell execution; allowlisted remediation only.
