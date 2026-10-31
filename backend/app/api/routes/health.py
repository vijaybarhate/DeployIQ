"""Health route incl. Docker collector connectivity status."""

from fastapi import APIRouter

from app.collector.docker_watcher import connection_status

router = APIRouter()


@router.get("/healthz")
def healthz() -> dict:
    docker = connection_status()
    ok = True  # API is up even if Docker is down; status is reported, not hidden.
    return {"ok": ok, "service": "deployiq-backend", "docker": docker}


@router.get("/collector/status")
def collector_status() -> dict:
    return {"docker": connection_status()}
