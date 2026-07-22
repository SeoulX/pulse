"""Security-scan API — pen-test Pulse-deployed apps against their own
endpoints.

Authorization model: you can only scan a target that Pulse itself
owns. `GET /security/targets` returns the allowlist, resolved from
(a) the monitored Endpoint inventory and (b) deployed apps that have
a resolvable domain. `POST /security/scans` REJECTS any target_url
that isn't in that allowlist — there is no free-text URL path. This
keeps the feature squarely defensive: scan what you deployed.
"""

from __future__ import annotations

import asyncio
from typing import List, Optional

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.deps import get_current_user, require_admin
from models.deployment import DeploymentRequest
from models.endpoint import Endpoint
from models.security_scan import SecurityScan
from models.user import User
from services.security_scanner import dispatch_scan

router = APIRouter(prefix="/security", tags=["security"])


# ---------------------------------------------------------------------------
# Target resolution (the authorization allowlist)
# ---------------------------------------------------------------------------

class ScanTarget(BaseModel):
    kind: str            # "endpoint" | "deployment"
    ref: Optional[str]   # source document id
    label: str
    url: str


def _deployment_url(dep: DeploymentRequest) -> Optional[str]:
    """Best-effort public URL for a deployed app. Explicit domain wins;
    otherwise fall back to `<slug>.<zone>`. Returns None when neither
    is present (nothing scannable)."""
    if dep.domain:
        host = dep.domain
    elif dep.domain_zone:
        # Convention used by generate-manifests.sh for ingress hosts.
        host = f"{dep.repo_slug.replace('_', '-')}.{dep.domain_zone}"
    else:
        return None
    return f"https://{host}"


async def _resolve_targets() -> List[ScanTarget]:
    targets: dict[str, ScanTarget] = {}

    # (a) Monitored http endpoints — Pulse already probes these, so
    #     they are definitionally owned + reachable.
    eps = await Endpoint.find(Endpoint.kind == "http").to_list()
    for ep in eps:
        if not ep.url.startswith(("http://", "https://")):
            continue
        targets[ep.url] = ScanTarget(
            kind="endpoint", ref=str(ep.id), label=ep.name, url=ep.url
        )

    # (b) Deployed apps with a resolvable domain.
    deps = await DeploymentRequest.find(
        DeploymentRequest.status == "completed"
    ).to_list()
    for dep in deps:
        url = _deployment_url(dep)
        if not url or url in targets:
            continue
        targets[url] = ScanTarget(
            kind="deployment", ref=str(dep.id),
            label=f"{dep.repo_slug} ({dep.cluster})", url=url,
        )

    return list(targets.values())


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def _serialize(scan: SecurityScan, *, full: bool = False) -> dict:
    out = {
        "_id": str(scan.id),
        "targetKind": scan.target_kind,
        "targetRef": scan.target_ref,
        "targetLabel": scan.target_label,
        "targetUrl": scan.target_url,
        "engine": scan.engine,
        "profile": getattr(scan, "profile", "fast"),
        "status": scan.status,
        "error": scan.error,
        "severityCounts": scan.severity_counts,
        "topSeverity": scan.top_severity,
        "requestedBy": scan.requested_by,
        "startedAt": scan.started_at.isoformat() if scan.started_at else None,
        "finishedAt": scan.finished_at.isoformat() if scan.finished_at else None,
        "createdAt": scan.created_at.isoformat(),
        "findingCount": len(scan.findings),
    }
    if full:
        out["findings"] = [
            {
                "ruleId": f.rule_id,
                "severity": f.severity,
                "title": f.title,
                "detail": f.detail,
                "evidence": f.evidence,
                "remediation": f.remediation,
                "engine": f.engine,
            }
            for f in scan.findings
        ]
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/targets")
async def list_targets(user: User = Depends(get_current_user)):
    """The scan allowlist — every asset Pulse owns + can scan."""
    return [t.model_dump() for t in await _resolve_targets()]


