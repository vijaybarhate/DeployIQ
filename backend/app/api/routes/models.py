"""Free-model catalog for the console engine picker."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import models as model_service

router = APIRouter(prefix="/models", tags=["models"])


class FreeModel(BaseModel):
    id: str
    name: str


@router.get("", response_model=list[FreeModel])
async def list_models() -> list[FreeModel]:
    items = await model_service.list_free_models()
    return [FreeModel(id=e["id"], name=e["name"]) for e in items]
