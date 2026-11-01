"""SRE Copilot: stateless grounded Q&A (no persistence, no auto-actions)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.llm.base import LLMError
from app.services import copilot as copilot_service

router = APIRouter(prefix="/copilot", tags=["copilot"])


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    incident_id: uuid.UUID | None = None
    model: str | None = Field(default=None, max_length=256)


class AskResponse(BaseModel):
    answer: str
    evidence_ids: list[str] = []
    runbook_ids: list[str] = []
    confidence: float | None = None
    actual_model: str = ""
    total_tokens: int = 0


@router.post("/ask", response_model=AskResponse)
async def ask_question(
    payload: AskRequest, session: Session = Depends(get_session)
) -> AskResponse:
    try:
        result = await copilot_service.ask(
            session,
            payload.question,
            incident_id=payload.incident_id,
            model_override=payload.model,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(
            status_code=502, detail=f"copilot provider failed: {exc.code.value}"
        ) from exc
    return AskResponse(**result)
