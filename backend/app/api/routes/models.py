"""Free-model catalog + per-model health check for the console engine picker."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.llm.base import LLMError
from app.services import models as model_service

router = APIRouter(prefix="/models", tags=["models"])


class FreeModel(BaseModel):
    id: str
    name: str


class CheckRequest(BaseModel):
    model: str = Field(min_length=1, max_length=256)


class CheckResponse(BaseModel):
    model: str
    ok: bool = True
    actual_model: str = ""
    latency_ms: int = 0


@router.get("", response_model=list[FreeModel])
async def list_models() -> list[FreeModel]:
    items = await model_service.list_free_models()
    return [FreeModel(id=e["id"], name=e["name"]) for e in items]


@router.post("/check", response_model=CheckResponse)
async def check_model(payload: CheckRequest) -> CheckResponse:
    """Ping one explicit free model; proves the picker selection is live."""
    try:
        result = await model_service.check_model(payload.model)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except LLMError as exc:
        raise HTTPException(
            status_code=502, detail=f"model check failed: {exc.code.value}"
        ) from None
    return CheckResponse(**result)
