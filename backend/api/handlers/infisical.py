"""Admin endpoints for Infisical secret-change history.

Reads from the Pulse-side mirror (models.infisical_secret_event)
populated by services.infisical_history poller. Never touches the
Infisical DB directly — the API stays snappy even during a backfill.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from api.deps import require_admin
from models.infisical_secret_event import InfisicalSecretEvent
from models.user import User
from services import infisical_history

router = APIRouter(prefix="/infisical", tags=["infisical"])


def _iso_utc(dt) -> Optional[str]:
    """Emit an ISO string with explicit +00:00 offset.

    Beanie strips tzinfo on write for older records so we can't rely on
    the stored value carrying an offset. Assume Infisical postgres UTC
    when tzinfo is missing — same assumption the poller makes.
    """
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _serialize(ev: InfisicalSecretEvent) -> dict:
    return {
        "id": str(ev.id),
        "projectSlug": ev.project_slug,
        "envSlug": ev.env_slug,
        "secretKey": ev.secret_key,
        "version": ev.version,
        "changedAt": _iso_utc(ev.changed_at),
        "actorType": ev.actor_type,
        "actor": ev.actor,
        "alertSent": ev.alert_sent,
    }


@router.get("/secret-history")
async def list_history(
    project: Optional[str] = None,
    env: Optional[str] = None,
    actor: Optional[str] = None,
    key: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    limit: int = 200,
    skip: int = 0,
    admin: User = Depends(require_admin),
):
    """Filtered timeline of Infisical secret changes."""
    query: dict = {}
    if project:
        query["project_slug"] = project
    if env:
        query["env_slug"] = env
    if actor:
        query["actor"] = actor
    if key:
        query["secret_key"] = key
    date_range: dict = {}
    if since:
        try:
            date_range["$gte"] = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid `since` timestamp")
    if until:
        try:
            date_range["$lte"] = datetime.fromisoformat(until.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid `until` timestamp")
    if date_range:
        query["changed_at"] = date_range

    docs = (
        await InfisicalSecretEvent.find(query)
        .sort("-changed_at")
        .skip(max(0, skip))
        .limit(max(1, min(limit, 500)))
        .to_list()
    )
    total = await InfisicalSecretEvent.find(query).count()
    return {
        "count": len(docs),
        "total": total,
        "events": [_serialize(d) for d in docs],
    }


@router.get("/secret-history/versions")
async def list_versions(
    project: str,
    env: str,
    key: str,
    admin: User = Depends(require_admin),
):
    """All versions of one (project, env, key) — the drill-down view."""
    docs = (
        await InfisicalSecretEvent.find(
            {"project_slug": project, "env_slug": env, "secret_key": key}
        )
        .sort("-version")
        .to_list()
    )
    return {
        "projectSlug": project,
        "envSlug": env,
        "secretKey": key,
        "versions": [_serialize(d) for d in docs],
    }


@router.get("/facets")
async def facets(admin: User = Depends(require_admin)):
    """Distinct filter values for the dashboard dropdowns."""
    coll = InfisicalSecretEvent.get_motor_collection()
    projects = sorted(await coll.distinct("project_slug"))
    envs = sorted(await coll.distinct("env_slug"))
    actors = sorted(await coll.distinct("actor"))
    return {"projects": projects, "envs": envs, "actors": actors}


@router.post("/sync")
async def sync_now(admin: User = Depends(require_admin)):
    """Force one poll iteration on demand — useful after mass changes
    when the admin doesn't want to wait for the next tick."""
    return await infisical_history.sync_once()
