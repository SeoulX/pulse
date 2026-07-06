"""Auto-discovered DB inventory + on-demand probes.

Source of truth = the `devops-global-secrets` Secret, envFrom'd into
pulse-api as plain env vars (Reflector mirrors the Secret into the
pulse-api namespace; the Deployment includes
`envFrom: secretRef: devops-global-secrets`). This handler reads the
relevant env vars at request time so new DBs added to the cluster
Secret appear in the UI as soon as pulse-api restarts (Reloader does
that automatically on Secret change).

No Mongo collection — discovery is stateless, probes are on-demand.
"""

import os
import re
import urllib.parse
from typing import Optional

from fastapi import APIRouter, HTTPException

from api.deps import require_admin
from models.endpoint import Endpoint
from models.user import User
from services.check_db import PROBES
from services.db_metrics import DETAILS
from models.db_metric_sample import DbMetricSample
from datetime import datetime, timedelta, timezone
from fastapi import Depends, Query

router = APIRouter(prefix="/databases", tags=["databases"])


# Which env-var names map to which probe kind. Scope locked to the
# DBs the team asked for; add new keys here as inventory grows.
# Order within each kind is preserved for stable UI listing.
_INVENTORY: dict[str, list[tuple[str, str]]] = {
    "mongo": [
        ("MONGODB_URI", "MongoDB primary"),
    ],
    "redis": [
        ("REDIS_KL_MAIN_URI", "Redis (kl primary)"),
        ("REDIS_KL_V4_URI", "Redis (kl v4)"),
    ],
    "elasticsearch": [
        ("ES_SCOUP_URI", "ES Scoup"),
        ("ES_V4_URI", "ES v4"),
        ("ES_SALINA_URI", "ES Salina"),
        ("ES_VP_URI", "ES Voice-Product"),
    ],
    "postgres": [
        ("POSTGRES_URI", "Postgres"),
    ],
}


def _mask(uri: str) -> str:
    """Hide creds in a connection string for UI display.
    `mongodb://user:secret@host/...` -> `mongodb://***:***@host/...`.
    Leaves host + path intact so admins can spot which cluster it
    points at."""
    if not uri:
        return ""
    try:
        # Generic regex covers mongo, postgres, redis, http(s).
        return re.sub(r"://[^@/]+@", "://***:***@", uri)
    except Exception:
        return "***"


def _entry(key: str, label: str, kind: str) -> Optional[dict]:
    """Return UI entry for an env key, or None when value missing/empty."""
    val = os.environ.get(key, "").strip()
    if not val:
        return None
    return {
        "key": key,
        "label": label,
        "kind": kind,
        "url_masked": _mask(val),
    }


@router.get("")
async def list_databases(admin: User = Depends(require_admin)):
    """Inventory of DBs discoverable from the pulse-api environment.

    Empty / unset env vars are dropped — the UI then shows nothing for
    that key rather than a fake DB entry.
    """
    out: dict[str, list[dict]] = {}
    for kind, entries in _INVENTORY.items():
        out[kind] = []
        for key, label in entries:
            e = _entry(key, label, kind)
            if e:
                out[kind].append(e)
    return out


@router.post("/probe/{key}")
async def probe_database(key: str, admin: User = Depends(require_admin)):
    """Run the matching protocol probe against the env value for `key`.

    Returns the same {status, status_code, response_time, error} shape
    as the endpoint probes so the frontend can render results
    uniformly."""
    # Find which kind owns this key.
    kind = None
    label = None
    for k, entries in _INVENTORY.items():
        for env_key, lbl in entries:
            if env_key == key:
                kind, label = k, lbl
                break
        if kind:
            break
    if kind is None:
        raise HTTPException(status_code=404, detail=f"Unknown database key: {key}")
    if kind not in PROBES:
        raise HTTPException(status_code=400, detail=f"No probe registered for kind: {kind}")

    val = os.environ.get(key, "").strip()
    if not val:
        raise HTTPException(
            status_code=404,
            detail=f"Env var {key} not set on pulse-api — check devops-global-secrets is envFrom'd into the pod.",
        )

    # Build a transient Endpoint just to reuse the probe signature.
    # Not persisted — discovery is stateless.
    probe_ep = Endpoint(
        name=f"probe:{key}",
        kind=kind,  # type: ignore[arg-type]
        url=val,
        timeout=10,
    )
    result = await PROBES[kind](probe_ep)
    return {"key": key, "label": label, "kind": kind, **result}


@router.get("/details/{key}")
async def database_details(key: str, admin: User = Depends(require_admin)):
    """Deep metric snapshot — protocol-specific, one-shot, no storage.

    Returns `{key, label, kind, sections: [{title, rows: [[label, value], ...]}, ...]}`.
    Each section is a logical group (Connections, Replication, ...);
    the frontend renders them as key/value cards.
    """
    kind = None
    label = None
    for k, entries in _INVENTORY.items():
        for env_key, lbl in entries:
            if env_key == key:
                kind, label = k, lbl
                break
        if kind:
            break
    if kind is None:
        raise HTTPException(status_code=404, detail=f"Unknown database key: {key}")
    if kind not in DETAILS:
        raise HTTPException(status_code=400, detail=f"No metric collector for kind: {kind}")

    uri = os.environ.get(key, "").strip()
    if not uri:
        raise HTTPException(
            status_code=404,
            detail=f"Env var {key} not set — check devops-global-secrets envFrom.",
        )

    result = await DETAILS[kind](uri)
    return {"key": key, "label": label, "kind": kind, **result}


@router.get("/history/{key}")
async def database_history(
    key: str,
    minutes: int = Query(60, ge=5, le=10080),  # default last hour, cap 7d
    admin: User = Depends(require_admin),
):
    """Return time-series samples for a DB key. Drives the sparkline +
    history view in the Databases page.

    Each entry: {captured_at, status, response_time_ms, error}.
    Sorted oldest → newest so the chart can plot straight from the
    array. The TTL index on `captured_at` reaps anything older than
    DATA_RETENTION_DAYS, so very large `minutes` values silently
    return less data."""
    # Resolve key → ensure it's known before hitting Mongo.
    known = any(env_key == key for entries in _INVENTORY.values() for env_key, _ in entries)
    if not known:
        raise HTTPException(status_code=404, detail=f"Unknown database key: {key}")

    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    samples = (
        await DbMetricSample
        .find(DbMetricSample.key == key, DbMetricSample.captured_at >= since)
        .sort("+captured_at")
        .to_list()
    )
    return {
        "key": key,
        "minutes": minutes,
        "count": len(samples),
        "samples": [
            {
                "captured_at":      s.captured_at.isoformat(),
                "status":           s.status,
                "response_time_ms": s.response_time_ms,
                "error":            s.error,
                "metrics":          s.metrics or {},
            }
            for s in samples
        ],
    }
