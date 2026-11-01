"""Ops console Docker routes: container list + log tails (read-only)."""

from fastapi import APIRouter, HTTPException, Query

from app.collector.docker_watcher import DockerUnavailableError
from app.services import docker_ops

router = APIRouter(prefix="/docker", tags=["docker"])


@router.get("/containers")
def list_containers() -> list[dict]:
    try:
        return docker_ops.list_containers()
    except DockerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/containers/{name}/logs")
def container_logs(
    name: str, tail: int = Query(default=200, ge=1, le=2000)
) -> dict:
    try:
        return docker_ops.container_logs(name, tail=tail)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DockerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