class CreateScanRequest(BaseModel):
    target_url: str = Field(alias="targetUrl")
    engine: str = "passive"
    # nuclei depth: "fast" (scoped, ~1min) | "deep" (all templates, ~10-15min)
    profile: str = "fast"
    # Optional per-scan request headers for auth-aware scanning — reach
    # BEHIND login (IDOR/auth-bypass/injection live there). Each item is a
    # raw header, e.g. "Authorization: Bearer <test-jwt>" or "Cookie: ...".
    # NEVER persisted on the scan doc (they're credentials).
    auth_headers: list[str] = Field(default_factory=list, alias="authHeaders")

    model_config = {"populate_by_name": True}


def _custom_target_allowed(url: str) -> Optional["ScanTarget"]:
    """Vet a pasted URL. Returns a ScanTarget when custom scanning is
    enabled AND the host is under an org domain; None otherwise.

    Keeps custom scans confined to org-owned infra — a pasted URL can
    only target hosts ending in SECURITY_SCAN_CUSTOM_DOMAINS, so this
    can't be used to scan arbitrary third-party sites."""
    from core.config import settings
    from urllib.parse import urlparse

    if not settings.SECURITY_SCAN_ALLOW_CUSTOM_TARGET:
        return None
    if not url.startswith(("http://", "https://")):
        return None
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return None
    domains = [d.strip().lower() for d in settings.SECURITY_SCAN_CUSTOM_DOMAINS.split(",") if d.strip()]
    if domains and not any(host == d or host.endswith("." + d) for d in domains):
        return None
    return ScanTarget(kind="custom", ref=None, label=f"{host} (custom)", url=url)


@router.post("/scans", status_code=201)
async def create_scan(body: CreateScanRequest, admin: User = Depends(require_admin)):
    # 1) Owned-asset allowlist (deployments + monitored endpoints).
    allowed = {t.url: t for t in await _resolve_targets()}
    target = allowed.get(body.target_url)
    # 2) Fallback: a pasted URL, but only under an org domain.
    if not target:
        target = _custom_target_allowed(body.target_url)
    if not target:
        from core.config import settings
        raise HTTPException(
            status_code=403,
            detail=(
                "Target not allowed. Scan an app Pulse deployed/monitors "
                "(GET /api/security/targets)"
                + (
                    f", or paste a URL under an org domain "
                    f"({settings.SECURITY_SCAN_CUSTOM_DOMAINS})."
                    if settings.SECURITY_SCAN_ALLOW_CUSTOM_TARGET
                    else "."
                )
            ),
        )
    if body.engine not in ("passive", "zap", "nuclei"):
        raise HTTPException(status_code=400, detail="engine must be 'passive', 'nuclei', or 'zap'")
    if body.profile not in ("fast", "deep"):
        raise HTTPException(status_code=400, detail="profile must be 'fast' or 'deep'")

    scan = SecurityScan(
        target_kind=target.kind,
        target_ref=target.ref,
        target_label=target.label,
        target_url=target.url,
        engine=body.engine,
        profile=body.profile,          # type: ignore[arg-type]
        status="queued",
        requested_by=admin.email,
    )
    await scan.insert()

    # Fire-and-forget — the scan runs in the background, the client polls
    # GET /security/scans/{id} for progress (findings stream in live).
    # auth_headers are passed to the task only, never stored on the doc.
    asyncio.create_task(dispatch_scan(scan, auth_headers=body.auth_headers))

    return _serialize(scan)


@router.get("/scans")
async def list_scans(user: User = Depends(get_current_user)):
    scans = await SecurityScan.find_all().sort("-created_at").limit(100).to_list()
    return [_serialize(s) for s in scans]


@router.get("/scans/{scan_id}")
async def get_scan(scan_id: str, user: User = Depends(get_current_user)):
    scan = await SecurityScan.get(PydanticObjectId(scan_id))
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return _serialize(scan, full=True)


@router.delete("/scans/{scan_id}", status_code=204)
async def delete_scan(scan_id: str, admin: User = Depends(require_admin)):
    scan = await SecurityScan.get(PydanticObjectId(scan_id))
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    await scan.delete()
