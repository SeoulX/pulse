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
from typing import List, Optional
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


async def dispatch_scan(
    scan: SecurityScan,
    auth_headers: Optional[list[str]] = None,
) -> None:
    """Route to the requested engine. Passive is always available; nuclei
    and ZAP require their container + the matching *_ENABLED flag, and
    degrade to passive when unavailable.

    `auth_headers` (nuclei only) are per-scan request headers — e.g.
    ["Authorization: Bearer <test-jwt>", "Cookie: session=..."] — so the
    scan reaches behind login. They are NEVER persisted on the scan doc
    (they're credentials); they only live for the duration of this run.
    """
    if scan.engine == "nuclei" and settings.SECURITY_SCAN_NUCLEI_ENABLED:
        await _run_nuclei_scan(scan, auth_headers=auth_headers)
    elif scan.engine == "zap" and settings.SECURITY_SCAN_ZAP_ENABLED:
        await _run_zap_scan(scan)
    else:
        # Fall back to passive for any engine we can't run here.
        scan.engine = "passive"
        await run_passive_scan(scan)


# Nuclei severity strings map 1:1 onto our ladder.
_NUCLEI_SEV = {"critical", "high", "medium", "low", "info"}


def _nuclei_mode() -> str:
    """Resolve the effective nuclei runner mode.
    `auto` → k8s when running in-cluster (SA token mounted), else docker
    when a container name is set, else local (binary / docker run)."""
    mode = settings.SECURITY_SCAN_NUCLEI_MODE
    if mode != "auto":
        return mode
    import os
    if os.path.exists("/var/run/secrets/kubernetes.io/serviceaccount/token"):
        return "k8s"
    if settings.SECURITY_SCAN_NUCLEI_CONTAINER:
        return "docker"
    return "local"


async def _nuclei_exec_in_pod(cmd: list, timeout: float, on_line=None) -> bytes:
    """Exec `cmd` in the nuclei runner POD over the Kubernetes API.

    Prod path: the kl-1/nuclei Deployment runs a long-lived pod; Pulse's
    in-cluster ServiceAccount (bound to the nuclei-exec Role) streams an
    exec against it. Uses the kubernetes client; the blocking stream runs
    off-thread. Raises on missing pod / RBAC so the caller degrades to
    passive.

    `on_line`, when given, is called with each COMPLETE stdout line as it
    arrives (thread context) — used to stream findings live instead of
    waiting for the whole run. The full bytes are still returned.
    """
    from kubernetes import client, config as k8s_config  # optional dep
    from kubernetes.stream import stream

    ns = settings.SECURITY_SCAN_NUCLEI_K8S_NAMESPACE
    selector = settings.SECURITY_SCAN_NUCLEI_K8S_SELECTOR
    _SA_TOKEN = "/var/run/secrets/kubernetes.io/serviceaccount/token"

    def _run() -> bytes:
        k8s_config.load_incluster_config()
        cfg = client.Configuration.get_default_copy()
        # kubernetes-client 36 + k3s auth fix. load_incluster_config stores
        # the SA token as api_key['authorization']='bearer <tok>' (lowercase
        # 'bearer', which k3s's case-sensitive "Bearer " strip rejects) and
        # the generated auth setting looks it up under the 'BearerToken'
        # key. Net effect: REST calls 401, and the websocket exec handshake
        # raises an ApiException whose None body then crashes the client's
        # error handler (AttributeError). Rebuild the token under BOTH keys
        # with a capital-B 'Bearer' prefix, and set it as the DEFAULT config
        # so the websocket handshake (which reads the default) authenticates.
        try:
            with open(_SA_TOKEN) as fh:
                token = fh.read().strip()
            cfg.api_key = {"authorization": token, "BearerToken": token}
            cfg.api_key_prefix = {"authorization": "Bearer", "BearerToken": "Bearer"}
            client.Configuration.set_default(cfg)
        except OSError:
            pass  # not in-cluster — leave whatever load_incluster set
        v1 = client.CoreV1Api(client.ApiClient(cfg))
        pods = v1.list_namespaced_pod(ns, label_selector=selector).items
        ready = [p for p in pods if (p.status and p.status.phase == "Running")]
        if not ready:
            raise RuntimeError(f"no running nuclei pod ({selector} in {ns})")
        pod = ready[0].metadata.name
        resp = stream(
            v1.connect_get_namespaced_pod_exec,
            pod, ns, command=cmd,
            stderr=False, stdin=False, stdout=True, tty=False,
            _preload_content=False,
        )
        out = bytearray()
        line_buf = bytearray()
        # Drain the stream until the exec finishes, emitting complete
        # lines as they arrive so findings stream live.
        while resp.is_open():
            resp.update(timeout=1)
            if resp.peek_stdout():
                chunk = resp.read_stdout().encode("utf-8", "replace")
                out.extend(chunk)
                if on_line is not None:
                    line_buf.extend(chunk)
                    while b"\n" in line_buf:
                        raw, _, rest = line_buf.partition(b"\n")
                        line_buf = bytearray(rest)
                        try:
                            on_line(raw.decode("utf-8", "replace"))
                        except Exception:
                            pass
        if on_line is not None and line_buf:
            try:
                on_line(line_buf.decode("utf-8", "replace"))
            except Exception:
                pass
        resp.close()
        return bytes(out)

    return await asyncio.wait_for(asyncio.to_thread(_run), timeout=timeout)


