# DeployIQ Frontend

React + TypeScript + Vite workbench for the DeployIQ AI DevOps Copilot.

## Setup

```bash
npm install
```

## Development

The dev server proxies `/api/*` to the FastAPI backend on `127.0.0.1:8000`
(see `vite.config.ts`). Start the backend first (see the root README), then:

```bash
npm run dev
```

No API keys or secrets belong in this app. `VITE_API_URL` (see `.env.example`)
optionally overrides the same-origin `/api/v1` base for non-proxied setups.

## Checks

```bash
npm run typecheck   # TypeScript
npm run lint        # oxlint
npm test -- --run   # Vitest unit/component tests
npm run build       # production build
npm run test:e2e    # Playwright smoke tests (starts dev server automatically)
```

## Structure

- `src/app/` — App shell, router, TanStack Query provider
- `src/features/` — Overview, Incident Center, Incident Details + Workbench
- `src/lib/api/` — typed REST client (`client.ts`, `incidents.ts`, `investigations.ts`)
- `src/types/api.ts` — backend API mirror (evidence snapshots included)
- `src/hooks/` — TanStack Query hooks with status-aware polling
- `e2e/` — Playwright smoke tests (honest backend-absent states, no mock data)
