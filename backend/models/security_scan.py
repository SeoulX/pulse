from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from beanie import Document, Indexed
from pydantic import BaseModel, Field

# Severity ladder — ordered so counts + gating can compare numerically.
Severity = Literal["critical", "high", "medium", "low", "info"]
SEVERITY_ORDER = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

ScanStatus = Literal["queued", "running", "completed", "failed"]
# Which engine produced the run.
#   passive = built-in pure-python baseline (headers, TLS, cookies, banner).
#             Non-intrusive — GET/HEAD only.
#   nuclei  = ProjectDiscovery Nuclei — real active template-based vuln
#             scanning (CVEs, misconfig, exposures, default creds). Thousands
#             of community templates. Rate-limited + severity-filtered.
#   zap     = OWASP ZAP baseline container (passive spider + rules).
ScanEngine = Literal["passive", "zap", "nuclei"]


class Finding(BaseModel):
    # Stable slug for the rule that fired (e.g. "missing-hsts").
    rule_id: str = Field(alias="ruleId")
    severity: Severity
    title: str
    detail: str
    # Concrete evidence pulled from the response (header value, banner,
    # cookie string). Never contains secrets — passive checks only read
    # response metadata the server already exposes publicly.
    evidence: Optional[str] = None
    remediation: str
    # Which engine emitted it — lets the UI badge ZAP vs built-in.
    engine: ScanEngine = "passive"

    model_config = {"populate_by_name": True}


class SecurityScan(Document):
    # --- target (must resolve to a Pulse-owned asset) ---
    # `target_kind` records how the target was authorized:
    #   endpoint   → a monitored Endpoint document (Pulse already probes it)
    #   deployment → derived from a DeploymentRequest's domain/port
    target_kind: Literal["endpoint", "deployment"] = Field(alias="targetKind")
    target_ref: Optional[str] = Field(default=None, alias="targetRef")  # source doc id
    target_label: str = Field(alias="targetLabel")  # human name (repo slug / endpoint name)
    target_url: Indexed(str) = Field(alias="targetUrl")

    engine: ScanEngine = "passive"
    # Scan depth (nuclei): fast = scoped high-signal templates (~1min);
    # deep = full template set + info severity (~10-15min).
    profile: Literal["fast", "deep"] = "fast"
    status: ScanStatus = "queued"
    error: Optional[str] = None

    findings: List[Finding] = Field(default_factory=list)
    # Denormalized severity histogram so list views don't rehydrate
    # every finding. Recomputed whenever findings change.
    severity_counts: Dict[str, int] = Field(
        default_factory=lambda: {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0},
        alias="severityCounts",
    )
    # Highest severity present — powers the list badge + gating.
    top_severity: Optional[Severity] = Field(default=None, alias="topSeverity")

    requested_by: str = Field(alias="requestedBy")
    started_at: Optional[datetime] = Field(default=None, alias="startedAt")
    finished_at: Optional[datetime] = Field(default=None, alias="finishedAt")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), alias="createdAt"
    )

    class Settings:
        name = "security_scans"

    model_config = {"populate_by_name": True}

    def recompute(self) -> None:
        counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
        for f in self.findings:
            counts[f.severity] = counts.get(f.severity, 0) + 1
        self.severity_counts = counts
        top = None
        for sev in ("critical", "high", "medium", "low", "info"):
            if counts[sev] > 0:
                top = sev
                break
        self.top_severity = top
