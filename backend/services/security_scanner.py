"""Passive baseline security scanner for Pulse-deployed apps.

Runs NON-INTRUSIVE checks against a target that Pulse itself owns
(a monitored endpoint or a deployed app). Everything here is passive:
we issue ordinary GET/HEAD requests — the same traffic a browser or
the uptime monitor already sends — and inspect response *metadata*
the server exposes publicly (headers, TLS, cookie flags, banner).

No fuzzing, no injection, no auth bypass, no rate flooding. This is
security-posture hygiene for infrastructure you own, not offensive
tooling. The optional ZAP engine (services below) runs the OWASP ZAP
*baseline* profile, which is likewise passive by design.

Authorization is enforced upstream: the handler only accepts targets
resolved from Pulse's own inventory. This module trusts that the URL
it's handed is owned.
"""

from __future__ import annotations

import asyncio
import ssl
from datetime import datetime, timezone
from typing import List
from urllib.parse import urlparse

import httpx

from core.config import settings
from models.security_scan import Finding, SecurityScan

# Security response headers we expect a hardened app to set, with the
# severity assigned when they're missing + the fix hint.
_EXPECTED_HEADERS = {
    "strict-transport-security": (
        "high", "missing-hsts", "HSTS header absent",
        "Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` "
        "so browsers refuse to downgrade to plain HTTP.",
    ),
    "content-security-policy": (
        "medium", "missing-csp", "Content-Security-Policy absent",
        "Define a CSP to constrain script/style/frame sources and blunt XSS.",
    ),
    "x-frame-options": (
        "medium", "missing-xfo", "X-Frame-Options absent",
        "Set `X-Frame-Options: DENY` (or a CSP frame-ancestors rule) to stop clickjacking.",
    ),
    "x-content-type-options": (
        "low", "missing-xcto", "X-Content-Type-Options absent",
        "Set `X-Content-Type-Options: nosniff` to stop MIME sniffing.",
    ),
    "referrer-policy": (
        "low", "missing-referrer-policy", "Referrer-Policy absent",
        "Set `Referrer-Policy: strict-origin-when-cross-origin` to limit referrer leakage.",
    ),
    "permissions-policy": (
        "info", "missing-permissions-policy", "Permissions-Policy absent",
        "Set a Permissions-Policy to disable unused browser features (camera, geolocation, ...).",
    ),
}

# Banners that disclose stack/version — informational fingerprinting risk.
_BANNER_HEADERS = ("server", "x-powered-by", "x-aspnet-version")


async def _fetch(url: str, timeout: float) -> httpx.Response:
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=timeout, verify=True
    ) as client:
        return await client.get(url)


def _check_tls(url: str) -> List[Finding]:
    out: List[Finding] = []
    scheme = urlparse(url).scheme
    if scheme != "https":
        out.append(Finding(
            rule_id="no-tls",
            severity="high",
            title="Endpoint served over plain HTTP",
            detail="Traffic to this target is unencrypted; credentials and session "
                   "cookies are exposed on the wire.",
            evidence=f"scheme={scheme}",
            remediation="Terminate TLS at the ingress and redirect HTTP→HTTPS.",
        ))
    return out


def _check_headers(resp: httpx.Response) -> List[Finding]:
    out: List[Finding] = []
    present = {k.lower(): v for k, v in resp.headers.items()}
    for header, (sev, rule, title, fix) in _EXPECTED_HEADERS.items():
        # HSTS only meaningful over https; skip its check for http (no-tls
        # finding already covers that case).
        if header == "strict-transport-security" and resp.url.scheme != "https":
            continue
        if header not in present:
            out.append(Finding(
                rule_id=rule, severity=sev, title=title,
                detail=f"Response is missing the `{header}` header.",
                remediation=fix,
            ))
    return out


def _check_banner(resp: httpx.Response) -> List[Finding]:
    out: List[Finding] = []
    present = {k.lower(): v for k, v in resp.headers.items()}
    for h in _BANNER_HEADERS:
        if h in present and present[h].strip():
            out.append(Finding(
                rule_id=f"banner-{h}",
                severity="info",
                title=f"Stack disclosure via `{h}` header",
                detail="The server advertises its software/version, easing targeted "
                       "exploit selection.",
                evidence=f"{h}: {present[h]}",
                remediation=f"Strip or genericize the `{h}` response header at the proxy.",
            ))
    return out


