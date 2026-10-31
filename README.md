# DeployIQ — AI-Powered DevOps Copilot

Automated root-cause analysis and grounded incident remediation via multi-agent systems.

## Status

Foundation only. No application modules implemented yet — backend structure is under
architecture review with GPT-6 (see ChatGPT mentorship conversation).

## Stack (MVP)

- Backend: Python 3.12, FastAPI, Pydantic, SQLAlchemy
- AI: LangGraph, OpenRouter (free-model routing, structured JSON output)
- RAG: DevOps runbooks (ranked retrieval; pgvector where feasible)
- Frontend: React + TypeScript + Vite + Tailwind (not started)
- Reports: ReportLab PDF
- Infra: Docker Desktop, Docker Compose, GitHub Actions

## Quickstart (placeholder)

1. Copy `.env.example` to `.env` and fill in values (never commit `.env`).
2. Create the virtualenv and install pinned deps:
   `python -m venv backend/.venv && backend/.venv/Scripts/python -m pip install -r backend/requirements.txt`
3. Apply database migrations from `backend/`:
   `MONITORED_PROJECTS=deployiq-demo backend/.venv/Scripts/python -m alembic upgrade head`
4. Start the API from `backend/` (migrations must run first; the app never auto-creates schema):
   `$env:MONITORED_PROJECTS="deployiq-demo"; .venv/Scripts/python -m uvicorn app.main:app`
5. Frontend and RAG/AI setup instructions will be added as those milestones land.

## Security

- Never commit `.env` or secrets.
- No arbitrary LLM-generated shell execution; allowlisted remediation only.
