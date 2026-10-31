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
2. Backend and frontend setup instructions will be added once Milestone 1 is approved.

## Security

- Never commit `.env` or secrets.
- No arbitrary LLM-generated shell execution; allowlisted remediation only.
