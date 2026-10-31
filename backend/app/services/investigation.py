"""Investigation entry point — LangGraph pipeline lands here in a later milestone."""

from app.core.logging import get_logger

log = get_logger(__name__)


def run_investigation(incident_id: str) -> dict:
    """Not implemented yet (Milestone 4+). Raises rather than faking results."""
    raise NotImplementedError(
        f"investigation pipeline not implemented yet (incident {incident_id})"
    )