def _check_cookies(resp: httpx.Response) -> List[Finding]:
    out: List[Finding] = []
    # httpx exposes Set-Cookie via headers.get_list.
    for raw in resp.headers.get_list("set-cookie"):
        low = raw.lower()
        name = raw.split("=", 1)[0].strip()
        missing = []
        if "secure" not in low:
            missing.append("Secure")
        if "httponly" not in low:
            missing.append("HttpOnly")
        if "samesite" not in low:
            missing.append("SameSite")
        if missing:
            out.append(Finding(
                rule_id="weak-cookie-flags",
                severity="medium",
                title=f"Cookie `{name}` missing flags: {', '.join(missing)}",
                detail="Session cookies without these flags are exposed to theft via "
                       "XSS, MITM, or CSRF.",
                evidence=f"{name} (missing {', '.join(missing)})",
                remediation="Set Secure + HttpOnly + SameSite=Lax|Strict on session cookies.",
            ))
    return out


async def run_passive_scan(scan: SecurityScan) -> None:
    """Execute the built-in passive baseline against scan.target_url.

    Mutates + saves the scan document through its lifecycle. Never
    raises — any failure lands as status=failed with the error text.
    """
    scan.status = "running"
    scan.started_at = datetime.now(timezone.utc)
    await scan.save()

    findings: List[Finding] = []
    try:
        findings.extend(_check_tls(scan.target_url))
        resp = await _fetch(scan.target_url, timeout=float(settings.SECURITY_SCAN_TIMEOUT))
        findings.extend(_check_headers(resp))
        findings.extend(_check_banner(resp))
        findings.extend(_check_cookies(resp))

        # No findings at all is itself worth recording as a clean pass.
        scan.findings = findings
        scan.recompute()
        scan.status = "completed"
    except httpx.HTTPError as e:
        scan.status = "failed"
        scan.error = f"request failed: {e.__class__.__name__}: {e}"
    except ssl.SSLError as e:
        # A TLS handshake failure is itself a finding, not just an error.
        scan.findings = findings + [Finding(
            rule_id="tls-handshake-failed",
            severity="high",
            title="TLS handshake failed",
            detail="The endpoint's certificate could not be validated.",
            evidence=str(e),
            remediation="Fix the cert chain / expiry / SNI at the ingress.",
        )]
        scan.recompute()
        scan.status = "completed"
    except Exception as e:  # pragma: no cover - defensive
        scan.status = "failed"
        scan.error = f"{e.__class__.__name__}: {e}"

    scan.finished_at = datetime.now(timezone.utc)
    await scan.save()

    # Best-effort Discord alert on high/critical.
    try:
        await _maybe_alert(scan)
    except Exception:
        pass


async def _maybe_alert(scan: SecurityScan) -> None:
    webhook = settings.DISCORD_SECURITY_WEBHOOK_URL or settings.DISCORD_DB_ALERT_WEBHOOK_URL
    if not webhook:
        return
    if scan.top_severity not in ("critical", "high"):
        return
    counts = scan.severity_counts
    lines = "\\n".join(
        f"**{s.upper()}**: {counts[s]}"
        for s in ("critical", "high", "medium", "low")
        if counts.get(s)
    )
    payload = {
        "content": (
            f"🛡️ **Security scan finding** — `{scan.target_label}`\\n"
            f"{scan.target_url}\\n{lines}"
        )
    }
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(webhook, json=payload)


async def dispatch_scan(scan: SecurityScan) -> None:
    """Route to the requested engine. Passive is always available; nuclei
    and ZAP require their container + the matching *_ENABLED flag, and
    degrade to passive when unavailable."""
    if scan.engine == "nuclei" and settings.SECURITY_SCAN_NUCLEI_ENABLED:
        await _run_nuclei_scan(scan)
    elif scan.engine == "zap" and settings.SECURITY_SCAN_ZAP_ENABLED:
        await _run_zap_scan(scan)
    else:
        # Fall back to passive for any engine we can't run here.
        scan.engine = "passive"
        await run_passive_scan(scan)


# Nuclei severity strings map 1:1 onto our ladder.
_NUCLEI_SEV = {"critical", "high", "medium", "low", "info"}