async def _nuclei_exec_in_container(container: str, cmd: list, timeout: float) -> bytes:
    """Run `cmd` inside a long-lived nuclei sidecar via the Docker API.

    Uses docker-py (talks to the mounted /var/run/docker.sock — no docker
    CLI binary needed in the API image). docker-py is synchronous, so the
    blocking exec is pushed to a thread. Returns the combined stdout bytes
    (nuclei JSONL). Raises on missing container / socket so the caller
    degrades to passive.
    """
    import docker  # local import — optional dep, only needed for this path

    def _run() -> bytes:
        client = docker.from_env()
        cont = client.containers.get(container)
        # demux=False → single interleaved stream; nuclei writes JSONL to
        # stdout with -silent, so stderr noise is minimal.
        _code, output = cont.exec_run(cmd, stdout=True, stderr=False, demux=False)
        return output or b""

    return await asyncio.wait_for(asyncio.to_thread(_run), timeout=timeout)


def _parse_nuclei_line(line: str) -> Optional[Finding]:
    """Turn one nuclei -jsonl stdout line into a Finding, or None."""
    import json
    line = line.strip()
    if not line or not line.startswith("{"):
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    info = obj.get("info") or {}
    sev = (info.get("severity") or "info").lower()
    if sev not in _NUCLEI_SEV:
        sev = "info"
    classification = info.get("classification") or {}
    cve = ", ".join(classification.get("cve-id") or []) if classification else ""
    remediation = info.get("remediation") or (
        f"Review + patch. Template: {obj.get('template-id', '?')}."
        + (f" CVE: {cve}." if cve else "")
    )
    return Finding(
        rule_id=f"nuclei-{obj.get('template-id', 'x')}",
        severity=sev,  # type: ignore[arg-type]
        title=info.get("name") or obj.get("template-id") or "Nuclei finding",
        detail=(info.get("description") or "")[:600],
        evidence=obj.get("matched-at") or obj.get("host"),
        remediation=remediation[:600],
        engine="nuclei",
    )


