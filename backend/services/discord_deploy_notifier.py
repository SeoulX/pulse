"""Discord webhook notifier for deployment lifecycle events.

Separate from `services/notification.py` (which handles endpoint
health checks). Fires a single embedded message per submission when:
  - new submission lands awaiting approval (one message covers all
    sibling env records grouped by submission_id)
  - an admin approves or rejects (single env or all siblings)

Webhook URL comes from settings.DISCORD_DEPLOYMENT_WEBHOOK_URL. Empty
URL silently no-ops so dev/test environments don't need a real channel.
"""

from typing import Iterable, Optional

import httpx

from core.config import settings
from models.deployment import DeploymentRequest


# Discord embed colors (decimal). Mirrors the tracker UI status pills
# so an admin reading Discord + the UI sees the same color.
_COLOR_PENDING = 0xFBBF24   # amber — waiting on admin
_COLOR_APPROVED = 0x10B981  # emerald
_COLOR_REJECTED = 0xEF4444  # red


def _track_url(dep: DeploymentRequest) -> str:
    """Public-facing tracker link the admin clicks to approve/reject.
    Falls back to a relative path when no host is configured."""
    return f"/track/{dep.track_token}"


def _envs_field(deps: Iterable[DeploymentRequest]) -> str:
    """Single field listing one line per env record with track link."""
    lines = []
    for d in deps:
        env = (d.environments or ["?"])[0]
        lines.append(f"• **{env}** — [open]({_track_url(d)}) · `{d.id}`")
    return "\n".join(lines) or "*(no envs)*"


async def _post(payload: dict) -> None:
    """Best-effort POST. Network/Discord errors logged, never raised —
    the deployment must succeed even if Discord is down."""
    url = settings.DISCORD_DEPLOYMENT_WEBHOOK_URL
    if not url:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload)
    except Exception as exc:
        # Don't propagate — Discord outage must not 500 the deploy API.
        print(f"[discord-deploy] post failed: {exc}", flush=True)


async def notify_pending_approval(deps: list[DeploymentRequest]) -> None:
    """Fires on POST /api/deployments. `deps` are sibling env records
    sharing a submission_id — one message lists them all."""
    if not deps:
        return
    head = deps[0]
    envs_label = ", ".join(d.environments[0] for d in deps if d.environments)
    embed = {
        "title": f"🟡 New deployment awaiting approval — {head.repo_slug}",
        "color": _COLOR_PENDING,
        "fields": [
            {"name": "Repo",          "value": f"`{head.repo_slug}`",       "inline": True},
            {"name": "Cluster",       "value": f"`{head.cluster}`",          "inline": True},
            {"name": "Workload",      "value": f"`{head.workload_kind}` / `{head.role or '-'}`", "inline": True},
            {"name": "Requested by",  "value": head.requested_by or "*(unknown)*", "inline": True},
            {"name": "Envs",          "value": envs_label or "-",            "inline": True},
            {"name": "Submission ID", "value": f"`{head.submission_id}`",    "inline": True},
            {"name": "Records",       "value": _envs_field(deps),            "inline": False},
        ],
    }
    await _post({"embeds": [embed]})


async def notify_decision(dep: DeploymentRequest, *, approved: bool, reason: Optional[str] = None) -> None:
    """Fires when an admin approves/rejects a single env record. One
    message per decision (siblings may resolve independently)."""
    env = (dep.environments or ["?"])[0]
    embed = {
        "title": (
            f"✅ Approved — {dep.repo_slug} ({env})"
            if approved
            else f"❌ Rejected — {dep.repo_slug} ({env})"
        ),
        "color": _COLOR_APPROVED if approved else _COLOR_REJECTED,
        "fields": [
            {"name": "Repo",          "value": f"`{dep.repo_slug}`",                "inline": True},
            {"name": "Env",           "value": f"`{env}`",                          "inline": True},
            {"name": "Cluster",       "value": f"`{dep.cluster}`",                  "inline": True},
            {"name": "Decided by",    "value": dep.approved_by or "*(unknown)*",    "inline": True},
            {"name": "Requested by",  "value": dep.requested_by or "*(unknown)*",   "inline": True},
            {"name": "Track",         "value": f"[open]({_track_url(dep)})",        "inline": True},
        ],
    }
    if not approved and reason:
        embed["fields"].append({"name": "Reason", "value": reason, "inline": False})
    await _post({"embeds": [embed]})