async def _run_nuclei_scan(scan: SecurityScan) -> None:
    """ProjectDiscovery Nuclei — real active template-based vuln scan.

    Runs the nuclei container against the target with JSONL output, a
    request rate limit, and a severity filter. Each JSON line becomes a
    Finding. Templates are detection-oriented (CVEs, misconfigurations,
    exposures, default credentials) rather than destructive exploits —
    still, we only ever point it at Pulse-owned assets (enforced upstream
    by the allowlist) and cap the request rate. Degrades to passive on
    any failure so a scan always returns something useful.
    """
    import json

    scan.status = "running"
    scan.started_at = datetime.now(timezone.utc)
    await scan.save()

    cmd = [
        "docker", "run", "--rm", "--network", "host",
        settings.SECURITY_SCAN_NUCLEI_IMAGE,
        "-u", scan.target_url,
        "-jsonl",                                   # one JSON object per line
        "-silent",                                  # suppress banner/progress
        "-severity", settings.SECURITY_SCAN_NUCLEI_SEVERITY,
        "-rate-limit", str(settings.SECURITY_SCAN_NUCLEI_RATE),
        "-no-color",
    ]
    if settings.SECURITY_SCAN_NUCLEI_TAGS.strip():
        cmd += ["-tags", settings.SECURITY_SCAN_NUCLEI_TAGS.strip()]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(
            proc.communicate(), timeout=float(settings.SECURITY_SCAN_NUCLEI_TIMEOUT)
        )

        findings: List[Finding] = []
        for line in stdout.decode("utf-8", "replace").splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            info = obj.get("info") or {}
            sev = (info.get("severity") or "info").lower()
            if sev not in _NUCLEI_SEV:
                sev = "info"
            # Nuclei classification / remediation live under info.*
            classification = info.get("classification") or {}
            cve = ", ".join(classification.get("cve-id") or []) if classification else ""
            remediation = info.get("remediation") or (
                f"Review + patch. Template: {obj.get('template-id', '?')}."
                + (f" CVE: {cve}." if cve else "")
            )
            findings.append(Finding(
                rule_id=f"nuclei-{obj.get('template-id', 'x')}",
                severity=sev,  # type: ignore[arg-type]
                title=info.get("name") or obj.get("template-id") or "Nuclei finding",
                detail=(info.get("description") or "")[:600],
                evidence=obj.get("matched-at") or obj.get("host"),
                remediation=remediation[:600],
                engine="nuclei",
            ))

        scan.findings = findings
        scan.recompute()
        scan.status = "completed"
    except Exception as e:
        # Nuclei / docker unavailable → run the always-on passive engine so
        # the scan still yields posture findings.
        scan.error = f"nuclei unavailable ({e.__class__.__name__}); ran passive instead"
        scan.engine = "passive"
        await run_passive_scan(scan)
        return

    scan.finished_at = datetime.now(timezone.utc)
    await scan.save()
    try:
        await _maybe_alert(scan)
    except Exception:
        pass


async def _run_zap_scan(scan: SecurityScan) -> None:
    """OWASP ZAP baseline (passive spider + rules, non-destructive).

    Runs the stable ZAP container against the target and parses its
    JSON report into Finding rows. Requires docker to be reachable
    from the API container (mount the socket) OR swap this for a k8s
    Job in a hardened deploy. Falls back to passive on any failure.
    """
    scan.status = "running"
    scan.started_at = datetime.now(timezone.utc)
    await scan.save()

    import json
    import tempfile
    import os

    out_dir = tempfile.mkdtemp(prefix="zap-")
    report = os.path.join(out_dir, "zap.json")
    zap_sev = {"3": "high", "2": "medium", "1": "low", "0": "info"}

    cmd = [
        "docker", "run", "--rm", "--network", "host",
        "-v", f"{out_dir}:/zap/wrk:rw",
        settings.SECURITY_SCAN_ZAP_IMAGE,
        "zap-baseline.py", "-t", scan.target_url,
        "-J", "zap.json", "-I",  # -I: don't fail the process on warnings
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(
            proc.communicate(), timeout=float(settings.SECURITY_SCAN_ZAP_TIMEOUT)
        )
        with open(report) as fh:
            data = json.load(fh)
        findings: List[Finding] = []
        for site in data.get("site", []):
            for alert in site.get("alerts", []):
                sev = zap_sev.get(str(alert.get("riskcode", "0")), "info")
                findings.append(Finding(
                    rule_id=f"zap-{alert.get('pluginid', 'x')}",
                    severity=sev,
                    title=alert.get("name", "ZAP finding"),
                    detail=(alert.get("desc", "") or "")[:600],
                    evidence=(alert.get("instances", [{}]) or [{}])[0].get("uri"),
                    remediation=(alert.get("solution", "") or "")[:600],
                    engine="zap",
                ))
        scan.findings = findings
        scan.recompute()
        scan.status = "completed"
    except Exception as e:
        # ZAP unavailable → degrade to the always-on passive engine so
        # the scan still returns something useful.
        scan.error = f"zap unavailable ({e.__class__.__name__}); ran passive instead"
        scan.engine = "passive"
        await run_passive_scan(scan)
        return

    scan.finished_at = datetime.now(timezone.utc)
    await scan.save()
    try:
        await _maybe_alert(scan)
    except Exception:
        pass
