"""Redis client for publishing deployment specs + job-queue entries.

Pulse writes:
  pulse:spec:<slug>     STRING (JSON)  persistent — full spec for generate-manifests.sh
  pulse:queue:<slug>    LIST (JSON)    consumable — Jenkins RPOPs one per build

Jenkins reads:
  GET  pulse:spec:<slug>      → spec.json content (fail strict if empty)
  RPOP pulse:queue:<slug>     → claim a fresh job (skip if empty: rebuild from spec)
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import redis

from core.config import settings


_client: Optional[redis.Redis] = None


def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD or None,
            db=settings.REDIS_DB,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
        )
    return _client


def publish_spec(slug: str, spec: dict[str, Any]) -> None:
    """Persist the deployment spec for `slug`. Overwrites any prior value."""
    _get_client().set(f"pulse:spec:{slug}", json.dumps(spec))


def enqueue_job(slug: str, *, deployment_id: str, requested_by: str) -> str:
    """Push a one-shot build claim. Returns the generated job_id."""
    job_id = uuid.uuid4().hex
    payload = {
        "job_id": job_id,
        "deployment_id": deployment_id,
        "requested_by": requested_by,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }
    _get_client().lpush(f"pulse:queue:{slug}", json.dumps(payload))
    return job_id


def ping() -> bool:
    try:
        return bool(_get_client().ping())
    except Exception:
        return False