def _build_nuclei_args(scan: SecurityScan, auth_headers: Optional[list[str]]) -> list[str]:
    """Assemble the nuclei CLI args. `profile=deep` on the scan widens the
    template set + severity; otherwise the FAST config defaults apply."""
    deep = getattr(scan, "profile", "fast") == "deep"
    severity = (
        "info,low,medium,high,critical" if deep
        else settings.SECURITY_SCAN_NUCLEI_SEVERITY
    )
    args = [
        "-u", scan.target_url,
        "-jsonl", "-silent", "-no-color",
        "-severity", severity,
        "-rate-limit", str(settings.SECURITY_SCAN_NUCLEI_RATE),
        "-c", str(settings.SECURITY_SCAN_NUCLEI_CONCURRENCY),
        "-timeout", str(settings.SECURITY_SCAN_NUCLEI_REQ_TIMEOUT),
        "-retries", str(settings.SECURITY_SCAN_NUCLEI_RETRIES),
        "-disable-update-check", "-duc",
    ]
    # Template scope. Deep = all templates (omit -t); fast = scoped dirs.
    if not deep:
        for t in settings.SECURITY_SCAN_NUCLEI_TEMPLATES.split(","):
            t = t.strip()
            if t:
                args += ["-t", t]
    if settings.SECURITY_SCAN_NUCLEI_TAGS.strip():
        args += ["-tags", settings.SECURITY_SCAN_NUCLEI_TAGS.strip()]
    if settings.SECURITY_SCAN_NUCLEI_EXCLUDE_TAGS.strip():
        args += ["-etags", settings.SECURITY_SCAN_NUCLEI_EXCLUDE_TAGS.strip()]
    if settings.SECURITY_SCAN_NUCLEI_NO_INTERACTSH:
        args += ["-no-interactsh"]
    # Auth-aware: per-scan request headers so nuclei reaches behind login.
    # Passed as -H "Key: Value" argv pairs (no shell — no injection risk).
    for h in (auth_headers or []):
        h = h.strip()
        if h and ":" in h:
            args += ["-H", h]
    return args


async def _run_nuclei_scan(
    scan: SecurityScan,
    auth_headers: Optional[list[str]] = None,
) -> None:
    """ProjectDiscovery Nuclei — real active template-based vuln scan.

    Streams findings LIVE: each JSONL line nuclei emits is parsed and
    appended to the scan (throttled saves) + logged, so the UI's polling
    view and `kubectl logs -f` both show findings as they're discovered
    rather than only at the end. Degrades to passive on any failure.
    """
    import shutil

    scan.status = "running"
    scan.started_at = datetime.now(timezone.utc)
    scan.findings = []
    await scan.save()

    nuclei_args = _build_nuclei_args(scan, auth_headers)
    timeout = float(settings.SECURITY_SCAN_NUCLEI_TIMEOUT)
    mode = _nuclei_mode()

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def _emit(line: str) -> None:
        # Thread-safe hand-off from the exec thread to the async consumer.
        loop.call_soon_threadsafe(queue.put_nowait, line)

    async def _producer() -> None:
        try:
            if mode == "k8s":
                await _nuclei_exec_in_pod(["nuclei", *nuclei_args], timeout, on_line=_emit)
            elif mode == "docker" and settings.SECURITY_SCAN_NUCLEI_CONTAINER:
                # Container path returns bytes; emit its lines after the run.
                out = await _nuclei_exec_in_container(
                    settings.SECURITY_SCAN_NUCLEI_CONTAINER,
                    ["nuclei", *nuclei_args], timeout,
                )
                for ln in out.decode("utf-8", "replace").splitlines():
                    _emit(ln)
            else:
                cmd = (["nuclei", *nuclei_args] if shutil.which("nuclei")
                       else ["docker", "run", "--rm", "--network", "host",
                             settings.SECURITY_SCAN_NUCLEI_IMAGE, *nuclei_args])
                proc = await asyncio.create_subprocess_exec(
                    *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                )
                assert proc.stdout is not None
                async for raw in proc.stdout:               # live per-line
                    _emit(raw.decode("utf-8", "replace"))
                await asyncio.wait_for(proc.wait(), timeout=timeout)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)  # sentinel

    prod = asyncio.create_task(_producer())
    findings: List[Finding] = []
    last_save = 0.0
    try:
        import time as _t
        while True:
            line = await queue.get()
            if line is None:
                break
            f = _parse_nuclei_line(line)
            if not f:
                continue
            findings.append(f)
            scan.findings = findings
            scan.recompute()
            log.info(
                "nuclei finding [%s] %s @ %s (%s, %d so far)",
                f.severity, f.title, f.evidence, scan.target_label, len(findings),
            )
            # Throttle DB writes to ~1/2s so a burst of findings doesn't
            # hammer mongo; the UI polls every 2.5s anyway.
            now = _t.monotonic()
            if now - last_save > 2:
                await scan.save()
                last_save = now
        await prod  # surface producer exceptions
        scan.findings = findings
        scan.recompute()
        scan.status = "completed"
    except Exception as e:
        prod.cancel()
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
