"""Discord alerter for DB status transitions.

Fires when:
  - status enters DOWN or DEGRADED (transition from UP / first sample)
  - status recovers from DOWN/DEGRADED back to UP

Avoids spam by only posting on edge transitions. Steady-state DOWN
samples are skipped — the user already got pinged when it went down.

Same-DB duplicate alerts can fire from local + staging samplers
hitting the shared Mongo. Acceptable for now; dedupe via instance_id
later.
"""

import logging
from typing import Optional

import httpx

from core.config import settings
from models.db_metric_sample import DbMetricSample


log = logging.getLogger("db_alert")


_COLOR_DOWN = 0xEF4444
_COLOR_DEGRADED = 0xF59E0B
_COLOR_UP = 0x10B981


async def _post_alert(
    *,
    key: str,
    label: str,
    kind: str,
    transition: str,        # "down" | "degraded" | "up"
    error: Optional[str],
    response_time_ms: float,
) -> None:
    """Post a single embed. Failures swallowed — alerter must not
    crash the sampler tick."""
    url = settings.DISCORD_DB_ALERT_WEBHOOK_URL
    if not url:
        return

    color = {"down": _COLOR_DOWN, "degraded": _COLOR_DEGRADED, "up": _COLOR_UP}[transition]
    emoji = {"down": "🔴", "degraded": "🟡", "up": "🟢"}[transition]
    verb = {"down": "DOWN", "degraded": "DEGRADED", "up": "recovered"}[transition]
    title = f"{emoji} {label} {verb}"

    fields = [
        {"name": "Database",     "value": f"`{key}`",                  "inline": True},
        {"name": "Kind",         "value": f"`{kind}`",                 "inline": True},
        {"name": "Last latency", "value": f"{response_time_ms:.0f} ms", "inline": True},
    ]
    if error:
        # Discord field max 1024 chars; cap defensively.
        fields.append({"name": "Error", "value": (error or "")[:1000], "inline": False})

    payload = {"embeds": [{"title": title, "color": color, "fields": fields}]}
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(url, json=payload)
            if r.status_code >= 300:
                log.warning("db_alert post non-2xx: %s body=%s", r.status_code, r.text[:200])
    except Exception as exc:
        log.warning("db_alert post failed for %s: %s", key, exc)


async def maybe_alert(
    *,
    key: str,
    kind: str,
    label: str,
    current_status: str,
    response_time_ms: float,
    error: Optional[str],
) -> None:
    """Check the immediately-previous sample for this key and fire an
    alert if status transitioned. Called from the sampler right after
    inserting the new sample.

    Note: this reads the *second-most-recent* sample because the one
    we just inserted is now the latest.
    """
    if not settings.DISCORD_DB_ALERT_WEBHOOK_URL:
        return
    try:
        prev_list = (
            await DbMetricSample.find(DbMetricSample.key == key)
            .sort("-captured_at")
            .limit(2)
            .to_list()
        )
    except Exception as exc:
        log.warning("db_alert query failed for %s: %s", key, exc)
        return

    # prev_list[0] is the sample we just inserted (or near-tie); we want
    # the one before that.
    prev_status = prev_list[1].status if len(prev_list) >= 2 else None

    # Edge transitions only.
    if current_status == "DOWN" and prev_status != "DOWN":
        await _post_alert(key=key, label=label, kind=kind, transition="down",
                          error=error, response_time_ms=response_time_ms)
    elif current_status == "DEGRADED" and prev_status != "DEGRADED":
        await _post_alert(key=key, label=label, kind=kind, transition="degraded",
                          error=error, response_time_ms=response_time_ms)
    elif current_status == "UP" and prev_status in ("DOWN", "DEGRADED"):
        await _post_alert(key=key, label=label, kind=kind, transition="up",
                          error=None, response_time_ms=response_time_ms)
