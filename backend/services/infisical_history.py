"""Poll Infisical's `secret_versions_v2` table for secret-change history.

Infisical OSS (community, no enterprise license) has audit_logs
gated — the API endpoint returns []. `secret_versions_v2` is free
and records full actor attribution for writes, so we bypass the API
entirely and read Postgres.

Query joins secret_versions_v2 → secret_folders → project_environments
→ projects because sv.envId is NULL on every row (schema quirk).

Hard rule: NEVER select encryptedValue / encryptedComment. Pulse shows
key + actor + timestamp, never the new value.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import asyncpg
import httpx

from core.config import settings
from models.infisical_secret_event import InfisicalSecretEvent

log = logging.getLogger(__name__)

_QUERY = """
SELECT sv."createdAt"                     AS changed_at,
       p.slug                             AS project,
       pe.slug                            AS environment,
       sv.key                             AS secret_key,
       sv.version                         AS version,
       sv."actorType"                     AS actor_type,
       COALESCE(u.email, i.name, '?')     AS actor
FROM secret_versions_v2 sv
JOIN secret_folders sf       ON sf.id = sv."folderId"
JOIN project_environments pe ON pe.id = sf."envId"
JOIN projects p              ON p.id  = pe."projectId"
LEFT JOIN users u            ON u.id  = sv."userActorId"
LEFT JOIN identities i       ON i.id  = sv."identityActorId"
WHERE sv."createdAt" > $1
ORDER BY sv."createdAt" DESC
"""

_BACKFILL_QUERY = _QUERY.replace(
    'WHERE sv."createdAt" > $1', "WHERE $1::timestamptz IS NULL OR sv.\"createdAt\" > $1"
)


def is_configured() -> bool:
    return bool(settings.INFISICAL_DB_URI)


async def _fetch_rows(since: Optional[datetime]) -> list[dict]:
    """One-shot fetch. Opens + closes a connection per poll — cheap at
    a 5-minute cadence, avoids pool tuning on a low-traffic worker.
    """
    conn = await asyncpg.connect(settings.INFISICAL_DB_URI)
    try:
        rows = await conn.fetch(_QUERY, since or datetime(1970, 1, 1, tzinfo=timezone.utc))
        return [dict(r) for r in rows]
    finally:
        await conn.close()


async def _last_synced_at() -> Optional[datetime]:
    """High-water mark = most recent changed_at we already stored."""
    doc = await InfisicalSecretEvent.find_all().sort("-changed_at").limit(1).to_list()
    return doc[0].changed_at if doc else None


async def _maybe_alert(ev: InfisicalSecretEvent, *, silent: bool = False) -> None:
    """Fire Discord alert on prod writes OR non-operator identity writes.

    Operator = the k8s Infisical operator (identity name matches
    INFISICAL_OPERATOR_IDENTITY_NAME). Alerts route to
    DISCORD_INFISICAL_ALERT_WEBHOOK_URL (falls back to db-alert channel).
    """
    if silent:
        return  # backfill mode — don't spam Discord with historical rows
    is_prod = ev.env_slug in ("prod", "production")
    is_unexpected_identity = (
        ev.actor_type == "identity"
        and ev.actor != settings.INFISICAL_OPERATOR_IDENTITY_NAME
    )
    if not (is_prod or is_unexpected_identity):
        return
    hook = (
        settings.DISCORD_INFISICAL_ALERT_WEBHOOK_URL
        or settings.DISCORD_DB_ALERT_WEBHOOK_URL
    )
    if not hook:
        return
    tag = "PROD" if is_prod else "IDENTITY"
    color = 0xE74C3C if is_prod else 0xE67E22
    embed = {
        "title": f"Infisical secret changed — {tag}",
        "color": color,
        "fields": [
            {"name": "Project", "value": ev.project_slug, "inline": True},
            {"name": "Env", "value": ev.env_slug, "inline": True},
            {"name": "Key", "value": ev.secret_key, "inline": True},
            {"name": "Version", "value": str(ev.version), "inline": True},
            {"name": "Actor", "value": f"{ev.actor} ({ev.actor_type})", "inline": True},
            {"name": "When", "value": ev.changed_at.isoformat(), "inline": True},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            await c.post(hook, json={"embeds": [embed]})
        ev.alert_sent = True
        await ev.save()
    except Exception:
        log.warning("infisical alert dispatch failed (non-fatal)")


async def sync_once() -> dict:
    """Pull new rows since high-water, insert idempotently.

    Idempotency: the composite key (project_slug, env_slug, secret_key,
    version) lets us skip already-seen rows. A unique index would be
    tighter but we've kept it advisory here so schema stays flexible
    for future backfills.
    """
    if not is_configured():
        return {"skipped": True, "reason": "INFISICAL_DB_URI unset"}
    since = await _last_synced_at()
    # First run has no high-water → treat as backfill and skip Discord
    # fan-out so we don't nuke the alert channel with historical rows.
    is_backfill = since is None
    rows = await _fetch_rows(since)
    inserted = 0
    for r in rows:
        exists = await InfisicalSecretEvent.find_one(
            InfisicalSecretEvent.project_slug == r["project"],
            InfisicalSecretEvent.env_slug == r["environment"],
            InfisicalSecretEvent.secret_key == r["secret_key"],
            InfisicalSecretEvent.version == int(r["version"]),
        )
        if exists:
            continue
        # Infisical postgres stores timestamptz in UTC; asyncpg returns
        # tz-aware datetimes, but Beanie strips tzinfo before it hits
        # Mongo. Re-attach UTC so serialize_public sends an ISO string
        # with a real offset — otherwise the browser parses it as local
        # time and shifts by the user's TZ (bug: PHT viewer saw values
        # 8h behind reality).
        ts = r["changed_at"]
        if ts is not None and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        elif ts is not None:
            ts = ts.astimezone(timezone.utc)
        ev = InfisicalSecretEvent(
            project_slug=r["project"],
            env_slug=r["environment"],
            secret_key=r["secret_key"],
            version=int(r["version"]),
            changed_at=ts,
            actor_type=r["actor_type"] or "?",
            actor=r["actor"] or "?",
        )
        await ev.insert()
        await _maybe_alert(ev, silent=is_backfill)
        inserted += 1
    log.info(
        "infisical history sync: %d fetched, %d inserted (since=%s)",
        len(rows), inserted, since,
    )
    return {"fetched": len(rows), "inserted": inserted, "since": since}


async def poll_loop() -> None:
    """Background task: sync every INFISICAL_HISTORY_POLL_SEC seconds.

    First iteration acts as the backfill (since=None on empty
    collection — pulls full history, ~1717 rows). Subsequent iterations
    are cheap deltas.
    """
    if not is_configured():
        log.info("infisical history poller disabled (INFISICAL_DB_URI unset)")
        return
    interval = max(30, int(settings.INFISICAL_HISTORY_POLL_SEC or 300))
    log.info("infisical history poller starting (interval=%ds)", interval)
    while True:
        try:
            await sync_once()
        except Exception:
            log.exception("infisical history sync failed")
        await asyncio.sleep(interval)
